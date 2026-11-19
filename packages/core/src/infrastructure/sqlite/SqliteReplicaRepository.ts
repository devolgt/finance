import { syncedTable, type NaturalKey, type SyncedTable } from '../../domain/sync/SyncCatalog.ts';
import type { Database, SqlRow, SqlValue } from '../../ports/Database.ts';
import type { ForeignKeyLink, ReplicaRepository } from '../../repositories/ReplicaRepository.ts';
import { columnsOf, syncedColumnsOf } from '../sync/CaptureTriggers.ts';
import { RowReader } from './RowReader.ts';

/**
 * Por tabela, a consulta das contas cujo saldo depende da linha `:id`. Uma fatura afeta a
 * conta do cartão e a do extrato que a pagou; um lançamento, a do extrato, a que paga a
 * fatura dele e a de destino.
 */
const ACCOUNTS_AFFECTED: Readonly<Record<string, string>> = {
    accounts: 'SELECT id AS account_id FROM accounts WHERE id = :id',
    bank_statements: 'SELECT account_id FROM bank_statements WHERE id = :id',
    credit_cards: 'SELECT account_id FROM credit_cards WHERE id = :id',
    goals: 'SELECT account_id FROM goals WHERE id = :id',
    invoices: `SELECT c.account_id FROM invoices i JOIN credit_cards c ON c.id = i.credit_card_id WHERE i.id = :id
        UNION SELECT s.account_id FROM invoices i JOIN bank_statements s ON s.id = i.bank_statement_id WHERE i.id = :id`,
    transactions: `SELECT s.account_id FROM transactions t JOIN bank_statements s ON s.id = t.bank_statement_id WHERE t.id = :id
        UNION SELECT c.account_id FROM transactions t JOIN invoices i ON i.id = t.invoice_id JOIN credit_cards c ON c.id = i.credit_card_id WHERE t.id = :id
        UNION SELECT s.account_id FROM transactions t JOIN invoices i ON i.id = t.invoice_id JOIN bank_statements s ON s.id = i.bank_statement_id WHERE t.id = :id
        UNION SELECT destination_account_id AS account_id FROM transactions WHERE id = :id`,
};

/**
 * Implementação SQLite do acesso genérico às linhas. Monta SQL com nomes de tabela e coluna,
 * o que só é seguro porque todo nome vem do catálogo (`SYNCED_TABLES`) ou do `PRAGMA` — nunca
 * de um lote recebido sem conferência.
 */
export class SqliteReplicaRepository implements ReplicaRepository {
    private readonly columns = new Map<string, readonly string[]>();
    private readonly allColumns = new Map<string, readonly string[]>();
    private links: readonly ForeignKeyLink[] | null = null;

    /**
     * @param database Conexão do núcleo.
     */
    public constructor(private readonly database: Database) {}

    /**
     * @param table Tabela sincronizada.
     * @return As colunas que trafegam; lidas do schema uma vez por conexão.
     */
    public syncedColumns(table: SyncedTable): readonly string[] {
        let cached = this.columns.get(table.name);
        if (cached === undefined) {
            cached = syncedColumnsOf(this.database, table);
            this.columns.set(table.name, cached);
        }
        return cached;
    }

    /**
     * @param table Tabela.
     * @param id Linha.
     * @return A linha, ou `null`.
     */
    public find(table: SyncedTable, id: string): SqlRow | null {
        return this.database.get(`SELECT * FROM main.${table.name} WHERE id = :id`, { id }) ?? null;
    }

    /**
     * @param table Tabela.
     * @param ids Linhas.
     * @return As encontradas, por id; consultadas em blocos para não estourar o limite de
     * parâmetros do SQLite.
     */
    public findMany(table: SyncedTable, ids: readonly string[]): ReadonlyMap<string, SqlRow> {
        const found = new Map<string, SqlRow>();
        for (let start = 0; start < ids.length; start += 500) {
            const ids500 = JSON.stringify(ids.slice(start, start + 500));
            for (const row of this.database.all(`SELECT * FROM main.${table.name} WHERE id IN (SELECT value FROM json_each(:ids))`, { ids: ids500 })) {
                found.set(new RowReader(table.name, row).text('id'), row);
            }
        }
        return found;
    }

    /**
     * @param table Tabela.
     * @param id Linha.
     * @param values Colunas sincronizadas.
     */
    public insert(table: SyncedTable, id: string, values: Readonly<Record<string, SqlValue>>): void {
        const row: Record<string, SqlValue> = { ...values, id };
        for (const derived of table.derived) {
            row[derived] = 0;
        }
        const names = Object.keys(row).filter((name) => this.allColumnsOf(table).includes(name));
        this.database.run(
            `INSERT INTO main.${table.name} (${names.join(', ')}) VALUES (${names.map((_, index) => `:p${index}`).join(', ')})`,
            Object.fromEntries(names.map((name, index) => [`p${index}`, row[name] ?? null])),
        );
    }

