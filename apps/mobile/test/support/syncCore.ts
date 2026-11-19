import { createCore, LocalDate, openDatabase, parseTimestamp, parseUuid, type Clock, type Connection, type Core, type DiscoveredPeer, type Discovery, type KeyStore, type Listener, type Transport } from '@finance/core';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { randomBytes } from 'node:crypto';
import { ChunkQueue } from '../../src/platform/syncAdapters.ts';

/**
 * Uma ponta de uma conexão em memória, sobre a mesma `ChunkQueue` do adaptador TCP do app: os
 * testes de tela exercitam a fila de leitura que roda no aparelho.
 */
class MemoryConnection implements Connection {
    private readonly queue = new ChunkQueue();
    private closed = false;
    public peer: MemoryConnection | null = null;

    /**
     * @param remoteAddress Endereço que esta ponta enxerga do outro lado.
     */
    public constructor(public readonly remoteAddress: string) {}

    /**
     * @param bytes Bytes entregues à outra ponta.
     * @return Resolve logo; rejeita com a conexão fechada.
     * @throws {Error} Quando esta ponta já foi fechada.
     */
    public write(bytes: Uint8Array): Promise<void> {
        if (this.closed) {
            return Promise.reject(new Error('conexão fechada'));
        }
        this.peer?.queue.push(bytes.slice());
        return Promise.resolve();
    }

    /**
     * @return O próximo pedaço, ou `null` no fim.
     */
    public read(): Promise<Uint8Array | null> {
        return this.queue.next();
    }

    /** Fecha as duas pontas. */
    public close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.queue.end();
        this.peer?.close();
    }
}

/**
 * Rede local em memória: cada aparelho tem um endereço, o transporte liga as pontas e a
 * descoberta entrega a quem procura o que os outros anunciam. É o papel do Wi-Fi nos testes de
 * tela, que sincronizam dois núcleos de verdade.
 */
export class MemoryNetwork {
    private readonly listeners = new Map<string, (connection: Connection) => void>();
    private readonly advertised = new Map<string, DiscoveredPeer>();
    private readonly browsers = new Set<(peer: DiscoveredPeer) => void>();
    private nextPort = 40_000;

    /**
     * @param address Endereço do aparelho.
     * @return O transporte desse aparelho.
     */
    public transport(address: string): Transport {
        return {
            listen: (onConnection) => {
                const port = this.nextPort++;
                const key = `${address}:${String(port)}`;
                this.listeners.set(key, onConnection);
                const listener: Listener = {
                    port,
                    close: () => {
                        this.listeners.delete(key);
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
                const dialer = new MemoryConnection(target);
                const accepted = new MemoryConnection(address);
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

    /**
     * @return Quantos listeners estão abertos — o teste do ciclo de vida confere que sair da tela
     * ou do primeiro plano fecha o do celular.
     */
    public openListeners(): number {
        return this.listeners.size;
    }
}

/**
 * Cofre de chave em memória.
 *
 * @return Um cofre vazio, como o de um aparelho recém-instalado.
 */
function memoryKeyStore(): KeyStore {
    let key: Uint8Array | null = null;
    return {
        load: () => Promise.resolve(key),
        save: (privateKey) => {
            key = privateKey;
            return Promise.resolve();
        },
    };
}

/**
 * Monta um núcleo real com a sincronização ligada, sobre a rede em memória. Cada aparelho tem o
 * próprio prefixo de ids: dois núcleos com o gerador sequencial do `testCore` criariam o mesmo
 * UUID nos dois lados, e a mesclagem dos bancos trataria linhas diferentes como a mesma.
 *
 * @param options.device Número do aparelho, prefixo dos ids (1–9).
 * @param options.network Rede em memória compartilhada pelos aparelhos do teste.
 * @param options.address Endereço local do aparelho nessa rede.
 * @param options.platform Plataforma informada ao grupo.
 * @param options.today "Hoje" do teste.
 * @param options.discovery `false` para o aparelho numa rede que bloqueia o mDNS: só o endereço
 * digitado chega até ele.
 * @return O núcleo.
 */
export function syncTestCore(options: {
    readonly device: number;
    readonly network: MemoryNetwork;
    readonly address: string;
    readonly platform: 'desktop' | 'android';
    readonly today?: string;
    readonly discovery?: boolean;
}): Core {
    const today = options.today ?? '2026-03-15';
    const clock: Clock = { now: () => parseTimestamp(`${today} 12:00:00`), today: () => LocalDate.parse(today) };
    let next = 0;
    const database = BetterSqliteDatabase.open(':memory:');
    openDatabase(database, { backups: null, clock });
    return createCore({
        database,
        clock,
        ids: { random: () => parseUuid(`0000000${String(options.device)}-0000-4000-8000-${(++next).toString(16).padStart(12, '0')}`) },
        wallClock: { millis: () => Date.parse(`${today}T12:00:00Z`) },
        syncNetwork: {
            platform: options.platform,
            localAddresses: () => [options.address],
            transport: options.network.transport(options.address),
            discovery: options.discovery === false ? null : options.network.discovery(options.address),
            keyStore: memoryKeyStore(),
            random: { bytes: (length) => new Uint8Array(randomBytes(length)) },
            snapshots: null,
        },
        onUnexpectedError: (error) => {
            throw error;
        },
    });
}
