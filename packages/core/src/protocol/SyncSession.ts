import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { DeviceId, GroupId } from '../domain/shared/ids.ts';
import type { SyncPlatform } from '../domain/sync/SyncMember.ts';
import { VersionVector } from '../domain/sync/VersionVector.ts';
import type { SyncBatchDto } from '../dto/sync/SyncBatchDto.ts';
import type { RandomSource, SnapshotPort } from '../ports/SyncNetwork.ts';
import type { WallClock } from '../ports/WallClock.ts';
import { syncBatchRequest } from '../requests/syncRequests.ts';
import type { ApplyReport } from '../services/sync/BatchApplier.ts';
import type { SyncService } from '../services/sync/SyncService.ts';
import {
    clearHelloSchema,
    clearRefusalSchema,
    invitePsk,
    MAX_CLOCK_SKEW_MS,
    pairHelloSchema,
    prologueOf,
    sessionHelloSchema,
    sessionMessageSchema,
    SYNC_PROTOCOL_VERSION,
    type InvitePayload,
    type PairHello,
    type SessionMessage,
} from './messages.ts';
import { keyPairFrom, NoiseHandshake, type KeyPair, type TransportCiphers } from './noise/Noise.ts';
import { ConnectionClosedError, SecureChannel, type FrameConnection } from './SecureChannel.ts';
import { decodeUtf8 } from './utf8.ts';

/** O que a sessão precisa do aparelho, montado pelo coordenador. */
export interface SessionContext {
    readonly sync: SyncService;
    readonly wallClock: WallClock;
    readonly random: RandomSource;
    /** Par de chaves deste aparelho, lido do `KeyStore`. */
    readonly keys: KeyPair;
    /** Troca por snapshot na entrada de um aparelho; `null` faz a entrada por lote completo. */
    readonly snapshots: SnapshotPort | null;
}

/**
 * Por que uma sessão foi recusada. A tela diz qual aparelho corrigir (sincronizacao §3.2 e
 * banco-de-dados §5.9): no relógio, mostra os dois horários; na versão, quem está atrás.
 */
export type SessionRefusal =
    | { readonly reason: 'clock'; readonly localMillis: number; readonly remoteMillis: number }
    | { readonly reason: 'version'; readonly localVersion: number; readonly remoteVersion: number }
    | { readonly reason: 'not-member' }
    | { readonly reason: 'removed' }
    | { readonly reason: 'no-invite' }
    | { readonly reason: 'has-data' };

/** Etapas visíveis de uma sessão. */
export type SessionStage = 'handshake' | 'syncing' | 'live';

/** Como uma sessão terminou. */
export type SessionOutcome =
    | { readonly kind: 'closed' }
    | { readonly kind: 'refused'; readonly refusal: SessionRefusal }
    | { readonly kind: 'joined'; readonly snapshot: boolean };

/** Quem acompanha a sessão: a tela de Dispositivos, pelo coordenador. */
export interface SessionObserver {
    /**
     * @param peerId Par da sessão, quando já conhecido.
     * @param stage Etapa nova.
     */
    stage(peerId: string | null, stage: SessionStage): void;

    /**
     * Um lote foi aplicado: o shell invalida as consultas da UI (sincronizacao §6.3).
     *
     * @param report O que a aplicação fez.
     */
    applied(report: ApplyReport): void;
}

/** Recusa interna, que vira o desfecho `refused`. */
class SessionRefused extends Error {
    /**
     * @param refusal Motivo.
     */
    public constructor(public readonly refusal: SessionRefusal) {
        super(`sessão recusada: ${refusal.reason}`);
        this.name = 'SessionRefused';
    }
}

/**
 * Uma sessão aberta com um par. `notifyLocalChange` é o modo ao vivo (sincronizacao §5.6, passo
 * 8): cada escrita local confirmada é enviada enquanto a tela de Dispositivos está aberta.
 */
export interface LiveSession {
    /** Id do par, conhecido depois do handshake. */
    peerId(): string | null;
    notifyLocalChange(): void;
    close(): void;
    readonly done: Promise<SessionOutcome>;
    /** Resolve quando a troca inicial termina e a sessão entra no modo ao vivo. */
    readonly live: Promise<void>;
}

