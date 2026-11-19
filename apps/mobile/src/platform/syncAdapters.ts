import type { Connection, DiscoveredPeer, Discovery, KeyStore, Listener, RandomSource, Transport } from '@finance/core';
import { getRandomBytes } from 'expo-crypto';
import { getItemAsync, setItemAsync, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from 'expo-secure-store';
import TcpSocket from 'react-native-tcp-socket';
import Zeroconf, { type Service } from 'react-native-zeroconf';

/** Tipo do serviço anunciado no mDNS, o mesmo do desktop (sync-design §7.2). */
export const SERVICE_TYPE = 'financas-sync';

/** Quanto esperar a resposta de um par antes de desistir de discar. */
const CONNECT_TIMEOUT_MS = 5_000;

/** Nome da entrada do Keystore com a chave privada do aparelho. */
const DEVICE_KEY_ENTRY = 'finance.sync.device-key';

/** Regra de endereços locais do núcleo, recebida da raiz de composição. */
export type LocalAddressRule = (address: string) => boolean;

/**
 * Fila de leitura da porta `Connection`: os pedaços chegam por evento e o núcleo os pede um a
 * um, com `read()`. Separada do socket para ser testada sem o módulo nativo — é a única regra do
 * adaptador TCP: nenhum pedaço se perde, nenhum troca de ordem, e quem espera depois do fim
 * recebe `null` em vez de ficar pendurado (o que travaria a sessão no núcleo).
 */
export class ChunkQueue {
    private readonly chunks: Uint8Array[] = [];
    private readonly waiting: ((chunk: Uint8Array | null) => void)[] = [];
    private ended = false;

    /**
     * @param chunk Pedaço recebido; ignorado depois do fim, quando o socket já foi dado por morto.
     */
    public push(chunk: Uint8Array): void {
        if (this.ended) {
            return;
        }
        const resolve = this.waiting.shift();
        if (resolve === undefined) {
            this.chunks.push(chunk);
        } else {
            resolve(chunk);
        }
    }

    /**
     * Marca o fim da conexão. Os pedaços já recebidos continuam sendo entregues: o último lote
     * pode ter chegado junto com o fechamento.
     */
    public end(): void {
        this.ended = true;
        for (const resolve of this.waiting.splice(0)) {
            resolve(null);
        }
    }

    /**
     * @return O próximo pedaço, ou `null` quando a conexão terminou e não sobrou nada.
     */
    public next(): Promise<Uint8Array | null> {
        const chunk = this.chunks.shift();
        if (chunk !== undefined) {
            return Promise.resolve(chunk);
        }
        if (this.ended) {
            return Promise.resolve(null);
        }
        return new Promise((resolve) => {
            this.waiting.push(resolve);
        });
    }
}

/** O socket do `react-native-tcp-socket` como esta camada o usa. */
type TcpSocketInstance = ReturnType<typeof TcpSocket.createConnection>;

/**
 * Conexão TCP do `react-native-tcp-socket` vista pela porta `Connection`. O enquadramento é do
 * núcleo, então aqui não se corta nada: os bytes vão para a `ChunkQueue` como chegaram.
 */
class TcpConnection implements Connection {
    private readonly queue = new ChunkQueue();
    public readonly remoteAddress: string;

    /**
     * @param socket Socket já conectado.
     * @param fallbackAddress Endereço discado, para quando o módulo nativo ainda não informou o
     * do outro lado — a regra de endereços locais do núcleo precisa de algum.
     */
    public constructor(private readonly socket: TcpSocketInstance, fallbackAddress: string) {
        this.remoteAddress = socket.remoteAddress ?? fallbackAddress;
        socket.setNoDelay(true);
        socket.on('data', (data) => {
            this.queue.push(typeof data === 'string' ? new TextEncoder().encode(data) : Uint8Array.from(data));
        });
        /** Fim, fechamento ou erro do socket: quem espera um pedaço recebe `null` e a sessão termina. */
        const finish = (): void => {
            this.queue.end();
        };
        socket.on('close', finish);
        socket.on('end', finish);
        socket.on('error', finish);
    }

    /**
     * @param bytes Bytes a enviar.
     * @return Resolve quando o módulo nativo aceitou os bytes.
     */
    public write(bytes: Uint8Array): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket.write(bytes, undefined, (error) => {
                if (error === undefined) {
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
        return this.queue.next();
    }

    /** Fecha o socket; as leituras pendentes resolvem com `null` pelo evento `close`. */
    public close(): void {
        this.socket.destroy();
    }
}

/**
 * Transporte TCP do celular (mobile-shell-design §5.2) sobre o `react-native-tcp-socket`.
 * Escuta em todas as interfaces numa porta livre (0): a porta vai no anúncio, e a regra de
 * endereços locais, que recusa quem vem de fora, é do núcleo.
 *
 * Risco aceito (sync-plan Fase 8): a biblioteca não declara `codegenConfig` e roda na Nova
 * Arquitetura do RN 0.88 pela camada de compatibilidade (interop) dos módulos antigos. Se uma
 * versão futura do React Native tirar essa camada, o adaptador precisa de outra biblioteca ou
 * de um módulo Expo próprio; a porta `Transport` não muda.
 *
 * @param access Confere a permissão de rede local antes de abrir ou discar.
 * @return O transporte.
 */
export function tcpTransport(access: () => Promise<void>): Transport {
    return {
        listen: async (onConnection) => {
            await access();
            return new Promise<Listener>((resolve, reject) => {
                const server = TcpSocket.createServer((socket) => {
                    onConnection(new TcpConnection(socket, ''));
                });
                server.once('error', reject);
                server.listen({ port: 0, host: '0.0.0.0' }, () => {
                    resolve({
                        port: server.address()?.port ?? 0,
                        close: () => new Promise<void>((done) => {
                            server.close(() => {
                                done();
                            });
                        }),
                    });
                });
            });
        },
        connect: async (address, port) => {
            await access();
            return new Promise<Connection>((resolve, reject) => {
                const socket = TcpSocket.createConnection({ host: address, port, connectTimeout: CONNECT_TIMEOUT_MS }, () => {
                    resolve(new TcpConnection(socket, address));
                });
                socket.once('error', reject);
                socket.once('timeout', () => {
                    socket.destroy();
                    reject(new Error(`sem resposta de ${address}:${String(port)}`));
                });
            });
        },
    };
}

/**
 * Converte um serviço resolvido pelo mDNS nos pares que o núcleo entende. Sem o TXT `device` e
 * `group`, o serviço não é deste app (ou é de uma versão que anuncia outra coisa) e é ignorado;
 * cada endereço anunciado vira um par, já filtrado pela regra de endereços locais — o celular
 * pode estar numa VPN, e o anúncio de um endereço de fora não pode levar a uma discagem.
 *
 * @param service Serviço resolvido.
 * @param isLocal Regra de endereços locais do núcleo.
 * @return Um par por endereço local anunciado; vazio quando o serviço não é da sincronização.
 */
export function peersOf(service: Pick<Service, 'txt' | 'addresses' | 'port'>, isLocal: LocalAddressRule): readonly DiscoveredPeer[] {
    const device = service.txt['device'];
    const group = service.txt['group'];
    if (typeof device !== 'string' || typeof group !== 'string' || device === '' || group === '') {
        return [];
    }
    return service.addresses.filter(isLocal).map((address) => ({ deviceId: device, groupHash: group, address, port: service.port }));
}

/**
 * Descoberta mDNS / DNS-SD do celular sobre o `react-native-zeroconf`, com o tipo e o TXT do
 * desktop (`device`, `group`), para que os dois se achem.
 *
 * Usa a implementação `NSD` (o `NsdManager` do Android, padrão da biblioteca): o mDNS roda no
 * serviço do sistema, que cuida do multicast — o app não precisa segurar o *multicast lock*,
 * que a implementação alternativa `DNSSD` adquire sozinha. A permissão
 * `CHANGE_WIFI_MULTICAST_STATE` fica declarada mesmo assim (o manifesto da biblioteca já a traz).
 *
 * Risco aceito (sync-plan Fase 8): como o `react-native-tcp-socket`, a biblioteca não declara
 * `codegenConfig` e depende da camada de compatibilidade da Nova Arquitetura do RN 0.88. O plano
 * B é um módulo Expo próprio sobre o `NsdManager` (mobile-shell-design §5.2).
 *
 * @param isLocal Regra de endereços locais do núcleo; vem da raiz de composição porque só ela
 * importa código do núcleo.
 * @param access Confere a permissão de rede local antes de anunciar ou procurar.
 * @return A descoberta, com uma instância por chamada para que parar o anúncio não derrube a busca.
 */
export function zeroconfDiscovery(isLocal: LocalAddressRule, access: () => Promise<void>): Discovery {
    return {
        advertise: async (service) => {
            await access();
            const zeroconf = new Zeroconf();
            const published = await zeroconf.publishService({
                type: SERVICE_TYPE,
                protocol: 'tcp',
                domain: 'local.',
                name: `financas-${service.deviceId.slice(0, 8)}`,
                port: service.port,
                txt: { device: service.deviceId, group: service.groupHash },
            });
            return async () => {
                try {
                    await zeroconf.unpublishService(published.name);
                } finally {
                    zeroconf.removeDeviceListeners();
                }
            };
        },
        browse: async (onPeer) => {
            await access();
            const zeroconf = new Zeroconf();
            zeroconf.on('resolved', (found) => {
                for (const peer of peersOf(found, isLocal)) {
                    onPeer(peer);
                }
            });
            // Falha de descoberta não derruba a tela: o endereço digitado continua funcionando.
            zeroconf.on('error', () => undefined);
            zeroconf.scan({ type: SERVICE_TYPE, protocol: 'tcp', domain: 'local.' });
            return () => {
                zeroconf.stop();
                zeroconf.removeDeviceListeners();
                return Promise.resolve();
            };
        },
    };
}

/**
 * Permissão de rede local (`ACCESS_LOCAL_NETWORK`), exigida pelo Android 17 dos apps que miram a
 * API 37. O projeto mira a 36 (`targetSdk` do RN 0.88), em que o sistema ainda não a cobra, mas a
 * permissão já fica declarada e conferida aqui: quando o `targetSdk` subir, a sincronização
 * continua funcionando sem mudar o adaptador. Abaixo da API 37 a biblioteca responde `granted`.
 * Uma vez concedida, não se pergunta de novo no mesmo processo.
 *
 * @return Função que resolve quando a rede local está liberada.
 * @throws Error Quando o usuário negou o acesso à rede local.
 */
export function localNetworkAccess(): () => Promise<void> {
    let granted: Promise<void> | null = null;
    return () => {
        granted ??= (async () => {
            const zeroconf = new Zeroconf();
            try {
                const answer = await zeroconf.checkLocalNetworkAccess({ type: SERVICE_TYPE, protocol: 'tcp', request: true });
                if (answer === 'denied') {
                    throw new Error('o acesso à rede local foi negado nas permissões do app');
                }
            } finally {
                zeroconf.removeDeviceListeners();
            }
        })().catch((error: unknown) => {
            granted = null;
            throw error;
        });
        return granted;
    };
}

/**
 * @param bytes Bytes da chave.
 * @return Os bytes em hexadecimal minúsculo — o `expo-secure-store` só guarda texto.
 */
export function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * @param text Texto em hexadecimal.
 * @return Os bytes, ou `null` quando o texto não é hexadecimal de tamanho par — uma entrada
 * corrompida vira "sem chave", e não uma chave errada que nenhum par reconheceria.
 */
export function fromHex(text: string): Uint8Array | null {
    if (text.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(text)) {
        return null;
    }
    const bytes = new Uint8Array(text.length / 2);
    for (let index = 0; index < bytes.length; index++) {
        bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
}

/**
 * Cofre da chave do aparelho sobre o `expo-secure-store` (mobile-shell-design §5.2 e §6.3): no
 * Android, cifrada pelo Keystore. O acesso `WHEN_UNLOCKED_THIS_DEVICE_ONLY` impede que a chave
 * saia num backup ou numa transferência para outro aparelho — quem restaurasse a cópia poderia se
 * passar por este celular no grupo (sync-design §6.1).
 */
export const secureStoreKeyStore: KeyStore = {
    load: async () => {
        const stored = await getItemAsync(DEVICE_KEY_ENTRY, { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY });
        return stored === null ? null : fromHex(stored);
    },
    save: (privateKey) => setItemAsync(DEVICE_KEY_ENTRY, toHex(privateKey), { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
};

/** Aleatoriedade criptográfica do sistema pelo `expo-crypto`: o Hermes não tem `crypto.getRandomValues`. */
export const expoRandom: RandomSource = { bytes: (length) => getRandomBytes(length) };

/**
 * Endereços locais que vão no convite (sync-design §6.3). Devolve vazio: nem o
 * `react-native-tcp-socket` nem o `react-native-zeroconf` informam o IP do Wi-Fi antes de uma
 * conexão, e o `expo-network` não está no app — uma dependência nativa só para isso não se paga,
 * porque no celular o caso comum é entrar no grupo do computador, e não convidar. O celular não
 * mostra "Adicionar dispositivo" por esse motivo.
 *
 * @return Lista vazia.
 */
export function mobileLocalAddresses(): readonly string[] {
    return [];
}
