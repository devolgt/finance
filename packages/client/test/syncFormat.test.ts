import type { SyncStatusResponse } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { describeSyncRefusal, inviteCountdown, syncMemberViews } from '../src/index.ts';

/**
 * @param overrides Partes do estado que o teste fixa.
 * @return Um estado com três aparelhos, um deles removido.
 */
function status(overrides: Partial<SyncStatusResponse> = {}): SyncStatusResponse {
    return {
        available: true,
        deviceId: 'a',
        groupId: 'g',
        hasData: true,
        members: [
            { id: 'b', name: 'Galaxy', platform: 'android', isSelf: false, removed: false, stage: 'live' },
            { id: 'a', name: 'Notebook', platform: 'desktop', isSelf: true, removed: false, stage: null },
            { id: 'c', name: 'Antigo', platform: 'android', isSelf: false, removed: true, stage: null },
            { id: 'd', name: 'Tablet', platform: 'android', isSelf: false, removed: false, stage: null },
        ],
        open: true,
        port: 4000,
        invite: null,
        lastRefusal: { deviceId: 'd', refusal: { reason: 'version', localVersion: 9, remoteVersion: 8 } },
        appliedBatches: 0,
        revivedRows: 0,
        ...overrides,
    };
}

describe('Tela de Dispositivos (sincronizacao §6.3 e §6.4)', () => {
    it('lista este aparelho primeiro, esconde os removidos e mostra o estado e o aviso de cada um', () => {
        const views = syncMemberViews(status());

        expect(views.map((view) => view.name)).toEqual(['Notebook', 'Galaxy', 'Tablet']);
        expect(views[0]).toMatchObject({ detail: 'Desktop · este aparelho', status: null, removable: false });
        expect(views[1]?.status).toEqual({ label: 'Sincronizado', tone: 'ok' });
        expect(views[2]).toMatchObject({ status: { label: 'Versão diferente', tone: 'warn' }, warning: 'Atualize o app em Tablet para sincronizar.' });
    });

    it('diz qual aparelho atualizar e a diferença dos relógios', () => {
        expect(describeSyncRefusal({ reason: 'version', localVersion: 8, remoteVersion: 9 }, 'Galaxy')).toBe('Atualize o app neste aparelho para sincronizar com Galaxy.');
        expect(describeSyncRefusal({ reason: 'clock', localMillis: 0, remoteMillis: 5 * 60_000 }, 'Galaxy')).toContain('5 min');
    });

    it('conta o tempo restante do convite', () => {
        expect(inviteCountdown(272_000, 0)).toBe('4:32');
        expect(inviteCountdown(0, 10)).toBe('0:00');
    });
});
