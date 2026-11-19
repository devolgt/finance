import { randomBytes } from 'node:crypto';
import { createConnection, createServer, type Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import { Bonjour, type Service } from 'bonjour-service';
import { isLocalAddress, type Connection, type DiscoveredPeer, type Discovery, type KeyStore, type Listener, type RandomSource, type Transport } from '@finance/core';

/** Tipo do serviço anunciado no mDNS (sync-design §7.2). */
const SERVICE_TYPE = 'financas-sync';

/**
 * Conexão TCP do Node vista pela porta `Connection`: os pedaços chegam numa fila e `read` os
 * entrega em ordem. O enquadramento é do núcleo, então aqui não se corta nada.
 */
class SocketConnection implements Connection {
    private readonly chunks: Uint8Array[] = [];
    private readonly waiting: ((chunk: Uint8Array | null) => void)[] = [];
    private ended = false;
    public readonly remoteAddress: string;

    /**
     * @param socket Socket aberto.
     */
    public constructor(private readonly socket: Socket) {
        this.remoteAddress = socket.remoteAddress ?? '';
        socket.setNoDelay(true);
        socket.on('data', (data: Buffer) => {
            const chunk = new Uint8Array(data);
            const resolve = this.waiting.shift();
            if (resolve === undefined) {
                this.chunks.push(chunk);
            } else {
                resolve(chunk);
            }
        });
        const finish = (): void => {
            this.ended = true;
            for (const resolve of this.waiting.splice(0)) {
                resolve(null);
            }
        };
        socket.on('close', finish);
        socket.on('end', finish);
        socket.on('error', finish);
    }

    /**
     * @param bytes Bytes a enviar.
     * @return Resolve quando o socket aceitou os bytes.
     */
    public write(bytes: Uint8Array): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket.write(bytes, (error) => {
                if (error === undefined || error === null) {
                    resolve();
                } else {
                    reject(error);
                }
            });
        });
    }

    /**
     * @return O próximo pedaço, ou `null` no fim.
     */
    public read(): Promise<Uint8Array | null> {
        const next = this.chunks.shift();
        if (next !== undefined) {
            return Promise.resolve(next);
        }
        if (this.ended) {
            return Promise.resolve(null);
        }
        return new Promise((resolve) => {
            this.waiting.push(resolve);
        });
    }

    /** Fecha o socket. */
    public close(): void {
        this.socket.destroy();
    }
}

/**
 * Transporte TCP do `utilityProcess` (sync-plan Fase 7). Escuta em todas as interfaces numa
 * porta livre; a regra de endereços locais, que recusa quem vem de fora, é do núcleo.
 */
export const nodeTransport: Transport = {
    listen: (onConnection) => new Promise((resolve, reject) => {
        const server = createServer((socket) => {
            onConnection(new SocketConnection(socket));
        });
        server.once('error', reject);
        server.listen(0, () => {
            const address = server.address();
            const listener: Listener = {
                port: typeof address === 'object' && address !== null ? address.port : 0,
                close: () => new Promise((done) => {
                    server.close(() => {
                        done();
                    });
                }),
            };
            resolve(listener);
        });
    }),
    connect: (address, port) => new Promise((resolve, reject) => {
        const socket = createConnection({ host: address, port, timeout: 5_000 });
        socket.once('connect', () => {
            socket.setTimeout(0);
            resolve(new SocketConnection(socket));
        });
        socket.once('timeout', () => {
            socket.destroy();
            reject(new Error(`sem resposta de ${address}:${String(port)}`));
        });
        socket.once('error', reject);
    }),
};

/**
 * Descoberta mDNS / DNS-SD sobre o `bonjour-service`, em JavaScript puro — nenhum módulo
 * nativo novo no Electron. O anúncio leva o id do aparelho e o hash do grupo no TXT.
 *
 * @return A descoberta, com uma instância do Bonjour por chamada para que parar o anúncio
 * não derrube a busca.
 */
export function bonjourDiscovery(): Discovery {
    return {
        advertise: (service) => {
            const bonjour = new Bonjour();
            bonjour.publish({ name: `financas-${service.deviceId.slice(0, 8)}`, type: SERVICE_TYPE, port: service.port, txt: { device: service.deviceId, group: service.groupHash } });
            return Promise.resolve(() => new Promise<void>((resolve) => {
                bonjour.unpublishAll(() => {
                    bonjour.destroy();
                    resolve();
                });
            }));
        },
        browse: (onPeer) => {
            const bonjour = new Bonjour();
            const browser = bonjour.find({ type: SERVICE_TYPE }, (service: Service) => {
                for (const peer of peersOf(service)) {
                    onPeer(peer);
                }
            });
            return Promise.resolve(() => {
                browser.stop();
                bonjour.destroy();
                return Promise.resolve();
            });
        },
    };
}

