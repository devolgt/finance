import { BusinessRuleViolation } from '../../domain/shared/errors.ts';

/**
 * Uma operação de sincronização pediu o grupo, e o aparelho não pertence a nenhum. É regra,
 * e não bug, porque a tela de Dispositivos pode ser aberta antes de criar ou entrar num grupo.
 */
export class NotInSyncGroupError extends BusinessRuleViolation {
    /** Mensagem fixa: não há detalhe a acrescentar além da regra. */
    public constructor() {
        super('sync-not-in-group', 'o aparelho não pertence a um grupo de sincronização');
    }
}

/**
 * Criar ou entrar num grupo com o aparelho já num grupo. Recusado porque trocaria a
 * identidade do aparelho e deixaria o vetor apontando para um histórico que não é o do grupo
 * novo (sincronizacao §4.4).
 */
export class AlreadyInSyncGroupError extends BusinessRuleViolation {
    /** Mensagem fixa. */
    public constructor() {
        super('sync-already-in-group', 'o aparelho já pertence a um grupo de sincronização');
    }
}

/**
 * Entrar num grupo com dados locais. Recusado porque dois históricos independentes não podem
 * ser mesclados (sincronizacao §4.4): o usuário descarta os dados antes, explicitamente.
 */
export class DeviceHasDataError extends BusinessRuleViolation {
    /** Mensagem fixa. */
    public constructor() {
        super('sync-device-has-data', 'o aparelho tem dados e não pode entrar num grupo');
    }
}
