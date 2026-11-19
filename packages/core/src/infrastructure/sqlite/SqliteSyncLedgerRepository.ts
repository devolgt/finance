import { DeviceId, GroupId } from '../../domain/shared/ids.ts';
import { HybridLogicalClock } from '../../domain/sync/HybridLogicalClock.ts';
import { SYNCED_TABLES } from '../../domain/sync/SyncCatalog.ts';
import type { LedgerEntry, Provenance, SyncState } from '../../domain/sync/SyncState.ts';
import { VersionVector } from '../../domain/sync/VersionVector.ts';
import type { Database } from '../../ports/Database.ts';
import type { SyncLedgerRepository } from '../../repositories/SyncLedgerRepository.ts';
import { RowReader } from './RowReader.ts';

/** Implementação SQLite das tabelas da sincronização (migration `0009`). */
export class SqliteSyncLedgerRepository implements SyncLedgerRepository {
    /**
     * @param database Conexão do núcleo; a mesma em que a captura está instalada, para que o
     * interruptor e as tabelas de relógio participem da transação da escrita.
     */
    public constructor(private readonly database: Database) {}

    /**
     * @return A identidade gravada, ou `null` fora de um grupo.
     */
    public findState(): SyncState | null {
        const row = this.database.get('SELECT device_id, group_id, hlc, next_seq FROM sync_state WHERE singleton = 1');
        if (row === undefined) {
            return null;
        }
        const reader = new RowReader('sync_state', row);
        return {
            deviceId: DeviceId(reader.text('device_id')),
            groupId: GroupId(reader.text('group_id')),
            clock: HybridLogicalClock.parse(reader.text('hlc')),
            nextSeq: reader.number('next_seq'),
        };
    }

    /**
     * @param state Identidade a gravar.
     */
    public saveState(state: SyncState): void {
        this.database.run(
            `INSERT INTO sync_state (singleton, device_id, group_id, hlc, next_seq) VALUES (1, :deviceId, :groupId, :hlc, :nextSeq)
            ON CONFLICT (singleton) DO UPDATE SET device_id = excluded.device_id, group_id = excluded.group_id,
                hlc = excluded.hlc, next_seq = excluded.next_seq`,
            { deviceId: state.deviceId, groupId: state.groupId, hlc: state.clock.toString(), nextSeq: state.nextSeq },
        );
    }

    /** Apaga identidade e vetor; as tabelas são locais e o apagar não é capturado. */
    public clearState(): void {
        this.database.run('DELETE FROM sync_state');
        this.database.run('DELETE FROM sync_vector');
    }

    /**
     * @return O vetor gravado.
     */
    public vector(): VersionVector {
        return VersionVector.of(this.database.all('SELECT origin, seq FROM sync_vector').map((row) => {
            const reader = new RowReader('sync_vector', row);
            return [DeviceId(reader.text('origin')), reader.number('seq')] as const;
        }));
    }

    /**
     * @param vector Vetor a gravar; só avança, como o próprio `VersionVector`.
     */
    public saveVector(vector: VersionVector): void {
        for (const [origin, seq] of vector.toEntries()) {
            this.database.run(
                `INSERT INTO sync_vector (origin, seq) VALUES (:origin, :seq)
                ON CONFLICT (origin) DO UPDATE SET seq = max(seq, excluded.seq)`,
                { origin, seq },
            );
        }
    }

    /** Vale até o fim da transação corrente; o SQLite o desliga sozinho no commit. */
    public deferForeignKeys(): void {
        this.database.run('PRAGMA defer_foreign_keys = ON');
    }

    /**
     * @return O `user_version` gravado pelo runner de migrations.
     */
    public schemaVersion(): number {
        const row = this.database.get('PRAGMA user_version');
        return row === undefined ? 0 : new RowReader('pragma', row).number('user_version');
    }

    /**
     * @return `true` quando há linha em alguma tabela sincronizada.
     */
    public hasDomainData(): boolean {
        return SYNCED_TABLES.some((table) => this.database.get(`SELECT 1 AS found FROM main.${table.name} LIMIT 1`) !== undefined);
    }

    /**
     * @param provenance Procedência da ativação.
     * @return Quantas linhas receberam entrada.
     */
    public backfill(provenance: Provenance): number {
        let total = 0;
        for (const table of SYNCED_TABLES) {
            total += this.database.run(
                `INSERT INTO sync_rows (table_name, row_id, hlc, origin, seq)
                SELECT '${table.name}', id, :hlc, :origin, :seq FROM main.${table.name} WHERE true
                ON CONFLICT (table_name, row_id) DO NOTHING`,
                this.provenanceParams(provenance),
            ).changes;
        }
        return total;
    }

