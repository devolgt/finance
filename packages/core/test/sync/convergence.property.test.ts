import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CoreInput } from '../../src/index.ts';
import type { TestWorld } from '../support/TestWorld.ts';
import { device, domainDump, join, pull, syncOf } from '../support/syncSupport.ts';

/** Uma operação aleatória numa réplica, ou uma troca entre duas. */
type Step =
    | { readonly kind: 'create'; readonly replica: number; readonly source: number; readonly cents: number; readonly date: string; readonly paid: boolean }
    | { readonly kind: 'update'; readonly replica: number; readonly pick: number; readonly cents: number; readonly date: string; readonly name: string }
    | { readonly kind: 'setPaid'; readonly replica: number; readonly pick: number; readonly paid: boolean }
    | { readonly kind: 'delete'; readonly replica: number; readonly pick: number }
    | { readonly kind: 'pay'; readonly replica: number; readonly pick: number; readonly date: string }
    | { readonly kind: 'tag'; readonly replica: number; readonly name: string }
    | { readonly kind: 'renameTag'; readonly replica: number; readonly pick: number; readonly name: string }
    | { readonly kind: 'deleteTag'; readonly replica: number; readonly pick: number }
    | { readonly kind: 'tagTransaction'; readonly replica: number; readonly pick: number; readonly tag: number }
    | { readonly kind: 'category'; readonly replica: number; readonly name: string; readonly sub: string }
    | { readonly kind: 'installments'; readonly replica: number; readonly cents: number; readonly date: string; readonly count: number }
    | { readonly kind: 'clock'; readonly replica: number; readonly shift: number }
    | { readonly kind: 'exchange'; readonly from: number; readonly to: number };

