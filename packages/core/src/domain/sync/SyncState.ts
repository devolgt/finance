import type { DeviceId, GroupId } from '../shared/ids.ts';
import type { HybridLogicalClock } from './HybridLogicalClock.ts';

/**
 * A identidade deste aparelho dentro do grupo (`sync_state`, sincronizacao §3.3). Existe só
 * enquanto o aparelho pertence a um grupo; sem ela, a captura não carimba nada.
 */
export interface SyncState {
    readonly deviceId: DeviceId;
    readonly groupId: GroupId;
    /** O último HLC carimbado ou visto; o próximo carimbo parte dele. */
    readonly clock: HybridLogicalClock;
    /** Sequência da próxima transação de escrita local; uma por transação, não por linha. */
    readonly nextSeq: number;
}

/**
 * Uma entrada das tabelas de relógio: a criação de uma linha (`column === null`, de
 * `sync_rows`) ou a alteração de uma célula (`sync_cells`). É o que a extração lê para
 * montar um lote e o que a aplicação compara para decidir o last-writer-wins.
 */
export interface LedgerEntry {
    readonly table: string;
    readonly rowId: string;
    readonly column: string | null;
    readonly clock: HybridLogicalClock;
    readonly origin: DeviceId;
    readonly seq: number;
}

/** Relógio e procedência de uma escrita, o que se grava junto com a célula vencedora. */
export interface Provenance {
    readonly clock: HybridLogicalClock;
    readonly origin: DeviceId;
    readonly seq: number;
}