    /**
     * Junta linhas e células numa consulta só, ordenada pelo relógio. O vetor do par entra
     * como JSON para que a consulta seja uma só, sem tabela temporária por sessão.
     *
     * @param vector O que o par já possui.
     * @return As entradas que faltam, em ordem de relógio.
     */
    public entriesAfter(vector: VersionVector): readonly LedgerEntry[] {
        const known = JSON.stringify(Object.fromEntries(vector.toEntries()));
        return this.database.all(
            `SELECT table_name, row_id, NULL AS column_name, hlc, origin, seq FROM sync_rows r
            WHERE r.seq > coalesce((SELECT value FROM json_each(:known) WHERE key = r.origin), 0)
            UNION ALL
            SELECT table_name, row_id, column_name, hlc, origin, seq FROM sync_cells c
            WHERE c.seq > coalesce((SELECT value FROM json_each(:known) WHERE key = c.origin), 0)
            ORDER BY hlc, table_name, row_id, column_name`,
            { known },
        ).map((row) => {
            const reader = new RowReader('sync_ledger', row);
            return {
                table: reader.text('table_name'),
                rowId: reader.text('row_id'),
                column: reader.nullableText('column_name'),
                clock: HybridLogicalClock.parse(reader.text('hlc')),
                origin: DeviceId(reader.text('origin')),
                seq: reader.number('seq'),
            };
        });
    }

    /**
     * @param table Tabela sincronizada.
     * @param rowId Linha.
     * @return Procedência da criação, ou `null`.
     */
    public rowEntry(table: string, rowId: string): Provenance | null {
        const row = this.database.get('SELECT hlc, origin, seq FROM sync_rows WHERE table_name = :table AND row_id = :rowId', { table, rowId });
        return row === undefined ? null : this.toProvenance(row);
    }

    /**
     * @param table Tabela sincronizada.
     * @param rowId Linha.
     * @return Relógio de cada célula alterada depois da criação.
     */
    public cellClocks(table: string, rowId: string): ReadonlyMap<string, HybridLogicalClock> {
        return new Map(this.database.all(
            'SELECT column_name, hlc FROM sync_cells WHERE table_name = :table AND row_id = :rowId',
            { table, rowId },
        ).map((row) => {
            const reader = new RowReader('sync_cells', row);
            return [reader.text('column_name'), HybridLogicalClock.parse(reader.text('hlc'))] as const;
        }));
    }

    /**
     * @param table Tabela.
     * @param rowId Linha criada.
     * @param provenance Procedência da criação.
     */
    public putRow(table: string, rowId: string, provenance: Provenance): void {
        this.database.run(
            `INSERT INTO sync_rows (table_name, row_id, hlc, origin, seq) VALUES (:table, :rowId, :hlc, :origin, :seq)
            ON CONFLICT (table_name, row_id) DO UPDATE SET hlc = excluded.hlc, origin = excluded.origin, seq = excluded.seq`,
            { table, rowId, ...this.provenanceParams(provenance) },
        );
    }

    /**
     * @param table Tabela.
     * @param rowId Linha.
     * @param column Célula.
     * @param provenance Procedência da escrita vencedora.
     */
    public putCell(table: string, rowId: string, column: string, provenance: Provenance): void {
        this.database.run(
            `INSERT INTO sync_cells (table_name, row_id, column_name, hlc, origin, seq) VALUES (:table, :rowId, :column, :hlc, :origin, :seq)
            ON CONFLICT (table_name, row_id, column_name) DO UPDATE SET hlc = excluded.hlc, origin = excluded.origin, seq = excluded.seq`,
            { table, rowId, column, ...this.provenanceParams(provenance) },
        );
    }

    /**
     * @param table Tabela.
     * @param rowId Linha.
     * @param columns Células ajustadas.
     */
    public markDirty(table: string, rowId: string, columns: readonly string[]): void {
        for (const column of columns) {
            this.database.run(
                'INSERT OR IGNORE INTO temp.sync_dirty (table_name, row_id, column_name) VALUES (:table, :rowId, :column)',
                { table, rowId, column },
            );
        }
    }

    /**
     * @param enabled Novo estado da captura.
     */
    public setCapture(enabled: boolean): void {
        this.database.run('UPDATE temp.sync_control SET capture = :capture', { capture: enabled ? 1 : 0 });
    }

    /**
     * @param enabled Estado da captura durante `work`.
     * @param work Trabalho.
     * @return O que `work` devolveu.
     */
    public withCapture<T>(enabled: boolean, work: () => T): T {
        const row = this.database.get('SELECT capture FROM temp.sync_control');
        const previous = row === undefined ? 0 : new RowReader('sync_control', row).number('capture');
        this.database.run('UPDATE temp.sync_control SET capture = :capture', { capture: enabled ? 1 : 0 });
        try {
            return work();
        } finally {
            this.database.run('UPDATE temp.sync_control SET capture = :capture', { capture: previous });
        }
    }

    /**
     * @param row Linha com `hlc`, `origin` e `seq`.
     * @return A procedência tipada.
     */
    private toProvenance(row: Readonly<Record<string, string | number | null>>): Provenance {
        const reader = new RowReader('sync_ledger', row);
        return { clock: HybridLogicalClock.parse(reader.text('hlc')), origin: DeviceId(reader.text('origin')), seq: reader.number('seq') };
    }

    /**
     * @param provenance Procedência.
     * @return Os parâmetros nomeados comuns às escritas de relógio.
     */
    private provenanceParams(provenance: Provenance): Record<string, string | number> {
        return { hlc: provenance.clock.toString(), origin: provenance.origin, seq: provenance.seq };
    }
}
