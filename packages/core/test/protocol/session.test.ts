import { utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { SyncCoordinator, type CoordinatorStatus, type SessionOutcome } from '../../src/index.ts';
import { SYNC_PROTOCOL_VERSION } from '../../src/protocol/messages.ts';
import { FrameConnection } from '../../src/protocol/SecureChannel.ts';
import type { TestWorld } from '../support/TestWorld.ts';
import { MemoryKeyStore, MemoryNetwork, nodeRandom } from '../support/memoryNetwork.ts';
import { device, domainDump, syncOf } from '../support/syncSupport.ts';

/** Um aparelho na rede em memória, com o coordenador da tela de Dispositivos. */
interface Node {
    readonly world: TestWorld;
    readonly coordinator: SyncCoordinator;
    readonly statuses: CoordinatorStatus[];
    applied: number;
}

/**
 * @param world Aparelho.
 * @param network Rede.
 * @param address Endereço dele na rede.
 * @return O nó.
 */
function node(world: TestWorld, network: MemoryNetwork, address: string): Node {
    const statuses: CoordinatorStatus[] = [];
    const result: Node = {
        world,
        statuses,
        applied: 0,
        coordinator: new SyncCoordinator(syncOf(world), {
            transport: network.transport(address),
            discovery: network.discovery(address),
            keyStore: new MemoryKeyStore(),
            random: nodeRandom,
            wallClock: world.wall,
            snapshots: null,
        }, {
            changed: (status) => statuses.push(status),
            applied: () => {
                result.applied++;
            },
        }),
    };
    return result;
}

/**
 * @param condition Condição esperada.
 * @param label Descrição para a falha.
 */
async function eventually(condition: () => boolean, label: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
        if (condition()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`não aconteceu: ${label}`);
}

/**
 * Desktop com dados e grupo criado, e celular vazio que entra pelo convite.
 *
 * @param network Rede.
 * @return Os dois nós, já sincronizados e com a tela de Dispositivos fechada.
 */
async function pairedDevices(network = new MemoryNetwork()): Promise<{ readonly desktop: Node; readonly phone: Node; readonly network: MemoryNetwork; readonly ids: { readonly profileId: string; readonly accountId: string; readonly subCategoryId: string } }> {
    const desktopWorld = device(1);
    const profileId = desktopWorld.profile();
    const accountId = desktopWorld.account(profileId, { openingBalance: 1000 });
    const subCategoryId = desktopWorld.subCategory(profileId);
    const desktop = node(desktopWorld, network, '192.168.0.10');
    const phone = node(device(2), network, '192.168.0.20');
    syncOf(desktopWorld).createGroup({ name: 'Desktop', platform: 'desktop', publicKey: await desktop.coordinator.publicKey() });
    await desktop.coordinator.open();

    const invite = await desktop.coordinator.createInvite(['192.168.0.10', '8.8.8.8']);
    expect(invite.addresses).toEqual(['192.168.0.10']);
    const joined = await phone.coordinator.join(invite, { name: 'Celular', platform: 'android' });
    expect(joined).toEqual({ kind: 'joined', snapshot: false });
    await eventually(() => domainDump(phone.world) === domainDump(desktopWorld), 'o celular recebe o banco do desktop');
    await phone.coordinator.close();
    await desktop.coordinator.close();
    return { desktop, phone, network, ids: { profileId, accountId, subCategoryId } };
}

describe('Sessão sobre um Transport em memória (sync-plan Fase 5)', () => {
    it('entra pelo convite, troca o que falta ao abrir a tela e envia ao vivo enquanto ela está aberta', async () => {
        const { desktop, phone, ids } = await pairedDevices();
        expect(syncOf(desktop.world).listMembers().map((member) => member.name)).toEqual(expect.arrayContaining(['Desktop', 'Celular']));

        await phone.world.create({ profileId: ids.profileId, subCategoryId: ids.subCategoryId }, { source: { kind: 'account', accountId: ids.accountId }, name: 'Offline', value: 30 });
        await desktop.coordinator.open();
        await phone.coordinator.open();
        await eventually(() => domainDump(phone.world) === domainDump(desktop.world), 'a escrita offline chega ao abrir a tela');
        await eventually(() => desktop.coordinator.status().sessions.some((session) => session.stage === 'live'), 'a sessão entra no modo ao vivo');

        const live = await desktop.world.create({ profileId: ids.profileId, subCategoryId: ids.subCategoryId }, { source: { kind: 'account', accountId: ids.accountId }, name: 'Ao vivo', value: 45 });
        desktop.coordinator.notifyLocalChange();
        await eventually(() => phone.world.database.get('SELECT id FROM transactions WHERE id = :id', { id: live.id }) !== undefined, 'o lançamento ao vivo chega');
        expect(phone.applied).toBeGreaterThan(0);

        await phone.coordinator.close();
        await eventually(() => desktop.coordinator.status().sessions.length === 0, 'fechar a tela num lado encerra a sessão no outro');
        await desktop.coordinator.close();
        expect(domainDump(phone.world)).toBe(domainDump(desktop.world));
    });

    it('recusa a sessão quando os relógios divergem mais de 2 minutos', async () => {
        const { desktop, phone } = await pairedDevices();
        phone.world.wall.set(desktop.world.wall.millis() + 3 * 60 * 1000);

        await desktop.coordinator.open();
        await phone.coordinator.open();

        await eventually(() => desktop.coordinator.status().lastEnd?.outcome.kind === 'refused', 'a sessão é recusada');
        const outcome = desktop.coordinator.status().lastEnd?.outcome as Extract<SessionOutcome, { kind: 'refused' }>;
        expect(outcome.refusal.reason).toBe('clock');
        await phone.coordinator.close();
        await desktop.coordinator.close();
    });

    it('recusa a sessão quando as versões de schema diferem', async () => {
        const { desktop, phone } = await pairedDevices();
        phone.world.database.exec('PRAGMA user_version = 99');

        await desktop.coordinator.open();
        await phone.coordinator.open();

        await eventually(() => phone.coordinator.status().lastEnd?.outcome.kind === 'refused', 'a sessão é recusada');
        expect(phone.coordinator.status().lastEnd?.outcome).toMatchObject({ kind: 'refused', refusal: { reason: 'version', localVersion: 99 } });
        await phone.coordinator.close();
        await desktop.coordinator.close();
    });

    it('um membro removido é recusado depois da troca de membros', async () => {
        const { desktop, phone } = await pairedDevices();
        syncOf(desktop.world).removeMember(syncOf(phone.world).requireState().deviceId);

        await desktop.coordinator.open();
        await phone.coordinator.open();

        await eventually(() => phone.coordinator.status().lastEnd?.outcome.kind === 'refused', 'a sessão é recusada');
        expect(phone.coordinator.status().lastEnd?.outcome).toMatchObject({ kind: 'refused', refusal: { reason: 'removed' } });
        // O celular aprendeu a própria remoção pelos membros, que vêm antes de qualquer dado.
        expect(syncOf(phone.world).activeMember(syncOf(phone.world).requireState().deviceId)).toBeNull();
        await phone.coordinator.close();
        await desktop.coordinator.close();
    });

    it('o convite é de uso único', async () => {
        const network = new MemoryNetwork();
        const { desktop } = await pairedDevices(network);
        await desktop.coordinator.open();
        const invite = await desktop.coordinator.createInvite(['192.168.0.10']);
        const first = node(device(3), network, '192.168.0.30');
        await first.coordinator.join(invite, { name: 'Tablet', platform: 'android' });

        const second = node(device(4), network, '192.168.0.40');
        await expect(second.coordinator.join(invite, { name: 'Intruso', platform: 'android' })).resolves.toMatchObject({ kind: 'refused', refusal: { reason: 'no-invite' } });
        await first.coordinator.close();
        await desktop.coordinator.close();
    });

    it('uma conexão que não prova o segredo não queima o convite', async () => {
        const network = new MemoryNetwork();
        const { desktop } = await pairedDevices(network);
        await desktop.coordinator.open();
        const invite = await desktop.coordinator.createInvite(['192.168.0.10']);

        // Um intruso na rede manda o hello de pareamento em claro e desiste antes do handshake.
        const intruder = new FrameConnection(await network.transport('192.168.0.66').connect('192.168.0.10', invite.port));
        await intruder.send(utf8ToBytes(JSON.stringify({ protocol: SYNC_PROTOCOL_VERSION, mode: 'pair', deviceId: '00000000-0000-4000-8000-000000000066' })));
        await intruder.receive();
        intruder.close();
        await new Promise((resolve) => setTimeout(resolve, 10));

        const tablet = node(device(3), network, '192.168.0.30');
        await expect(tablet.coordinator.join(invite, { name: 'Tablet', platform: 'android' })).resolves.toEqual({ kind: 'joined', snapshot: false });
        await tablet.coordinator.close();
        await desktop.coordinator.close();
    });

    it('uma recusa por relógio no pareamento deixa o mesmo convite valer depois de corrigido', async () => {
        const network = new MemoryNetwork();
        const { desktop } = await pairedDevices(network);
        await desktop.coordinator.open();
        const invite = await desktop.coordinator.createInvite(['192.168.0.10']);
        const tablet = node(device(3), network, '192.168.0.30');
        const correct = tablet.world.wall.millis();
        tablet.world.wall.set(correct + 3 * 60 * 1000);

        await expect(tablet.coordinator.join(invite, { name: 'Tablet', platform: 'android' })).resolves.toMatchObject({ kind: 'refused', refusal: { reason: 'clock' } });
        await new Promise((resolve) => setTimeout(resolve, 10));
        tablet.world.wall.set(correct);

        await expect(tablet.coordinator.join(invite, { name: 'Tablet', platform: 'android' })).resolves.toEqual({ kind: 'joined', snapshot: false });
        await tablet.coordinator.close();
        await desktop.coordinator.close();
    });

    it('no modo ao vivo não devolve ao par o lote que acabou de receber dele', async () => {
        const { desktop, phone, ids } = await pairedDevices();
        await desktop.coordinator.open();
        await phone.coordinator.open();
        await eventually(() => desktop.coordinator.status().sessions.some((session) => session.stage === 'live'), 'a sessão entra no modo ao vivo');
        await eventually(() => phone.coordinator.status().sessions.some((session) => session.stage === 'live'), 'o celular entra no modo ao vivo');
        const desktopApplied = desktop.applied;

        const live = await desktop.world.create({ profileId: ids.profileId, subCategoryId: ids.subCategoryId }, { source: { kind: 'account', accountId: ids.accountId }, name: 'Ao vivo', value: 45 });
        desktop.coordinator.notifyLocalChange();
        await eventually(() => phone.world.database.get('SELECT id FROM transactions WHERE id = :id', { id: live.id }) !== undefined, 'o lançamento chega');
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(desktop.applied).toBe(desktopApplied);
        await phone.coordinator.close();
        await desktop.coordinator.close();
    });

    it('queda de conexão em qualquer passo não deixa nada pela metade, e a próxima sessão converge', async () => {
        const { desktop, phone, network, ids } = await pairedDevices();
        await phone.world.create({ profileId: ids.profileId, subCategoryId: ids.subCategoryId }, { source: { kind: 'account', accountId: ids.accountId }, name: 'Celular', value: 10 });
        await desktop.world.create({ profileId: ids.profileId, subCategoryId: ids.subCategoryId }, { source: { kind: 'account', accountId: ids.accountId }, name: 'Desktop', value: 20 });

        for (let budget = 1; budget <= 12; budget++) {
            network.writeBudget = budget;
            await desktop.coordinator.open();
            await phone.coordinator.open();
            // Com escritas suficientes a sessão completa e fica ao vivo; com menos, cai no meio.
            await eventually(
                () => (desktop.coordinator.status().sessions.length === 0 && phone.coordinator.status().sessions.length === 0)
                    || desktop.coordinator.status().sessions.some((session) => session.stage === 'live'),
                `a sessão termina ou fica ao vivo com ${String(budget)} escritas`,
            );
            await phone.coordinator.close();
            await desktop.coordinator.close();
            for (const world of [desktop.world, phone.world]) {
                expect(world.database.all('PRAGMA foreign_key_check')).toEqual([]);
                expect((await world.ok('integrity.verifyBalances', {})).drifts).toEqual([]);
            }
        }

        network.writeBudget = Number.POSITIVE_INFINITY;
        await desktop.coordinator.open();
        await phone.coordinator.open();
        await eventually(() => domainDump(phone.world) === domainDump(desktop.world), 'converge depois das quedas');
        await phone.coordinator.close();
        await desktop.coordinator.close();
    });
});
