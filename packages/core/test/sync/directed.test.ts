import { describe, expect, it } from 'vitest';
import type { CoreOutput } from '../../src/index.ts';
import type { TestWorld } from '../support/TestWorld.ts';
import { device, domainDump, exchange, join, pull, syncOf } from '../support/syncSupport.ts';

type Transaction = CoreOutput<'transactions.get'>;

/** Dois aparelhos no mesmo grupo, com perfil, conta e subcategoria semeados no primeiro. */
interface Pair {
    readonly desktop: TestWorld;
    readonly phone: TestWorld;
    readonly profileId: string;
    readonly accountId: string;
    readonly subCategoryId: string;
}

/**
 * @param today "Hoje" dos dois aparelhos.
 * @param seed Semeadura extra no desktop antes de criar o grupo.
 * @return O par sincronizado.
 */
function pair(today = '2026-10-15', seed: (world: TestWorld, profileId: string) => void = () => undefined): Pair {
    const desktop = device(1, today);
    const profileId = desktop.profile();
    const accountId = desktop.account(profileId, { openingBalance: 1000 });
    const subCategoryId = desktop.subCategory(profileId);
    seed(desktop, profileId);
    const phone = device(2, today);
    join(desktop, phone, 2);
    return { desktop, phone, profileId, accountId, subCategoryId };
}

/**
 * @param world Aparelho.
 * @param first Primeira ocorrência da série.
 * @return As ocorrências vivas da série, em ordem de número.
 */
function liveOccurrences(world: TestWorld, first: Transaction): readonly { readonly occurrence: number; readonly dueDate: string; readonly recurrenceId: string }[] {
    return world.database
        .all(
            `SELECT occurrence, due_date, recurrence_id FROM transactions
            WHERE deleted_at IS NULL AND recurrence_id IN (SELECT id FROM recurrences WHERE profile_id = (SELECT profile_id FROM recurrences WHERE id = :id))
            ORDER BY recurrence_id, occurrence`,
            { id: first.recurrenceId },
        )
        .map((row) => ({ occurrence: Number(row['occurrence']), dueDate: String(row['due_date']), recurrenceId: String(row['recurrence_id']) }));
}

/**
 * @param world Aparelho.
 * @param first Primeira ocorrência da série.
 * @param occurrence Número procurado.
 * @return A ocorrência viva, pela rota.
 * @throws {Error} Quando a série não tem a ocorrência viva.
 */
async function occurrenceOf(world: TestWorld, first: Transaction, occurrence: number): Promise<Transaction> {
    const row = world.database.get(
        'SELECT id FROM transactions WHERE recurrence_id = :recurrenceId AND occurrence = :occurrence AND deleted_at IS NULL',
        { recurrenceId: first.recurrenceId, occurrence },
    );
    if (typeof row?.['id'] !== 'string') {
        throw new Error(`sem a ocorrência ${String(occurrence)}`);
    }
    return world.ok('transactions.get', { id: row['id'] });
}

/**
 * @param a Um aparelho.
 * @param b O outro.
 */
async function expectConverged(a: TestWorld, b: TestWorld): Promise<void> {
    expect(domainDump(b)).toBe(domainDump(a));
    for (const world of [a, b]) {
        expect(world.database.all('PRAGMA foreign_key_check')).toEqual([]);
        expect((await world.ok('integrity.verifyBalances', {})).drifts).toEqual([]);
    }
}

