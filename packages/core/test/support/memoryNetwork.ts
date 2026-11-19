import { randomBytes } from 'node:crypto';
import type { Connection, DiscoveredPeer, Discovery, KeyStore, Listener, RandomSource, Transport } from '../../src/index.ts';

/**
 * Uma ponta de uma conexão em memória. Entrega os bytes em pedaços como chegaram e pode ser
 * programada para cair depois de N escritas, o que exercita a queda de conexão em cada passo
 * da sessão (sync-plan Fase 5).
 */
class MemoryConnection implements Connection {
    private readonly inbox: Uint8Array[] = [];
    private readonly waiting: ((chunk: Uint8Array | null) => void)[] = [];
    private closed = false;
    public peer: MemoryConnection | null = null;

    /**
     * @param remoteAddress Endereço que esta ponta enxerga do outro lado.
     * @param budget Escritas restantes até a conexão cair; `Infinity` não cai.
     */
    public constructor(public readonly remoteAddress: string, private budget: { remaining: number }) {}

    /**
     * @param bytes Bytes enviados à outra ponta.
     */
    public write(bytes: Uint8Array): Promise<void> {
        if (this.closed) {
            return Promise.reject(new Error('conexão fechada'));
        }
        if (this.budget.remaining <= 0) {
            this.close();
            return Promise.reject(new Error('conexão caiu'));
        }
        this.budget.remaining--;
        this.peer?.deliver(bytes.slice());
        return Promise.resolve();
    }

    /**
     * @return O próximo pedaço, ou `null` no fim.
     */
    public read(): Promise<Uint8Array | null> {
        const next = this.inbox.shift();
        if (next !== undefined) {
            return Promise.resolve(next);
        }
        if (this.closed) {
            return Promise.resolve(null);
        }
        return new Promise((resolve) => {
            this.waiting.push(resolve);
        });
    }

    /** Fecha as duas pontas. */
    public close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        for (const resolve of this.waiting.splice(0)) {
            resolve(null);
        }
        this.peer?.close();
    }

    /**
     * @param bytes Bytes vindos da outra ponta.
     */
    private deliver(bytes: Uint8Array): void {
        if (this.closed) {
            return;
        }
        const resolve = this.waiting.shift();
        if (resolve === undefined) {
            this.inbox.push(bytes);
        } else {
            resolve(bytes);
        }
    }
}

/**
 * Rede local em memória com transporte e descoberta: cada aparelho tem um endereço, e o que um
 * anuncia os outros encontram.
 */
export class MemoryNetwork {
    private readonly listeners = new Map<string, (connection: Connection) => void>();
    private readonly advertised = new Map<string, DiscoveredPeer>();
    private readonly browsers = new Set<(peer: DiscoveredPeer) => void>();
    private nextPort = 40_000;
    /** Escritas permitidas por conexão nova; os testes de queda o reduzem. */
    public writeBudget = Number.POSITIVE_INFINITY;

    /**
     * @param address Endereço do aparelho nesta rede.
     * @return O transporte desse aparelho.
     */
    public transport(address: string): Transport {
        return {
            listen: (onConnection) => {
                const port = this.nextPort++;
                this.listeners.set(`${address}:${String(port)}`, onConnection);
                const listener: Listener = {
                    port,
                    close: () => {
                        this.listeners.delete(`${address}:${String(port)}`);
                        return Promise.resolve();
                    },
                };
                return Promise.resolve(listener);
            },
            connect: (target, port) => {
                const accept = this.listeners.get(`${target}:${String(port)}`);
                if (accept === undefined) {
                    return Promise.reject(new Error(`ninguém escuta em ${target}:${String(port)}`));
                }
                const budget = { remaining: this.writeBudget };
                const dialer = new MemoryConnection(target, budget);
                const accepted = new MemoryConnection(address, budget);
                dialer.peer = accepted;
                accepted.peer = dialer;
                accept(accepted);
                return Promise.resolve(dialer);
            },
        };
    }

    /**
     * @param address Endereço do aparelho.
     * @return A descoberta desse aparelho.
     */
    public discovery(address: string): Discovery {
        return {
            advertise: (service) => {
                const peer = { ...service, address };
                this.advertised.set(service.deviceId, peer);
                for (const browse of this.browsers) {
                    browse(peer);
                }
                return Promise.resolve(() => {
                    this.advertised.delete(service.deviceId);
                    return Promise.resolve();
                });
            },
            browse: (onPeer) => {
                this.browsers.add(onPeer);
                for (const peer of this.advertised.values()) {
                    onPeer(peer);
                }
                return Promise.resolve(() => {
                    this.browsers.delete(onPeer);
                    return Promise.resolve();
                });
            },
        };
    }
}

/** Cofre de chave em memória. */
export class MemoryKeyStore implements KeyStore {
    private key: Uint8Array | null = null;

    /**
     * @return A chave guardada.
     */
    public load(): Promise<Uint8Array | null> {
        return Promise.resolve(this.key);
    }

    /**
     * @param privateKey Chave a guardar.
     */
    public save(privateKey: Uint8Array): Promise<void> {
        this.key = privateKey;
        return Promise.resolve();
    }
}

/** Aleatoriedade do Node, a mesma do adaptador do desktop. */
export const nodeRandom: RandomSource = { bytes: (length) => new Uint8Array(randomBytes(length)) };
