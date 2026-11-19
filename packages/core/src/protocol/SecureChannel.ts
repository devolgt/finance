import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Connection } from '../ports/SyncNetwork.ts';
import { decodeUtf8 } from './utf8.ts';
import { NOISE_MAX_MESSAGE, NOISE_MAX_PLAINTEXT, NoiseError, type CipherState } from './noise/Noise.ts';

const LENGTH_PREFIX = 2;
/** Byte de controle de cada pedaço cifrado: o bit 0 marca o último pedaço da mensagem. */
const LAST_CHUNK = 1;
/** Tipo da mensagem, no primeiro byte do conteúdo: JSON ou bytes crus (o snapshot). */
const KIND_JSON = 1;
const KIND_BYTES = 2;
/** Teto de uma mensagem remontada; um snapshot do histórico inteiro cabe com folga. */
const MAX_MESSAGE_BYTES = 512 * 1024 * 1024;

/** A conexão terminou no meio de uma mensagem ou do handshake. */
export class ConnectionClosedError extends Error {
    /** Mensagem fixa. */
    public constructor() {
        super('conexão encerrada');
        this.name = 'ConnectionClosedError';
    }
}

/**
 * Quadros com prefixo de 2 bytes (big-endian) sobre o fluxo TCP: o mesmo tamanho máximo das
 * mensagens Noise. O TCP entrega bytes em pedaços arbitrários; remontar quadros aqui, no
 * núcleo, faz desktop e celular cortarem igual, sem depender de como cada socket fatia.
 */
export class FrameConnection {
    private buffer = new Uint8Array(0);

    /**
     * @param connection Conexão da plataforma.
     */
    public constructor(public readonly connection: Connection) {}

    /**
     * @param frame Conteúdo do quadro, até 65.535 bytes.
     * @throws {NoiseError} Quando o quadro passa do tamanho máximo.
     */
    public async send(frame: Uint8Array): Promise<void> {
        if (frame.length > NOISE_MAX_MESSAGE) {
            throw new NoiseError('quadro maior que uma mensagem Noise');
        }
        const header = new Uint8Array(LENGTH_PREFIX);
        new DataView(header.buffer).setUint16(0, frame.length);
        await this.connection.write(concatBytes(header, frame));
    }

    /**
     * @return O próximo quadro.
     * @throws {ConnectionClosedError} Quando a conexão termina antes de um quadro completo.
     */
    public async receive(): Promise<Uint8Array> {
        for (;;) {
            if (this.buffer.length >= LENGTH_PREFIX) {
                const length = new DataView(this.buffer.buffer, this.buffer.byteOffset).getUint16(0);
                if (this.buffer.length >= LENGTH_PREFIX + length) {
                    const frame = this.buffer.slice(LENGTH_PREFIX, LENGTH_PREFIX + length);
                    this.buffer = this.buffer.slice(LENGTH_PREFIX + length);
                    return frame;
                }
            }
            const chunk = await this.connection.read();
            if (chunk === null) {
                throw new ConnectionClosedError();
            }
            this.buffer = concatBytes(this.buffer, chunk);
        }
    }

    /** Fecha a conexão. */
    public close(): void {
        this.connection.close();
    }
}

/** Uma mensagem recebida pelo canal: JSON já decodificado ou bytes crus. */
export type ChannelMessage = { readonly kind: 'json'; readonly value: unknown } | { readonly kind: 'bytes'; readonly value: Uint8Array };

/**
 * Canal cifrado depois do handshake: mensagens de qualquer tamanho fatiadas em pedaços que
 * cabem numa mensagem Noise, cada um cifrado com a cifra da direção. Os dados nunca trafegam
 * sem criptografia, nem na rede de casa (sync-design §7.4).
 */
export class SecureChannel {
    private sending: Promise<void> = Promise.resolve();

    /**
     * @param frames Conexão enquadrada.
     * @param send Cifra de saída.
     * @param receive Cifra de entrada.
     */
    public constructor(private readonly frames: FrameConnection, private readonly send: CipherState, private readonly receive: CipherState) {}

    /**
     * @param value Mensagem serializável em JSON.
     * @return Resolve quando todos os pedaços foram escritos.
     */
    public sendJson(value: unknown): Promise<void> {
        return this.enqueue(KIND_JSON, utf8ToBytes(JSON.stringify(value)));
    }

    /**
     * @param bytes Conteúdo binário (o snapshot).
     * @return Resolve quando todos os pedaços foram escritos.
     */
    public sendBytes(bytes: Uint8Array): Promise<void> {
        return this.enqueue(KIND_BYTES, bytes);
    }

    /**
     * @return A próxima mensagem completa.
     * @throws {ConnectionClosedError} Quando a conexão termina.
     * @throws {NoiseError} Quando um pedaço não autentica ou a mensagem é grande demais.
     */
    public async receiveMessage(): Promise<ChannelMessage> {
        const parts: Uint8Array[] = [];
        let total = 0;
        for (;;) {
            const plaintext = this.receive.decrypt(new Uint8Array(0), await this.frames.receive());
            const control = plaintext[0];
            parts.push(plaintext.slice(1));
            total += plaintext.length - 1;
            if (total > MAX_MESSAGE_BYTES) {
                throw new NoiseError('mensagem grande demais');
            }
            if (control === LAST_CHUNK) {
                break;
            }
        }
        const message = concatBytes(...parts);
        const kind = message[0];
        const body = message.slice(1);
        if (kind === KIND_JSON) {
            return { kind: 'json', value: JSON.parse(decodeUtf8(body)) as unknown };
        }
        if (kind === KIND_BYTES) {
            return { kind: 'bytes', value: body };
        }
        throw new NoiseError('tipo de mensagem desconhecido');
    }

    /** Fecha a conexão. */
    public close(): void {
        this.frames.close();
    }

    /**
     * Serializa as escritas: a ordem dos pedaços cifrados precisa ser a dos nonces, e duas
     * mensagens enviadas ao mesmo tempo (o modo ao vivo e uma confirmação) se intercalariam.
     *
     * @param kind Tipo da mensagem.
     * @param body Conteúdo.
     * @return Resolve quando esta mensagem foi escrita.
     */
    private enqueue(kind: number, body: Uint8Array): Promise<void> {
        const message = concatBytes(Uint8Array.of(kind), body);
        const next = this.sending.then(async () => {
            const chunkSize = NOISE_MAX_PLAINTEXT - 1;
            for (let offset = 0; offset < message.length || offset === 0; offset += chunkSize) {
                const chunk = message.slice(offset, offset + chunkSize);
                const last = offset + chunkSize >= message.length;
                await this.frames.send(this.send.encrypt(new Uint8Array(0), concatBytes(Uint8Array.of(last ? LAST_CHUNK : 0), chunk)));
                if (last) {
                    break;
                }
            }
        });
        this.sending = next.catch(() => undefined);
        return next;
    }
}
