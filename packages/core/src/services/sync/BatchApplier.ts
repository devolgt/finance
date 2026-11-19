import { InvalidValueError } from '../../domain/shared/errors.ts';
import { AccountId, RecurrenceId, TransactionId } from '../../domain/shared/ids.ts';
import type { HybridLogicalClock } from '../../domain/sync/HybridLogicalClock.ts';
import type { CellChange, CellValue, RowChange, SyncBatch } from '../../domain/sync/SyncBatch.ts';
import { syncedTable, type NaturalKey, type SyncedTable } from '../../domain/sync/SyncCatalog.ts';
import type { Provenance } from '../../domain/sync/SyncState.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { SqlRow } from '../../ports/Database.ts';
import type { WallClock } from '../../ports/WallClock.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { ForeignKeyLink, ReplicaRepository } from '../../repositories/ReplicaRepository.ts';
import type { RecurrenceRepository } from '../../repositories/RecurrenceRepository.ts';
import type { SyncLedgerRepository } from '../../repositories/SyncLedgerRepository.ts';
import type { TransactionRepository } from '../../repositories/TransactionRepository.ts';
import type { BalanceRecalculationService } from '../balance/BalanceRecalculationService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import { NotInSyncGroupError } from './SyncErrors.ts';

/** Uma linha que a aplicação tocou, identificada pela tabela do catálogo. */
interface RowRef {
    readonly table: SyncedTable;
    readonly id: string;
}

/** O que a aplicação de um lote fez além de gravar as células — o que a tela avisa. */
export interface ApplyReport {
    /** Transações de origem aplicadas. */
    readonly changes: number;
    /** Pais donos revividos porque um filho vivo apontava para eles (sync-design §5.8). */
    readonly revived: readonly { readonly table: string; readonly id: string }[];
    /** Linhas que perderam uma colisão de chave natural e foram mescladas (sync-design §5.7). */
    readonly merged: number;
    /** Ocorrências excluídas por estarem além do término da série (sync-design §5.6). */
    readonly trimmed: number;
}

/**
 * Aplica um lote recebido (sync-design §5.9): last-writer-wins por célula contra o relógio
 * efetivo, numa transação só, seguido da passada pós-aplicação. A ordem do lote é a causal
 * (por HLC), e as chaves estrangeiras são adiadas para que a ordem dentro de uma transação de
 * origem não importe.
 *
 * Todas as decisões dependem só dos dados — relógios e ids —, nunca de quem aplica nem de
 * quando: é o que faz duas réplicas que viram as mesmas mudanças terminarem iguais.
 */
export class BatchApplier {
    /**
     * @param unitOfWork Transação única da aplicação; um erro desfaz tudo e o vetor não anda.
     * @param ledger Tabelas de relógio e o interruptor da captura.
     * @param replica Acesso genérico às linhas.
     * @param accounts Contas, para saber quais ainda existem antes de recalcular.
     * @param recurrences Regras, para o término das séries.
     * @param transactions Lançamentos, para excluir ocorrências além do término.
     * @param recalculation Recálculo dos caches, que não trafegam.
     * @param clock Instante das escritas locais da passada (lápides, revivências).
     * @param wallClock Relógio de parede para avançar o HLC além do recebido.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ledger: SyncLedgerRepository,
        private readonly replica: ReplicaRepository,
        private readonly accounts: AccountRepository,
        private readonly recurrences: RecurrenceRepository,
        private readonly transactions: TransactionRepository,
        private readonly recalculation: BalanceRecalculationService,
        private readonly clock: Clock,
        private readonly wallClock: WallClock,
    ) {}

    /**
     * @param batch Lote validado.
     * @return O que a aplicação fez além das células.
     * @throws {NotInSyncGroupError} Quando o aparelho não pertence a um grupo.
     * @throws {InvalidValueError} Quando o lote é inconsistente (coluna desconhecida, célula de
     * linha que não existe); nada é gravado.
     */
    public apply(batch: SyncBatch): ApplyReport {
        return this.unitOfWork.run(() => {
            const state = this.ledger.findState();
            if (state === null) {
                throw new NotInSyncGroupError();
            }
            this.ledger.deferForeignKeys();
            const pass = new ApplyPass(this.replica, this.ledger, this.clock);
            const received = batch.changes.flatMap((change) => [...change.rows, ...change.cells]);
            const accountsBefore = this.affectedAccounts(received);

            this.ledger.withCapture(false, () => {
                for (const change of batch.changes) {
                    for (const row of change.rows) {
                        pass.applyRow(row, change.provenance);
                    }
                    for (const cell of change.cells) {
                        pass.applyCell(cell, change.provenance);
                    }
                }
            });

            const latest = batch.changes.reduce<HybridLogicalClock | null>(
                (max, change) => (max === null || change.provenance.clock.isAfter(max) ? change.provenance.clock : max),
                null,
            );
            if (latest !== null) {
                // As escritas da passada seguinte ficam depois de tudo o que chegou (sync-design §5.2).
                this.ledger.saveState({ ...state, clock: state.clock.receive(latest, this.wallClock.millis()) });
            }

            const trimmed = this.ledger.withCapture(true, () => {
                pass.redirectMerged();
                const doomed = this.trimEndedSeries(pass.touched());
                pass.reviveOwners();
                return doomed;
            });

            const accountIds = new Set([...accountsBefore, ...this.affectedAccounts([...pass.touched(), ...trimmed])]);
            for (const id of [...accountIds].sort()) {
                const accountId = AccountId(id);
                if (this.accounts.findById(accountId) !== null) {
                    this.recalculation.recalculateAccountFully(accountId);
                }
            }

            this.ledger.saveVector(this.ledger.vector().merge(batch.through));
            return { changes: batch.changes.length, revived: pass.revivedRows(), merged: pass.mergedCount(), trimmed: trimmed.length };
        });
    }

