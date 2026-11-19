import type { HybridLogicalClock } from '../domain/sync/HybridLogicalClock.ts';
import type { LedgerEntry, Provenance, SyncState } from '../domain/sync/SyncState.ts';
import type { VersionVector } from '../domain/sync/VersionVector.ts';

/**
 * Acesso às tabelas da sincronização (`sync_state`, `sync_vector`, `sync_rows`,
 * `sync_cells`) e ao interruptor da captura desta conexão. Fica atrás de uma interface pelo
 * mesmo motivo dos demais Repositories: os Services de sincronização decidem regra e não
 * conhecem SQL.
 */
export interface SyncLedgerRepository {
    /**
     * @return A identidade do aparelho no grupo, ou `null` quando ele não pertence a nenhum.
     */
    findState(): SyncState | null;

    /**
     * Grava a identidade ao criar ou entrar num grupo; substitui a anterior.
     *
     * @param state Identidade nova.
     */
    saveState(state: SyncState): void;

    /**
     * Apaga a identidade e o vetor — sair do grupo ou preparar a entrada por snapshot. As
     * tabelas são locais, então apagar não se propaga.
     */
    clearState(): void;

    /**
     * @return O vetor deste aparelho, incluindo a própria origem.
     */
    vector(): VersionVector;

    /**
     * @param vector Vetor a gravar inteiro.
     */
    saveVector(vector: VersionVector): void;

    /**
     * Adia as chaves estrangeiras até o commit da transação corrente (sincronizacao §3.11), para
     * que a ordem das linhas dentro de um lote não importe; uma chave que continue quebrada no
     * fim ainda derruba o commit.
     */
    deferForeignKeys(): void;

    /**
     * @return O `user_version` do banco.
     */
    schemaVersion(): number;

    /**
     * @return `true` quando alguma tabela sincronizada tem ao menos uma linha, viva ou não.
     */
    hasDomainData(): boolean;

    /**
     * Dá a toda linha existente das tabelas sincronizadas uma entrada em `sync_rows` com a
     * procedência informada (sincronizacao §4.6): é a ativação num aparelho que já tem dados.
     *
     * @param provenance Relógio, origem e sequência da ativação.
     * @return Quantas linhas receberam entrada.
     */
    backfill(provenance: Provenance): number;

    /**
     * @param vector O que o par já possui.
     * @return As entradas que faltam ao par, em ordem de relógio — a ordem causal, para que
     * a criação de uma linha venha antes das alterações feitas a partir dela.
     */
    entriesAfter(vector: VersionVector): readonly LedgerEntry[];

    /**
     * @param table Tabela sincronizada.
     * @param rowId Linha.
     * @return A procedência da criação, ou `null` quando a linha nunca foi registrada.
     */
    rowEntry(table: string, rowId: string): Provenance | null;

    /**
     * @param table Tabela sincronizada.
     * @param rowId Linha.
     * @return O relógio de cada célula alterada depois da criação.
     */
    cellClocks(table: string, rowId: string): ReadonlyMap<string, HybridLogicalClock>;

    /**
     * @param table Tabela sincronizada.
     * @param rowId Linha criada.
     * @param provenance Procedência da criação.
     */
    putRow(table: string, rowId: string, provenance: Provenance): void;

    /**
     * @param table Tabela sincronizada.
     * @param rowId Linha.
     * @param column Célula que recebeu o valor vencedor.
     * @param provenance Procedência da escrita vencedora.
     */
    putCell(table: string, rowId: string, column: string, provenance: Provenance): void;

    /**
     * Marca células como escritas locais desta transação, para o carimbo do fim. Existe para
     * o ajuste de uma linha recebida que perdeu uma colisão: ela é gravada já ajustada (o
     * índice único não deixa gravar antes) e com a captura desligada, então o trigger não
     * tem mudança nenhuma para ver.
     *
     * @param table Tabela sincronizada.
     * @param rowId Linha.
     * @param columns Células ajustadas.
     */
    markDirty(table: string, rowId: string, columns: readonly string[]): void;

    /**
     * Liga ou desliga a captura desta conexão de forma duradoura — ao criar ou entrar num
     * grupo, quando as escritas passam a precisar de relógio.
     *
     * @param enabled Novo estado.
     */
    setCapture(enabled: boolean): void;

    /**
     * Roda `work` com a captura ligada ou desligada e restaura o estado anterior no fim,
     * mesmo em erro — um lote aplicado com a captura ligada carimbaria as células recebidas
     * como escritas locais, com outro relógio.
     *
     * @param enabled Estado da captura durante `work`.
     * @param work Trabalho.
     * @return O que `work` devolveu.
     */
    withCapture<T>(enabled: boolean, work: () => T): T;
}
