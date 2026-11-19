import type { SyncInviteResponse, SyncJoinResponse, SyncStatusResponse } from '../dto/sync/SyncStatusResponse.ts';
import { connectSyncPeerRequest, createSyncGroupRequest, joinSyncGroupRequest, syncMemberIdRequest, syncStatusRequest } from '../requests/syncRequests.ts';
import type { SyncDevicesService } from '../services/sync/SyncDevicesService.ts';
import { handle, handleAsync, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas da tela de Dispositivos (sincronizacao §6.3 e §6.4). */
export class SyncController {
    /**
     * @param devices Casos de uso da tela.
     * @param onUnexpected Log de falha inesperada.
     */
    public constructor(private readonly devices: SyncDevicesService, private readonly onUnexpected: UnexpectedErrorListener) {}

    /**
     * @param raw Entrada vazia.
     * @return O estado.
     */
    public status(raw: unknown): Promise<CoreResult<SyncStatusResponse>> {
        return handle(syncStatusRequest, raw, () => this.devices.status(), this.onUnexpected);
    }

    /**
     * @param raw Nome do aparelho.
     * @return O estado com o grupo criado.
     */
    public createGroup(raw: unknown): Promise<CoreResult<SyncStatusResponse>> {
        return handleAsync(createSyncGroupRequest, raw, ({ deviceName }) => this.devices.createGroup(deviceName), this.onUnexpected);
    }

    /**
     * @param raw Entrada vazia.
     * @return O estado com a tela aberta.
     */
    public open(raw: unknown): Promise<CoreResult<SyncStatusResponse>> {
        return handleAsync(syncStatusRequest, raw, () => this.devices.open(), this.onUnexpected);
    }

    /**
     * @param raw Entrada vazia.
     * @return O estado com a tela fechada.
     */
    public close(raw: unknown): Promise<CoreResult<SyncStatusResponse>> {
        return handleAsync(syncStatusRequest, raw, () => this.devices.close(), this.onUnexpected);
    }

    /**
     * @param raw Entrada vazia.
     * @return O convite.
     */
    public createInvite(raw: unknown): Promise<CoreResult<SyncInviteResponse>> {
        return handleAsync(syncStatusRequest, raw, () => this.devices.createInvite(), this.onUnexpected);
    }

    /**
     * @param raw Entrada vazia.
     * @return O estado sem convite.
     */
    public cancelInvite(raw: unknown): Promise<CoreResult<SyncStatusResponse>> {
        return handle(syncStatusRequest, raw, () => this.devices.cancelInvite(), this.onUnexpected);
    }

    /**
     * @param raw Texto do convite e nome do aparelho.
     * @return O desfecho da entrada.
     */
    public join(raw: unknown): Promise<CoreResult<SyncJoinResponse>> {
        return handleAsync(joinSyncGroupRequest, raw, ({ invite, deviceName }) => this.devices.join(invite, deviceName), this.onUnexpected);
    }

    /**
     * @param raw Endereço, porta e membro.
     * @return O estado.
     */
    public connect(raw: unknown): Promise<CoreResult<SyncStatusResponse>> {
        return handleAsync(connectSyncPeerRequest, raw, ({ address, port, deviceId }) => this.devices.connect(address, port, deviceId), this.onUnexpected);
    }

    /**
     * @param raw Membro.
     * @return O estado.
     */
    public removeMember(raw: unknown): Promise<CoreResult<SyncStatusResponse>> {
        return handle(syncMemberIdRequest, raw, ({ id }) => this.devices.removeMember(id), this.onUnexpected);
    }

    /**
     * @param raw Entrada vazia.
     * @return O estado.
     */
    public leave(raw: unknown): Promise<CoreResult<SyncStatusResponse>> {
        return handle(syncStatusRequest, raw, () => this.devices.leave(), this.onUnexpected);
    }
}