describe('Testes direcionados da sync-design §11.4', () => {
    it('colisão de nomes: categoria e subcategoria criadas offline nos dois mesclam no menor id, levando os lançamentos', async () => {
        const { desktop, phone, profileId, accountId } = pair();
        const mine = await desktop.ok('categories.create', { profileId, name: 'Alimentação' });
        const mySub = await desktop.ok('subCategories.create', { categoryId: mine.id, name: 'Mercado' });
        const theirs = await phone.ok('categories.create', { profileId, name: 'alimentação' });
        const theirSub = await phone.ok('subCategories.create', { categoryId: theirs.id, name: 'MERCADO' });
        await desktop.create({ profileId, subCategoryId: mySub.id }, { source: { kind: 'account', accountId }, name: 'Feira', dueDate: '2026-10-02' });
        await phone.create({ profileId, subCategoryId: theirSub.id }, { source: { kind: 'account', accountId }, name: 'Padaria', dueDate: '2026-10-03' });

        exchange(desktop, phone);
        pull(desktop, phone);

        const survivor = [mySub.id, theirSub.id].sort()[0];
        for (const world of [desktop, phone]) {
            const live = world.database.all("SELECT id FROM transaction_categories WHERE deleted_at IS NULL AND lower(name) = 'alimentação'");
            expect(live).toHaveLength(1);
            const used = world.database.all('SELECT DISTINCT sub_category_id AS id FROM transactions WHERE deleted_at IS NULL AND name IN (\'Feira\', \'Padaria\')');
            expect(used.map((row) => row['id'])).toEqual([survivor]);
        }
        await expectConverged(desktop, phone);
    });

    it('filho órfão: lançamento novo numa conta excluída no outro aparelho revive a conta, com aviso', async () => {
        const { desktop, phone, profileId, accountId, subCategoryId } = pair();
        await phone.ok('accounts.delete', { id: accountId });
        const added = await desktop.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, name: 'Luz', value: 90, dueDate: '2026-10-08' });

        const report = pull(phone, desktop);
        pull(desktop, phone);

        expect(report.revived.map((row) => row.table)).toContain('accounts');
        for (const world of [desktop, phone]) {
            expect(world.database.get('SELECT deleted_at FROM accounts WHERE id = :accountId', { accountId })?.['deleted_at']).toBeNull();
            expect(world.database.get('SELECT deleted_at FROM transactions WHERE id = :id', { id: added.id })?.['deleted_at']).toBeNull();
        }
        await expectConverged(desktop, phone);
    });

    it('a mesma ocorrência gerada nos dois aparelhos, com o dia da série trocado em um deles, vira uma linha só', async () => {
        const { desktop, phone, profileId, accountId, subCategoryId } = pair();
        const first = await desktop.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, name: 'Aluguel', value: 2300, dueDate: '2026-10-05', repeat: { kind: 'fixed', frequency: 'monthly', endAt: null } });
        exchange(desktop, phone);

        // Até 25/11 o horizonte de 12 meses alcança a ocorrência 14 nos dois calendários (dia 5 e dia 20).
        for (const world of [desktop, phone]) {
            world.clock.set('2026-11-25');
        }
        await desktop.ok('recurrences.topUp', {});
        // O celular troca o dia e completa a série depois do desktop, no relógio de parede.
        phone.wall.set(desktop.wall.millis() + 5_000);
        await phone.edit(await occurrenceOf(phone, first, 3), { dueDate: '2026-12-20', scope: 'future' });
        await phone.ok('recurrences.topUp', {});
        exchange(desktop, phone);
        pull(desktop, phone);

        const occurrences = liveOccurrences(desktop, first).filter((row) => row.recurrenceId === first.recurrenceId);
        expect(occurrences.filter((row) => row.occurrence === 14)).toHaveLength(1);
        // A data do dia âncora novo vence: o complemento do celular é mais novo que o do desktop.
        expect(occurrences.find((row) => row.occurrence === 14)?.dueDate).toBe('2027-11-20');
        await expectConverged(desktop, phone);
    });

    it('série recomeçada num aparelho e a regra antiga completada offline no outro: as ocorrências além do término saem', async () => {
        const { desktop, phone, profileId, accountId, subCategoryId } = pair();
        const repeat = { kind: 'fixed', frequency: 'monthly', endAt: null } as const;
        const first = await desktop.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, name: 'Academia', value: 120, dueDate: '2026-10-05', repeat });
        exchange(desktop, phone);

        await desktop.edit(await occurrenceOf(desktop, first, 3), { scope: 'future', repeat: { ...repeat, frequency: 'weekly' } });
        phone.clock.set('2026-11-10');
        expect((await phone.ok('recurrences.topUp', {})).emitted).toBe(1);
        desktop.clock.set('2026-11-10');
        exchange(desktop, phone);
        pull(desktop, phone);

        for (const world of [desktop, phone]) {
            const old = liveOccurrences(world, first).filter((row) => row.recurrenceId === first.recurrenceId);
            expect(old.map((row) => row.occurrence)).toEqual([1, 2]);
        }
        await expectConverged(desktop, phone);
    });

    it('soft delete continua excluído quando o outro aparelho edita outra coluna', async () => {
        const { desktop, phone, profileId, accountId, subCategoryId } = pair();
        const created = await desktop.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, name: 'Internet', value: 100, dueDate: '2026-10-07' });
        exchange(desktop, phone);

        await desktop.ok('transactions.delete', { id: created.id });
        phone.wall.set(desktop.wall.millis() + 5_000);
        await phone.update({ profileId, subCategoryId }, created.id, { source: { kind: 'account', accountId }, name: 'Internet fibra', value: 100, dueDate: '2026-10-07' });
        exchange(desktop, phone);

        for (const world of [desktop, phone]) {
            const row = world.database.get('SELECT name, deleted_at FROM transactions WHERE id = :id', { id: created.id });
            expect(row?.['deleted_at']).not.toBeNull();
            expect(row?.['name']).toBe('Internet fibra');
        }
        await expectConverged(desktop, phone);
    });

    it('transferência entre perfis feita no celular chega com as duas pernas e os saldos dos dois perfis', async () => {
        let business = '';
        let businessAccount = '';
        const { desktop, phone, profileId, accountId, subCategoryId } = pair('2026-10-15', (world) => {
            business = world.profile({ type: 'business' });
            businessAccount = world.account(business, { openingBalance: 200 });
        });

        await phone.create({ profileId, subCategoryId }, {
            source: { kind: 'account', accountId }, type: 'transference', value: 500, charges: 8, dueDate: '2026-10-05', paymentDate: '2026-10-05', destinationAccountId: businessAccount,
        });
        exchange(desktop, phone);

        expect(desktop.accountRow(accountId).balance).toEqualMoney('492');
        expect(desktop.accountRow(businessAccount).balance).toEqualMoney('700');
        expect(business).not.toBe('');
        await expectConverged(desktop, phone);
    });

    it('divergência de relógio: uma réplica com o relógio de parede atrasado ainda ordena a edição dela depois da que recebeu', async () => {
        const { desktop, phone, profileId, accountId, subCategoryId } = pair();
        const created = await desktop.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, name: 'Mercado', dueDate: '2026-10-07' });
        await desktop.update({ profileId, subCategoryId }, created.id, { source: { kind: 'account', accountId }, name: 'Do desktop', dueDate: '2026-10-07' });
        pull(desktop, phone);

        // O celular está um minuto atrasado, mas editou depois de ver a edição do desktop.
        phone.wall.set(desktop.wall.millis() - 60_000);
        await phone.update({ profileId, subCategoryId }, created.id, { source: { kind: 'account', accountId }, name: 'Do celular', dueDate: '2026-10-07' });
        exchange(desktop, phone);

        expect(desktop.database.get('SELECT name FROM transactions WHERE id = :id', { id: created.id })?.['name']).toBe('Do celular');
        await expectConverged(desktop, phone);
        expect(syncOf(phone).requireState().clock.isAfter(syncOf(desktop).requireState().clock) || syncOf(desktop).requireState().clock.isAfter(syncOf(phone).requireState().clock)).toBe(true);
    });
});
