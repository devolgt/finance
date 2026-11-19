import { describe, expect, it } from 'vitest';
import { syncBatchRequest } from '../../src/requests/syncRequests.ts';
import type { TestWorld } from '../support/TestWorld.ts';
import { device, domainDump, exchange, join, pull, syncOf } from '../support/syncSupport.ts';

/** Cena com um desktop que já tem dados e um celular que entrou vazio. */
interface Scene {
    readonly desktop: TestWorld;
    readonly phone: TestWorld;
    readonly profileId: string;
    readonly accountId: string;
    readonly subCategoryId: string;
}

/**
 * @return Desktop com perfil, conta e subcategoria, e celular que acabou de entrar.
 */
function scene(): Scene {
    const desktop = device(1);
    const profileId = desktop.profile();
    const accountId = desktop.account(profileId, { openingBalance: 1000 });
    const subCategoryId = desktop.subCategory(profileId);
    const phone = device(2);
    join(desktop, phone, 2);
    return { desktop, phone, profileId, accountId, subCategoryId };
}

/**
 * @param world Aparelho.
 * @param id Lançamento.
 * @return A linha do lançamento lida direto da tabela.
 */
function transactionRow(world: TestWorld, id: string): Readonly<Record<string, unknown>> | undefined {
    return world.database.get('SELECT * FROM transactions WHERE id = :id', { id });
}

describe('Extração e aplicação (sincronizacao §3.11)', () => {
    it('o aparelho que entra vazio recebe tudo, com os saldos recalculados', () => {
        const { desktop, phone } = scene();

        expect(domainDump(phone)).toBe(domainDump(desktop));
        expect(syncOf(phone).listMembers()).toHaveLength(2);
    });

    it('um lançamento feito no celular chega ao desktop, e o contrário', async () => {
        const { desktop, phone, profileId, accountId, subCategoryId } = scene();

        const fromPhone = await phone.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, name: 'Padaria', value: 12 });
        const fromDesktop = await desktop.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, name: 'Aluguel', value: 1500 });
        exchange(desktop, phone);

        expect(transactionRow(desktop, fromPhone.id)?.['name']).toBe('Padaria');
        expect(transactionRow(phone, fromDesktop.id)?.['name']).toBe('Aluguel');
        expect(domainDump(phone)).toBe(domainDump(desktop));
    });

    it('edições concorrentes em colunas diferentes da mesma transação sobrevivem as duas (sincronizacao §3.1)', async () => {
        const { desktop, phone, profileId, accountId, subCategoryId } = scene();
        const created = await desktop.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, name: 'Mercado', value: 100 });
        exchange(desktop, phone);

        await desktop.update({ profileId, subCategoryId }, created.id, { source: { kind: 'account', accountId }, name: 'Mercado', value: 130 });
        await phone.update({ profileId, subCategoryId }, created.id, { source: { kind: 'account', accountId }, name: 'Mercado', value: 100, description: 'Feira do mês' });
        exchange(desktop, phone);

        expect(transactionRow(desktop, created.id)).toMatchObject({ value: 130, description: 'Feira do mês' });
        expect(domainDump(phone)).toBe(domainDump(desktop));
    });

    it('na mesma célula vence a escrita com o maior relógio', async () => {
        const { desktop, phone, profileId, accountId, subCategoryId } = scene();
        const created = await desktop.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, name: 'Mercado' });
        exchange(desktop, phone);

        await desktop.update({ profileId, subCategoryId }, created.id, { source: { kind: 'account', accountId }, name: 'Primeiro' });
        // Os relógios de parede de teste andam por leitura; o do celular passa a estar depois.
        phone.wall.set(desktop.wall.millis() + 10_000);
        await phone.update({ profileId, subCategoryId }, created.id, { source: { kind: 'account', accountId }, name: 'Segundo' });
        exchange(desktop, phone);

        expect(transactionRow(desktop, created.id)?.['name']).toBe('Segundo');
        expect(domainDump(phone)).toBe(domainDump(desktop));
    });

    it('reaplicar um lote não muda nada', async () => {
        const { desktop, phone, profileId, accountId, subCategoryId } = scene();
        await desktop.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, name: 'Luz', value: 200 });
        const batch = syncBatchRequest.parse(JSON.parse(JSON.stringify(syncOf(desktop).extract(syncOf(phone).vector()))));
        syncOf(phone).apply(batch);
        const dump = domainDump(phone);
        const ledger = JSON.stringify(phone.database.all('SELECT * FROM sync_rows ORDER BY table_name, row_id')) + JSON.stringify(phone.database.all('SELECT * FROM sync_cells ORDER BY table_name, row_id, column_name'));
        const vector = syncOf(phone).vector().toEntries();

        syncOf(phone).apply(batch);

        expect(domainDump(phone)).toBe(dump);
        expect(JSON.stringify(phone.database.all('SELECT * FROM sync_rows ORDER BY table_name, row_id')) + JSON.stringify(phone.database.all('SELECT * FROM sync_cells ORDER BY table_name, row_id, column_name'))).toBe(ledger);
        expect(syncOf(phone).vector().toEntries()).toEqual(vector);
        // E o vetor do celular já cobre tudo o que o desktop tem: nada mais a trocar.
        expect(syncOf(desktop).extract(syncOf(phone).vector()).changes).toEqual([]);
    });

    it('recusa um lote com tabela fora do catálogo ou coluna de cache', () => {
        const { desktop, phone } = scene();
        const origin = syncOf(desktop).requireState();
        const change = { hlc: origin.clock.toString(), origin: origin.deviceId, seq: 99, rows: [], cells: [] };

        expect(() => syncBatchRequest.parse({ changes: [{ ...change, cells: [{ table: 'sync_state', id: 'x'.repeat(36), column: 'hlc', value: '' }] }], through: [] })).toThrow(/catálogo/);
        const accountId = String(desktop.database.get('SELECT id FROM accounts')?.['id']);
        const batch = syncBatchRequest.parse({ changes: [{ ...change, cells: [{ table: 'accounts', id: accountId, column: 'balance', value: 1e9 }] }], through: [] });
        expect(() => syncOf(phone).apply(batch)).toThrow(/não sincronizadas/);
    });

    it('um lote que falha não move o vetor nem deixa escrita pela metade', async () => {
        const { desktop, phone, profileId, accountId, subCategoryId } = scene();
        await desktop.create({ profileId, subCategoryId }, { source: { kind: 'account', accountId }, name: 'Gás' });
        const dto = syncOf(desktop).extract(syncOf(phone).vector());
        const broken = { ...dto, changes: [...dto.changes, { hlc: syncOf(desktop).requireState().clock.toString(), origin: syncOf(desktop).requireState().deviceId, seq: 999, rows: [], cells: [{ table: 'notes', id: '0'.repeat(36), column: 'note', value: 'x' }] }] };
        const vector = syncOf(phone).vector().toEntries();
        const dump = domainDump(phone);

        expect(() => syncOf(phone).apply(syncBatchRequest.parse(broken))).toThrow(/sem a linha/);

        expect(syncOf(phone).vector().toEntries()).toEqual(vector);
        expect(domainDump(phone)).toBe(dump);
        pull(desktop, phone);
        expect(domainDump(phone)).toBe(domainDump(desktop));
    });
});
