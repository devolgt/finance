import { IDENTITY_COLUMN, SYNCED_TABLES, type SyncedTable } from '../../domain/sync/SyncCatalog.ts';
import type { Database } from '../../ports/Database.ts';
import { RowReader } from '../sqlite/RowReader.ts';

/** Marcador de "linha inserida" em `temp.sync_dirty`, no lugar do nome de uma coluna. */
export const ROW_INSERTED = '';

/**
 * @param database Conexão.
 * @param table Tabela do schema.
 * @return Os nomes das colunas na ordem do `PRAGMA table_info`.
 */
export function columnsOf(database: Database, table: string): readonly string[] {
    return database.all(`PRAGMA table_info(${table})`).map((row) => new RowReader('pragma', row).text('name'));
}

/**
 * @param database Conexão.
 * @param table Tabela sincronizada.
 * @return As colunas que trafegam: todas menos o id e os caches derivados (sync-design §5.5).
 */
export function syncedColumnsOf(database: Database, table: SyncedTable): readonly string[] {
    return columnsOf(database, table.name).filter((column) => column !== IDENTITY_COLUMN && !table.derived.includes(column));
}

/**
 * Instala, só nesta conexão, a captura das escritas (sync-design §5.4; sync-plan §3.1): a
 * tabela temporária de células sujas, a flag que a liga e um trigger `TEMP` por tabela
 * sincronizada. Os triggers são gerados do `PRAGMA table_info` a cada abertura, para que
 * uma coluna nova de migration entre sozinha; e são `TEMP` para que nada fique gravado no
 * arquivo — as migrations rodam antes e ficam fora da captura (backend-design §4.9).
 *
 * Por que trigger e não instrumentar cada Repository: são ~70 pontos de escrita, vários em
 * upsert que não sabe quais colunas mudaram; uma escrita esquecida viraria divergência
 * silenciosa. O trigger vê toda escrita da conexão.
 *
 * @param database Conexão já migrada; precisa ser a mesma que o núcleo usa.
 * @param enabled Estado inicial da captura: ligada quando o aparelho já pertence a um grupo.
 */
export function installCapture(database: Database, enabled: boolean): void {
    database.exec(`
        CREATE TEMP TABLE IF NOT EXISTS sync_dirty (
            table_name TEXT NOT NULL,
            row_id TEXT NOT NULL,
            column_name TEXT NOT NULL,
            PRIMARY KEY (table_name, row_id, column_name)
        ) WITHOUT ROWID;
        CREATE TEMP TABLE IF NOT EXISTS sync_control (capture INTEGER NOT NULL);
        DELETE FROM temp.sync_control;
    `);
    database.run('INSERT INTO temp.sync_control (capture) VALUES (:capture)', { capture: enabled ? 1 : 0 });
    for (const table of SYNCED_TABLES) {
        database.exec(triggersFor(table, syncedColumnsOf(database, table)));
    }
}

/**
 * Gera os três triggers de uma tabela.
 * - `AFTER INSERT` marca a linha inteira: a criação recebe o relógio da linha.
 * - `AFTER UPDATE` marca cada coluna sincronizada com `OLD.c IS NOT NEW.c`, para que gravar
 *   o mesmo valor (upserts reescrevem tudo) não gere mudança.
 * - `BEFORE DELETE` aborta sempre: um hard delete não deixa nada para replicar, e um par
 *   que nunca visse a lápide manteria a linha viva (sync-design §9).
 *
 * @param table Tabela sincronizada.
 * @param columns Colunas capturadas na alteração.
 * @return O script com os `DROP` e `CREATE TEMP TRIGGER`.
 */
function triggersFor(table: SyncedTable, columns: readonly string[]): string {
    const { name } = table;
    const when = 'WHEN (SELECT capture FROM temp.sync_control) = 1';
    const marks = columns
        .map((column) => `INSERT OR IGNORE INTO temp.sync_dirty (table_name, row_id, column_name) SELECT '${name}', NEW.id, '${column}' WHERE OLD.${column} IS NOT NEW.${column};`)
        .join('\n            ');
    return `
        DROP TRIGGER IF EXISTS temp.sync_insert_${name};
        DROP TRIGGER IF EXISTS temp.sync_update_${name};
        DROP TRIGGER IF EXISTS temp.sync_delete_${name};
        CREATE TEMP TRIGGER sync_insert_${name} AFTER INSERT ON main.${name} ${when}
        BEGIN
            INSERT OR IGNORE INTO temp.sync_dirty (table_name, row_id, column_name) VALUES ('${name}', NEW.id, '${ROW_INSERTED}');
        END;
        CREATE TEMP TRIGGER sync_update_${name} AFTER UPDATE ON main.${name} ${when}
        BEGIN
            SELECT RAISE(ABORT, 'o id de uma linha sincronizada não muda') WHERE OLD.id IS NOT NEW.id;
            ${marks}
        END;
        CREATE TEMP TRIGGER sync_delete_${name} BEFORE DELETE ON main.${name}
        BEGIN
            SELECT RAISE(ABORT, 'hard delete em tabela sincronizada: use soft delete');
        END;
    `;
}
