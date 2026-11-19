import type { Core } from '@finance/core';
import { PermissionStatus, useCameraPermissions } from 'expo-camera';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { AppLifecycle } from '../src/startup/AppLifecycle.tsx';
import type { DatabaseCopies } from '../src/startup/databaseCopy.ts';
import { renderApp } from './support/renderApp.tsx';
import { ok } from './support/scenario.ts';
import { MemoryNetwork, syncTestCore } from './support/syncCore.ts';

jest.mock('expo-file-system', () => ({ Paths: {} }));

/** Endereço do computador na rede em memória. */
const DESKTOP_ADDRESS = '192.168.0.10';

/** Permissão da câmera já concedida, como o `jestSetup` começa. */
const GRANTED = { granted: true, canAskAgain: true, status: PermissionStatus.GRANTED, expires: 'never' } as const;

/** Endereço do celular na rede em memória. */
const PHONE_ADDRESS = '192.168.0.20';

/**
 * Computador com o grupo criado, um perfil e o convite em aberto — o lado que o celular encontra
 * quando lê o QR.
 *
 * @param network Rede em memória do teste.
 * @param discovery `false` para o computador sem mDNS.
 * @return O núcleo do computador e o texto do convite.
 */
async function desktopWithInvite(network: MemoryNetwork, discovery = true): Promise<{ readonly desktop: Core; readonly invite: string }> {
    const desktop = syncTestCore({ device: 1, network, address: DESKTOP_ADDRESS, platform: 'desktop', discovery });
    await ok(desktop, 'onboarding.start', { profile: { name: 'Casa', type: 'personal', currency: 'BRL' }, account: { name: 'Nubank', type: 'checking' } });
    await ok(desktop, 'sync.createGroup', { deviceName: 'Computador' });
    const invite = await ok(desktop, 'sync.createInvite', {});
    return { desktop, invite: invite.text };
}

/**
 * Leva o celular para dentro do grupo do computador direto pelo núcleo, sem tela: o ponto de
 * partida dos testes da lista do grupo.
 *
 * @param network Rede em memória do teste.
 * @param discovery `false` para o computador sem mDNS.
 * @return Os dois núcleos, já pareados, com as sessões encerradas.
 */
async function pairedDevices(network: MemoryNetwork, discovery = true): Promise<{ readonly desktop: Core; readonly phone: Core }> {
    const { desktop, invite } = await desktopWithInvite(network, discovery);
    const phone = syncTestCore({ device: 2, network, address: PHONE_ADDRESS, platform: 'android' });
    const joined = await ok(phone, 'sync.join', { invite, deviceName: 'Pixel' });
    expect(joined.joined).toBe(true);
    await ok(phone, 'sync.close', {});
    return { desktop, phone };
}

/**
 * Dublê da cópia do banco que registra o descarte para entrar num grupo.
 *
 * @return O dublê e quantas vezes o banco foi tirado do lugar.
 */
function fakeCopies(): { readonly copies: DatabaseCopies; readonly setAside: { count: number } } {
    const setAside = { count: 0 };
    const copies: DatabaseCopies = {
        exportCopy: () => ({ ok: false, reason: 'unavailable' }),
        discard: () => undefined,
        importCopy: () => ({ result: { ok: false, reason: 'unreadable' }, closed: false }),
        logUri: () => null,
        setAsideForJoin: () => {
            setAside.count++;
            return { ok: true, previousCopy: 'antes-de-entrar-no-grupo-20260315-120000.sqlite' };
        },
    };
    return { copies, setAside };
}

