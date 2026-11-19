import { CorruptRowError } from '../../domain/shared/errors.ts';
import { syncedTable } from '../../domain/sync/SyncCatalog.ts';
import type { LedgerEntry } from '../../domain/sync/SyncState.ts';
import { VersionVector } from '../../domain/sync/VersionVector.ts';
import type { SyncBatchDto, SyncChangeDto } from '../../dto/sync/SyncBatchDto.ts';
import type { SqlRow, SqlValue } from '../../ports/Database.ts';
import type { ReplicaRepository } from '../../repositories/ReplicaRepository.ts';
import type { SyncLedgerRepository } from '../../repositories/SyncLedgerRepository.ts';

/** Restrição de uma extração: tudo, ou só a lista de membros. */
export type ExtractionScope = 'all' | 'members';

/**
 * Monta o lote do que falta a um par (sincronizacao §3.3 e §5.6, passo 5): as entradas de
 * relógio com sequência maior que a do vetor dele, em ordem de relógio, agrupadas por
 * transação de origem, com os valores **atuais** das células. Não existe log de valores: o
 * vencedor atual de cada célula é o único que importa e já está na tabela de domínio.
 */
export class ChangeExtractor {
    /**
     * @param ledger Tabelas de relógio.
     * @param replica Valores atuais das linhas.
     */
    public constructor(private readonly ledger: SyncLedgerRepository, private readonly replica: ReplicaRepository) {}

    /**
     * @param peer Vetor do par.
     * @param scope `members` para o passo "membros primeiro" da sessão (sincronizacao §5.6, passo
     * 3): uma remoção aprendida tem efeito antes de qualquer dado. Esse lote não carrega vetor,
     * porque não é completo, e o receptor não pode avançar o dele com ele.
     * @return O lote.
     * @throws {CorruptRowError} Quando uma entrada de relógio aponta para linha inexistente —
     * só acontece com o banco editado por fora.
     */
    public extract(peer: VersionVector, scope: ExtractionScope = 'all'): SyncBatchDto {
        const entries = this.ledger.entriesAfter(peer).filter((entry) => scope === 'all' || entry.table === 'sync_members');
        const rows = this.loadRows(entries);
        // Entradas de uma transação de origem compartilham o HLC, então chegam contíguas; o Map
        // preserva a ordem de inserção, que é a ordem causal.
        const groups = new Map<string, { readonly entry: LedgerEntry; readonly rows: SyncChangeDto['rows'][number][]; readonly cells: SyncChangeDto['cells'][number][] }>();
        for (const entry of entries) {
            const key = `${entry.origin}/${entry.seq}`;
            const group = groups.get(key) ?? { entry, rows: [], cells: [] };
            groups.set(key, group);
            const row = rows.get(`${entry.table}/${entry.rowId}`);
            if (row === undefined) {
                throw new CorruptRowError(entry.table, `entrada de relógio sem linha: ${entry.rowId}`);
            }
            if (entry.column === null) {
                group.rows.push({ table: entry.table, id: entry.rowId, values: row });
            } else {
                group.cells.push({ table: entry.table, id: entry.rowId, column: entry.column, value: row[entry.column] ?? null });
            }
        }
        const changes: SyncChangeDto[] = [...groups.values()].map((group) => ({
            hlc: group.entry.clock.toString(),
            origin: group.entry.origin,
            seq: group.entry.seq,
            rows: group.rows,
            cells: group.cells,
        }));
        return {
            changes,
            through: scope === 'all' ? this.ledger.vector().toEntries() : VersionVector.EMPTY.toEntries(),
        };
    }

    /**
     * Lê, por tabela e em blocos, as linhas citadas nas entradas, já reduzidas às colunas que
     * trafegam — os caches ficam de fora (sincronizacao §3.6).
     *
     * @param entries Entradas do lote.
     * @return Valores por `tabela/id`.
     * @throws {CorruptRowError} Quando `sync_rows`/`sync_cells` citam uma tabela fora do catálogo.
     */
    private loadRows(entries: readonly LedgerEntry[]): ReadonlyMap<string, Readonly<Record<string, SqlValue>>> {
        const idsByTable = new Map<string, Set<string>>();
        for (const entry of entries) {
            const ids = idsByTable.get(entry.table) ?? new Set<string>();
            ids.add(entry.rowId);
            idsByTable.set(entry.table, ids);
        }
        const loaded = new Map<string, Readonly<Record<string, SqlValue>>>();
        for (const [name, ids] of idsByTable) {
            const table = syncedTable(name);
            if (table === null) {
                throw new CorruptRowError(name, 'tabela fora do catálogo em sync_rows/sync_cells');
            }
            const columns = this.replica.syncedColumns(table);
            for (const [id, row] of this.replica.findMany(table, [...ids])) {
                loaded.set(`${name}/${id}`, pick(row, columns));
            }
        }
        return loaded;
    }
}

/**
 * @param row Linha completa.
 * @param columns Colunas que trafegam.
 * @return Só as colunas pedidas.
 */
function pick(row: SqlRow, columns: readonly string[]): Readonly<Record<string, SqlValue>> {
    return Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));
}
