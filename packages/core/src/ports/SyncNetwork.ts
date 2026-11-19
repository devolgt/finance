/**
 * Portas de rede da sincronização (mobile-shell-design §5.1). O protocolo, a criptografia e a
 * máquina de estados ficam no núcleo; cada plataforma fornece só o transporte de bytes, a
 * descoberta, o cofre de chaves e a aleatoriedade — o desktop sobre `net`/mDNS/`safeStorage`,
 * o celular sobre `react-native-tcp-socket`/NSD/`expo-secure-store`.
 */

/**
 * Uma conexão TCP aberta. `read` devolve os bytes na ordem em que chegaram, em pedaços de
 * qualquer tamanho — o enquadramento é do núcleo, para que as duas plataformas cortem as
 * mensagens igual.
 */
export interface Connection {
    /** Endereço IP do outro lado, para a regra de endereços locais (sync-design §7.1). */
    readonly remoteAddress: string;

    /**
     * @param bytes Bytes a enviar.
     * @return Resolve quando o sistema aceitou os bytes.
     */
    write(bytes: Uint8Array): Promise<void>;

    /**
     * @return O próximo pedaço recebido, ou `null` quando a conexão terminou.
     */
    read(): Promise<Uint8Array | null>;

    /** Fecha a conexão; leituras pendentes resolvem com `null`. */
    close(): void;
}

/** Um listener TCP aberto. */
export interface Listener {
    /** Porta em que ele escuta, anunciada pela descoberta. */
    readonly port: number;

    /** Para de aceitar conexões. */
    close(): Promise<void>;
}

/** Transporte TCP da plataforma. */
export interface Transport {
    /**
     * Começa a escutar numa porta livre. Só existe enquanto a tela de Dispositivos está aberta
     * (sync-design §7.1).
     *
     * @param onConnection Recebe cada conexão aceita.
     * @return O listener.
     */
    listen(onConnection: (connection: Connection) => void): Promise<Listener>;

    /**
     * @param address Endereço IP do par, já conferido pela regra de endereços locais.
     * @param port Porta anunciada por ele.
     * @return A conexão aberta.
     */
    connect(address: string, port: number): Promise<Connection>;
}

/** Um aparelho visto pela descoberta (sync-design §7.2). */
export interface DiscoveredPeer {
    readonly deviceId: string;
    /** Hash do id do grupo: os vizinhos veem que o aparelho existe, não a qual grupo pertence. */
    readonly groupHash: string;
    readonly address: string;
    readonly port: number;
}

/** Descoberta mDNS / DNS-SD da plataforma. */
export interface Discovery {
    /**
     * @param service O que anunciar.
     * @return Função que para o anúncio.
     */
    advertise(service: { readonly deviceId: string; readonly groupHash: string; readonly port: number }): Promise<() => Promise<void>>;

    /**
     * @param onPeer Recebe cada aparelho encontrado (pode repetir).
     * @return Função que para a busca.
     */
    browse(onPeer: (peer: DiscoveredPeer) => void): Promise<() => Promise<void>>;
}

/**
 * Cofre da chave privada do aparelho (sync-design §6.1): Keystore no Android, `safeStorage`
 * no desktop. Nunca o arquivo SQLite, para que uma cópia do banco não carregue a capacidade de
 * se passar pelo aparelho.
 */
export interface KeyStore {
    /**
     * @return A chave privada X25519 de 32 bytes, ou `null` quando ainda não foi gerada.
     */
    load(): Promise<Uint8Array | null>;

    /**
     * @param privateKey Chave a guardar, substituindo a anterior.
     */
    save(privateKey: Uint8Array): Promise<void>;
}

/**
 * Aleatoriedade criptográfica da plataforma: chaves efêmeras do Noise, chave do aparelho e o
 * segredo do convite. É porta pelo mesmo motivo do `IdGenerator`: o Hermes não tem `crypto`.
 */
export interface RandomSource {
    /**
     * @param length Quantos bytes.
     * @return Bytes de um gerador criptográfico.
     */
    bytes(length: number): Uint8Array;
}

/**
 * Snapshot do banco para quem entra no grupo (sync-design §6.4). O anfitrião gera a cópia
 * consistente por `VACUUM INTO`, e o convidado troca o próprio banco por ela pelo mesmo
 * caminho da importação de uma cópia — os dois dependem do sistema de arquivos, por isso
 * porta.
 */
export interface SnapshotPort {
    /**
     * @return Os bytes de uma cópia consistente deste banco.
     */
    create(): Promise<Uint8Array>;

    /**
     * Grava a cópia recebida e agenda a troca do banco; a identidade própria é assumida
     * depois de reabrir (`SyncService.adoptSnapshot`).
     *
     * @param bytes Cópia do anfitrião.
     * @param identity Id deste aparelho e grupo do convite.
     */
    install(bytes: Uint8Array, identity: { readonly deviceId: string; readonly groupId: string }): Promise<void>;
}
