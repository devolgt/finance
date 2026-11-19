import { InvalidValueError } from '../shared/errors.ts';
import type { DeviceId } from '../shared/ids.ts';
import type { Timestamp } from '../../ports/Clock.ts';

/** Plataformas de um aparelho; o código numérico é o do `CHECK` de `sync_members.platform`. */
export const SYNC_PLATFORMS = ['desktop', 'android', 'ios'] as const;
export type SyncPlatform = (typeof SYNC_PLATFORMS)[number];

/** Tamanho máximo do nome de exibição, o do `CHECK` da migration `0009`. */
export const SYNC_MEMBER_NAME_MAX_LENGTH = 60;

const PUBLIC_KEY_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Chave pública X25519 de um aparelho, em hexadecimal minúsculo. Valida o formato porque ela
 * chega pela rede no pareamento e é o que autentica o aparelho em toda sessão seguinte
 * (sincronizacao §4.1).
 *
 * @param raw Texto recebido.
 * @return A chave canônica.
 * @throws {InvalidValueError} Quando não tem 32 bytes em hexadecimal.
 */
export function parsePublicKey(raw: string): string {
    const normalized = raw.toLowerCase();
    if (!PUBLIC_KEY_PATTERN.test(normalized)) {
        throw new InvalidValueError('publicKey', 'chave pública fora do formato de 32 bytes em hexadecimal');
    }
    return normalized;
}

/**
 * Um aparelho do grupo (sincronizacao §4.2). Replicado como dado de domínio; a remoção é a
 * lápide `removedAt` e é permanente para aquele id (sincronizacao §4.5).
 */
export interface SyncMember {
    readonly id: DeviceId;
    readonly name: string;
    readonly platform: SyncPlatform;
    readonly publicKey: string;
    readonly addedBy: DeviceId | null;
    readonly removedAt: Timestamp | null;
}

/**
 * @param name Nome de exibição digitado ou derivado do sistema.
 * @return O nome aparado.
 * @throws {InvalidValueError} Quando fica vazio ou passa do limite do schema.
 */
export function memberName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > SYNC_MEMBER_NAME_MAX_LENGTH) {
        throw new InvalidValueError('name', `nome do aparelho precisa ter de 1 a ${SYNC_MEMBER_NAME_MAX_LENGTH} caracteres`);
    }
    return trimmed;
}
