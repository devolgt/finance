import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { blake2s } from '@noble/hashes/blake2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const HASH_LENGTH = 32;
const KEY_LENGTH = 32;
const TAG_LENGTH = 16;
/** Maior mensagem Noise (especificação, §3); a sessão fatia lotes maiores. */
export const NOISE_MAX_MESSAGE = 65_535;
/** Maior texto puro que cabe numa mensagem de transporte. */
export const NOISE_MAX_PLAINTEXT = NOISE_MAX_MESSAGE - TAG_LENGTH;
const MAX_NONCE = 2n ** 64n - 1n;

/** Par de chaves X25519. A privada nunca sai do aparelho; vem do `KeyStore`. */
export interface KeyPair {
    readonly publicKey: Uint8Array;
    readonly privateKey: Uint8Array;
}

/** Falha do protocolo Noise: mensagem adulterada, chave errada ou fora de ordem. */
export class NoiseError extends Error {
    /**
     * @param message Descrição técnica, para log.
     */
    public constructor(message: string) {
        super(message);
        this.name = 'NoiseError';
    }
}

/**
 * @param privateKey 32 bytes aleatórios.
 * @return O par X25519.
 */
export function keyPairFrom(privateKey: Uint8Array): KeyPair {
    return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

type Token = 'e' | 's' | 'ee' | 'es' | 'se' | 'ss' | 'psk';

/**
 * Padrões usados pela sincronização (sync-design §7.4 e sync-plan §2):
 * - `KK` nas sessões normais: os dois lados já conhecem a chave pública do outro, gravada
 *   em `sync_members` no pareamento.
 * - `IKpsk2` no pareamento: o aparelho novo conhece só a chave do anfitrião (do QR) e prova
 *   que leu o segredo do convite pela PSK; o anfitrião aprende a chave do novo no handshake.
 */
const PATTERNS = {
    KK: { preInitiator: ['s'], preResponder: ['s'], messages: [['e', 'es', 'ss'], ['e', 'ee', 'se']] },
    IKpsk2: { preInitiator: [], preResponder: ['s'], messages: [['e', 'es', 's', 'ss'], ['e', 'ee', 'se', 'psk']] },
} as const satisfies Record<string, { readonly preInitiator: readonly Token[]; readonly preResponder: readonly Token[]; readonly messages: readonly (readonly Token[])[] }>;

export type NoisePattern = keyof typeof PATTERNS;

/**
 * Estado de cifra de uma direção (especificação Noise, §5.1): chave e nonce. O nonce nunca
 * se repete com a mesma chave — reutilizá-lo quebraria a ChaCha20-Poly1305 —, por isso ele é
 * contado aqui e uma sessão que esgotasse 2^64 mensagens é recusada.
 */
export class CipherState {
    private nonce = 0n;

    /**
     * @param key Chave de 32 bytes; `null` antes de o handshake misturar alguma chave, quando
     * o "cifrar" é a identidade, como manda a especificação.
     */
    public constructor(private key: Uint8Array | null = null) {}

    /**
     * @return `true` quando já há chave.
     */
    public hasKey(): boolean {
        return this.key !== null;
    }

    /**
     * @param key Chave nova; zera o nonce.
     */
    public initialize(key: Uint8Array): void {
        this.key = key;
        this.nonce = 0n;
    }

    /**
     * @param ad Dados associados autenticados e não cifrados (o hash do handshake).
     * @param plaintext Texto puro.
     * @return O texto cifrado com a tag, ou o próprio texto sem chave.
     * @throws {NoiseError} Quando o nonce se esgota.
     */
    public encrypt(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
        if (this.key === null) {
            return plaintext;
        }
        const sealed = chacha20poly1305(this.key, this.nextNonce(), ad).encrypt(plaintext);
        return sealed;
    }

    /**
     * @param ad Dados associados.
     * @param ciphertext Texto cifrado com a tag.
     * @return O texto puro.
     * @throws {NoiseError} Quando a tag não confere — mensagem adulterada ou chave errada.
     */
    public decrypt(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
        if (this.key === null) {
            return ciphertext;
        }
        const nonce = this.nextNonce();
        try {
            return chacha20poly1305(this.key, nonce, ad).decrypt(ciphertext);
        } catch {
            throw new NoiseError('falha de autenticação da mensagem');
        }
    }

    /**
     * O contador é conferido aqui porque reutilizar um nonce com a mesma chave quebra a
     * confidencialidade e a autenticação da ChaCha20-Poly1305.
     *
     * @return O nonce de 12 bytes: 4 zeros e o contador em little-endian, como a especificação
     * define para a ChaChaPoly.
     * @throws {NoiseError} Quando o contador chega ao limite e a chave não pode mais cifrar.
     */
    private nextNonce(): Uint8Array {
        if (this.nonce >= MAX_NONCE) {
            throw new NoiseError('nonce esgotado');
        }
        const nonce = new Uint8Array(12);
        new DataView(nonce.buffer).setBigUint64(4, this.nonce, true);
        this.nonce++;
        return nonce;
    }
}

/**
 * HKDF da especificação Noise (§4.3) sobre HMAC-BLAKE2s.
 *
 * @param chainingKey Chave de encadeamento.
 * @param input Material de entrada.
 * @param outputs Quantas saídas (2 ou 3).
 * @return As saídas de 32 bytes.
 */
function hkdf(chainingKey: Uint8Array, input: Uint8Array, outputs: 2 | 3): readonly Uint8Array[] {
    const tempKey = hmac(blake2s, chainingKey, input);
    const first = hmac(blake2s, tempKey, Uint8Array.of(1));
    const second = hmac(blake2s, tempKey, concatBytes(first, Uint8Array.of(2)));
    if (outputs === 2) {
        return [first, second];
    }
    return [first, second, hmac(blake2s, tempKey, concatBytes(second, Uint8Array.of(3)))];
}

/** Estado simétrico do handshake (especificação Noise, §5.2): hash e chave de encadeamento. */
class SymmetricState {
    private hash: Uint8Array;
    private chainingKey: Uint8Array;
    public readonly cipher = new CipherState();

    /**
     * @param protocolName Nome completo do protocolo, que entra no hash e amarra os dois
     * lados à mesma combinação de padrão e primitivas.
     */
    public constructor(protocolName: string) {
        const name = utf8ToBytes(protocolName);
        const initial = new Uint8Array(HASH_LENGTH);
        if (name.length <= HASH_LENGTH) {
            initial.set(name);
        } else {
            initial.set(blake2s(name));
        }
        this.hash = initial;
        this.chainingKey = initial;
    }

    /**
     * @param data Dado público que passa a fazer parte da transcrição.
     */
    public mixHash(data: Uint8Array): void {
        this.hash = blake2s(concatBytes(this.hash, data));
    }

    /**
     * @param input Resultado de um DH ou chave efêmera em modo PSK.
     */
    public mixKey(input: Uint8Array): void {
        const [chainingKey, key] = hkdf(this.chainingKey, input, 2);
        this.chainingKey = chainingKey ?? this.chainingKey;
        this.cipher.initialize((key ?? new Uint8Array(KEY_LENGTH)).slice(0, KEY_LENGTH));
    }

    /**
     * @param input A PSK.
     */
    public mixKeyAndHash(input: Uint8Array): void {
        const [chainingKey, hashInput, key] = hkdf(this.chainingKey, input, 3);
        this.chainingKey = chainingKey ?? this.chainingKey;
        this.mixHash(hashInput ?? new Uint8Array(0));
        this.cipher.initialize((key ?? new Uint8Array(KEY_LENGTH)).slice(0, KEY_LENGTH));
    }

    /**
     * @param plaintext Conteúdo a cifrar com o hash como dado associado.
     * @return O cifrado.
     */
    public encryptAndHash(plaintext: Uint8Array): Uint8Array {
        const ciphertext = this.cipher.encrypt(this.hash, plaintext);
        this.mixHash(ciphertext);
        return ciphertext;
    }

    /**
     * @param ciphertext Conteúdo recebido.
     * @return O texto puro.
     * @throws {NoiseError} Quando a autenticação falha.
     */
    public decryptAndHash(ciphertext: Uint8Array): Uint8Array {
        const plaintext = this.cipher.decrypt(this.hash, ciphertext);
        this.mixHash(ciphertext);
        return plaintext;
    }

    /**
     * @return As duas cifras de transporte: iniciador→respondedor e respondedor→iniciador.
     */
    public split(): readonly [CipherState, CipherState] {
        const [first, second] = hkdf(this.chainingKey, new Uint8Array(0), 2);
        return [new CipherState(first ?? null), new CipherState(second ?? null)];
    }

    /**
     * @return O hash da transcrição, que identifica a sessão (channel binding).
     */
    public handshakeHash(): Uint8Array {
        return this.hash;
    }
}

/** O que um lado precisa para começar um handshake. */
export interface HandshakeOptions {
    readonly pattern: NoisePattern;
    readonly initiator: boolean;
    /** Contexto amarrado ao handshake; a sessão usa a versão do protocolo e o id do grupo. */
    readonly prologue: Uint8Array;
    readonly staticKeys: KeyPair;
    /** Chave pública do outro lado, quando o padrão a exige antes do handshake. */
    readonly remoteStatic: Uint8Array | null;
    /** Segredo do convite, no padrão com PSK. */
    readonly psk: Uint8Array | null;
    /** Fonte da chave efêmera; nos testes, uma efêmera fixa para bater com os vetores. */
    readonly ephemeral: () => KeyPair;
}

/** As cifras de transporte de um lado, depois do handshake. */
export interface TransportCiphers {
    readonly send: CipherState;
    readonly receive: CipherState;
    readonly handshakeHash: Uint8Array;
    /** A chave pública que o outro lado provou possuir. */
    readonly remoteStatic: Uint8Array;
}

/**
 * Estado do handshake Noise (especificação, §5.3), para os padrões da sincronização. É
 * implementado no núcleo, em TypeScript puro sobre as `@noble`, para que desktop e celular
 * rodem exatamente o mesmo protocolo (mobile-shell-design §5.1); a conformidade é verificada
 * contra os vetores públicos da cacophony.
 */
export class NoiseHandshake {
    private readonly symmetric: SymmetricState;
    private readonly messages: readonly (readonly Token[])[];
    private readonly psk: boolean;
    private ephemeral: KeyPair | null = null;
    private remoteEphemeral: Uint8Array | null = null;
    private remoteStatic: Uint8Array | null;
    private step = 0;

    /**
     * @param options Padrão, papel, chaves e prólogo.
     * @throws {NoiseError} Quando falta a chave remota ou a PSK que o padrão exige.
     */
    public constructor(private readonly options: HandshakeOptions) {
        const pattern = PATTERNS[options.pattern];
        this.messages = pattern.messages;
        this.psk = options.pattern.includes('psk');
        if (this.psk && options.psk?.length !== 32) {
            throw new NoiseError('o padrão exige uma PSK de 32 bytes');
        }
        this.remoteStatic = options.remoteStatic;
        this.symmetric = new SymmetricState(`Noise_${options.pattern}_25519_ChaChaPoly_BLAKE2s`);
        this.symmetric.mixHash(options.prologue);
        const initiatorStatic = options.initiator ? options.staticKeys.publicKey : options.remoteStatic;
        const responderStatic = options.initiator ? options.remoteStatic : options.staticKeys.publicKey;
        for (const [tokens, key] of [[pattern.preInitiator, initiatorStatic], [pattern.preResponder, responderStatic]] as const) {
            if (tokens.length > 0) {
                if (key === null) {
                    throw new NoiseError('o padrão exige a chave estática do outro lado antes do handshake');
                }
                this.symmetric.mixHash(key);
            }
        }
    }

    /**
     * @return `true` quando todas as mensagens do padrão foram trocadas.
     */
    public isComplete(): boolean {
        return this.step >= this.messages.length;
    }

    /**
     * @return `true` quando é a vez deste lado escrever.
     */
    public isMyTurn(): boolean {
        return !this.isComplete() && (this.step % 2 === 0) === this.options.initiator;
    }

    /**
     * @param payload Carga da mensagem, cifrada assim que houver chave.
     * @return A mensagem do handshake.
     * @throws {NoiseError} Fora da vez.
     */
    public writeMessage(payload: Uint8Array): Uint8Array {
        const tokens = this.turn(true);
        const parts: Uint8Array[] = [];
        for (const token of tokens) {
            switch (token) {
                case 'e': {
                    this.ephemeral = this.options.ephemeral();
                    parts.push(this.ephemeral.publicKey);
                    this.mixEphemeral(this.ephemeral.publicKey);
                    break;
                }
                case 's':
                    parts.push(this.symmetric.encryptAndHash(this.options.staticKeys.publicKey));
                    break;
                case 'psk':
                    this.symmetric.mixKeyAndHash(this.requirePsk());
                    break;
                case 'ee':
                case 'es':
                case 'se':
                case 'ss':
                    this.symmetric.mixKey(this.dh(token));
                    break;
            }
        }
        parts.push(this.symmetric.encryptAndHash(payload));
        this.step++;
        return concatBytes(...parts);
    }

    /**
     * @param message Mensagem recebida.
     * @return A carga decifrada.
     * @throws {NoiseError} Fora da vez, mensagem curta ou autenticação que falha.
     */
    public readMessage(message: Uint8Array): Uint8Array {
        const tokens = this.turn(false);
        let offset = 0;
        const take = (length: number): Uint8Array => {
            if (offset + length > message.length) {
                throw new NoiseError('mensagem de handshake curta demais');
            }
            const slice = message.slice(offset, offset + length);
            offset += length;
            return slice;
        };
        for (const token of tokens) {
            switch (token) {
                case 'e': {
                    this.remoteEphemeral = take(32);
                    this.mixEphemeral(this.remoteEphemeral);
                    break;
                }
                case 's':
                    this.remoteStatic = this.symmetric.decryptAndHash(take(32 + (this.symmetric.cipher.hasKey() ? TAG_LENGTH : 0)));
                    break;
                case 'psk':
                    this.symmetric.mixKeyAndHash(this.requirePsk());
                    break;
                case 'ee':
                case 'es':
                case 'se':
                case 'ss':
                    this.symmetric.mixKey(this.dh(token));
                    break;
            }
        }
        const payload = this.symmetric.decryptAndHash(message.slice(offset));
        this.step++;
        return payload;
    }

    /**
     * @return As cifras de transporte deste lado.
     * @throws {NoiseError} Antes do fim do handshake.
     */
    public split(): TransportCiphers {
        if (!this.isComplete() || this.remoteStatic === null) {
            throw new NoiseError('handshake incompleto');
        }
        const [initiatorToResponder, responderToInitiator] = this.symmetric.split();
        return {
            send: this.options.initiator ? initiatorToResponder : responderToInitiator,
            receive: this.options.initiator ? responderToInitiator : initiatorToResponder,
            handshakeHash: this.symmetric.handshakeHash(),
            remoteStatic: this.remoteStatic,
        };
    }

    /**
     * @param writing `true` ao escrever.
     * @return Os tokens da mensagem da vez.
     * @throws {NoiseError} Quando não é a vez deste lado.
     */
    private turn(writing: boolean): readonly Token[] {
        const tokens = this.messages[this.step];
        if (tokens === undefined || this.isMyTurn() !== writing) {
            throw new NoiseError('mensagem de handshake fora de ordem');
        }
        return tokens;
    }

    /**
     * @param key Chave efêmera pública.
     */
    private mixEphemeral(key: Uint8Array): void {
        this.symmetric.mixHash(key);
        if (this.psk) {
            this.symmetric.mixKey(key);
        }
    }

    /**
     * @param token Combinação de DH; a primeira letra é do iniciador, a segunda do respondedor.
     * @return O segredo compartilhado.
     * @throws {NoiseError} Quando falta alguma das chaves.
     */
    private dh(token: 'ee' | 'es' | 'se' | 'ss'): Uint8Array {
        const initiatorSide = token[0] === 'e' ? 'ephemeral' : 'static';
        const responderSide = token[1] === 'e' ? 'ephemeral' : 'static';
        const mine = this.options.initiator ? initiatorSide : responderSide;
        const theirs = this.options.initiator ? responderSide : initiatorSide;
        const local = mine === 'ephemeral' ? this.ephemeral?.privateKey : this.options.staticKeys.privateKey;
        const remote = theirs === 'ephemeral' ? this.remoteEphemeral : this.remoteStatic;
        if (local === undefined || remote === null) {
            throw new NoiseError(`DH ${token} sem as chaves necessárias`);
        }
        return x25519.getSharedSecret(local, remote);
    }

    /**
     * @return A PSK.
     * @throws {NoiseError} Sem PSK.
     */
    private requirePsk(): Uint8Array {
        if (this.options.psk === null) {
            throw new NoiseError('PSK ausente');
        }
        return this.options.psk;
    }
}