const REPLICAS = 3;
const replicaArb = fc.integer({ min: 0, max: REPLICAS - 1 });
const dateArb = fc.record({ month: fc.integer({ min: 2, max: 5 }), day: fc.integer({ min: 1, max: 28 }) })
    .map(({ month, day }) => `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
const centsArb = fc.integer({ min: 100, max: 200_000 });
// Poucos nomes para que dois aparelhos criem o mesmo vocabulário offline e colidam (sincronizacao §3.8).
const nameArb = fc.constantFrom('Mercado', 'mercado', 'Casa', 'Viagem');

const stepArb: fc.Arbitrary<Step> = fc.oneof(
    { weight: 6, arbitrary: fc.record({ kind: fc.constant('create' as const), replica: replicaArb, source: fc.integer({ min: 0, max: 2 }), cents: centsArb, date: dateArb, paid: fc.boolean() }) },
    { weight: 3, arbitrary: fc.record({ kind: fc.constant('update' as const), replica: replicaArb, pick: fc.nat(), cents: centsArb, date: dateArb, name: nameArb }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('setPaid' as const), replica: replicaArb, pick: fc.nat(), paid: fc.boolean() }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('delete' as const), replica: replicaArb, pick: fc.nat() }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('pay' as const), replica: replicaArb, pick: fc.nat(), date: dateArb }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('tag' as const), replica: replicaArb, name: nameArb }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('renameTag' as const), replica: replicaArb, pick: fc.nat(), name: nameArb }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('deleteTag' as const), replica: replicaArb, pick: fc.nat() }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('tagTransaction' as const), replica: replicaArb, pick: fc.nat(), tag: fc.nat() }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('category' as const), replica: replicaArb, name: nameArb, sub: nameArb }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('installments' as const), replica: replicaArb, cents: centsArb, date: dateArb, count: fc.integer({ min: 2, max: 4 }) }) },
    // O relógio de parede de um aparelho anda ou volta até um minuto, dentro do limite da sessão.
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('clock' as const), replica: replicaArb, shift: fc.integer({ min: -60_000, max: 60_000 }) }) },
    { weight: 4, arbitrary: fc.record({ kind: fc.constant('exchange' as const), from: replicaArb, to: replicaArb }) },
);

/** As réplicas e os ids do cenário semeado no primeiro aparelho antes de criar o grupo. */
interface Mesh {
    readonly replicas: readonly TestWorld[];
    readonly profileId: string;
    readonly subCategoryId: string;
    readonly accounts: readonly [string, string];
    readonly card: string;
}

/**
 * @return Três aparelhos no mesmo grupo: o primeiro com perfil, duas contas e um cartão; os
 * outros entraram vazios.
 */
function mesh(): Mesh {
    const first = device(1);
    const profileId = first.profile();
    const accounts = [first.account(profileId, { openingBalance: 1000 }), first.account(profileId, { openingBalance: 50 })] as const;
    const card = first.creditCard(profileId, accounts[0], 10, 17);
    const subCategoryId = first.subCategory(profileId);
    const replicas = [first, device(2), device(3)];
    replicas.slice(1).forEach((replica, index) => {
        join(first, replica, index + 2);
    });
    return { replicas, profileId, subCategoryId, accounts, card };
}

/**
 * @param world Réplica.
 * @param sql Consulta que devolve `id`.
 * @param pick Índice sorteado.
 * @return Um id vivo, ou `null` quando a consulta não devolve nada.
 */
function pickId(world: TestWorld, sql: string, pick: number): string | null {
    const rows = world.database.all(sql);
    const id = rows[pick % Math.max(rows.length, 1)]?.['id'];
    return typeof id === 'string' ? id : null;
}

/**
 * Executa um passo pelas rotas reais da réplica. Recusas de regra (nome repetido, fatura já
 * paga) são aceitas: o que se verifica é a convergência, não o sucesso de cada operação.
 *
 * @param m Réplicas.
 * @param step Passo sorteado.
 */
async function run(m: Mesh, step: Step): Promise<void> {
    if (step.kind === 'exchange') {
        const from = m.replicas[step.from];
        const to = m.replicas[step.to];
        if (from !== undefined && to !== undefined && from !== to) {
            pull(from, to);
        }
        return;
    }
    const world = m.replicas[step.replica];
    if (world === undefined) {
        return;
    }
    const base = { profileId: m.profileId, subCategoryId: m.subCategoryId };
    const liveTransaction = (pick: number): string | null => pickId(world, 'SELECT id FROM transactions WHERE deleted_at IS NULL ORDER BY id', pick);
    switch (step.kind) {
        case 'create': {
            const source: CoreInput<'transactions.create'>['source'] = step.source === 2
                ? { kind: 'creditCard', creditCardId: m.card, invoicePeriod: null }
                : { kind: 'account', accountId: m.accounts[step.source] ?? '' };
            await world.core.call('transactions.create', { ...base, type: 'expense', name: 'Op', source, value: step.cents / 100, dueDate: step.date, paymentDate: step.paid && step.source !== 2 ? step.date : null });
            return;
        }
        case 'update': {
            const id = liveTransaction(step.pick);
            const current = id === null ? null : await world.core.call('transactions.get', { id });
            if (id === null || current === null || !current.ok) {
                return;
            }
            const t = current.data;
            const source: CoreInput<'transactions.update'>['source'] = t.container.kind === 'invoice'
                ? { kind: 'creditCard', creditCardId: t.container.creditCardId, invoicePeriod: null }
                : { kind: 'account', accountId: t.container.accountId };
            await world.core.call('transactions.update', {
                id, ...base, type: t.type, source, name: step.name, destinationAccountId: t.destinationAccountId, partnerId: t.partnerId, goalId: t.goalId,
                goalWithdrawal: t.goalWithdrawal, description: t.description, originCurrency: t.originCurrency, conversionRate: t.conversionRate,
                value: step.cents / 100, charges: t.charges.amount, dueDate: step.date, paymentDate: t.paymentDate, tagIds: [...t.tagIds],
            });
            return;
        }
        case 'setPaid': {
            const id = liveTransaction(step.pick);
            if (id !== null) {
                await world.core.call('transactions.setPaid', { id, paid: step.paid });
            }
            return;
        }
        case 'delete': {
            const id = liveTransaction(step.pick);
            if (id !== null) {
                await world.core.call('transactions.delete', { id });
            }
            return;
        }
        case 'pay': {
            const invoiceId = pickId(world, 'SELECT id FROM invoices WHERE deleted_at IS NULL ORDER BY id', step.pick);
            if (invoiceId !== null) {
                await world.core.call('invoices.pay', { invoiceId, paymentDate: step.date });
            }
            return;
        }
        case 'tag':
            await world.core.call('tags.create', { profileId: m.profileId, name: step.name });
            return;
        case 'renameTag':
        case 'deleteTag': {
            const id = pickId(world, 'SELECT id FROM tags WHERE deleted_at IS NULL ORDER BY id', step.pick);
            if (id !== null) {
                await (step.kind === 'renameTag' ? world.core.call('tags.update', { id, name: step.name }) : world.core.call('tags.delete', { id }));
            }
            return;
        }
        case 'tagTransaction': {
            const id = liveTransaction(step.pick);
            const tagId = pickId(world, 'SELECT id FROM tags WHERE deleted_at IS NULL ORDER BY id', step.tag);
            const current = id === null ? null : await world.core.call('transactions.get', { id });
            if (id === null || tagId === null || current === null || !current.ok) {
                return;
            }
            const t = current.data;
            const source: CoreInput<'transactions.update'>['source'] = t.container.kind === 'invoice'
                ? { kind: 'creditCard', creditCardId: t.container.creditCardId, invoicePeriod: null }
                : { kind: 'account', accountId: t.container.accountId };
            await world.core.call('transactions.update', {
                id, subCategoryId: t.subCategoryId, type: t.type, source, name: t.name, destinationAccountId: t.destinationAccountId, partnerId: t.partnerId, goalId: t.goalId,
                goalWithdrawal: t.goalWithdrawal, description: t.description, originCurrency: t.originCurrency, conversionRate: t.conversionRate,
                value: t.value.amount, charges: t.charges.amount, dueDate: t.dueDate, paymentDate: t.paymentDate, tagIds: [...new Set([...t.tagIds, tagId])],
            });
            return;
        }
        case 'category': {
            const created = await world.core.call('categories.create', { profileId: m.profileId, name: step.name });
            const categoryId = created.ok ? created.data.id : pickId(world, 'SELECT id FROM transaction_categories WHERE deleted_at IS NULL ORDER BY id', 0);
            if (categoryId !== null) {
                await world.core.call('subCategories.create', { categoryId, name: step.sub });
            }
            return;
        }
        case 'installments':
            await world.core.call('recurrences.planCreate', {
                ...base, type: 'expense', name: 'Parcelado', value: step.cents / 100, source: { kind: 'account', accountId: m.accounts[0] }, dueDate: step.date, paymentDate: null,
                repeat: { kind: 'installments', frequency: 'monthly', installments: step.count, valueType: 'total' },
            });
            return;
        case 'clock':
            world.wall.set(world.wall.millis() + step.shift);
            return;
    }
}

/**
 * Troca tudo entre todos até ninguém ter mais nada a receber. Duas voltas bastam numa malha
 * completa, mas a terceira confirma que a passada pós-aplicação não fica gerando mudanças
 * novas a cada troca.
 *
 * @param m Réplicas.
 */
function settle(m: Mesh): void {
    for (let round = 0; round < 3; round++) {
        for (const from of m.replicas) {
            for (const to of m.replicas) {
                if (from !== to) {
                    pull(from, to);
                }
            }
        }
    }
}

describe('Convergência (sincronizacao §9)', () => {
    it('réplicas com operações e trocas aleatórias terminam idênticas nas tabelas de domínio', async () => {
        await fc.assert(fc.asyncProperty(fc.array(stepArb, { minLength: 5, maxLength: 80 }), async (steps) => {
            const m = mesh();
            for (const step of steps) {
                await run(m, step);
            }
            settle(m);

            const [first, ...others] = m.replicas;
            if (first === undefined) {
                return;
            }
            const expected = domainDump(first);
            for (const replica of others) {
                expect(domainDump(replica)).toBe(expected);
            }
            for (const replica of m.replicas) {
                expect(replica.database.all('PRAGMA foreign_key_check')).toEqual([]);
                const integrity = await replica.ok('integrity.verifyBalances', {});
                expect(integrity.drifts).toEqual([]);
                // Nada mais a trocar: o vetor de cada um cobre o dos outros.
                for (const other of m.replicas) {
                    expect(syncOf(replica).vector().covers(syncOf(other).vector())).toBe(true);
                }
            }
        }), { numRuns: 100 });
    }, 120_000);
});
