import type { DeviceId } from '../domain/shared/ids.ts';
import type { SyncMember } from '../domain/sync/SyncMember.ts';

/** Acesso a `sync_members`, a lista replicada de aparelhos do grupo. */
export interface SyncMemberRepository {
    /**
     * @return Todos os membros, inclusive removidos — a remoção precisa continuar visível para
     * que o aparelho removido seja recusado.
     */
    listAll(): readonly SyncMember[];

    /**
     * @param id Aparelho.
     * @return O membro, removido ou não; `null` quando nunca foi do grupo.
     */
    findById(id: DeviceId): SyncMember | null;

    /**
     * @param member Membro novo.
     */
    insert(member: SyncMember): void;

    /**
     * @param id Membro a remover; a remoção é permanente.
     */
    markRemoved(id: DeviceId): void;
}
