import { describe, expect, it } from 'vitest';
import { SequentialIds } from '../support/adapters.ts';
import { MemoryKeyStore, MemoryNetwork, nodeRandom } from '../support/memoryNetwork.ts';
import { domainDump } from '../support/syncSupport.ts';
import { TestWorld } from '../support/TestWorld.ts';

/**
 * @param network Rede em memória.
 * @param number Número do aparelho.
 * @param address Endereço na rede.
 * @param platform Plataforma informada.
 * @return O aparelho com as rotas de sincronização ligadas à rede.
 */
function deviceOn(network: MemoryNetwork, number: number, address: string, platform: 'desktop' | 'android'): TestWorld {
    return new TestWorld('2026-03-15', 'BRL', new SequentialIds(number), {
        platform,
        localAddresses: () => [address],
        transport: network.transport(address),
        discovery: network.discovery(address),
        keyStore: new MemoryKeyStore(),
        random: nodeRandom,
        snapshots: null,
    });
}

/**
 * @param condition Condição esperada.
 */
async function eventually(condition: () => Promise<boolean>): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
        if (await condition()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('a condição não aconteceu');
}

describe('Rotas da tela de Dispositivos (sync-plan Fases 7 e 8)', () => {
    it('cria o grupo, convida, o celular entra pelo texto do QR e o modo ao vivo segue os commits', async () => {
        const network = new MemoryNetwork();
        const desktop = deviceOn(network, 1, '192.168.0.10', 'desktop');
        const profileId = desktop.profile();
        const accountId = desktop.account(profileId, { openingBalance: 100 });
        const subCategoryId = desktop.subCategory(profileId);
        const phone = deviceOn(network, 2, '192.168.0.20', 'android');

        expect(await desktop.ok('sync.status', {})).toMatchObject({ available: true, groupId: null, hasData: true, members: [] });
        const created = await desktop.ok('sync.createGroup', { deviceName: 'Notebook' });
        expect(created.members).toMatchObject([{ name: 'Notebook', platform: 'desktop', isSelf: true }]);
        await desktop.ok('sync.open', {});
        const invite = await desktop.ok('sync.createInvite', {});
        expect(invite.addresses).toEqual(['192.168.0.10']);

        const joined = await phone.ok('sync.join', { invite: invite.text, deviceName: 'Galaxy' });
        expect(joined).toEqual({ joined: true, restartRequired: false, refusal: null });
        await eventually(() => Promise.resolve(domainDump(phone) === domainDump(desktop)));
        // Entrar encerra a sessão de entrada; o modo ao vivo volta com a tela de Dispositivos aberta.
        expect((await phone.ok('sync.status', {})).open).toBe(false);
        await phone.ok('sync.open', {});

        await desktop.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, name: 'Ao vivo' });
        await eventually(() => Promise.resolve(phone.database.get("SELECT 1 AS found FROM transactions WHERE name = 'Ao vivo'") !== undefined));
        const status = await phone.ok('sync.status', {});
        expect(status.appliedBatches).toBeGreaterThan(0);
        expect(status.members.map((member) => member.name).sort()).toEqual(['Galaxy', 'Notebook']);

        await phone.ok('sync.close', {});
        await desktop.ok('sync.close', {});
        expect((await desktop.failure('sync.join', { invite: 'qualquer coisa', deviceName: 'X' })).details).toMatchObject({ rule: 'sync-invite-invalid' });
    });

    it('conectar a um endereço digitado responde com a regra quando a discagem não pode acontecer', async () => {
        const network = new MemoryNetwork();
        const desktop = deviceOn(network, 1, '192.168.0.10', 'desktop');
        const created = await desktop.ok('sync.createGroup', { deviceName: 'Notebook' });
        const selfId = created.members[0]?.id ?? '';

        expect((await desktop.failure('sync.connect', { address: '8.8.8.8', port: 47_000, deviceId: selfId })).details).toMatchObject({ rule: 'sync-address-not-local' });
        expect((await desktop.failure('sync.connect', { address: '192.168.0.20', port: 47_000, deviceId: '00000000-0000-4000-8000-000000000099' })).details).toMatchObject({ rule: 'sync-not-a-member' });
        expect((await desktop.failure('sync.connect', { address: '192.168.0.20', port: 47_000, deviceId: selfId })).details).toMatchObject({ rule: 'sync-peer-unreachable' });
    });

    it('sem wallClock as rotas respondem que a sincronização está indisponível', async () => {
        const { createCore, openDatabase } = await import('../../src/index.ts');
        const { BetterSqliteDatabase } = await import('@finance/sqlite-better');
        const { FixedClock } = await import('../support/adapters.ts');
        const database = BetterSqliteDatabase.open(':memory:');
        const clock = new FixedClock('2026-03-15');
        openDatabase(database, { backups: null, clock });
        const core = createCore({ database, clock, ids: new SequentialIds() });

        const result = await core.call('sync.status', {});
        expect(result.ok ? null : result.error.details).toMatchObject({ rule: 'sync-unavailable' });
    });
});