/**
 * Abre uma sessão como quem liga (o aparelho de menor id, sincronizacao §5.3).
 *
 * @param context Aparelho.
 * @param frames Conexão já aberta.
 * @param peer Id e chave pública do par, de `sync_members`.
 * @param outerObserver Quem acompanha.
 * @return A sessão.
 */
export function dialSession(context: SessionContext, frames: FrameConnection, peer: { readonly id: string; readonly publicKey: string }, outerObserver: SessionObserver): LiveSession {
    return startSession(frames, outerObserver, async (session, observer) => {
        const state = context.sync.requireState();
        const hello = await sendClearHello(frames, 'session', state.deviceId);
        await expectClearAccept(frames);
        const handshake = new NoiseHandshake({
            pattern: 'KK', initiator: true, prologue: prologueOf(hello), staticKeys: context.keys, remoteStatic: hexToBytes(peer.publicKey), psk: null, ephemeral: () => ephemeral(context.random),
        });
        await frames.send(handshake.writeMessage(utf8ToBytes(JSON.stringify(localHello(context)))));
        const remote = sessionHelloSchema.parse(parseJson(handshake.readMessage(await frames.receive())));
        if (remote.deviceId !== peer.id) {
            throw new SessionRefused({ reason: 'not-member' });
        }
        assertCompatible(context, remote.wallMillis, remote.userVersion);
        const ciphers = handshake.split();
        session.peer = remote.deviceId;
        return exchange(context, new SecureChannel(frames, ciphers.send, ciphers.receive), remote.deviceId, observer, session);
    });
}

/** O convite em aberto no anfitrião, que só ele conhece. */
export interface PendingInvite {
    readonly payload: InvitePayload;
    /** Consumido: um aparelho provou o segredo e entrou no grupo (sincronizacao §4.3, uso único). */
    used: boolean;
    /**
     * Reservado por um pareamento em andamento. Fica separado de `used` porque só a decifração
     * do `pair-confirm` prova o segredo; uma conexão qualquer da rede, ou uma recusa por relógio,
     * não pode queimar o convite.
     */
    claimed: boolean;
}

/** O que o pareamento entrega depois que o aparelho novo provou conhecer o segredo do convite. */
interface PairingProof {
    readonly guest: PairHello;
    readonly ciphers: TransportCiphers;
    readonly channel: SecureChannel;
}

/**
 * Atende uma conexão recebida pelo listener: sessão de um membro (`KK`) ou pareamento de um
 * aparelho novo com o convite em aberto (`IKpsk2`).
 *
 * @param context Aparelho.
 * @param frames Conexão aceita.
 * @param invite Convite ativo, ou `null`.
 * @param outerObserver Quem acompanha.
 * @return A sessão.
 */
export function acceptSession(context: SessionContext, frames: FrameConnection, invite: () => PendingInvite | null, outerObserver: SessionObserver): LiveSession {
    return startSession(frames, outerObserver, async (session, observer) => {
        const raw = await frames.receive();
        const hello = clearHelloSchema.parse(parseJson(raw));
        if (hello.mode === 'pair') {
            return acceptPairing(context, frames, raw, hello.deviceId, invite(), observer, session);
        }
        const member = context.sync.activeMember(DeviceId(hello.deviceId));
        if (member === null) {
            await frames.send(utf8ToBytes(JSON.stringify({ refused: 'not-member' })));
            throw new SessionRefused({ reason: 'not-member' });
        }
        await frames.send(utf8ToBytes(JSON.stringify({ accepted: true })));
        const handshake = new NoiseHandshake({
            pattern: 'KK', initiator: false, prologue: prologueOf(raw), staticKeys: context.keys, remoteStatic: hexToBytes(member.publicKey), psk: null, ephemeral: () => ephemeral(context.random),
        });
        const remote = sessionHelloSchema.parse(parseJson(handshake.readMessage(await frames.receive())));
        await frames.send(handshake.writeMessage(utf8ToBytes(JSON.stringify(localHello(context)))));
        if (remote.deviceId !== hello.deviceId) {
            throw new SessionRefused({ reason: 'not-member' });
        }
        assertCompatible(context, remote.wallMillis, remote.userVersion);
        const ciphers = handshake.split();
        session.peer = remote.deviceId;
        return exchange(context, new SecureChannel(frames, ciphers.send, ciphers.receive), remote.deviceId, observer, session);
    });
}

