import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { afterEach, describe, expect, it } from 'vitest';
import { copyDatabaseTo, createCore, openDatabase } from '../../src/index.ts';
import { BusinessRuleViolation } from '../../src/domain/shared/errors.ts';
import { DeviceId } from '../../src/domain/shared/ids.ts';
import { syncBatchRequest } from '../../src/requests/syncRequests.ts';
import { FixedClock, ManualWallClock, SequentialIds } from '../support/adapters.ts';
import { device, domainDump, exchange, join, syncOf, testPublicKey } from '../support/syncSupport.ts';

const folders: string[] = [];

/**
 * @param action Operação que deve ser recusada por regra de negócio.
 * @return A regra da recusa, ou `null` quando nada foi lançado.
 */
function ruleOf(action: () => unknown): unknown {
    try {
        action();
        return null;
    } catch (error) {
        return error instanceof BusinessRuleViolation ? error.details['rule'] : error;
    }
}

afterEach(() => {
    for (const folder of folders.splice(0)) {
        rmSync(folder, { recursive: true, force: true });
    }
});

describe('Membros, entrada e remoção (sync-plan Fase 6)', () => {
    it('recusa entrar num grupo com dados locais, e criar um segundo grupo', () => {
        const host = device(1);
        host.profile();
        const state = syncOf(host).createGroup({ name: 'Desktop', platform: 'desktop', publicKey: testPublicKey(1) });
        const guest = device(2);
        guest.profile();

        expect(ruleOf(() => syncOf(guest).joinEmpty(DeviceId(guest.ids.random()), state.groupId))).toBe('sync-device-has-data');
        expect(ruleOf(() => syncOf(host).createGroup({ name: 'De novo', platform: 'desktop', publicKey: testPublicKey(1) }))).toBe('sync-already-in-group');
    });

    it('entra por snapshot: a cópia do anfitrião vira o banco do aparelho novo, com identidade própria (sync-design §6.4)', async () => {
        const host = device(1);
        const profileId = host.profile();
        const accountId = host.account(profileId, { openingBalance: 500 });
        const subCategoryId = host.subCategory(profileId);
        const state = syncOf(host).createGroup({ name: 'Desktop', platform: 'desktop', publicKey: testPublicKey(1) });
        await host.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, name: 'Antes do snapshot', value: 50 });
        const guestId = syncOf(host).newDeviceId();
        syncOf(host).addMember(guestId, { name: 'Celular', platform: 'android', publicKey: testPublicKey(2) });

        const folder = mkdtempSync(joinPath(tmpdir(), 'sync-snapshot-'));
        folders.push(folder);
        const path = joinPath(folder, 'snapshot.sqlite');
        copyDatabaseTo(host.database, path);
        const database = BetterSqliteDatabase.open(path);
        const clock = new FixedClock('2026-03-15');
        openDatabase(database, { backups: null, clock });
        const guest = createCore({ database, clock, ids: new SequentialIds(2), wallClock: new ManualWallClock(host.wall.millis()) });
        const guestSync = guest.services.sync;
        if (guestSync === null) {
            throw new Error('núcleo sem sincronização');
        }

        const adopted = guestSync.adoptSnapshot(guestId, state.groupId);
        expect(adopted.deviceId).toBe(guestId);
        expect(adopted.clock.isAfter(syncOf(host).requireState().clock)).toBe(true);
        const created = await guest.call('transactions.create', { profileId, subCategoryId, type: 'expense', name: 'No celular', source: { kind: 'account', accountId }, value: 7, dueDate: '2026-03-02', paymentDate: null });
        expect(created.ok).toBe(true);

        syncOf(host).apply(syncBatchRequest.parse(JSON.parse(JSON.stringify(guestSync.extract(syncOf(host).vector())))));
        guestSync.apply(syncBatchRequest.parse(JSON.parse(JSON.stringify(syncOf(host).extract(guestSync.vector())))));
        expect(host.database.get("SELECT count(*) AS n FROM transactions WHERE name = 'No celular'")?.['n']).toBe(1);
        // O snapshot já trouxe tudo do anfitrião: nada da origem dele precisou ser reenviado.
        expect(syncOf(host).extract(guestSync.vector()).changes).toEqual([]);
        database.close();
    });

    it('sair do grupo se propaga como remoção, e o aparelho passa a ser recusado', () => {
        const desktop = device(1);
        desktop.profile();
        const phone = device(2);
        join(desktop, phone, 2);
        const phoneId = syncOf(phone).requireState().deviceId;

        syncOf(phone).leaveGroup();
        exchange(desktop, phone);

        expect(syncOf(desktop).activeMember(phoneId)).toBeNull();
        expect(syncOf(desktop).knownMember(phoneId)?.removedAt).not.toBeNull();
        expect(domainDump(phone)).toBe(domainDump(desktop));
    });
});
