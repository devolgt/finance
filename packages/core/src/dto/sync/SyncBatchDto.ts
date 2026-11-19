/**
 * Forma serializada de um lote de sincronização, a que trafega cifrada entre os aparelhos
 * (sync-design §7.4, passo 5). Só dados simples, como todo DTO, porque vai para JSON; a
 * forma tipada do domínio (`SyncBatch`) sai daqui pela validação de `syncBatchRequest`, já
 * que o lote chega de outro aparelho e não pode ser confiado como veio.
 */
export interface SyncBatchDto {
    readonly changes: readonly SyncChangeDto[];
    /** Vetor de quem enviou, como pares `[origem, sequência]`. */
    readonly through: readonly (readonly [string, number])[];
}

/** Uma transação de origem dentro do lote. */
export interface SyncChangeDto {
    readonly hlc: string;
    readonly origin: string;
    readonly seq: number;
    readonly rows: readonly { readonly table: string; readonly id: string; readonly values: Readonly<Record<string, string | number | null>> }[];
    readonly cells: readonly { readonly table: string; readonly id: string; readonly column: string; readonly value: string | number | null }[];
}