/** O que o aparelho novo informa de si ao entrar. */
export interface JoiningDevice {
    readonly deviceId: string;
    readonly name: string;
    readonly platform: SyncPlatform;
}

/**
 * Entra num grupo pelo convite lido do QR (sincronizacao §4.3 e §4.4), como quem liga. O
 * aparelho precisa estar vazio; termina com o snapshot instalado (e o app reabre) ou, sem
 * snapshot, já como membro sincronizando.
 *
 * @param context Aparelho novo.
 * @param frames Conexão com o endereço do convite.
 * @param invite Convite.
 * @param device Identidade deste aparelho.
 * @param outerObserver Quem acompanha.
 * @return A sessão.
 */
export function joinWithInvite(context: SessionContext, frames: FrameConnection, invite: InvitePayload, device: JoiningDevice, outerObserver: SessionObserver): LiveSession {
    return startSession(frames, outerObserver, async (session, observer) => {
        if (context.sync.hasDomainData()) {
            throw new SessionRefused({ reason: 'has-data' });
        }
        const hello = await sendClearHello(frames, 'pair', device.deviceId);
        await expectClearAccept(frames);
        const handshake = new NoiseHandshake({
            pattern: 'IKpsk2', initiator: true, prologue: prologueOf(hello), staticKeys: context.keys, remoteStatic: hexToBytes(invite.key),
            psk: invitePsk(invite.secret, invite.group), ephemeral: () => ephemeral(context.random),
        });
        const local = localHello(context);
        await frames.send(handshake.writeMessage(utf8ToBytes(JSON.stringify({ name: device.name, platform: device.platform, wallMillis: local.wallMillis, userVersion: local.userVersion }))));
        const remote = sessionHelloSchema.parse(parseJson(handshake.readMessage(await frames.receive())));
        assertCompatible(context, remote.wallMillis, remote.userVersion);
        const ciphers = handshake.split();
        const channel = new SecureChannel(frames, ciphers.send, ciphers.receive);
        session.peer = remote.deviceId;
        await channel.sendJson({ type: 'pair-confirm' } satisfies SessionMessage);
        const accepted = await receiveSessionMessage(channel);
        if (accepted.type !== 'pair-accepted') {
            throw unexpected(accepted);
        }
        if (accepted.snapshot) {
            observer.stage(remote.deviceId, 'syncing');
            const snapshot = await channel.receiveMessage();
            if (snapshot.kind !== 'bytes' || context.snapshots === null) {
                throw new Error('snapshot esperado');
            }
            await context.snapshots.install(snapshot.value, { deviceId: device.deviceId, groupId: accepted.groupId });
            channel.close();
            return { kind: 'joined', snapshot: true };
        }
        context.sync.joinEmpty(DeviceId(device.deviceId), GroupId(accepted.groupId));
        return exchange(context, channel, remote.deviceId, observer, session);
    });
}

/**
 * Lado do anfitrião no pareamento: confere o convite, aprende a chave do aparelho novo no
 * handshake e só o registra depois que ele prova conhecer o segredo — no `IKpsk2`, isso é a
 * primeira mensagem cifrada dele decifrar.
 *
 * @param context Anfitrião.
 * @param frames Conexão.
 * @param raw Mensagem em claro recebida, que entra no prólogo.
 * @param guestId Id do aparelho novo.
 * @param invite Convite ativo.
 * @param observer Quem acompanha.
 * @param session Estado mutável da sessão.
 * @return O desfecho.
 * @throws {SessionRefused} Quando não há convite ativo, ele já foi usado ou está reservado por
 * outro pareamento, expirou ou é de outro grupo; ou quando o aparelho novo é incompatível.
 * @throws {Error} Quando o convidado manda outra mensagem no lugar de `pair-confirm`.
 */
