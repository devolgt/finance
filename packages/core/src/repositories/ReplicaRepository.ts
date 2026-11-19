import type { NaturalKey, SyncedTable } from '../domain/sync/SyncCatalog.ts';
import type { SqlRow, SqlValue } from '../ports/Database.ts';

/**
 * Uma chave estrangeira entre duas tabelas sincronizadas, lida do schema. A ação de
 * exclusão diz que tipo de vínculo é (database-design §3.8): `CASCADE` é propriedade,
 * `NO ACTION` é vocabulário obrigatório, `SET NULL` é só referência.
 */
export interface ForeignKeyLink {
    readonly child: string;
    readonly column: string;
    readonly parent: string;
    readonly onDelete: 'CASCADE' | 'NO ACTION' | 'SET NULL';
}

/**
 * Acesso genérico às linhas das tabelas sincronizadas, por nome de tabela e coluna. Existe
 * porque a aplicação de um lote trata toda tabela do mesmo jeito — compara célula a célula,
 * resolve colisões, segue chaves estrangeiras — e um Repository por entidade repetiria isso
 * dezoito vezes. Os nomes só chegam aqui depois de conferidos contra o catálogo e o schema.
 */
export interface ReplicaRepository {
    /**
     * @param table Tabela sincronizada.
     * @return As colunas que trafegam (todas menos o id e os caches derivados).
     */
    syncedColumns(table: SyncedTable): readonly string[];

    /**
     * @param table Tabela sincronizada.
     * @param id Linha.
     * @return A linha com todas as colunas, viva ou não; `null` quando não existe.
     */
    find(table: SyncedTable, id: string): SqlRow | null;

    /**
     * @param table Tabela sincronizada.
     * @param ids Linhas.
     * @return As linhas encontradas, por id.
     */
    findMany(table: SyncedTable, ids: readonly string[]): ReadonlyMap<string, SqlRow>;

    /**
     * Insere uma linha recebida com os caches derivados zerados (sync-design §5.5).
     *
     * @param table Tabela sincronizada.
     * @param id Linha.
     * @param values Colunas sincronizadas, inclusive o `created_at` da origem.
     */
    insert(table: SyncedTable, id: string, values: Readonly<Record<string, SqlValue>>): void;

    /**
     * @param table Tabela sincronizada.
     * @param id Linha.
     * @param values Colunas a regravar.
     */
    update(table: SyncedTable, id: string, values: Readonly<Record<string, SqlValue>>): void;

    /**
     * @param table Tabela da chave.
     * @param key Chave natural.
     * @param row Valores da linha que seria gravada.
     * @param excludingId A própria linha, que não colide consigo mesma.
     * @return O id de outra linha viva com a mesma chave, ou `null`.
     */
    findLiveTwin(table: SyncedTable, key: NaturalKey, row: SqlRow, excludingId: string): string | null;

    /**
     * @param table Tabela filha.
     * @return As chaves estrangeiras que saem dela para outras tabelas sincronizadas.
     */
    parentLinks(table: SyncedTable): readonly ForeignKeyLink[];

    /**
     * @param table Tabela mãe.
     * @return As chaves estrangeiras de outras tabelas sincronizadas que apontam para ela.
     */
    childLinks(table: SyncedTable): readonly ForeignKeyLink[];

    /**
     * @param link Chave estrangeira.
     * @param parentId Linha mãe.
     * @return Os ids das filhas vivas que apontam para ela.
     */
    liveChildren(link: ForeignKeyLink, parentId: string): readonly string[];

    /**
     * Contas cujos saldos dependem da linha, pelo estado atual dela: a do extrato e a que paga
     * a fatura de um lançamento, a de destino de uma transferência, a dona de um cartão.
     *
     * @param table Tabela.
     * @param id Linha.
     * @return Ids das contas; vazio para tabelas que não afetam saldo.
     */
    accountsAffectedBy(table: SyncedTable, id: string): readonly string[];
}
