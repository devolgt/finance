import { describe, expect, it } from 'vitest';
import { LOCAL_TABLES, SYNCED_TABLES } from '../../src/domain/sync/SyncCatalog.ts';
import type { TestWorld } from '../support/TestWorld.ts';
import { cellValues, device, effectiveClocks, syncOf, testPublicKey } from '../support/syncSupport.ts';

/**
 * Mundo com um perfil, uma conta, um cartão e uma subcategoria, já dentro de um grupo.
 *
 * @return O mundo e os ids semeados.
 */
async function groupWorld(): Promise<{ readonly world: TestWorld; readonly profileId: string; readonly accountId: string; readonly creditCardId: string; readonly subCategoryId: string }> {
    const world = device(1);
    const profileId = world.profile();
    const accountId = world.account(profileId, { openingBalance: 1000 });
    const creditCardId = world.creditCard(profileId, accountId, 3, 10);
    const subCategoryId = world.subCategory(profileId);
    syncOf(world).createGroup({ name: 'Desktop', platform: 'desktop', publicKey: testPublicKey(1) });
    await Promise.resolve();
    return { world, profileId, accountId, creditCardId, subCategoryId };
}

/**
 * @param world Mundo.
 * @return As sequências distintas registradas nas tabelas de relógio.
 */
function sequences(world: TestWorld): readonly number[] {
    return world.database
        .all('SELECT seq FROM sync_rows UNION SELECT seq FROM sync_cells ORDER BY seq')
        .map((row) => Number(row['seq']));
}

describe('Captura das escritas (sincronizacao §3.4)', () => {
    it('classifica toda tabela do schema como sincronizada ou local', () => {
        const world = device(1);
        const tables = world.database
            .all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
            .map((row) => String(row['name']));
        const classified = new Set([...SYNCED_TABLES.map((table) => table.name), ...LOCAL_TABLES]);

        expect(tables.filter((table) => !classified.has(table))).toEqual([]);
        expect([...classified].filter((table) => !tables.includes(table))).toEqual([]);
    });

    it('ao criar o grupo, toda linha existente ganha entrada com origem neste aparelho (sincronizacao §4.6)', async () => {
        const { world } = await groupWorld();
        const state = syncOf(world).requireState();

        const unregistered = [...effectiveClocks(world)].filter(([key, clock]) => clock === null && !key.startsWith('sync_members/'));
        expect(unregistered).toEqual([]);
        expect(world.database.get('SELECT count(*) AS n FROM sync_rows WHERE seq = 1 AND origin = :origin', { origin: state.deviceId })?.['n']).toBeGreaterThan(0);
        // O próprio membro é a primeira escrita capturada.
        expect(syncOf(world).listMembers().map((member) => member.name)).toEqual(['Desktop']);
        expect(sequences(world)).toEqual([1, 2]);
        expect(syncOf(world).vector().seqOf(state.deviceId)).toBe(2);
    });

    it('uma unidade de trabalho é uma sequência e um HLC, e a criação não gera entradas de célula', async () => {
        const { world, profileId, accountId, subCategoryId } = await groupWorld();

        await world.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, tagIds: [], dueDate: '2026-03-10' });

        expect(sequences(world)).toEqual([1, 2, 3]);
        const stamped = world.database.all('SELECT DISTINCT hlc FROM sync_rows WHERE seq = 3 UNION SELECT DISTINCT hlc FROM sync_cells WHERE seq = 3');
        expect(stamped).toHaveLength(1);
        expect(world.database.get("SELECT count(*) AS n FROM sync_rows WHERE seq = 3 AND table_name = 'transactions'")?.['n']).toBe(1);
        expect(world.database.get('SELECT count(*) AS n FROM sync_cells WHERE seq = 3')?.['n']).toBe(0);
    });

    it('uma edição registra só as colunas que mudaram, com relógio novo', async () => {
        const { world, profileId, accountId, subCategoryId } = await groupWorld();
        const created = await world.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, name: 'Mercado' });

        await world.update({ profileId, subCategoryId }, created.id, { source: { kind: 'account', accountId }, name: 'Feira' });

        const cells = world.database
            .all("SELECT column_name FROM sync_cells WHERE table_name = 'transactions' AND row_id = :id ORDER BY column_name", { id: created.id })
            .map((row) => row['column_name']);
        // O relógio de teste devolve o mesmo instante o dia todo, então `updated_at` não muda.
        expect(cells).toEqual(['name']);
    });

    it('o recálculo de saldos não gera entrada nem muda updated_at (sincronizacao §3.4)', async () => {
        const { world, profileId, accountId, subCategoryId } = await groupWorld();
        await world.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId } });
        const before = sequences(world);
        const updatedAt = world.database.get('SELECT updated_at FROM accounts WHERE id = :accountId', { accountId });
        world.clock.set('2026-04-02');

        await world.ok('balances.rebuildAccount', { accountId });

        expect(sequences(world)).toEqual(before);
        expect(world.database.get('SELECT updated_at FROM accounts WHERE id = :accountId', { accountId })).toEqual(updatedAt);
    });

    it('recusa hard delete em tabela sincronizada', async () => {
        const { world, profileId } = await groupWorld();

        await world.ok('notes.create', { profileId, text: 'Anotação' });
        expect(() => world.database.run('DELETE FROM notes WHERE profile_id = :profileId', { profileId })).toThrow(/hard delete/);
    });

    it('cada operação das rotas que altera uma célula deixa nela um relógio efetivo novo', async () => {
        const { world, profileId, accountId, creditCardId, subCategoryId } = await groupWorld();
        const base = { profileId, subCategoryId };
        const operations: readonly (() => Promise<unknown>)[] = [
            () => world.create(base, { source: { kind: 'account', accountId }, name: 'Aluguel', value: 1500 }),
            () => world.create(base, { source: { kind: 'creditCard', creditCardId }, value: 80, dueDate: '2026-03-05' }),
            () => world.ok('notes.create', { profileId, text: 'Lembrete' }),
            () => world.ok('tags.create', { profileId, name: 'Casa' }),
            async () => {
                const category = await world.ok('categories.create', { profileId, name: 'Lazer' });
                await world.ok('subCategories.create', { categoryId: category.id, name: 'Cinema' });
                await world.ok('categories.update', { id: category.id, name: 'Diversão' });
            },
            () => world.ok('accounts.create', { profileId, name: 'Poupança', type: 'investment' }),
            () => world.ok('goals.create', { profileId, name: 'Viagem', value: 4000, targetDate: '2027-01-15' }),
            () => world.ok('profiles.update', { id: profileId, name: 'Casa', currency: 'BRL' }),
            () => world.ok('recurrences.planCreate', {
                profileId, subCategoryId, type: 'expense', name: 'Notebook', value: 900, source: { kind: 'account', accountId }, dueDate: '2026-03-06', paymentDate: null,
                repeat: { kind: 'installments', frequency: 'monthly', installments: 3, valueType: 'total' },
            }),
            () => world.payInvoice(creditCardId, '2026-04', '2026-04-10'),
        ];

        for (const operation of operations) {
            const valuesBefore = cellValues(world);
            const clocksBefore = effectiveClocks(world);
            await operation();
            const clocksAfter = effectiveClocks(world);
            for (const [key, value] of cellValues(world)) {
                if (valuesBefore.has(key) && valuesBefore.get(key) === value) {
                    continue;
                }
                const before = clocksBefore.get(key) ?? '';
                const after = clocksAfter.get(key) ?? '';
                expect({ key, newer: after > before }).toEqual({ key, newer: true });
            }
        }
    });
});
