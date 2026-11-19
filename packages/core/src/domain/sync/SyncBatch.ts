import type { SyncedTable } from './SyncCatalog.ts';
import type { Provenance } from './SyncState.ts';
import type { VersionVector } from './VersionVector.ts';

/** Valor de uma célula no lote: os mesmos três tipos do schema mais `NULL` (banco-de-dados §3.9). */
export type CellValue = string | number | null;

/**
 * A criação de uma linha, com os valores atuais das colunas sincronizadas. Carrega a linha
 * inteira, e não só as células com o relógio da criação, para que o receptor consiga
 * inserir uma linha com toda coluna `NOT NULL` preenchida; as células alteradas depois
 * chegam também como `CellChange`, com relógio maior, e vencem na mesma aplicação.
 */
export interface RowChange {
    readonly table: SyncedTable;
    readonly id: string;
    readonly values: Readonly<Record<string, CellValue>>;
}

/** A alteração de uma célula depois da criação da linha. */
export interface CellChange {
    readonly table: SyncedTable;
    readonly id: string;
    readonly column: string;
    readonly value: CellValue;
}

/**
 * Tudo o que uma transação de escrita de origem produziu e o par ainda não tem. Agrupado
 * por transação porque uma unidade de trabalho — as duas pernas de uma transferência —
 * trafega e é aplicada junta (sincronizacao §3.3).
 */
export interface SyncChange {
    readonly provenance: Provenance;
    readonly rows: readonly RowChange[];
    readonly cells: readonly CellChange[];
}

/**
 * Um lote: as mudanças que faltam ao par, em ordem de relógio, e o vetor de quem enviou.
 * O vetor é o que o receptor passa a ter depois de aplicar — não a maior sequência vista no
 * lote, porque sequências compactadas (células sobrescritas depois) não aparecem nele.
 */
export interface SyncBatch {
    readonly changes: readonly SyncChange[];
    readonly through: VersionVector;
}
