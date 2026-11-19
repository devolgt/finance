import { BusinessRuleViolation } from '../../domain/shared/errors.ts';
import type { DeviceId } from '../../domain/shared/ids.ts';
import type { SyncPlatform } from '../../domain/sync/SyncMember.ts';
import type { SyncInviteResponse, SyncJoinResponse, SyncRefusalResponse, SyncStatusResponse } from '../../dto/sync/SyncStatusResponse.ts';
import { decodeInvite, encodeInvite } from '../../protocol/messages.ts';
import type { SyncCoordinator } from '../../protocol/SyncCoordinator.ts';
import type { SessionOutcome, SessionRefusal } from '../../protocol/SyncSession.ts';
import type { SyncService } from './SyncService.ts';

/** O que a plataforma informa de si para a tela de Dispositivos. */
export interface SyncPlatformInfo {
    readonly platform: SyncPlatform;
    /** Endereços locais atuais deste aparelho, que vão no convite (sincronizacao §4.3). */
    localAddresses(): readonly string[];
}

/** Contadores que o coordenador alimenta e a tela lê. */
export interface SyncCounters {
    appliedBatches: number;
    revivedRows: number;
}

/**
 * Casos de uso da tela de Dispositivos (sincronizacao §6.3 e §6.4): estado, grupo, convite,
 * entrada, remoção e o ciclo de abrir e fechar a tela. Fica no núcleo, atrás das mesmas rotas
 * nos dois apps, para que desktop e celular sigam a mesma regra — a tela só mostra.
 */
export class SyncDevicesService {
    /**
     * @param sync Casos de uso sem rede.
     * @param coordinator Coordenador da rede; `null` quando o app não tem os adaptadores.
     * @param platform Plataforma e endereços deste aparelho.
     * @param counters Lotes e revivências desde que o núcleo abriu.
     */
    public constructor(
        private readonly sync: SyncService,
        private readonly coordinator: SyncCoordinator | null,
        private readonly platform: SyncPlatformInfo,
        private readonly counters: SyncCounters,
    ) {}

    /**
     * @return O estado para a tela.
     */
    public status(): SyncStatusResponse {
        const state = this.sync.state();
        const coordinatorStatus = this.coordinator?.status() ?? null;
        const stages = new Map((coordinatorStatus?.sessions ?? []).filter((session) => session.deviceId !== null).map((session) => [session.deviceId, session.stage]));
        const lastEnd = coordinatorStatus?.lastEnd ?? null;
        const invite = coordinatorStatus?.invite ?? null;
        return {
            available: this.coordinator !== null,
            deviceId: state?.deviceId ?? null,
            groupId: state?.groupId ?? null,
            hasData: this.sync.hasDomainData(),
            members: state === null ? [] : this.sync.listMembers().map((member) => ({
                id: member.id,
                name: member.name,
                platform: member.platform,
                isSelf: member.id === state.deviceId,
                removed: member.removedAt !== null,
                stage: stages.get(member.id) ?? null,
            })),
            open: coordinatorStatus?.open ?? false,
            port: coordinatorStatus?.port ?? null,
            invite: invite === null ? null : { text: encodeInvite(invite), expiresAt: invite.expiresAt, addresses: invite.addresses, port: invite.port },
            lastRefusal: lastEnd?.outcome.kind === 'refused' ? { deviceId: lastEnd.deviceId, refusal: toRefusalResponse(lastEnd.outcome.refusal) } : null,
            appliedBatches: this.counters.appliedBatches,
            revivedRows: this.counters.revivedRows,
        };
    }

    /**
     * Cria o grupo com a chave deste aparelho, gerada no primeiro uso.
     *
     * @param deviceName Nome de exibição.
     * @return O estado novo.
     * @throws {BusinessRuleViolation} Sem os adaptadores de rede, ou já num grupo.
     */
    public async createGroup(deviceName: string): Promise<SyncStatusResponse> {
        const coordinator = this.requireCoordinator();
        this.sync.createGroup({ name: deviceName, platform: this.platform.platform, publicKey: await coordinator.publicKey() });
        return this.status();
    }

