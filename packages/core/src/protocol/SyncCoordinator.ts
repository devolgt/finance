import { bytesToHex } from '@noble/hashes/utils.js';
import { BusinessRuleViolation } from '../domain/shared/errors.ts';
import { DeviceId } from '../domain/shared/ids.ts';
import { isLocalAddress } from '../domain/sync/LocalAddress.ts';
import type { SyncPlatform } from '../domain/sync/SyncMember.ts';
import type { Connection, Discovery, DiscoveredPeer, KeyStore, Listener, RandomSource, SnapshotPort, Transport } from '../ports/SyncNetwork.ts';
import type { WallClock } from '../ports/WallClock.ts';
import type { ApplyReport } from '../services/sync/BatchApplier.ts';
import type { SyncService } from '../services/sync/SyncService.ts';
import { groupHash, INVITE_TTL_MS, type InvitePayload, SYNC_PROTOCOL_VERSION } from './messages.ts';
import { keyPairFrom, type KeyPair } from './noise/Noise.ts';
import { FrameConnection } from './SecureChannel.ts';
import { acceptSession, dialSession, joinWithInvite, type LiveSession, type PendingInvite, type SessionContext, type SessionOutcome, type SessionRefusal, type SessionStage } from './SyncSession.ts';

/** Adaptadores da plataforma que o coordenador usa. */
export interface CoordinatorPorts {
    readonly transport: Transport;
    /** `null` quando a plataforma não tem mDNS; sobra o endereço digitado (sincronizacao §5.2). */
    readonly discovery: Discovery | null;
    readonly keyStore: KeyStore;
    readonly random: RandomSource;
    readonly wallClock: WallClock;
    readonly snapshots: SnapshotPort | null;
}

/** Uma sessão como a tela de Dispositivos a mostra. */
export interface PeerStatus {
    readonly deviceId: string | null;
    readonly address: string;
    readonly stage: SessionStage;
}

/** O último fim de sessão que a tela precisa explicar. */
export interface SessionEnd {
    readonly deviceId: string | null;
    readonly outcome: SessionOutcome;
}

/** Estado do coordenador para a tela. */
export interface CoordinatorStatus {
    readonly open: boolean;
    readonly port: number | null;
    readonly sessions: readonly PeerStatus[];
    readonly invite: InvitePayload | null;
    readonly lastEnd: SessionEnd | null;
}

/** Quem acompanha o coordenador: o shell, que repassa à tela. */
export interface CoordinatorObserver {
    /**
     * @param status Estado novo.
     */
    changed(status: CoordinatorStatus): void;

    /**
     * @param report Lote aplicado; o shell invalida as consultas da UI.
     */
    applied(report: ApplyReport): void;
}

/**
 * Lê a chave do aparelho do cofre, gerando-a no primeiro uso (sincronizacao §4.1).
 *
 * @param keyStore Cofre da plataforma.
 * @param random Aleatoriedade criptográfica.
 * @return O par de chaves.
 */
export async function deviceKeys(keyStore: KeyStore, random: RandomSource): Promise<KeyPair> {
    const stored = await keyStore.load();
    if (stored !== null) {
        return keyPairFrom(stored);
    }
    const privateKey = random.bytes(32);
    await keyStore.save(privateKey);
    return keyPairFrom(privateKey);
}

/** Uma sessão em andamento, com o endereço de onde veio. */
interface Running {
    readonly session: LiveSession;
    readonly address: string;
    stage: SessionStage;
}

/**
 * Coordena a sincronização enquanto a tela de Dispositivos está aberta (sincronizacao §1.3,
 * §5.1 e §5.3): escuta e se anuncia só nesse intervalo, disca para os membros
 * encontrados quando tem o menor id, atende conexões de membros e de quem traz o convite em
 * aberto, e repassa cada escrita local às sessões ao vivo. Fechar a tela fecha tudo — nenhum
 * dado muda por baixo de outra tela.
 */
export class SyncCoordinator {
    private listener: Listener | null = null;
    private stopAdvertising: (() => Promise<void>) | null = null;
    private stopBrowsing: (() => Promise<void>) | null = null;
    private readonly running = new Set<Running>();
    private invite: PendingInvite | null = null;
    private lastEnd: SessionEnd | null = null;
    private keys: KeyPair | null = null;

    /**
     * @param sync Casos de uso da sincronização.
     * @param ports Adaptadores da plataforma.
     * @param observer Quem acompanha.
     */
    public constructor(private readonly sync: SyncService, private readonly ports: CoordinatorPorts, private readonly observer: CoordinatorObserver) {}

    /**
     * @return A chave pública deste aparelho em hexadecimal, gerando o par no primeiro uso;
     * é o que vai em `sync_members` ao criar o grupo.
     */
    public async publicKey(): Promise<string> {
        return bytesToHex((await this.context()).keys.publicKey);
    }

