import { SYNCED_TABLES } from '../../src/domain/sync/SyncCatalog.ts';
import { syncedColumnsOf } from '../../src/infrastructure/sync/CaptureTriggers.ts';
import { DeviceId } from '../../src/domain/shared/ids.ts';
import { syncBatchRequest } from '../../src/requests/syncRequests.ts';
import type { ApplyReport } from '../../src/services/sync/BatchApplier.ts';
import type { SyncService } from '../../src/services/sync/SyncService.ts';
import type { SqlValue } from '../../src/index.ts';
import { SequentialIds } from './adapters.ts';
import { TestWorld } from './TestWorld.ts';

/** Chave pública de teste: 32 bytes em hexadecimal, o formato do `CHECK` de `sync_members`. */
export function testPublicKey(device: number): string {
    return device.toString(16).padStart(64, '0');
}

/**
 * @param world Mundo montado com `wallClock`.
 * @return O Service da sincronização.
 * @throws {Error} Quando o mundo foi montado sem sincronização — erro do próprio teste.
 */
export function syncOf(world: TestWorld): SyncService {
    const { sync } = world.core.services;
    if (sync === null) {
        throw new Error('o TestWorld foi montado sem wallClock');
    }
    return sync;
}

/**
 * Um aparelho de teste: um mundo com ids próprios. Cada aparelho tem o seu namespace de ids
 * para que dois deles nunca gerem o mesmo UUID "aleatório", como no mundo real.
 *
 * @param device Número do aparelho; vira o namespace dos ids e a chave pública.
 * @param today "Hoje" do aparelho.
 * @return O mundo, ainda fora de qualquer grupo.
 */
export function device(device: number, today = '2026-03-15'): TestWorld {
    return new TestWorld(today, 'BRL', new SequentialIds(device));
}

/**
 * @param world Mundo.
 * @return Cada célula sincronizada das tabelas do catálogo, por `tabela/id/coluna`. Lida direto
 * das tabelas, sem passar pelo código testado.
 */
export function cellValues(world: TestWorld): ReadonlyMap<string, SqlValue> {
    const cells = new Map<string, SqlValue>();
    for (const table of SYNCED_TABLES) {
        const columns = syncedColumnsOf(world.database, table);
        for (const row of world.database.all(`SELECT * FROM ${table.name}`)) {
            for (const column of columns) {
                cells.set(`${table.name}/${String(row['id'])}/${column}`, row[column] ?? null);
            }
        }
    }
    return cells;
}

/**
 * @param world Mundo dentro de um grupo.
 * @return O relógio efetivo de cada célula (a entrada de célula, ou a da linha), por
 * `tabela/id/coluna`; `null` quando a linha não tem entrada nenhuma.
 */
export function effectiveClocks(world: TestWorld): ReadonlyMap<string, string | null> {
    const clocks = new Map<string, string | null>();
    for (const table of SYNCED_TABLES) {
        const columns = syncedColumnsOf(world.database, table);
        for (const row of world.database.all(
            `SELECT t.id, r.hlc FROM ${table.name} t LEFT JOIN sync_rows r ON r.table_name = '${table.name}' AND r.row_id = t.id`,
        )) {
            for (const column of columns) {
                const cell = world.database.get(
                    'SELECT hlc FROM sync_cells WHERE table_name = :table AND row_id = :id AND column_name = :column',
                    { table: table.name, id: row['id'] ?? null, column },
                );
                const clock = cell?.['hlc'] ?? row['hlc'] ?? null;
                clocks.set(`${table.name}/${String(row['id'])}/${column}`, typeof clock === 'string' ? clock : null);
            }
        }
    }
    return clocks;
}

/**
 * Despejo determinístico das tabelas de domínio — todas as colunas, caches incluídos —, para
 * comparar réplicas byte a byte. Os caches entram porque cada réplica os recalcula, e um
 * recálculo que dependesse da ordem de chegada também é divergência.
 *
 * @param world Mundo.
 * @return Texto estável com as linhas de cada tabela em ordem de id.
 */
export function domainDump(world: TestWorld): string {
    return SYNCED_TABLES.map((table) => {
        const rows = world.database.all(`SELECT * FROM ${table.name} ORDER BY id`);
        return `${table.name}\n${rows.map((row) => JSON.stringify(row)).join('\n')}`;
    }).join('\n');
}

/**
 * Leva a `to` tudo o que `from` tem e `to` não tem, passando pelo mesmo caminho da rede: o
 * lote vira JSON e volta pela validação de `syncBatchRequest`.
 *
 * @param from Aparelho que envia.
 * @param to Aparelho que recebe.
 * @return O relatório da aplicação em `to`.
 */
export function pull(from: TestWorld, to: TestWorld): ApplyReport {
    const dto = syncOf(from).extract(syncOf(to).vector());
    return syncOf(to).apply(syncBatchRequest.parse(JSON.parse(JSON.stringify(dto))));
}

/**
 * Uma sessão completa entre dois aparelhos: cada um recebe o que falta do outro.
 *
 * @param a Um aparelho.
 * @param b O outro.
 */
export function exchange(a: TestWorld, b: TestWorld): void {
    pull(a, b);
    pull(b, a);
}

/**
 * Cria um grupo em `host` (se ainda não houver) e põe `guest`, vazio, nele: o anfitrião
 * registra o membro, e o convidado recebe tudo pelo primeiro lote.
 *
 * @param host Aparelho com o grupo.
 * @param guest Aparelho vazio.
 * @param number Número do convidado, para a chave pública.
 */
export function join(host: TestWorld, guest: TestWorld, number: number): void {
    const hostSync = syncOf(host);
    const state = hostSync.state() ?? hostSync.createGroup({ name: 'Anfitrião', platform: 'desktop', publicKey: testPublicKey(1) });
    const guestId = DeviceId(guest.ids.random());
    hostSync.addMember(guestId, { name: `Aparelho ${number}`, platform: 'android', publicKey: testPublicKey(number) });
    syncOf(guest).joinEmpty(guestId, state.groupId);
    pull(host, guest);
}