    /**
     * Regra de negócio (Recorrências): ocorrências além do término de uma série encerrada são
     * excluídas na mesclagem. É a pendência da sync-design §5.6 e da Fase 9.2 do desktop: um
     * aparelho que completou offline a regra antiga traz ocorrências que a mudança de
     * periodicidade ou de tipo, feita no outro, já encerrou.
     *
     * @param touched Linhas tocadas pelo lote.
     * @return As ocorrências excluídas, para recalcular as contas delas.
     */
    private trimEndedSeries(touched: readonly RowRef[]): readonly RowRef[] {
        const series = new Set<string>();
        for (const ref of touched) {
            if (ref.table.name === 'recurrences') {
                series.add(ref.id);
            } else if (ref.table.name === 'transactions') {
                const recurrenceId = this.replica.find(ref.table, ref.id)?.['recurrence_id'];
                if (typeof recurrenceId === 'string') {
                    series.add(recurrenceId);
                }
            }
        }
        const trimmed: RowRef[] = [];
        const transactionTable = syncedTable('transactions');
        for (const id of [...series].sort()) {
            const recurrence = this.recurrences.findById(RecurrenceId(id));
            const last = recurrence?.lastOccurrence() ?? null;
            if (recurrence === null || last === null) {
                continue;
            }
            for (const occurrence of this.transactions.listOccurrences(recurrence.id)) {
                if (occurrence.occurrence !== null && occurrence.occurrence > last) {
                    this.transactions.softDelete(TransactionId(occurrence.id));
                    if (transactionTable !== null) {
                        trimmed.push({ table: transactionTable, id: occurrence.id });
                    }
                }
            }
        }
        return trimmed;
    }

    /**
     * Contas cujos saldos podem ter mudado com o lote. Lida antes e depois da aplicação para
     * que uma transação que mudou de lugar recalcule o contêiner antigo e o novo
     * (sync-design §5.9, passo 2).
     *
     * @param refs Linhas recebidas ou escritas pela passada.
     * @return Ids das contas.
     */
    private affectedAccounts(refs: readonly RowRef[]): ReadonlySet<string> {
        const accounts = new Set<string>();
        for (const ref of refs) {
            for (const id of this.replica.accountsAffectedBy(ref.table, ref.id)) {
                accounts.add(id);
            }
        }
        return accounts;
    }
}

/**
 * O estado de uma aplicação: as linhas tocadas, as mescladas e as revividas. Separado do
 * `BatchApplier` porque vive só durante um lote, e as regras de colisão e de órfãos
 * precisam do mesmo registro.
 */
class ApplyPass {
    private readonly touchedRows = new Map<string, RowRef>();
    private readonly merges: { readonly table: SyncedTable; readonly loser: string; readonly survivor: string }[] = [];
    private readonly revived: RowRef[] = [];
    private mergedTotal = 0;