async function acceptPairing(
    context: SessionContext,
    frames: FrameConnection,
    raw: Uint8Array,
    guestId: string,
    invite: PendingInvite | null,
    observer: SessionObserver,
    session: SessionHandle,
): Promise<SessionOutcome> {
    const state = context.sync.requireState();
    if (invite === null || invite.used || invite.claimed || invite.payload.expiresAt < context.wallClock.millis() || invite.payload.group !== state.groupId) {
        await frames.send(utf8ToBytes(JSON.stringify({ refused: 'no-invite' })));
        throw new SessionRefused({ reason: 'no-invite' });
    }
    // Regra de negócio (Sincronização, sincronizacao §4.3): o convite é de uso único, mas só é
    // consumido depois que o aparelho novo prova o segredo; até lá fica apenas reservado.
    invite.claimed = true;
    let proof: PairingProof;
    try {
        proof = await provePairing(context, frames, raw, invite);
    } catch (error) {
        // Sem a prova do segredo o convite volta a valer, para o mesmo QR poder ser lido de novo.
        invite.claimed = false;
        throw error;
    }
    invite.used = true;
    const { guest, ciphers, channel } = proof;
    context.sync.addMember(DeviceId(guestId), { name: guest.name, platform: guest.platform, publicKey: bytesToHex(ciphers.remoteStatic) });
    session.peer = guestId;
    const snapshot = context.snapshots;
    await channel.sendJson({ type: 'pair-accepted', groupId: state.groupId, hostId: state.deviceId, snapshot: snapshot !== null } satisfies SessionMessage);
    if (snapshot !== null) {
        observer.stage(guestId, 'syncing');
        await channel.sendBytes(await snapshot.create());
        return { kind: 'joined', snapshot: true };
    }
    return exchange(context, channel, guestId, observer, session);
}

/**
 * O handshake `IKpsk2` do anfitrião até o `pair-confirm`. Fica separado de `acceptPairing`
 * para que toda falha antes da prova do segredo — conexão derrubada, relógio ou versão
 * incompatível, mensagem fora de ordem — libere a reserva do convite num único ponto.
 *
 * @param context Anfitrião, com as chaves e o relógio que a compatibilidade confere.
 * @param frames Conexão já aceita.
 * @param raw Mensagem em claro recebida, que entra no prólogo e amarra o handshake a ela.
 * @param invite Convite reservado, de onde saem a PSK e o grupo.
 * @return O perfil do aparelho novo, as cifras de transporte e o canal cifrado.
 * @throws {SessionRefused} Quando o relógio ou a versão do aparelho novo é incompatível.
 * @throws {Error} Quando o convidado manda outra mensagem no lugar de `pair-confirm`.
 */
async function provePairing(context: SessionContext, frames: FrameConnection, raw: Uint8Array, invite: PendingInvite): Promise<PairingProof> {
    await frames.send(utf8ToBytes(JSON.stringify({ accepted: true })));
    const handshake = new NoiseHandshake({
        pattern: 'IKpsk2', initiator: false, prologue: prologueOf(raw), staticKeys: context.keys, remoteStatic: null,
        psk: invitePsk(invite.payload.secret, invite.payload.group), ephemeral: () => ephemeral(context.random),
    });
    const guest = pairHelloSchema.parse(parseJson(handshake.readMessage(await frames.receive())));
    await frames.send(handshake.writeMessage(utf8ToBytes(JSON.stringify(localHello(context)))));
    assertCompatible(context, guest.wallMillis, guest.userVersion);
    const ciphers = handshake.split();
    const channel = new SecureChannel(frames, ciphers.send, ciphers.receive);
    const confirm = await receiveSessionMessage(channel);
    if (confirm.type !== 'pair-confirm') {
        throw unexpected(confirm);
    }
    return { guest, ciphers, channel };
}

/** Estado mutável compartilhado entre a sessão e quem a controla. */
interface SessionHandle {
    peer: string | null;
    pushLocal: () => void;
    closed: boolean;
}

/**
 * Monta a sessão em torno do trabalho assíncrono e traduz o fim em desfecho: queda de
 * conexão vira `closed` — nada fica pela metade, porque cada lote é aplicado numa transação —
 * e recusa vira `refused`.
 *
 * @param frames Conexão.
 * @param outer Quem acompanha; recebe as etapas, e a sessão ainda resolve `live` na primeira
 * vez que chega ao modo ao vivo.
 * @param work Handshake e troca, com o observador já embrulhado.
 * @return A sessão.
 */