    /**
     * @param table Tabela.
     * @param id Linha.
     * @param values Colunas a regravar.
     */
    public update(table: SyncedTable, id: string, values: Readonly<Record<string, SqlValue>>): void {
        const names = Object.keys(values).filter((name) => this.allColumnsOf(table).includes(name) && name !== 'id');
        if (names.length === 0) {
            return;
        }
        this.database.run(
            `UPDATE main.${table.name} SET ${names.map((name, index) => `${name} = :p${index}`).join(', ')} WHERE id = :id`,
            { id, ...Object.fromEntries(names.map((name, index) => [`p${index}`, values[name] ?? null])) },
        );
    }

    /**
     * Reproduz a condição do índice único parcial: linhas vivas e, como no índice das
     * ocorrências, só quando todas as colunas da chave estão preenchidas.
     *
     * @param table Tabela.
     * @param key Chave natural.
     * @param row Valores da linha que seria gravada.
     * @param excludingId A própria linha.
     * @return O id da gêmea viva, ou `null`.
     */
    public findLiveTwin(table: SyncedTable, key: NaturalKey, row: SqlRow, excludingId: string): string | null {
        if (row[table.tombstone] !== null || key.columns.some((column) => row[column] === null || row[column] === undefined)) {
            return null;
        }
        const conditions = key.columns.map((column, index) => `${column} = :k${index}${column === key.caseInsensitive ? ' COLLATE NOCASE' : ''}`);
        const params = Object.fromEntries(key.columns.map((column, index) => [`k${index}`, row[column] ?? null]));
        const twin = this.database.get(
            `SELECT id FROM main.${table.name} WHERE ${conditions.join(' AND ')} AND ${table.tombstone} IS NULL AND id <> :self ORDER BY id LIMIT 1`,
            { ...params, self: excludingId },
        );
        return twin === undefined ? null : new RowReader(table.name, twin).text('id');
    }

    /**
     * @param table Tabela filha.
     * @return As chaves que saem dela.
     */
    public parentLinks(table: SyncedTable): readonly ForeignKeyLink[] {
        return this.allLinks().filter((link) => link.child === table.name);
    }

    /**
     * @param table Tabela mãe.
     * @return As chaves que chegam nela.
     */
    public childLinks(table: SyncedTable): readonly ForeignKeyLink[] {
        return this.allLinks().filter((link) => link.parent === table.name);
    }

    /**
     * @param link Chave estrangeira.
     * @param parentId Linha mãe.
     * @return As filhas vivas.
     */
    public liveChildren(link: ForeignKeyLink, parentId: string): readonly string[] {
        const child = syncedTable(link.child);
        if (child === null) {
            return [];
        }
        return this.database
            .all(`SELECT id FROM main.${child.name} WHERE ${link.column} = :parentId AND ${child.tombstone} IS NULL ORDER BY id`, { parentId })
            .map((row) => new RowReader(child.name, row).text('id'));
    }

    /**
     * @param table Tabela.
     * @param id Linha.
     * @return Contas afetadas, pelo estado atual da linha.
     */
    public accountsAffectedBy(table: SyncedTable, id: string): readonly string[] {
        const sql = ACCOUNTS_AFFECTED[table.name];
        if (sql === undefined) {
            return [];
        }
        return this.database
            .all(`SELECT DISTINCT account_id FROM (${sql}) WHERE account_id IS NOT NULL`, { id })
            .map((row) => new RowReader(table.name, row).text('account_id'));
    }

    /**
     * @param table Tabela.
     * @return Todas as colunas, inclusive caches; para filtrar o que um insert pode citar.
     */
    private allColumnsOf(table: SyncedTable): readonly string[] {
        let cached = this.allColumns.get(table.name);
        if (cached === undefined) {
            cached = columnsOf(this.database, table.name);
            this.allColumns.set(table.name, cached);
        }
        return cached;
    }

    /**
     * @return As chaves estrangeiras entre tabelas sincronizadas, lidas do schema uma vez.
     */
    private allLinks(): readonly ForeignKeyLink[] {
        if (this.links === null) {
            const links: ForeignKeyLink[] = [];
            for (const name of this.database.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => new RowReader('sqlite_master', row).text('name'))) {
                const child = syncedTable(name);
                if (child === null) {
                    continue;
                }
                for (const fk of this.database.all(`PRAGMA foreign_key_list(${name})`)) {
                    const reader = new RowReader('pragma', fk);
                    const parent = syncedTable(reader.text('table'));
                    const onDelete = reader.text('on_delete');
                    if (parent !== null && (onDelete === 'CASCADE' || onDelete === 'NO ACTION' || onDelete === 'SET NULL')) {
                        links.push({ child: child.name, column: reader.text('from'), parent: parent.name, onDelete });
                    }
                }
            }
            this.links = links;
        }
        return this.links;
    }
}