    /**
     * @param replica Acesso às linhas.
     * @param ledger Tabelas de relógio e captura.
     * @param clock Instante das escritas locais.
     */
    public constructor(
        private readonly replica: ReplicaRepository,
        private readonly ledger: SyncLedgerRepository,
        private readonly clock: Clock,
    ) {}

    /**
     * Aplica a criação de uma linha. Se ela não existe, é inserida com os valores da origem
     * (inclusive `created_at`, sync-design §5.5); se existe — id determinístico criado nos dois
     * aparelhos, ou o mesmo lote recebido de novo —, cada coluna é decidida pelo relógio.
     *
     * @param change Criação recebida.
     * @param provenance Relógio e origem da transação de origem.
     * @throws {InvalidValueError} Quando faltam colunas ou há coluna desconhecida.
     */
    public applyRow(change: RowChange, provenance: Provenance): void {
        const columns = this.replica.syncedColumns(change.table);
        this.assertColumns(change.table, Object.keys(change.values), columns);
        this.touch(change.table, change.id);
        const local = this.replica.find(change.table, change.id);
        if (local === null) {
            const missing = columns.filter((column) => !(column in change.values));
            if (missing.length > 0) {
                throw new InvalidValueError('batch', `criação de ${change.table.name}/${change.id} sem as colunas ${missing.join(', ')}`);
            }
            const row: Record<string, CellValue> = { ...change.values, id: change.id };
            const adjustments = this.resolveCollisions(change.table, change.id, row);
            this.replica.insert(change.table, change.id, { ...change.values, ...adjustments });
            this.ledger.putRow(change.table.name, change.id, provenance);
            this.ledger.markDirty(change.table.name, change.id, Object.keys(adjustments));
            return;
        }
        this.mergeInto(change.table, change.id, local, change.values, provenance);
    }

    /**
     * @param change Alteração de célula recebida.
     * @param provenance Relógio e origem.
     * @throws {InvalidValueError} Quando a linha não existe ou a coluna é desconhecida.
     */
    public applyCell(change: CellChange, provenance: Provenance): void {
        this.assertColumns(change.table, [change.column], this.replica.syncedColumns(change.table));
        this.touch(change.table, change.id);
        const local = this.replica.find(change.table, change.id);
        if (local === null) {
            // A criação vem antes de qualquer alteração na ordem causal; faltar é lote inconsistente.
            throw new InvalidValueError('batch', `alteração de ${change.table.name}/${change.id} sem a linha`);
        }
        this.mergeInto(change.table, change.id, local, { [change.column]: change.value }, provenance);
    }

    /**
     * Redireciona os filhos de toda linha que perdeu uma colisão "merge" para a sobrevivente
     * (sync-design §5.7). O redirecionamento é escrita local e se propaga; ele pode criar
     * novas colisões nos filhos (a mesma tag duas vezes num lançamento), resolvidas pela mesma
     * regra, por isso a fila.
     */
    public redirectMerged(): void {
        for (let index = 0; index < this.merges.length; index++) {
            const merge = this.merges[index];
            if (merge === undefined) {
                continue;
            }
            for (const link of this.replica.childLinks(merge.table)) {
                const child = syncedTable(link.child);
                if (child === null) {
                    continue;
                }
                for (const childId of this.replica.liveChildren(link, merge.loser)) {
                    this.writeLocal(child, childId, { [link.column]: merge.survivor });
                }
            }
        }
    }

    /**
     * Regra de negócio (Sincronização, sync-design §5.8): uma linha viva sob um pai dono
     * excluído revive o pai, com aviso; dado financeiro nunca é excluído por um merge que o
     * usuário não viu. Se o pai morto tem uma gêmea viva (perdeu uma colisão), o filho vai
     * para ela em vez de reviver o perdedor. Pais donos são as chaves `CASCADE` e o
     * vocabulário obrigatório (`NO ACTION`); referências `SET NULL` podem apontar para excluídos.
     */
    public reviveOwners(): void {
        const queue = [...this.touchedRows.values()];
        for (let index = 0; index < queue.length; index++) {
            const ref = queue[index];
            if (ref === undefined) {
                continue;
            }
            const row = this.replica.find(ref.table, ref.id);
            if (row === null) {
                continue;
            }
            if (row[ref.table.tombstone] === null) {
                for (const link of this.replica.parentLinks(ref.table).filter(isOwnerLink)) {
                    const parentId = row[link.column];
                    if (typeof parentId === 'string') {
                        this.rescueChild(ref, link, parentId, queue);
                    }
                }
            } else {
                for (const link of this.replica.childLinks(ref.table).filter(isOwnerLink)) {
                    const child = syncedTable(link.child);
                    if (child === null) {
                        continue;
                    }
                    for (const childId of this.replica.liveChildren(link, ref.id)) {
                        this.rescueChild({ table: child, id: childId }, link, ref.id, queue);
                    }
                }
            }
        }
    }