    /**
     * Abre a tela de Dispositivos: escuta, anuncia e procura membros. Fora de um grupo, não
     * faz nada — o aparelho só disca para entrar com um convite.
     */
    public async open(): Promise<void> {
        const state = this.sync.state();
        if (state === null || this.listener !== null) {
            return;
        }
        const context = await this.context();
        this.listener = await this.ports.transport.listen((connection) => {
            if (!isLocalAddress(connection.remoteAddress)) {
                connection.close();
                return;
            }
            this.track(acceptSession(context, new FrameConnection(connection), () => this.activeInvite(), this.sessionObserver()), connection.remoteAddress);
        });
        const hash = groupHash(state.groupId);
        if (this.ports.discovery !== null) {
            this.stopAdvertising = await this.ports.discovery.advertise({ deviceId: state.deviceId, groupHash: hash, port: this.listener.port });
            this.stopBrowsing = await this.ports.discovery.browse((peer) => {
                this.onPeer(peer, hash);
            });
        }
        this.emit();
    }

    /** Fecha a tela: encerra sessões, listener, anúncio e busca, e descarta o convite. */
    public async close(): Promise<void> {
        for (const running of this.running) {
            running.session.close();
        }
        this.running.clear();
        this.invite = null;
        await this.stopAdvertising?.();
        await this.stopBrowsing?.();
        await this.listener?.close();
        this.stopAdvertising = null;
        this.stopBrowsing = null;
        this.listener = null;
        this.emit();
    }

    /**
     * Abre um convite de uso único válido por 5 minutos (sincronizacao §4.3).
     *
     * @param addresses Endereços locais deste aparelho, que vão no QR.
     * @return O convite, para virar QR.
     * @throws {Error} Quando a tela não está aberta (sem listener não há o que discar).
     */
    public async createInvite(addresses: readonly string[]): Promise<InvitePayload> {
        const state = this.sync.requireState();
        if (this.listener === null) {
            throw new Error('a tela de Dispositivos precisa estar aberta para convidar');
        }
        const local = addresses.filter(isLocalAddress);
        const payload: InvitePayload = {
            v: SYNC_PROTOCOL_VERSION,
            group: state.groupId,
            host: state.deviceId,
            key: await this.publicKey(),
            addresses: local.length > 0 ? local.slice(0, 8) : ['127.0.0.1'],
            port: this.listener.port,
            secret: bytesToHex(this.ports.random.bytes(16)),
            expiresAt: this.ports.wallClock.millis() + INVITE_TTL_MS,
        };
        this.invite = { payload, used: false, claimed: false };
        this.emit();
        return payload;
    }

    /** Cancela o convite em aberto. */
    public cancelInvite(): void {
        this.invite = null;
        this.emit();
    }

    /**
     * Disca para um par e espera a sessão terminar; é o caminho da descoberta por mDNS, que não
     * tem tela esperando a resposta.
     *
     * @param address Endereço local do par.
     * @param port Porta do par.
     * @param peerId Membro esperado nesse endereço.
     * @return O desfecho da sessão.
     * @throws {BusinessRuleViolation} Nos casos de `dial`.
     */
    public async connect(address: string, port: number, peerId: string): Promise<SessionOutcome> {
        const session = await this.dial(address, port, peerId);
        return session.done;
    }

    /**
     * Disca para um endereço digitado (sincronizacao §5.2, alternativa ao mDNS) e devolve assim
     * que a conexão abre, com a sessão seguindo em segundo plano. Toda recusa anterior a isso
     * vira regra de negócio, para que a tela de Dispositivos a mostre em vez de fechar a folha
     * como se a ligação tivesse dado certo.
     * Regra de negócio (Sincronização, sincronizacao §5.1): só se disca para endereços da rede local.
     *
     * @param address Endereço local do par.
     * @param port Porta do par.
     * @param peerId Membro esperado nesse endereço.
     * @return A sessão já registrada no coordenador.
     * @throws {BusinessRuleViolation} `sync-address-not-local` quando o endereço não é da rede
     * local; `sync-not-a-member` quando o aparelho nunca foi membro do grupo;
     * `sync-peer-unreachable` quando a conexão não abre.
     */
    public async dial(address: string, port: number, peerId: string): Promise<LiveSession> {
        if (!isLocalAddress(address)) {
            throw new BusinessRuleViolation('sync-address-not-local', `${address} não é um endereço da rede local`);
        }
        // Um membro removido também recebe a ligação: a troca de membros vem primeiro e é por ela
        // que ele aprende a remoção, antes de a sessão ser recusada (sincronizacao §4.5).
        const member = this.sync.knownMember(DeviceId(peerId));
        if (member === null) {
            throw new BusinessRuleViolation('sync-not-a-member', 'o aparelho não é membro do grupo');
        }
        const context = await this.context();
        let connection: Connection;
        try {
            connection = await this.ports.transport.connect(address, port);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new BusinessRuleViolation('sync-peer-unreachable', `não foi possível conectar a ${address}:${String(port)}: ${reason}`);
        }
        const session = dialSession(context, new FrameConnection(connection), { id: member.id, publicKey: member.publicKey }, this.sessionObserver());
        this.track(session, address);
        return session;
    }

