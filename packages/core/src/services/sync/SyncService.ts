import { DeviceId, GroupId } from '../../domain/shared/ids.ts';
import { HybridLogicalClock } from '../../domain/sync/HybridLogicalClock.ts';
import type { SyncBatch } from '../../domain/sync/SyncBatch.ts';
import type { SyncMember, SyncPlatform } from '../../domain/sync/SyncMember.ts';
import type { SyncState } from '../../domain/sync/SyncState.ts';
import { VersionVector } from '../../domain/sync/VersionVector.ts';
import type { SyncBatchDto } from '../../dto/sync/SyncBatchDto.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { WallClock } from '../../ports/WallClock.ts';
import type { SyncLedgerRepository } from '../../repositories/SyncLedgerRepository.ts';
import type { SyncMemberRepository } from '../../repositories/SyncMemberRepository.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { ApplyReport, BatchApplier } from './BatchApplier.ts';
import type { ChangeExtractor, ExtractionScope } from './ChangeExtractor.ts';
import { AlreadyInSyncGroupError, DeviceHasDataError, NotInSyncGroupError } from './SyncErrors.ts';

/** O que identifica este aparelho ao criar um grupo ou ser convidado. */
export interface DeviceProfile {
    readonly name: string;
    readonly platform: SyncPlatform;
    /** Chave pública X25519 em hexadecimal; a privada fica no `KeyStore` da plataforma. */
    readonly publicKey: string;
}

/**
 * Casos de uso da sincronização que não dependem de rede: ativar o grupo, administrar os
 * membros, extrair e aplicar lotes. A sessão (protocolo, criptografia) fica por cima disto e
 * só conversa com o núcleo por aqui.
 */
export class SyncService {
    /**
     * @param unitOfWork Transação de cada caso de uso.
     * @param ids Fonte do id do aparelho e do grupo.
     * @param wallClock Relógio de parede para o HLC da ativação.
     * @param ledger Estado e relógios.
     * @param members Lista de membros.
     * @param extractor Montagem de lotes.
     * @param applier Aplicação de lotes.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ids: IdGenerator,
        private readonly wallClock: WallClock,
        private readonly ledger: SyncLedgerRepository,
        private readonly members: SyncMemberRepository,
        private readonly extractor: ChangeExtractor,
        private readonly applier: BatchApplier,
    ) {}

    /**
     * @return A identidade no grupo, ou `null` fora de um grupo.
     */
    public state(): SyncState | null {
        return this.ledger.findState();
    }

    /**
     * @return A identidade no grupo.
     * @throws {NotInSyncGroupError} Fora de um grupo.
     */
    public requireState(): SyncState {
        const state = this.ledger.findState();
        if (state === null) {
            throw new NotInSyncGroupError();
        }
        return state;
    }

    /**
     * Cria o grupo neste aparelho, que vira o primeiro membro (sincronizacao §4.2).
     * Regra de negócio (Sincronização, sincronizacao §4.6): toda linha existente
     * ganha uma entrada em `sync_rows` com origem neste aparelho — é assim que um aparelho com
     * histórico passa a sincronizar; o que entrar depois chega vazio e recebe o snapshot.
     *
     * @param device Nome, plataforma e chave pública deste aparelho.
     * @return A identidade criada.
     * @throws {AlreadyInSyncGroupError} Quando o aparelho já está num grupo.
     */
    public createGroup(device: DeviceProfile): SyncState {
        return this.unitOfWork.run(() => {
            if (this.ledger.findState() !== null) {
                throw new AlreadyInSyncGroupError();
            }
            const deviceId = DeviceId(this.ids.random());
            const clock = HybridLogicalClock.initial(deviceId).tick(this.wallClock.millis());
            this.ledger.saveState({ deviceId, groupId: GroupId(this.ids.random()), clock, nextSeq: 2 });
            this.ledger.backfill({ clock, origin: deviceId, seq: 1 });
            this.ledger.saveVector(VersionVector.of([[deviceId, 1]]));
            this.ledger.setCapture(true);
            this.members.insert({ id: deviceId, name: device.name, platform: device.platform, publicKey: device.publicKey, addedBy: null, removedAt: null });
            return this.requireState();
        });
    }

    /**
     * Entra num grupo com o aparelho vazio (sincronizacao §4.4): a identidade é a que o aparelho
     * apresentou no pareamento, e o vetor começa vazio — tudo chega pelo primeiro lote. É o
     * caminho dos testes e a alternativa ao snapshot quando o banco do anfitrião é pequeno.
     * Regra de negócio (Sincronização): só um aparelho sem dados entra; dois históricos
     * independentes não são mesclados (sincronizacao §2 e §4.4).
     *
     * @param deviceId Id deste aparelho, o mesmo cuja chave pública o anfitrião registrou.
     * @param groupId Grupo do convite.
     * @return A identidade gravada.
     * @throws {AlreadyInSyncGroupError} Quando o aparelho já está num grupo.
     * @throws {DeviceHasDataError} Quando o aparelho tem dados.
     */
    public joinEmpty(deviceId: DeviceId, groupId: GroupId): SyncState {
        return this.unitOfWork.run(() => {
            if (this.ledger.findState() !== null) {
                throw new AlreadyInSyncGroupError();
            }
            if (this.ledger.hasDomainData()) {
                throw new DeviceHasDataError();
            }
            this.ledger.saveState({ deviceId, groupId, clock: HybridLogicalClock.initial(deviceId).tick(this.wallClock.millis()), nextSeq: 1 });
            this.ledger.setCapture(true);
            return this.requireState();
        });
    }

