import { blake2s } from '@noble/hashes/blake2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { SYNC_PLATFORMS } from '../domain/sync/SyncMember.ts';
import type { SyncBatchDto } from '../dto/sync/SyncBatchDto.ts';

/** Versão do protocolo; entra no prólogo do Noise, então versões diferentes nem completam o handshake. */
export const SYNC_PROTOCOL_VERSION = 1;

/**
 * Divergência máxima de relógio aceita numa sessão (sincronizacao §3.2): além dela, "a escrita
 * mais recente vence" deixa de significar o que o usuário espera.
 */
export const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;

/** Validade de um convite (sincronizacao §4.3). */
export const INVITE_TTL_MS = 5 * 60 * 1000;

const deviceIdField = z.string().length(36);
const hexKeyField = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Primeira mensagem, em claro: quem liga e para quê. Em claro porque, no `KK`, quem atende
 * precisa da chave pública de quem liga antes do handshake — e a acha pelo id em
 * `sync_members`. Ela entra no prólogo, então adulterá-la derruba o handshake.
 */
export const clearHelloSchema = z.strictObject({
    protocol: z.literal(SYNC_PROTOCOL_VERSION),
    mode: z.enum(['session', 'pair']),
    deviceId: deviceIdField,
});
export type ClearHello = z.infer<typeof clearHelloSchema>;

/** Recusa em claro, antes do handshake: quem liga não é membro ou não há convite ativo. */
export const clearRefusalSchema = z.strictObject({ refused: z.enum(['not-member', 'no-invite', 'busy']) });

/** Carga do handshake da sessão: o que cada lado compara antes de trocar dados (sincronizacao §5.6, passo 2). */
export const sessionHelloSchema = z.strictObject({
    deviceId: deviceIdField,
    wallMillis: z.number().int().nonnegative(),
    userVersion: z.number().int().nonnegative(),
});
export type SessionHello = z.infer<typeof sessionHelloSchema>;

/** Carga do primeiro pacote do pareamento: o perfil do aparelho novo. */
export const pairHelloSchema = z.strictObject({
    name: z.string().min(1).max(60),
    platform: z.enum(SYNC_PLATFORMS),
    wallMillis: z.number().int().nonnegative(),
    userVersion: z.number().int().nonnegative(),
});
/** O perfil do aparelho novo já validado, que o anfitrião grava como membro depois da prova do convite. */
export type PairHello = z.infer<typeof pairHelloSchema>;

const vectorField = z.array(z.tuple([deviceIdField, z.number().int().min(0)]));
/** O lote viaja como veio do extrator; a validação de domínio é a de `syncBatchRequest`. */
const batchField = z.custom<SyncBatchDto>((value) => typeof value === 'object' && value !== null);

/** Mensagens cifradas trocadas depois do handshake. */
export const sessionMessageSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('members'), batch: batchField }),
    z.strictObject({ type: z.literal('vector'), vector: vectorField }),
    z.strictObject({ type: z.literal('batch'), batch: batchField }),
    z.strictObject({ type: z.literal('ack'), vector: vectorField }),
    // Relógio e versão não viajam aqui: os dois lados comparam as cargas do handshake e recusam sozinhos.
    z.strictObject({ type: z.literal('refuse'), reason: z.enum(['removed', 'not-member', 'has-data']) }),
    z.strictObject({ type: z.literal('pair-confirm') }),
    z.strictObject({ type: z.literal('pair-accepted'), groupId: deviceIdField, hostId: deviceIdField, snapshot: z.boolean() }),
]);
export type SessionMessage = z.infer<typeof sessionMessageSchema>;

/**
 * O convite lido do QR (sincronizacao §4.3): grupo, id e chave de quem convida, endereço local
 * e o segredo de 128 bits de uso único.
 */
export const invitePayloadSchema = z.strictObject({
    v: z.literal(SYNC_PROTOCOL_VERSION),
    group: deviceIdField,
    host: deviceIdField,
    key: hexKeyField,
    addresses: z.array(z.string().min(1).max(64)).min(1).max(8),
    port: z.number().int().min(1).max(65_535),
    secret: z.string().regex(/^[0-9a-f]{32}$/),
    expiresAt: z.number().int().nonnegative(),
});
export type InvitePayload = z.infer<typeof invitePayloadSchema>;

/**
 * Prefixo do texto do QR, para recusar de cara um QR que não é um convite do app. Maiúsculo e
 * com dois-pontos, para caber no modo alfanumérico do QR junto com o resto.
 */
const INVITE_PREFIX = 'FINANCAS1:';

/** Alfabeto base32 da RFC 4648: só maiúsculas e dígitos, o que o modo alfanumérico do QR guarda. */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Tamanho fixo do convite em bytes, antes dos endereços. */
const INVITE_FIXED_BYTES = 1 + 16 + 16 + 32 + 16 + 2 + 6 + 1;

/**
 * Texto do QR do convite. Binário compacto em base32, e não JSON: o JSON tinha uns 330
 * caracteres e virava um QR de ~69×69 módulos, denso demais para a câmera do celular ler com
 * folga na tela do computador. Assim o convite fica com ~160 caracteres no modo alfanumérico,
 * um QR de ~45×45. O mesmo texto serve para "Copiar convite".
 * Layout: versão (1) · grupo (16) · anfitrião (16) · chave (32) · segredo (16) · porta (2) ·
 * validade em ms (6) · quantidade de endereços (1) · IPv4 (4 cada).
 *
 * @param invite Convite; só os endereços IPv4 entram no QR, os que o celular alcança na rede de casa.
 * @return O texto do QR.
 */
