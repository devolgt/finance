import type { CoreInput, CoreOutput, CoreRoute } from '@finance/core';
import { expect, test } from '@playwright/test';
import { completeFirstUse } from './firstUse.ts';
import { launchApp, removeUserData, type LaunchedApp } from './launchApp.ts';

/*
 * Teste de fumaça da sincronização (sincronizacao §6.3): dois apps desktop no mesmo computador.
 * O primeiro cria o grupo e convida; o segundo entra pelo primeiro uso colando o convite e
 * recebe os dados; com a tela de Dispositivos aberta nos dois, um lançamento feito no segundo
 * chega ao primeiro. A segunda sessão é discada pelo endereço do convite, e não pela
 * descoberta mDNS, que nem toda rede de CI deixa passar.
 */

/**
 * Chama uma rota pelo mesmo canal que a UI usa e exige sucesso.
 *
 * @param launched App aberto.
 * @param route Rota do núcleo.
 * @param input Entrada.
 * @return A saída da rota.
 * @throws {Error} Quando a rota falha.
 */
async function call<R extends CoreRoute>(launched: LaunchedApp, route: R, input: CoreInput<R>): Promise<CoreOutput<R>> {
    const result = await launched.window.evaluate(({ r, i }) => window.finance.core.call(r, i), { r: route, i: input });
    if (!result.ok) {
        throw new Error(`${route} falhou: ${JSON.stringify(result.error)}`);
    }
    return result.data;
}

test('dois apps no mesmo host pareiam e trocam um lançamento', async () => {
    test.setTimeout(120_000);
    const host = await launchApp();
    const guest = await launchApp();
    try {
        await completeFirstUse(host.window, { profileName: 'Casa', accountName: 'Conta' });
        await host.window.getByRole('link', { name: 'Dispositivos' }).dispatchEvent('click');
        await host.window.getByRole('button', { name: 'Criar grupo' }).dispatchEvent('click');
        await host.window.getByRole('button', { name: 'Gerar convite' }).dispatchEvent('click');
        await expect(host.window.getByRole('img', { name: 'QR code do convite' })).toBeVisible();
        const invite = (await call(host, 'sync.status', {})).invite;
        if (invite === null) {
            throw new Error('o convite não abriu');
        }
        // O convite segue pela área de transferência, como o usuário faz entre dois computadores.
        await host.window.getByRole('button', { name: 'Copiar convite' }).dispatchEvent('click');
        await expect(host.window.getByText('Convite copiado.')).toBeVisible();
        const copied = await host.app.evaluate(({ clipboard }) => clipboard.readText());
        expect(copied).toBe(invite.text);

        await guest.window.getByLabel('Convite').fill(copied);
        await guest.window.getByRole('button', { name: 'Entrar num grupo existente' }).dispatchEvent('click');
        await expect(guest.window.getByTestId('profile-switcher')).toContainText('Casa', { timeout: 30_000 });

        await guest.window.getByRole('link', { name: 'Dispositivos' }).dispatchEvent('click');
        await expect(guest.window.getByText('Neste grupo')).toBeVisible();
        const hostStatus = await call(host, 'sync.status', {});
        await call(guest, 'sync.connect', { address: invite.addresses[0] ?? '', port: hostStatus.port ?? 0, deviceId: hostStatus.deviceId ?? '' });
        await expect(host.window.getByText('Sincronizado')).toBeVisible({ timeout: 30_000 });

        const profileId = (await call(guest, 'profiles.list', {}))[0]?.id ?? '';
        const accounts = await call(guest, 'accounts.list', { profileId, period: '2026-01' });
        const tree = await call(guest, 'categories.tree', { profileId });
        await call(guest, 'transactions.create', {
            profileId,
            subCategoryId: tree[0]?.subCategories[0]?.id ?? '',
            type: 'expense',
            name: 'Feito no outro app',
            source: { kind: 'account', accountId: accounts.accounts[0]?.id ?? '' },
            value: 42,
            dueDate: '2026-01-10',
        });
        await expect.poll(async () => (await call(host, 'transactions.listByPeriod', { profileId, period: '2026-01' })).map((transaction) => transaction.name), { timeout: 30_000 })
            .toContain('Feito no outro app');
    } finally {
        await guest.app.close();
        await host.app.close();
        removeUserData(guest.userData);
        removeUserData(host.userData);
    }
});