function startSession(frames: FrameConnection, outer: SessionObserver, work: (session: SessionHandle, observer: SessionObserver) => Promise<SessionOutcome>): LiveSession {
    const session: SessionHandle = { peer: null, pushLocal: () => undefined, closed: false };
    let reachedLive: () => void = () => undefined;
    const live = new Promise<void>((resolve) => {
        reachedLive = resolve;
    });
    const observer: SessionObserver = {
        stage: (peerId, stage) => {
            outer.stage(peerId, stage);
            if (stage === 'live') {
                reachedLive();
            }
        },
        applied: (report) => {
            outer.applied(report);
        },
    };
    observer.stage(null, 'handshake');
    const done = work(session, observer)
        .catch((error: unknown): SessionOutcome => {
            if (error instanceof SessionRefused) {
                return { kind: 'refused', refusal: error.refusal };
            }
            if (error instanceof ConnectionClosedError || session.closed) {
                return { kind: 'closed' };
            }
            throw error;
        })
        .finally(() => {
            session.closed = true;
            frames.close();
        });
    return {
        peerId: () => session.peer,
        notifyLocalChange: () => {
            session.pushLocal();
        },
        close: () => {
            session.closed = true;
            frames.close();
        },
        done,
        live,
    };
}

/**
 * A troca depois do handshake (sincronizacao §5.6, passos 3 a 8): membros primeiro, vetores,
 * lotes nos dois sentidos com confirmação, e o modo ao vivo até a conexão fechar.
 *
 * @param context Aparelho.
 * @param channel Canal cifrado.
 * @param peerId Par autenticado.
 * @param observer Quem acompanha.
 * @param session Estado da sessão, que recebe o empurrão do modo ao vivo.
 * @return O desfecho quando a conexão fecha.
 * @throws {SessionRefused} Quando a troca de membros revela que este aparelho ou o par foi
 * removido (sincronizacao §5.6, passo 3).
 * @throws {Error} Quando o par manda uma mensagem fora da ordem do protocolo.
 */
async function exchange(context: SessionContext, channel: SecureChannel, peerId: string, observer: SessionObserver, session: SessionHandle): Promise<SessionOutcome> {
    const { sync } = context;
    const self = sync.requireState().deviceId;
    observer.stage(peerId, 'syncing');

    await channel.sendJson({ type: 'members', batch: sync.extract(VersionVector.EMPTY, 'members') } satisfies SessionMessage);
    const members = await receiveSessionMessage(channel);
    if (members.type !== 'members') {
        throw unexpected(members);
    }
    sync.apply(syncBatchRequest.parse(members.batch));
    // Uma remoção aprendida agora vale antes de qualquer dado (sincronizacao §5.6, passo 3).
    if (sync.activeMember(DeviceId(peerId)) === null || sync.activeMember(self) === null) {
        await channel.sendJson({ type: 'refuse', reason: 'removed' } satisfies SessionMessage);
        throw new SessionRefused({ reason: 'removed' });
    }

    await channel.sendJson({ type: 'vector', vector: entriesOf(sync.vector()) } satisfies SessionMessage);
    const vectorMessage = await receiveSessionMessage(channel);
    if (vectorMessage.type !== 'vector') {
        throw unexpected(vectorMessage);
    }
    let peerVector = VersionVector.of(vectorMessage.vector.map(([origin, seq]) => [DeviceId(origin), seq] as const));
    // Em objeto, e não em variáveis soltas, porque o empurrão do modo ao vivo as altera de fora do laço.
    const flow = { awaitingAck: false, pending: false };
    let receivedInitial = false;
    let ackedInitial = false;

    const push = (force: boolean): void => {
        if (session.closed) {
            return;
        }
        if (flow.awaitingAck) {
            flow.pending = true;
            return;
        }
        const batch: SyncBatchDto = sync.extract(peerVector);
        if (!force && batch.changes.length === 0) {
            return;
        }
        flow.awaitingAck = true;
        void channel.sendJson({ type: 'batch', batch } satisfies SessionMessage).catch(() => undefined);
    };
    session.pushLocal = () => {
        push(false);
    };
    push(true);

    for (;;) {
        const message = await receiveSessionMessage(channel);
        switch (message.type) {
            case 'batch': {
                const batch = syncBatchRequest.parse(message.batch);
                const report = sync.apply(batch);
                // Quem enviou o lote possui tudo o que o `through` dele cobre; sem isto o próximo
                // empurrão devolveria ao par as mudanças que ele acabou de mandar.
                peerVector = peerVector.merge(batch.through);
                observer.applied(report);
                await channel.sendJson({ type: 'ack', vector: entriesOf(sync.vector()) } satisfies SessionMessage);
                receivedInitial = true;
                // As escritas da passada pós-aplicação (reviver um pai) também precisam ir.
                push(false);
                break;
            }
            case 'ack':
                peerVector = peerVector.merge(VersionVector.of(message.vector.map(([origin, seq]) => [DeviceId(origin), seq] as const)));
                flow.awaitingAck = false;
                ackedInitial = true;
                if (flow.pending) {
                    flow.pending = false;
                    push(false);
                }
                break;
            case 'refuse':
                throw new SessionRefused({ reason: message.reason });
            case 'members':
            case 'vector':
            case 'pair-confirm':
            case 'pair-accepted':
                throw unexpected(message);
        }
        if (receivedInitial && ackedInitial) {
            observer.stage(peerId, 'live');
        }
    }
}

