import { VersionVector } from '../../domain/sync/VersionVector.ts';
import type { Database, SqlParams, SqlRow } from '../../ports/Database.ts';
import type { WallClock } from '../../ports/WallClock.ts';
import { SqliteSyncLedgerRepository } from '../sqlite/SqliteSyncLedgerRepository.ts';
import { ROW_INSERTED } from './CaptureTriggers.ts';

/**
 * Decorator da porta `Database` que carimba as escritas capturadas (sync-design §5.4;
 * sync-plan §3.1). Os triggers `TEMP` só sabem *o que* mudou; o relógio e a sequência vêm
 * daqui, no fim da transação mais externa e antes do commit, para que toda célula escrita
 * por uma unidade de trabalho compartilhe uma sequência e um HLC — as duas pernas de uma
 * transferência trafegam e são aplicadas juntas (sync-design §5.3).
 *
 * É um decorator, e não código nos Services, para que nenhum caso de uso precise lembrar de
 * carimbar: tudo o que passa pela porta é coberto, inclusive uma escrita fora de transação,
 * que é embrulhada numa.
 */
export class CapturingDatabase implements Database {
    private depth = 0;
    private readonly ledger: SqliteSyncLedgerRepository;
    private readonly commitListeners: (() => void)[] = [];

    /**
     * @param inner Conexão real, já com a captura instalada (`installCapture`).
     * @param wallClock Relógio de parede para o `tick` do HLC; vem de porta porque o núcleo não
     * lê o relógio do sistema.
     */
    public constructor(private readonly inner: Database, private readonly wallClock: WallClock) {
        this.ledger = new SqliteSyncLedgerRepository(inner);
    }

    /**
     * @param sql Instrução de escrita.
     * @param params Parâmetros nomeados.
     * @return As linhas alteradas.
     */
    public run(sql: string, params?: SqlParams): { readonly changes: number } {
        return this.depth > 0 ? this.inner.run(sql, params) : this.transaction(() => this.inner.run(sql, params));
    }

    /**
     * @param sql Consulta.
     * @param params Parâmetros nomeados.
     * @return A primeira linha, ou `undefined`.
     */
    public get(sql: string, params?: SqlParams): SqlRow | undefined {
        return this.inner.get(sql, params);
    }

    /**
     * @param sql Consulta.
     * @param params Parâmetros nomeados.
     * @return Todas as linhas.
     */
    public all(sql: string, params?: SqlParams): readonly SqlRow[] {
        return this.inner.all(sql, params);
    }

    /**
     * @param sql Script; embrulhado numa transação quando chega fora de uma, como `run`.
     */
    public exec(sql: string): void {
        if (this.depth > 0) {
            this.inner.exec(sql);
            return;
        }
        this.transaction(() => {
            this.inner.exec(sql);
        });
    }

    /**
     * @param fn Trabalho atômico.
     * @return O que `fn` devolveu, depois de carimbar o que ele escreveu.
     */
    public transaction<T>(fn: () => T): T {
        if (this.depth > 0) {
            return this.inner.transaction(fn);
        }
        this.depth++;
        try {
            // O driver devolve o resultado do trabalho; o carimbo volta junto, para avisar depois do commit.
            const { value: result, stamped } = this.inner.transaction(() => {
                const value = fn();
                return { value, stamped: this.stamp() };
            });
            if (stamped) {
                for (const listener of this.commitListeners) {
                    listener();
                }
            }
            return result;
        } finally {
            this.depth--;
        }
    }

    /**
     * Avisa depois de cada commit que carimbou alguma escrita. É o gatilho do modo ao vivo
     * (sync-design §7.4, passo 8): a sessão envia a escrita assim que ela é confirmada, sem
     * que cada caso de uso precise saber que há uma sessão aberta.
     *
     * @param listener Chamado fora da transação, depois do commit.
     */
    public onCommit(listener: () => void): void {
        this.commitListeners.push(listener);
    }

    /**
     * Converte as células sujas em entradas de relógio. Uma transação sem escrita capturada
     * não consome sequência, para que leituras não inflem o vetor.
     * Regra de negócio (Sincronização): uma linha criada recebe só a entrada de linha; as
     * colunas alteradas na mesma transação já estão cobertas por ela (sync-design §5.3).
     *
     * @return `true` quando a transação produziu entradas de relógio.
     */
    private stamp(): boolean {
        if (this.inner.get('SELECT 1 AS dirty FROM temp.sync_dirty LIMIT 1') === undefined) {
            return false;
        }
        const state = this.ledger.findState();
        if (state === null) {
            // Fora de um grupo não há o que carimbar; a captura nem deveria estar ligada.
            this.inner.run('DELETE FROM temp.sync_dirty');
            return false;
        }
        const clock = state.clock.tick(this.wallClock.millis());
        const seq = state.nextSeq;
        const params = { hlc: clock.toString(), origin: state.deviceId, seq, inserted: ROW_INSERTED };
        this.inner.run(
            `INSERT INTO sync_rows (table_name, row_id, hlc, origin, seq)
            SELECT table_name, row_id, :hlc, :origin, :seq FROM temp.sync_dirty WHERE column_name = :inserted
            ON CONFLICT (table_name, row_id) DO UPDATE SET hlc = excluded.hlc, origin = excluded.origin, seq = excluded.seq`,
            params,
        );
        this.inner.run(
            `INSERT INTO sync_cells (table_name, row_id, column_name, hlc, origin, seq)
            SELECT d.table_name, d.row_id, d.column_name, :hlc, :origin, :seq FROM temp.sync_dirty d
            WHERE d.column_name <> :inserted AND NOT EXISTS (
                SELECT 1 FROM temp.sync_dirty r WHERE r.table_name = d.table_name AND r.row_id = d.row_id AND r.column_name = :inserted)
            ON CONFLICT (table_name, row_id, column_name) DO UPDATE SET hlc = excluded.hlc, origin = excluded.origin, seq = excluded.seq`,
            params,
        );
        this.inner.run('DELETE FROM temp.sync_dirty');
        this.ledger.saveState({ ...state, clock, nextSeq: seq + 1 });
        this.ledger.saveVector(VersionVector.of([[state.deviceId, seq]]));
        return true;
    }
}
