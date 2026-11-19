import type { SyncMemberResponse, SyncRefusalResponse, SyncStatusResponse } from '@finance/core';
import { SYNC_PLATFORM_LABELS } from './syncLabels.ts';

/** Como a tela mostra um aparelho do grupo: o estado da sessão agora, e o aviso quando houver. */
export interface SyncMemberView {
    readonly id: string;
    readonly name: string;
    readonly detail: string;
    readonly status: { readonly label: string; readonly tone: 'ok' | 'warn' | 'muted' } | null;
    readonly warning: string | null;
    readonly isSelf: boolean;
    readonly removable: boolean;
}

/**
 * Monta a lista da tela de Dispositivos a partir do estado. Fica no `client` para que desktop
 * e celular digam o mesmo para cada situação.
 * Decisão de interface (sincronizacao §7.1): sem histórico de
 * sessões, cada aparelho mostra o estado agora — conectando, sincronizando, ao vivo —, e o
 * aviso de relógio ou de versão vem da última recusa.
 *
 * @param status Estado da sincronização.
 * @return Os aparelhos ativos, este primeiro.
 */
export function syncMemberViews(status: SyncStatusResponse): readonly SyncMemberView[] {
    return [...status.members]
        .filter((member) => !member.removed)
        .sort((a, b) => Number(b.isSelf) - Number(a.isSelf))
        .map((member) => {
            const refusal = status.lastRefusal?.deviceId === member.id ? status.lastRefusal.refusal : null;
            return {
                id: member.id,
                name: member.name,
                detail: member.isSelf ? `${SYNC_PLATFORM_LABELS[member.platform]} · este aparelho` : SYNC_PLATFORM_LABELS[member.platform],
                status: member.isSelf ? null : memberStatus(member, refusal),
                warning: refusal === null ? null : describeSyncRefusal(refusal, member.name),
                isSelf: member.isSelf,
                removable: !member.isSelf,
            };
        });
}

/**
 * @param member Aparelho.
 * @param refusal Última recusa com ele.
 * @return O selo do estado.
 */
function memberStatus(member: SyncMemberResponse, refusal: SyncRefusalResponse | null): SyncMemberView['status'] {
    if (member.stage === 'live') {
        return { label: 'Sincronizado', tone: 'ok' };
    }
    if (member.stage === 'syncing' || member.stage === 'handshake') {
        return { label: 'Sincronizando…', tone: 'muted' };
    }
    if (refusal?.reason === 'version') {
        return { label: 'Versão diferente', tone: 'warn' };
    }
    if (refusal?.reason === 'clock') {
        return { label: 'Relógio divergente', tone: 'warn' };
    }
    return { label: 'Aguardando', tone: 'muted' };
}

/**
 * Explica uma recusa dizendo o que corrigir e em qual aparelho (sincronizacao §3.2 e
 * banco-de-dados §5.9). No relógio não dá para saber qual dos dois está errado, então a
 * mensagem mostra a diferença e pede para conferir a hora dos dois.
 *
 * @param refusal Motivo.
 * @param peerName Nome do outro aparelho, quando conhecido.
 * @return A mensagem para o usuário.
 */
export function describeSyncRefusal(refusal: SyncRefusalResponse, peerName: string | null): string {
    const peer = peerName ?? 'o outro aparelho';
    switch (refusal.reason) {
        case 'clock': {
            const minutes = Math.round(Math.abs(refusal.localMillis - refusal.remoteMillis) / 60_000);
            return `Os relógios deste aparelho e de ${peer} estão ${String(minutes)} min diferentes. Acerte a data e a hora automáticas no que estiver errado.`;
        }
        case 'version':
            return refusal.localVersion < refusal.remoteVersion
                ? `Atualize o app neste aparelho para sincronizar com ${peer}.`
                : `Atualize o app em ${peer} para sincronizar.`;
        case 'removed':
            return 'Este aparelho foi removido do grupo, ou tentou falar com um aparelho removido.';
        case 'not-member':
            return `${peer} não reconhece este aparelho como membro do grupo.`;
        case 'no-invite':
            return 'O convite expirou ou já foi usado. Gere um novo no outro aparelho.';
        case 'has-data':
            return 'Este aparelho tem dados. Descarte-os antes de entrar num grupo.';
    }
}

/**
 * @param expiresAt Fim da validade do convite, em milissegundos.
 * @param now Agora, em milissegundos.
 * @return "m:ss" restantes, ou "0:00" depois de expirar.
 */
export function inviteCountdown(expiresAt: number, now: number): string {
    const seconds = Math.max(0, Math.floor((expiresAt - now) / 1000));
    return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}