/**
 * @param context Aparelho.
 * @return A carga de handshake deste lado.
 */
function localHello(context: SessionContext): { readonly deviceId: string; readonly wallMillis: number; readonly userVersion: number } {
    return { deviceId: context.sync.state()?.deviceId ?? '', wallMillis: context.wallClock.millis(), userVersion: context.sync.schemaVersion() };
}

/**
 * Regra de negócio (Sincronização, sincronizacao §3.2 e banco-de-dados §5.9): nada é trocado
 * com relógios divergindo mais de 2 minutos nem com versões de schema diferentes.
 *
 * @param context Aparelho.
 * @param remoteMillis Relógio de parede do par no handshake.
 * @param remoteVersion `user_version` do par.
 * @throws {SessionRefused} Quando um dos dois não confere.
 */
function assertCompatible(context: SessionContext, remoteMillis: number, remoteVersion: number): void {
    const localVersion = context.sync.schemaVersion();
    if (localVersion !== remoteVersion) {
        throw new SessionRefused({ reason: 'version', localVersion, remoteVersion });
    }
    const localMillis = context.wallClock.millis();
    if (Math.abs(localMillis - remoteMillis) > MAX_CLOCK_SKEW_MS) {
        throw new SessionRefused({ reason: 'clock', localMillis, remoteMillis });
    }
}

/**
 * @param frames Conexão.
 * @param mode Sessão ou pareamento.
 * @param deviceId Quem liga.
 * @return Os bytes enviados, para o prólogo.
 */
async function sendClearHello(frames: FrameConnection, mode: 'session' | 'pair', deviceId: string): Promise<Uint8Array> {
    const hello = utf8ToBytes(JSON.stringify({ protocol: SYNC_PROTOCOL_VERSION, mode, deviceId }));
    await frames.send(hello);
    return hello;
}

/**
 * @param frames Conexão.
 * @throws {SessionRefused} Quando o outro lado recusou em claro.
 */
async function expectClearAccept(frames: FrameConnection): Promise<void> {
    const reply = parseJson(await frames.receive());
    const refusal = clearRefusalSchema.safeParse(reply);
    if (refusal.success) {
        throw new SessionRefused({ reason: refusal.data.refused === 'no-invite' ? 'no-invite' : 'not-member' });
    }
}

/**
 * @param channel Canal.
 * @return A próxima mensagem de sessão validada.
 * @throws {Error} Quando chega algo fora do protocolo.
 */
async function receiveSessionMessage(channel: SecureChannel): Promise<SessionMessage> {
    const message = await channel.receiveMessage();
    if (message.kind !== 'json') {
        throw new Error('mensagem binária fora de hora');
    }
    return sessionMessageSchema.parse(message.value);
}

/**
 * @param bytes Texto UTF-8 com JSON.
 * @return O valor.
 */
function parseJson(bytes: Uint8Array): unknown {
    return JSON.parse(decodeUtf8(bytes)) as unknown;
}

/**
 * @param random Fonte da plataforma.
 * @return Uma chave efêmera nova por handshake.
 */
function ephemeral(random: RandomSource): KeyPair {
    return keyPairFrom(random.bytes(32));
}

/**
 * @param vector Vetor.
 * @return As entradas serializáveis.
 */
function entriesOf(vector: VersionVector): [string, number][] {
    return vector.toEntries().map(([origin, seq]): [string, number] => [origin, seq]);
}

/**
 * @param message Mensagem fora de ordem.
 * @return O erro que derruba a sessão.
 */
function unexpected(message: SessionMessage): Error {
    return new Error(`mensagem fora de ordem: ${message.type}`);
}