    /**
     * Entra num grupo pelo convite (sincronizacao §4.4), tentando cada endereço do QR.
     *
     * @param invite Convite lido.
     * @param device Nome e plataforma deste aparelho.
     * @return O desfecho: `joined` quando entrou.
     * @throws {Error} Quando nenhum endereço do convite é alcançável.
     */
    public async join(invite: InvitePayload, device: { readonly name: string; readonly platform: SyncPlatform }): Promise<SessionOutcome> {
        const context = await this.context();
        const deviceId = this.sync.newDeviceId();
        let lastError: unknown = new Error('o convite não tem endereço local');
        for (const address of invite.addresses.filter(isLocalAddress)) {
            try {
                const connection = await this.ports.transport.connect(address, invite.port);
                const session = joinWithInvite(context, new FrameConnection(connection), invite, { deviceId, name: device.name, platform: device.platform }, this.sessionObserver());
                this.track(session, address);
                // Sem snapshot, a sessão de entrada segue ao vivo; entrar é chegar lá.
                return await Promise.race([session.done, session.live.then((): SessionOutcome => ({ kind: 'joined', snapshot: false }))]);
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError;
    }

    /** Uma escrita local foi confirmada: as sessões ao vivo a enviam (sincronizacao §5.6, passo 8). */
    public notifyLocalChange(): void {
        for (const running of this.running) {
            running.session.notifyLocalChange();
        }
    }

    /**
     * @return O estado para a tela.
     */
    public status(): CoordinatorStatus {
        return {
            open: this.listener !== null,
            port: this.listener?.port ?? null,
            sessions: [...this.running].map((running) => ({ deviceId: running.session.peerId(), address: running.address, stage: running.stage })),
            invite: this.activeInvite()?.payload ?? null,
            lastEnd: this.lastEnd,
        };
    }

    /**
     * Regra de negócio (Sincronização, sincronizacao §5.3): o aparelho de menor id disca, para
     * que um par não abra duas conexões; o outro só atende.
     *
     * @param peer Aparelho anunciado.
     * @param hash Hash do grupo deste aparelho.
     */
    private onPeer(peer: DiscoveredPeer, hash: string): void {
        const state = this.sync.state();
        if (state === null || peer.groupHash !== hash || peer.deviceId <= state.deviceId || !isLocalAddress(peer.address)) {
            return;
        }
        if ([...this.running].some((running) => running.session.peerId() === peer.deviceId)) {
            return;
        }
        this.connect(peer.address, peer.port, peer.deviceId).catch(() => undefined);
    }

    /**
     * @param session Sessão nova.
     * @param address Endereço do par.
     */
    private track(session: LiveSession, address: string): void {
        const running: Running = { session, address, stage: 'handshake' };
        this.running.add(running);
        this.emit();
        session.done
            .then((outcome) => {
                this.lastEnd = { deviceId: session.peerId(), outcome };
            })
            .catch(() => {
                // Uma falha fora do protocolo (lote inválido, bug) também encerra só esta sessão.
                this.lastEnd = { deviceId: session.peerId(), outcome: { kind: 'closed' } };
            })
            .finally(() => {
                this.running.delete(running);
                this.emit();
            });
    }

    /**
     * @return O observador que atualiza a etapa de cada sessão.
     */
    private sessionObserver(): { stage: (peerId: string | null, stage: SessionStage) => void; applied: (report: ApplyReport) => void } {
        return {
            stage: (peerId, stage) => {
                for (const running of this.running) {
                    if (running.session.peerId() === peerId || (peerId === null && running.stage === 'handshake')) {
                        running.stage = stage;
                    }
                }
                this.emit();
            },
            applied: (report) => {
                this.observer.applied(report);
            },
        };
    }

    /**
     * @return O convite ainda válido, ou `null`.
     */
    private activeInvite(): PendingInvite | null {
        const invite = this.invite;
        if (invite === null || invite.used || invite.payload.expiresAt < this.ports.wallClock.millis()) {
            return null;
        }
        return invite;
    }

    /**
     * @return O contexto das sessões, com as chaves lidas uma vez.
     */
    private async context(): Promise<SessionContext> {
        this.keys ??= await deviceKeys(this.ports.keyStore, this.ports.random);
        return { sync: this.sync, wallClock: this.ports.wallClock, random: this.ports.random, keys: this.keys, snapshots: this.ports.snapshots };
    }

    /** Avisa o observador do estado novo. */
    private emit(): void {
        this.observer.changed(this.status());
    }
}

export type { SessionRefusal };