    /**
     * A tela de Dispositivos abriu: escuta, anuncia e procura (sincronizacao §5.1).
     *
     * @return O estado.
     */
    public async open(): Promise<SyncStatusResponse> {
        await this.requireCoordinator().open();
        return this.status();
    }

    /**
     * A tela fechou (ou o app saiu do primeiro plano): encerra tudo.
     *
     * @return O estado.
     */
    public async close(): Promise<SyncStatusResponse> {
        await this.coordinator?.close();
        return this.status();
    }

    /**
     * @return O convite novo, para virar QR.
     * @throws {BusinessRuleViolation} Sem os adaptadores de rede.
     */
    public async createInvite(): Promise<SyncInviteResponse> {
        const coordinator = this.requireCoordinator();
        await coordinator.open();
        const invite = await coordinator.createInvite(this.platform.localAddresses());
        return { text: encodeInvite(invite), expiresAt: invite.expiresAt, addresses: invite.addresses, port: invite.port };
    }

    /**
     * @return O estado, sem convite.
     */
    public cancelInvite(): SyncStatusResponse {
        this.coordinator?.cancelInvite();
        return this.status();
    }

    /**
     * Entra no grupo do convite lido do QR (sincronizacao §4.4).
     *
     * @param inviteText Texto do QR.
     * @param deviceName Nome deste aparelho.
     * @return O desfecho.
     * @throws {BusinessRuleViolation} Com convite inválido ou sem os adaptadores.
     */
    public async join(inviteText: string, deviceName: string): Promise<SyncJoinResponse> {
        const coordinator = this.requireCoordinator();
        const invite = decodeInvite(inviteText);
        if (invite === null) {
            throw new BusinessRuleViolation('sync-invite-invalid', 'o texto não é um convite válido');
        }
        const outcome: SessionOutcome = await coordinator.join(invite, { name: deviceName, platform: this.platform.platform });
        // A sessão de entrada seguiria ao vivo; ela termina aqui, porque a sincronização só roda
        // com a tela de Dispositivos aberta (sincronizacao §5.1) — que a reabre se estiver aberta.
        await coordinator.close();
        if (outcome.kind === 'joined') {
            return { joined: true, restartRequired: outcome.snapshot, refusal: null };
        }
        return { joined: false, restartRequired: false, refusal: outcome.kind === 'refused' ? toRefusalResponse(outcome.refusal) : null };
    }

    /**
     * Disca para um endereço digitado (sincronizacao §5.2). Espera a conexão abrir, e não a
     * sessão terminar, para que um endereço fora da rede local, um aparelho fora do grupo ou um
     * par inalcançável cheguem à tela como erro, em vez de a folha fechar como se a ligação
     * tivesse dado certo.
     *
     * @param address Endereço local.
     * @param port Porta.
     * @param deviceId Membro esperado.
     * @return O estado, já com a sessão nova.
     * @throws {BusinessRuleViolation} Quando o coordenador recusa a discagem (ver `SyncCoordinator.dial`).
     */
    public async connect(address: string, port: number, deviceId: DeviceId): Promise<SyncStatusResponse> {
        const coordinator = this.requireCoordinator();
        await coordinator.dial(address, port, deviceId);
        return this.status();
    }

    /**
     * @param id Membro a remover.
     * @return O estado.
     */
    public removeMember(id: DeviceId): SyncStatusResponse {
        this.sync.removeMember(id);
        return this.status();
    }

    /**
     * @return O estado, com este aparelho removido.
     */
    public leave(): SyncStatusResponse {
        this.sync.leaveGroup();
        return this.status();
    }

    /**
     * @return O coordenador.
     * @throws {BusinessRuleViolation} Quando o app não tem os adaptadores de rede.
     */
    private requireCoordinator(): SyncCoordinator {
        if (this.coordinator === null) {
            throw new BusinessRuleViolation('sync-unavailable', 'o app foi montado sem os adaptadores de rede');
        }
        return this.coordinator;
    }
}

/**
 * @param refusal Recusa do protocolo.
 * @return A forma serializável.
 */
function toRefusalResponse(refusal: SessionRefusal): SyncRefusalResponse {
    return refusal;
}