/**
 * @param service Serviço encontrado.
 * @return Um par por endereço anunciado, já filtrado pela regra de endereços locais.
 */
function peersOf(service: Service): readonly DiscoveredPeer[] {
    const txt: unknown = service.txt;
    if (typeof txt !== 'object' || txt === null || !('device' in txt) || !('group' in txt) || typeof txt.device !== 'string' || typeof txt.group !== 'string') {
        return [];
    }
    const { device, group } = txt;
    return (service.addresses ?? []).filter(isLocalAddress).map((address) => ({ deviceId: device, groupHash: group, address, port: service.port }));
}

/** Aleatoriedade criptográfica do Node. */
export const nodeRandom: RandomSource = { bytes: (length) => new Uint8Array(randomBytes(length)) };

/**
 * @return Os endereços IPv4 locais das interfaces de rede, para o convite (sync-design §6.3).
 * IPv4 primeiro porque é o que o celular alcança em praticamente toda rede doméstica.
 */
export function localAddresses(): readonly string[] {
    return Object.values(networkInterfaces())
        .flatMap((entries) => entries ?? [])
        .filter((entry) => !entry.internal && entry.family === 'IPv4' && isLocalAddress(entry.address))
        .map((entry) => entry.address);
}

/** Mensagens do cofre de chave entre o `utilityProcess` e o principal. */
export type KeyStoreRequest = { readonly kind: 'keystore-load'; readonly requestId: number } | { readonly kind: 'keystore-save'; readonly requestId: number; readonly key: string };
export type KeyStoreReply =
    | { readonly kind: 'keystore-loaded'; readonly requestId: number; readonly key: string | null; readonly error: string | null }
    | { readonly kind: 'keystore-saved'; readonly requestId: number; readonly error: string | null };

/**
 * Cofre de chave do desktop visto do `utilityProcess`. O `safeStorage` do Electron só existe
 * no processo principal, então a chave vai e volta por mensagem, em hexadecimal, e é o
 * principal quem a cifra no arquivo em `userData` (sync-plan §2).
 */
export class MainProcessKeyStore implements KeyStore {
    private nextId = 1;
    private readonly pending = new Map<number, (reply: KeyStoreReply) => void>();

    /**
     * @param post Envia uma mensagem ao processo principal.
     */
    public constructor(private readonly post: (message: KeyStoreRequest) => void) {}

    /**
     * @param reply Resposta do principal.
     */
    public receive(reply: KeyStoreReply): void {
        this.pending.get(reply.requestId)?.(reply);
        this.pending.delete(reply.requestId);
    }

    /**
     * @return A chave guardada, ou `null` no primeiro uso.
     */
    public async load(): Promise<Uint8Array | null> {
        const reply = await this.request((requestId) => ({ kind: 'keystore-load', requestId }));
        return reply.kind === 'keystore-loaded' && reply.key !== null ? new Uint8Array(Buffer.from(reply.key, 'hex')) : null;
    }

    /**
     * @param reply Resposta do principal.
     * @return A mesma resposta.
     * @throws {Error} Quando o principal não conseguiu ler ou gravar a chave.
     */
    private static checked(reply: KeyStoreReply): KeyStoreReply {
        if (reply.error !== null) {
            throw new Error(`cofre da chave do aparelho: ${reply.error}`);
        }
        return reply;
    }

    /**
     * @param privateKey Chave a guardar.
     */
    public async save(privateKey: Uint8Array): Promise<void> {
        await this.request((requestId) => ({ kind: 'keystore-save', requestId, key: Buffer.from(privateKey).toString('hex') }));
    }

    /**
     * @param build Mensagem com o id do pedido.
     * @return A resposta.
     * @throws {Error} Quando o principal respondeu com erro.
     */
    private request(build: (requestId: number) => KeyStoreRequest): Promise<KeyStoreReply> {
        const requestId = this.nextId++;
        return new Promise<KeyStoreReply>((resolve) => {
            this.pending.set(requestId, resolve);
            this.post(build(requestId));
        }).then((reply) => MainProcessKeyStore.checked(reply));
    }
}