    /**
     * @return As linhas tocadas pelo lote, na ordem em que chegaram.
     */
    public touched(): readonly RowRef[] {
        return [...this.touchedRows.values()];
    }

    /**
     * @return Os pais revividos, para o aviso.
     */
    public revivedRows(): readonly { readonly table: string; readonly id: string }[] {
        return this.revived.map((ref) => ({ table: ref.table.name, id: ref.id }));
    }

    /**
     * @return Quantas linhas perderam uma colisão.
     */
    public mergedCount(): number {
        return this.mergedTotal;
    }

    /**
     * Last-writer-wins célula a célula contra o relógio efetivo local: a entrada em
     * `sync_cells` ou, sem ela, a da linha (sync-design §5.3). `materialized_count` é o máximo
     * dos dois, qualquer que seja o relógio (sync-design §5.5).
     *
     * @param table Tabela.
     * @param id Linha local existente.
     * @param local Valores locais atuais.
     * @param incoming Células recebidas.
     * @param provenance Relógio e origem da escrita recebida.
     */
    private mergeInto(table: SyncedTable, id: string, local: SqlRow, incoming: Readonly<Record<string, CellValue>>, provenance: Provenance): void {
        const rowClock = this.ledger.rowEntry(table.name, id)?.clock ?? null;
        const cellClocks = this.ledger.cellClocks(table.name, id);
        const writes: Record<string, CellValue> = {};
        const winners: string[] = [];
        for (const [column, value] of Object.entries(incoming)) {
            const effective = cellClocks.get(column) ?? rowClock;
            const newer = effective === null || provenance.clock.isAfter(effective);
            if (table.maxMerged.includes(column)) {
                const current = local[column];
                if (typeof value === 'number' && (typeof current !== 'number' || value > current)) {
                    writes[column] = value;
                }
            } else if (newer && local[column] !== value) {
                writes[column] = value;
            }
            if (newer) {
                winners.push(column);
            }
        }
        const merged: Record<string, CellValue> = { ...local, ...writes };
        const adjustments = Object.keys(writes).length === 0 ? {} : this.resolveCollisions(table, id, merged);
        this.replica.update(table, id, { ...writes, ...adjustments });
        for (const column of winners) {
            this.ledger.putCell(table.name, id, column, provenance);
        }
        // O ajuste de quem perdeu a colisão é escrita local: o carimbo, no fim, o registra com
        // relógio próprio, por cima da procedência recebida.
        this.ledger.markDirty(table.name, id, Object.keys(adjustments));
    }

    /**
     * Resolve, antes da escrita, as colisões de chave natural que a linha causaria: o índice
     * único não é adiável. Sobrevive a de menor id (sync-design §5.7), decidido só pelos ids
     * para que todo aparelho escolha a mesma. Quando a perdedora é a linha local, ela é
     * ajustada já (escrita local, capturada); quando é a recebida, o ajuste é aplicado em
     * `row` e devolvido, para que ela seja gravada sem colidir e o ajuste, marcado como
     * escrita local — regravar depois com a captura ligada não marcaria nada, porque o
     * trigger só vê valores que mudam.
     *
     * @param table Tabela.
     * @param id Linha que vai ser gravada.
     * @param row Valores com que ela vai ficar.
     * @return O ajuste a aplicar na linha recebida depois de gravá-la; vazio quando ela vence.
     */
    private resolveCollisions(table: SyncedTable, id: string, row: Record<string, CellValue>): Record<string, CellValue> {
        const adjustments: Record<string, CellValue> = {};
        for (const key of table.naturalKeys) {
            const twin = this.replica.findLiveTwin(table, key, row, id);
            if (twin === null) {
                continue;
            }
            const loserAdjustment = this.loserAdjustment(table, key);
            if (twin < id) {
                // A recebida perde: é gravada já ajustada, e o ajuste é marcado como escrita local.
                Object.assign(row, loserAdjustment);
                Object.assign(adjustments, loserAdjustment);
                this.recordLoss(table, key, id, twin);
            } else {
                this.ledger.withCapture(true, () => {
                    this.replica.update(table, twin, loserAdjustment);
                });
                this.recordLoss(table, key, twin, id);
            }
        }
        return adjustments;
    }

