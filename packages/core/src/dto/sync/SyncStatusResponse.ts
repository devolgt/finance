import type { SyncPlatform } from '../../domain/sync/SyncMember.ts';

/** Etapa de uma sessão em andamento, como a tela mostra. */
export type SyncSessionStage = 'handshake' | 'syncing' | 'live';

/**
 * Por que a última sessão foi recusada. A tela diz o que corrigir e em qual aparelho
 * (sincronizacao §3.2 e banco-de-dados §5.9).
 */
export type SyncRefusalResponse =
    | { readonly reason: 'clock'; readonly localMillis: number; readonly remoteMillis: number }
    | { readonly reason: 'version'; readonly localVersion: number; readonly remoteVersion: number }
    | { readonly reason: 'not-member' | 'removed' | 'no-invite' | 'has-data' };

/** Um aparelho do grupo na lista da tela. */
export interface SyncMemberResponse {
    readonly id: string;
    readonly name: string;
    readonly platform: SyncPlatform;
    readonly isSelf: boolean;
    readonly removed: boolean;
    /** Etapa da sessão com ele agora; `null` quando não há sessão. */
    readonly stage: SyncSessionStage | null;
}

/** O convite em aberto: o texto vira QR; endereço e porta servem à digitação manual. */
export interface SyncInviteResponse {
    readonly text: string;
    readonly expiresAt: number;
    readonly addresses: readonly string[];
    readonly port: number;
}

/**
 * Estado da sincronização para a tela de Dispositivos. A tela o consulta periodicamente
 * enquanto está aberta — a única hora em que a sincronização roda (sincronizacao §5.1) — e
 * invalida as consultas da UI quando `appliedBatches` cresce.
 */
export interface SyncStatusResponse {
    /** `false` quando o app foi montado sem os adaptadores de rede. */
    readonly available: boolean;
    readonly deviceId: string | null;
    readonly groupId: string | null;
    /** Há dados locais: entrar num grupo exige descartá-los antes (sincronizacao §4.4). */
    readonly hasData: boolean;
    readonly members: readonly SyncMemberResponse[];
    /** A tela está aberta: escutando, anunciando e procurando. */
    readonly open: boolean;
    readonly port: number | null;
    readonly invite: SyncInviteResponse | null;
    /** Recusa da última sessão encerrada, enquanto não houver sessão nova com o mesmo aparelho. */
    readonly lastRefusal: { readonly deviceId: string | null; readonly refusal: SyncRefusalResponse } | null;
    /** Lotes aplicados desde que o núcleo abriu. */
    readonly appliedBatches: number;
    /** Pais excluídos que um lote reviveu desde que o núcleo abriu (sincronizacao §3.9). */
    readonly revivedRows: number;
}

/** Desfecho de entrar num grupo pelo convite. */
export interface SyncJoinResponse {
    readonly joined: boolean;
    /** `true` quando o banco foi trocado pelo snapshot e o app precisa reabrir. */
    readonly restartRequired: boolean;
    readonly refusal: SyncRefusalResponse | null;
}