    /**
     * Assume a identidade própria num banco recém-trocado pelo snapshot do anfitrião
     * (sincronizacao §4.4). O snapshot traz as tabelas de relógio, os membros e o vetor do
     * anfitrião — exatamente o que ele representa —, mas também o `sync_state` dele, que é
     * substituído aqui pela identidade deste aparelho. O HLC parte do relógio do anfitrião,
     * para que a primeira escrita local fique depois de tudo o que veio no snapshot.
     *
     * @param deviceId Id deste aparelho.
     * @param groupId Grupo do convite; precisa ser o do snapshot.
     * @return A identidade gravada.
     * @throws {NotInSyncGroupError} Quando o banco não veio de um membro do grupo.
     */
    public adoptSnapshot(deviceId: DeviceId, groupId: GroupId): SyncState {
        return this.unitOfWork.run(() => {
            const host = this.ledger.findState();
            if (host?.groupId !== groupId) {
                throw new NotInSyncGroupError();
            }
            const clock = HybridLogicalClock.initial(deviceId).receive(host.clock, this.wallClock.millis());
            this.ledger.saveState({ deviceId, groupId, clock, nextSeq: 1 });
            this.ledger.setCapture(true);
            return this.requireState();
        });
    }

    /**
     * @return `true` quando alguma tabela sincronizada tem linha — o que impede entrar num grupo.
     */
    public hasDomainData(): boolean {
        return this.ledger.hasDomainData();
    }

    /**
     * @return Os membros, inclusive removidos.
     */
    public listMembers(): readonly SyncMember[] {
        return this.members.listAll();
    }

    /**
     * Registra o aparelho que acabou de parear (sincronizacao §4.3): quem convidou grava o novo
     * membro, e a linha se propaga como qualquer escrita.
     *
     * @param id Id do aparelho novo.
     * @param device Perfil enviado por ele no handshake de pareamento.
     * @return O membro gravado.
     * @throws {NotInSyncGroupError} Fora de um grupo.
     */
    public addMember(id: DeviceId, device: DeviceProfile): SyncMember {
        return this.unitOfWork.run(() => {
            const state = this.requireState();
            const member: SyncMember = { id, name: device.name, platform: device.platform, publicKey: device.publicKey, addedBy: state.deviceId, removedAt: null };
            if (this.members.findById(id) === null) {
                this.members.insert(member);
            }
            return member;
        });
    }

    /**
     * Remove um membro, inclusive este aparelho ("sair do grupo", sincronizacao §4.5). A remoção
     * é uma escrita comum e chega aos outros na próxima sessão; os membros recusam sessões com
     * um aparelho removido.
     *
     * @param id Membro a remover.
     * @throws {NotInSyncGroupError} Fora de um grupo.
     */
    public removeMember(id: DeviceId): void {
        this.unitOfWork.run(() => {
            this.requireState();
            this.members.markRemoved(id);
        });
    }

    /**
     * "Sair do grupo" (sincronizacao §4.5): a remoção deste aparelho é uma escrita comum, que os
     * outros aprendem na próxima sessão — pela troca de membros, que vem antes de qualquer
     * dado. A identidade fica, para que essa última sessão aconteça; depois dela, o aparelho é
     * recusado e mantém só a cópia local.
     *
     * @throws {NotInSyncGroupError} Fora de um grupo.
     */
    public leaveGroup(): void {
        this.removeMember(this.requireState().deviceId);
    }

    /**
     * @param id Aparelho que pede uma sessão.
     * @return O membro ativo, ou `null` quando ele nunca foi do grupo ou foi removido — o
     * que a sessão recusa.
     */
    public activeMember(id: DeviceId): SyncMember | null {
        const member = this.members.findById(id);
        return member === null || member.removedAt !== null ? null : member;
    }

    /**
     * @return Um id novo para este aparelho, gerado antes de parear: é ele que vai no
     * handshake e que o anfitrião grava em `sync_members` (sincronizacao §4.1).
     */
    public newDeviceId(): DeviceId {
        return DeviceId(this.ids.random());
    }

    /**
     * @return O `user_version` do banco; a sessão recusa pares com outra versão de schema
     * (banco-de-dados §5.9), porque um lote citaria colunas que o outro não tem.
     */
    public schemaVersion(): number {
        return this.ledger.schemaVersion();
    }

    /**
     * @param id Aparelho.
     * @return O membro, removido ou não; `null` quando nunca foi do grupo. Quem disca usa este,
     * e não `activeMember`, para que um aparelho removido aprenda a remoção pela troca de
     * membros antes de a sessão ser recusada.
     */
    public knownMember(id: DeviceId): SyncMember | null {
        return this.members.findById(id);
    }

    /**
     * @return O vetor deste aparelho, que ele envia ao par.
     */
    public vector(): VersionVector {
        return this.ledger.vector();
    }

    /**
     * @param peer Vetor do par.
     * @param scope Tudo, ou só os membros.
     * @return O lote do que falta ao par.
     */
    public extract(peer: VersionVector, scope: ExtractionScope = 'all'): SyncBatchDto {
        return this.unitOfWork.run(() => this.extractor.extract(peer, scope));
    }

    /**
     * @param batch Lote validado.
     * @return O que a aplicação fez.
     */
    public apply(batch: SyncBatch): ApplyReport {
        return this.applier.apply(batch);
    }
}