export function encodeInvite(invite: InvitePayload): string {
    const ipv4 = invite.addresses.map(ipv4Bytes).filter((bytes): bytes is Uint8Array => bytes !== null).slice(0, 8);
    const bytes = new Uint8Array(INVITE_FIXED_BYTES + ipv4.length * 4);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    bytes[offset++] = invite.v;
    for (const part of [uuidBytes(invite.group), uuidBytes(invite.host), hexToBytes(invite.key), hexToBytes(invite.secret)]) {
        bytes.set(part, offset);
        offset += part.length;
    }
    view.setUint16(offset, invite.port);
    offset += 2;
    view.setUint16(offset, Math.floor(invite.expiresAt / 2 ** 32));
    view.setUint32(offset + 2, invite.expiresAt % 2 ** 32);
    offset += 6;
    bytes[offset++] = ipv4.length;
    for (const address of ipv4) {
        bytes.set(address, offset);
        offset += 4;
    }
    return `${INVITE_PREFIX}${toBase32(bytes)}`;
}

/**
 * @param text Texto lido pela câmera ou colado; espaços e caixa são tolerados.
 * @return O convite, ou `null` quando o texto não é um convite válido.
 */
export function decodeInvite(text: string): InvitePayload | null {
    const normalized = text.trim().toUpperCase();
    if (!normalized.startsWith(INVITE_PREFIX)) {
        return null;
    }
    const bytes = fromBase32(normalized.slice(INVITE_PREFIX.length));
    if (bytes === null || bytes.length < INVITE_FIXED_BYTES) {
        return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = bytes[INVITE_FIXED_BYTES - 1] ?? 0;
    if (bytes.length !== INVITE_FIXED_BYTES + count * 4) {
        return null;
    }
    const addresses: string[] = [];
    for (let index = 0; index < count; index++) {
        addresses.push([...bytes.slice(INVITE_FIXED_BYTES + index * 4, INVITE_FIXED_BYTES + index * 4 + 4)].join('.'));
    }
    const parsed = invitePayloadSchema.safeParse({
        v: bytes[0],
        group: uuidText(bytes.slice(1, 17)),
        host: uuidText(bytes.slice(17, 33)),
        key: bytesToHex(bytes.slice(33, 65)),
        secret: bytesToHex(bytes.slice(65, 81)),
        port: view.getUint16(81),
        expiresAt: view.getUint16(83) * 2 ** 32 + view.getUint32(85),
        addresses,
    });
    return parsed.success ? parsed.data : null;
}

/**
 * @param uuid UUID canônico.
 * @return Os 16 bytes.
 */
function uuidBytes(uuid: string): Uint8Array {
    return hexToBytes(uuid.replace(/-/g, ''));
}

/**
 * @param bytes 16 bytes.
 * @return O UUID canônico, minúsculo com hífens.
 */
function uuidText(bytes: Uint8Array): string {
    const hex = bytesToHex(bytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * @param address Endereço em texto.
 * @return Os 4 bytes de um IPv4, ou `null` para qualquer outra coisa.
 */
function ipv4Bytes(address: string): Uint8Array | null {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
    if (match === null) {
        return null;
    }
    const octets = match.slice(1).map(Number);
    return octets.every((octet) => octet <= 255) ? Uint8Array.from(octets) : null;
}

/**
 * @param bytes Dados.
 * @return Base32 sem preenchimento.
 */
function toBase32(bytes: Uint8Array): string {
    let output = '';
    let buffer = 0;
    let bits = 0;
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32[(buffer >> (bits - 5)) & 31] ?? '';
            bits -= 5;
        }
        buffer &= (1 << bits) - 1;
    }
    if (bits > 0) {
        output += BASE32[(buffer << (5 - bits)) & 31] ?? '';
    }
    return output;
}

/**
 * @param text Base32 sem preenchimento.
 * @return Os bytes, ou `null` quando há caractere fora do alfabeto.
 */
function fromBase32(text: string): Uint8Array | null {
    const output: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (const char of text) {
        const value = BASE32.indexOf(char);
        if (value < 0) {
            return null;
        }
        buffer = (buffer << 5) | value;
        bits += 5;
        if (bits >= 8) {
            output.push((buffer >> (bits - 8)) & 255);
            bits -= 8;
        }
        buffer &= (1 << bits) - 1;
    }
    return Uint8Array.from(output);
}

/**
 * PSK do pareamento: o segredo do convite tem 16 bytes e o Noise pede 32, então ele passa
 * por um hash junto com o id do grupo — um segredo vazado de outro grupo não serve aqui.
 *
 * @param secretHex Segredo do convite.
 * @param groupId Grupo do convite.
 * @return A PSK de 32 bytes.
 */
export function invitePsk(secretHex: string, groupId: string): Uint8Array {
    return blake2s(concatBytes(utf8ToBytes('financas-sync-invite'), hexToBytes(secretHex), utf8ToBytes(groupId)));
}

/**
 * Hash do grupo anunciado no mDNS (sincronizacao §5.2): vizinhos veem que um aparelho existe,
 * não a qual grupo pertence; membros do mesmo grupo se reconhecem.
 *
 * @param groupId Id do grupo.
 * @return 16 caracteres hexadecimais.
 */
export function groupHash(groupId: string): string {
    return bytesToHex(blake2s(utf8ToBytes(`financas-sync-group:${groupId}`))).slice(0, 16);
}

/**
 * @param hello Mensagem em claro.
 * @return O prólogo do Noise: versão e a mensagem em claro, para que nada dela possa ser trocado
 * por quem está no meio do caminho.
 */
export function prologueOf(hello: Uint8Array): Uint8Array {
    return concatBytes(utf8ToBytes(`financas-sync/${String(SYNC_PROTOCOL_VERSION)}`), hello);
}