describe('Dispositivos e entrar num grupo (sincronizacao §6.4)', () => {
    afterEach(() => {
        // Volta ao padrão do `jestSetup`: a câmera já permitida.
        jest.mocked(useCameraPermissions).mockReturnValue([GRANTED, jest.fn(), jest.fn()]);
    });

    it('no primeiro uso, lê o QR do convite, recebe os dados do grupo e entra no app no perfil do computador', async () => {
        const network = new MemoryNetwork();
        const { invite } = await desktopWithInvite(network);
        const phone = syncTestCore({ device: 2, network, address: PHONE_ADDRESS, platform: 'android' });
        await renderApp(phone);

        await fireEvent.press(await screen.findByRole('button', { name: 'Entrar num grupo existente' }));
        await fireEvent.changeText(screen.getByLabelText('Nome deste aparelho'), 'Pixel');
        await act(async () => {
            await fireEvent(screen.getByTestId('qr-camera'), 'barcodeScanned', { data: invite });
        });

        expect(await screen.findByRole('button', { name: 'Perfil: Casa · Pessoal. Trocar perfil' }, { timeout: 10_000 })).toBeOnTheScreen();
        const status = await ok(phone, 'sync.status', {});
        expect(status.members.map((member) => [member.name, member.isSelf])).toEqual(expect.arrayContaining([['Computador', false], ['Pixel', true]]));
        // A entrada terminou com a sessão encerrada: fora da tela de Dispositivos não há socket.
        expect(status.open).toBe(false);
        expect(status.members.every((member) => member.stage === null)).toBe(true);
    });

    it('um convite que não é da sincronização mostra o erro e continua na leitura', async () => {
        const network = new MemoryNetwork();
        const phone = syncTestCore({ device: 2, network, address: PHONE_ADDRESS, platform: 'android' });
        await renderApp(phone);

        await fireEvent.press(await screen.findByRole('button', { name: 'Entrar num grupo existente' }));
        await fireEvent.changeText(screen.getByLabelText('Ou cole o convite'), 'https://exemplo.com');
        await fireEvent.press(screen.getByRole('button', { name: 'Entrar com o convite colado' }));

        expect(await screen.findByRole('alert')).toBeOnTheScreen();
        expect(screen.getByTestId('qr-camera')).toBeOnTheScreen();
        await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
        expect(await screen.findByRole('button', { name: 'Criar e começar' })).toBeOnTheScreen();
    });

    it('sem a câmera, explica o porquê e pede a permissão', async () => {
        const request = jest.fn(() => Promise.resolve(GRANTED));
        jest.mocked(useCameraPermissions).mockReturnValue([{ granted: false, canAskAgain: true, status: PermissionStatus.UNDETERMINED, expires: 'never' }, request, request]);
        const phone = syncTestCore({ device: 2, network: new MemoryNetwork(), address: PHONE_ADDRESS, platform: 'android' });
        await renderApp(phone);

        await fireEvent.press(await screen.findByRole('button', { name: 'Entrar num grupo existente' }));
        expect(screen.getByText('Para ler o QR code do convite, o app precisa usar a câmera.')).toBeOnTheScreen();
        await fireEvent.press(screen.getByRole('button', { name: 'Permitir a câmera' }));

        expect(request).toHaveBeenCalledTimes(1);
    });

    it('Regra de negócio (Sincronização): com dados, "Entrar num grupo" confirma o descarte, guarda o banco e reabre vazio no primeiro uso', async () => {
        const network = new MemoryNetwork();
        const phone = syncTestCore({ device: 2, network, address: PHONE_ADDRESS, platform: 'android' });
        await ok(phone, 'onboarding.start', { profile: { name: 'Celular antigo', type: 'personal', currency: 'BRL' }, account: { name: 'Carteira', type: 'checking' } });
        const { copies, setAside } = fakeCopies();
        const empty = syncTestCore({ device: 3, network, address: PHONE_ADDRESS, platform: 'android' });
        await renderApp(phone, { initialUrl: '/more/devices', copies, reopen: () => empty });

        expect(await screen.findByText('Dados só neste aparelho')).toBeOnTheScreen();
        await fireEvent.press(screen.getByRole('button', { name: 'Entrar num grupo' }));
        const sheet = within(await screen.findByTestId('bottom-sheet'));
        expect(sheet.getByText(/serão descartados e substituídos pelos do grupo/)).toBeOnTheScreen();
        await fireEvent.press(sheet.getByRole('button', { name: 'Cancelar' }));
        expect(setAside.count).toBe(0);

        await fireEvent.press(screen.getByRole('button', { name: 'Entrar num grupo' }));
        await act(async () => {
            await fireEvent.press(within(await screen.findByTestId('bottom-sheet')).getByRole('button', { name: 'Descartar e continuar' }));
        });

        expect(await screen.findByText(/backups\/antes-de-entrar-no-grupo-20260315-120000\.sqlite/)).toBeOnTheScreen();
        expect(setAside.count).toBe(1);
        expect(await screen.findByRole('button', { name: 'Entrar num grupo existente' })).toBeOnTheScreen();
    });

    it('no grupo, lista os aparelhos com o estado de agora e sincroniza só com a tela em foco e o app em primeiro plano', async () => {
        const network = new MemoryNetwork();
        const { phone } = await pairedDevices(network);
        const lifecycle = new AppLifecycle();
        const app = await renderApp(phone, { initialUrl: '/more', lifecycle });

        await fireEvent.press(await screen.findByRole('button', { name: 'Dispositivos e sincronização, Neste aparelho e em mais 1 do grupo' }));
        expect(await screen.findByText('Pixel')).toBeOnTheScreen();
        expect(screen.getByText('Computador')).toBeOnTheScreen();
        expect(screen.getByText('este aparelho')).toBeOnTheScreen();
        // O computador continua com a tela aberta (o convite a abriu) e disca para o celular assim
        // que ele se anuncia: a sessão fica ao vivo.
        expect(await screen.findByText('Sincronizado com Computador agora', {}, { timeout: 10_000 })).toBeOnTheScreen();
        expect(network.openListeners()).toBe(2);

        await act(async () => {
            lifecycle.update('background');
            await Promise.resolve();
        });
        await waitFor(() => {
            expect(network.openListeners()).toBe(1);
        });

        await act(async () => {
            lifecycle.update('active');
            await Promise.resolve();
        });
        await waitFor(() => {
            expect(network.openListeners()).toBe(2);
        });

        await act(async () => {
            await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
        });
        expect(app.getPathname()).toBe('/more');
        await waitFor(() => {
            expect(network.openListeners()).toBe(1);
        });
    });

    it('remove um aparelho só depois da confirmação', async () => {
        const network = new MemoryNetwork();
        const { phone } = await pairedDevices(network);
        await renderApp(phone, { initialUrl: '/more/devices' });

        await fireEvent.press(await screen.findByRole('button', { name: 'Remover Computador' }));
        const sheet = within(await screen.findByTestId('bottom-sheet'));
        expect(sheet.getByText(/não volta/)).toBeOnTheScreen();
        await act(async () => {
            await fireEvent.press(sheet.getByRole('button', { name: 'Remover' }));
        });

        await waitFor(() => {
            expect(screen.queryByText('Computador')).not.toBeOnTheScreen();
        });
        const status = await ok(phone, 'sync.status', {});
        expect(status.members.find((member) => member.name === 'Computador')?.removed).toBe(true);
    });

    it('sai do grupo com confirmação, e o aparelho fora do grupo oferece entrar de novo descartando os dados', async () => {
        const network = new MemoryNetwork();
        const { phone } = await pairedDevices(network);
        await renderApp(phone, { initialUrl: '/more/devices', copies: fakeCopies().copies });

        await fireEvent.press(await screen.findByRole('button', { name: 'Sair do grupo' }));
        await act(async () => {
            await fireEvent.press(within(await screen.findByTestId('bottom-sheet')).getByRole('button', { name: 'Sair do grupo' }));
        });

        expect(await screen.findByText(/não sincroniza mais/)).toBeOnTheScreen();
        await fireEvent.press(screen.getByRole('button', { name: 'Entrar num grupo' }));
        expect(within(await screen.findByTestId('bottom-sheet')).getByRole('button', { name: 'Descartar e continuar' })).toBeOnTheScreen();
    });

    it('o endereço digitado confere o formato e disca para o aparelho escolhido', async () => {
        const network = new MemoryNetwork();
        // O computador está numa rede sem mDNS: só o endereço digitado leva o celular até ele.
        const { desktop, phone } = await pairedDevices(network, false);
        await ok(desktop, 'sync.close', {});
        const desktopPort = (await ok(desktop, 'sync.open', {})).port;
        await renderApp(phone, { initialUrl: '/more/devices' });

        await fireEvent.press(await screen.findByRole('button', { name: 'Digitar endereço manualmente' }));
        const sheet = within(await screen.findByTestId('bottom-sheet'));
        await fireEvent.changeText(sheet.getByLabelText('Endereço e porta'), DESKTOP_ADDRESS);
        await fireEvent.press(sheet.getByRole('button', { name: 'Conectar' }));
        expect(sheet.getByText('Digite o endereço e a porta, como 192.168.0.10:45123.')).toBeOnTheScreen();

        await fireEvent.changeText(sheet.getByLabelText(/^Endereço e porta/), `${DESKTOP_ADDRESS}:${String(desktopPort)}`);
        await act(async () => {
            await fireEvent.press(sheet.getByRole('button', { name: 'Conectar' }));
        });

        expect(await screen.findByText('Sincronizado com Computador agora', {}, { timeout: 10_000 })).toBeOnTheScreen();
    });
});