    /**
     * @param table Tabela.
     * @param key Chave natural que colidiu.
     * @return As colunas que tiram a perdedora da colisão: a lápide numa mescla, a chave
     * limpa num desvínculo.
     */
    private loserAdjustment(table: SyncedTable, key: NaturalKey): Record<string, CellValue> {
        if (key.strategy === 'unlink') {
            return Object.fromEntries(key.columns.map((column) => [column, null]));
        }
        const now = this.clock.now();
        return { [table.tombstone]: now, updated_at: now };
    }

    /**
     * @param table Tabela.
     * @param key Chave que colidiu.
     * @param loser Linha perdedora.
     * @param survivor Linha sobrevivente.
     */
    private recordLoss(table: SyncedTable, key: NaturalKey, loser: string, survivor: string): void {
        this.mergedTotal++;
        if (key.strategy === 'merge') {
            this.merges.push({ table, loser, survivor });
        }
    }

    /**
     * Grava uma alteração local da passada pós-aplicação, resolvendo as colisões que ela
     * causaria. Roda com a captura ligada (a passada inteira roda assim).
     *
     * @param table Tabela.
     * @param id Linha.
     * @param changes Colunas a gravar.
     */
    private writeLocal(table: SyncedTable, id: string, changes: Readonly<Record<string, CellValue>>): void {
        const row = this.replica.find(table, id);
        if (row === null) {
            return;
        }
        const merged: Record<string, CellValue> = { ...row, ...changes };
        const adjustments = this.resolveCollisions(table, id, merged);
        this.replica.update(table, id, { ...changes, ...adjustments });
        this.touch(table, id);
    }

    /**
     * @param child Filha viva.
     * @param link Chave dona.
     * @param parentId Pai excluído (ou não — conferido aqui).
     * @param queue Fila da passada, que recebe o pai revivido para conferir os avós.
     */
    private rescueChild(child: RowRef, link: ForeignKeyLink, parentId: string, queue: RowRef[]): void {
        const parentTable = syncedTable(link.parent);
        if (parentTable === null) {
            return;
        }
        const parent = this.replica.find(parentTable, parentId);
        if (parent === null || parent[parentTable.tombstone] === null) {
            return;
        }
        for (const key of parentTable.naturalKeys.filter((candidate) => candidate.strategy === 'merge')) {
            const twin = this.replica.findLiveTwin(parentTable, key, { ...parent, [parentTable.tombstone]: null }, parentId);
            if (twin !== null) {
                this.writeLocal(child.table, child.id, { [link.column]: twin });
                return;
            }
        }
        this.writeLocal(parentTable, parentId, { [parentTable.tombstone]: null, updated_at: this.clock.now() });
        const revived = { table: parentTable, id: parentId };
        this.revived.push(revived);
        queue.push(revived);
    }

    /**
     * @param table Tabela.
     * @param names Colunas citadas.
     * @param columns Colunas sincronizadas da tabela.
     * @throws {InvalidValueError} Quando alguma não é sincronizada — coluna de cache, id ou
     * desconhecida (o par tem outro schema, o que o handshake já deveria ter recusado).
     */
    private assertColumns(table: SyncedTable, names: readonly string[], columns: readonly string[]): void {
        const unknown = names.filter((name) => !columns.includes(name));
        if (unknown.length > 0) {
            throw new InvalidValueError('batch', `colunas não sincronizadas em ${table.name}: ${unknown.join(', ')}`);
        }
    }

    /**
     * @param table Tabela.
     * @param id Linha tocada.
     */
    private touch(table: SyncedTable, id: string): void {
        this.touchedRows.set(`${table.name}/${id}`, { table, id });
    }
}

/**
 * @param link Chave estrangeira.
 * @return `true` para as chaves de propriedade e de vocabulário obrigatório, cujo pai excluído
 * com filho vivo é o caso da sync-design §5.8.
 */
function isOwnerLink(link: ForeignKeyLink): boolean {
    return link.onDelete !== 'SET NULL';
}
