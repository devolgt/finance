/**
 * O que acontece com a linha que perde uma colisão de chave natural (sync-design §5.7):
 * `merge` grava a perdedora com soft delete e redireciona os filhos dela para a
 * sobrevivente; `unlink` limpa as colunas da chave, que deixam de colidir sem que nenhuma
 * linha financeira seja excluída.
 */
export type CollisionStrategy = 'merge' | 'unlink';

/**
 * Uma regra de unicidade entre linhas vivas que dois aparelhos podem violar ao mesclar. Só
 * entra aqui o que um índice único parcial do schema já garante: a aplicação de um lote
 * precisa resolver a colisão antes de escrever, porque o índice não é adiável como as
 * chaves estrangeiras.
 */
export interface NaturalKey {
    /** Colunas da chave, na ordem do índice. */
    readonly columns: readonly string[];
    /** Coluna comparada sem diferenciar maiúsculas (`COLLATE NOCASE` no índice). */
    readonly caseInsensitive: string | null;
    readonly strategy: CollisionStrategy;
}

/**
 * Como uma tabela de domínio sincroniza. A lista é explícita, e não deduzida do schema,
 * porque classificar uma tabela nova — sincronizada ou local, quais colunas são caches —
 * é decisão de negócio; um teste falha se o schema tiver tabela fora do catálogo.
 */
export interface SyncedTable {
    readonly name: string;
    /** Coluna da lápide: `deleted_at` nas tabelas de domínio, `removed_at` nos membros. */
    readonly tombstone: 'deleted_at' | 'removed_at';
    /**
     * Caches derivados que nunca sincronizam: uma linha recebida os grava com `0` e o
     * recálculo pós-aplicação os preenche (sync-design §5.5).
     */
    readonly derived: readonly string[];
    /** Colunas mescladas como máximo, e não por last-writer-wins (sync-design §5.5). */
    readonly maxMerged: readonly string[];
    readonly naturalKeys: readonly NaturalKey[];
}

/**
 * @param columns Colunas da chave.
 * @param caseInsensitive Coluna de nome digitado pelo usuário, comparada como o índice.
 * @return Chave cuja perdedora é mesclada na sobrevivente.
 */
function mergeKey(columns: readonly string[], caseInsensitive: string | null = null): NaturalKey {
    return { columns, caseInsensitive, strategy: 'merge' };
}

/**
 * @param name Tabela.
 * @param options Partes que diferem do padrão (sem caches, sem máximo, sem chave natural).
 * @return A tabela classificada como sincronizada.
 */
function synced(name: string, options: Partial<Omit<SyncedTable, 'name'>> = {}): SyncedTable {
    return { name, tombstone: 'deleted_at', derived: [], maxMerged: [], naturalKeys: [], ...options };
}

/**
 * Catálogo das tabelas sincronizadas (sync-design §5.3 a §5.7).
 * Regra de negócio (Sincronização): os saldos são caches e não trafegam; `materialized_count`
 * é marca d'água e mescla como máximo; as chaves naturais com id determinístico
 * (extratos, faturas, vínculos de tag, ocorrências) só colidem por defeito, mas são tratadas
 * da mesma forma para que um defeito não aborte a sessão inteira.
 */
export const SYNCED_TABLES: readonly SyncedTable[] = [
    synced('profiles'),
    synced('partners'),
    synced('notes'),
    synced('accounts', { derived: ['balance', 'projected_balance'] }),
    synced('credit_cards'),
    synced('bank_statements', {
        derived: ['opening_balance', 'closing_balance', 'projected_opening_balance', 'projected_closing_balance'],
        naturalKeys: [mergeKey(['account_id', 'year', 'month'])],
    }),
    synced('invoices', { derived: ['balance'], naturalKeys: [mergeKey(['credit_card_id', 'year', 'month'])] }),
    synced('transaction_categories', { naturalKeys: [mergeKey(['profile_id', 'name'], 'name')] }),
    synced('transaction_sub_categories', { naturalKeys: [mergeKey(['category_id', 'name'], 'name')] }),
    synced('tags', { naturalKeys: [mergeKey(['profile_id', 'name'], 'name')] }),
    synced('goals'),
    synced('recurrences', { maxMerged: ['materialized_count'] }),
    synced('recurrences_tags', { naturalKeys: [mergeKey(['recurrence_id', 'tag_id'])] }),
    synced('transactions', {
        // Duas ocorrências com o mesmo número só colidem se a ocorrência mudar de série; desvincular
        // a perdedora mantém o lançamento, que é dado financeiro (sync-design §5.7).
        naturalKeys: [{ columns: ['recurrence_id', 'occurrence'], caseInsensitive: null, strategy: 'unlink' }],
    }),
    synced('transactions_tags', { naturalKeys: [mergeKey(['transaction_id', 'tag_id'])] }),
    synced('attachments', { naturalKeys: [mergeKey(['transaction_id', 'name'], 'name')] }),
    synced('report_definitions'),
    synced('sync_members', { tombstone: 'removed_at' }),
];

/**
 * Tabelas que nunca são capturadas: as de relógio (`sync_rows`, `sync_cells`) são escritas
 * pelo próprio carimbo, e `sync_vector`/`sync_state` descrevem só este aparelho.
 */
export const LOCAL_TABLES: readonly string[] = ['sync_rows', 'sync_cells', 'sync_vector', 'sync_state'];

/** Colunas que nenhuma escrita sincroniza: o id identifica a linha e nunca muda. */
export const IDENTITY_COLUMN = 'id';

const BY_NAME = new Map(SYNCED_TABLES.map((table) => [table.name, table]));

/**
 * @param name Nome vindo de um lote recebido ou do schema.
 * @return A tabela sincronizada, ou `null` quando o nome não está no catálogo — um lote que
 * cite uma tabela fora dele é recusado.
 */
export function syncedTable(name: string): SyncedTable | null {
    return BY_NAME.get(name) ?? null;
}
