import { AccountController } from '../controllers/AccountController.ts';
import { CategoryController } from '../controllers/CategoryController.ts';
import { CreditCardController } from '../controllers/CreditCardController.ts';
import { GoalController } from '../controllers/GoalController.ts';
import { IntegrityController } from '../controllers/IntegrityController.ts';
import { InvoiceController } from '../controllers/InvoiceController.ts';
import { NoteController } from '../controllers/NoteController.ts';
import type { CoreResult, UnexpectedErrorListener } from '../controllers/CoreResult.ts';
import { ProfileController } from '../controllers/ProfileController.ts';
import { ImportController } from '../controllers/ImportController.ts';
import type { CoreApi, CoreRoute, RouteHandlers } from '../controllers/routes.ts';
import { StatementController } from '../controllers/StatementController.ts';
import { FixedReportController } from '../controllers/FixedReportController.ts';
import { OverviewController } from '../controllers/OverviewController.ts';
import { ReportController } from '../controllers/ReportController.ts';
import { TagController } from '../controllers/TagController.ts';
import { PartnerController } from '../controllers/PartnerController.ts';
import { RecurrenceController } from '../controllers/RecurrenceController.ts';
import { TransactionController } from '../controllers/TransactionController.ts';
import { embeddedMigrations } from '../infrastructure/migrations/embedded.generated.ts';
import type { Migration } from '../infrastructure/migrations/Migration.ts';
import { MigrationRunner, type MigrationReport } from '../infrastructure/migrations/MigrationRunner.ts';
import { PreMigrationBackup } from '../infrastructure/migrations/PreMigrationBackup.ts';
import { configureConnection } from '../infrastructure/sqlite/connection.ts';
import { SqliteAccountRepository } from '../infrastructure/sqlite/SqliteAccountRepository.ts';
import { SqliteBalanceLedgerRepository } from '../infrastructure/sqlite/SqliteBalanceLedgerRepository.ts';
import { SqliteBankStatementRepository } from '../infrastructure/sqlite/SqliteBankStatementRepository.ts';
import { SqliteCategoryRepository } from '../infrastructure/sqlite/SqliteCategoryRepository.ts';
import { SqliteCreditCardRepository } from '../infrastructure/sqlite/SqliteCreditCardRepository.ts';
import { SqliteDeletionRepository } from '../infrastructure/sqlite/SqliteDeletionRepository.ts';
import { SqliteGoalRepository } from '../infrastructure/sqlite/SqliteGoalRepository.ts';
import { SqliteInvoiceRepository } from '../infrastructure/sqlite/SqliteInvoiceRepository.ts';
import { SqliteNoteRepository } from '../infrastructure/sqlite/SqliteNoteRepository.ts';
import { SqlitePartnerRepository } from '../infrastructure/sqlite/SqlitePartnerRepository.ts';
import { SqliteProfileRepository } from '../infrastructure/sqlite/SqliteProfileRepository.ts';
import { SqliteReferenceRepository } from '../infrastructure/sqlite/SqliteReferenceRepository.ts';
import { SqliteRecurrenceRepository } from '../infrastructure/sqlite/SqliteRecurrenceRepository.ts';
import { SqliteFixedReportRepository } from '../infrastructure/sqlite/SqliteFixedReportRepository.ts';
import { SqliteOverviewRepository } from '../infrastructure/sqlite/SqliteOverviewRepository.ts';
import { SqliteReportDefinitionRepository } from '../infrastructure/sqlite/SqliteReportDefinitionRepository.ts';
import { SqliteReportQueryRepository } from '../infrastructure/sqlite/SqliteReportQueryRepository.ts';
import { SqliteTagRepository } from '../infrastructure/sqlite/SqliteTagRepository.ts';
import { SqliteTransactionRepository } from '../infrastructure/sqlite/SqliteTransactionRepository.ts';
import type { BackupDirectory } from '../ports/BackupDirectory.ts';
import type { Clock } from '../ports/Clock.ts';
import type { Database } from '../ports/Database.ts';
import type { IdGenerator } from '../ports/IdGenerator.ts';
import type { WallClock } from '../ports/WallClock.ts';
import { installCapture } from '../infrastructure/sync/CaptureTriggers.ts';
import { CapturingDatabase } from '../infrastructure/sync/CapturingDatabase.ts';
import { SqliteReplicaRepository } from '../infrastructure/sqlite/SqliteReplicaRepository.ts';
import { SqliteSyncLedgerRepository } from '../infrastructure/sqlite/SqliteSyncLedgerRepository.ts';
import { SqliteSyncMemberRepository } from '../infrastructure/sqlite/SqliteSyncMemberRepository.ts';
import { BatchApplier } from '../services/sync/BatchApplier.ts';
import { ChangeExtractor } from '../services/sync/ChangeExtractor.ts';
import { SyncService } from '../services/sync/SyncService.ts';
import { SyncController } from '../controllers/SyncController.ts';
import { SyncCoordinator } from '../protocol/SyncCoordinator.ts';
import type { Discovery, KeyStore, RandomSource, SnapshotPort, Transport } from '../ports/SyncNetwork.ts';
import { SyncDevicesService, type SyncCounters, type SyncPlatformInfo } from '../services/sync/SyncDevicesService.ts';
import { BusinessRuleViolation } from '../domain/shared/errors.ts';
import { toCoreError } from '../controllers/CoreResult.ts';
import { AccountService } from '../services/account/AccountService.ts';
import { AccountBalanceService } from '../services/balance/AccountBalanceService.ts';
import { BalanceRecalculationService } from '../services/balance/BalanceRecalculationService.ts';
import { ImpactCalculator } from '../services/balance/ImpactCalculator.ts';
import { CategoryService } from '../services/category/CategoryService.ts';
import { CreditCardService } from '../services/creditCard/CreditCardService.ts';
import { CascadeDeletionService } from '../services/deletion/CascadeDeletionService.ts';
import { GoalService } from '../services/goal/GoalService.ts';
import { BalanceIntegrityService } from '../services/integrity/BalanceIntegrityService.ts';
import { InvoiceService } from '../services/invoice/InvoiceService.ts';
import { NoteService } from '../services/note/NoteService.ts';
import { OnboardingService } from '../services/onboarding/OnboardingService.ts';
import { ProfileService } from '../services/profile/ProfileService.ts';
import { StatementConsolidationService } from '../services/statement/StatementConsolidationService.ts';
import { FixedReportService } from '../services/report/FixedReportService.ts';
import { OverviewService } from '../services/overview/OverviewService.ts';
import { ReportService } from '../services/report/ReportService.ts';
import { TagService } from '../services/tag/TagService.ts';
import { PartnerService } from '../services/partner/PartnerService.ts';
import { ImportService } from '../services/import/ImportService.ts';
import { RecurrenceService } from '../services/recurrence/RecurrenceService.ts';
import { SeriesPlanner } from '../services/recurrence/SeriesPlanner.ts';
import { TransactionComposer } from '../services/transaction/TransactionComposer.ts';
import { TransactionService } from '../services/transaction/TransactionService.ts';
import { UnitOfWork } from '../services/UnitOfWork.ts';

/** Adaptadores que cada plataforma fornece ao núcleo (backend-design §3.4). */
export interface CorePorts {
    readonly database: Database;
    readonly clock: Clock;
    readonly ids: IdGenerator;
    /**
     * Relógio de parede em milissegundos. Com ele, o núcleo instala a captura das escritas e
     * monta a sincronização (sync-design §5.4); sem ele — ferramentas, benchmarks — a
     * sincronização fica indisponível e nada é capturado.
     */
    readonly wallClock?: WallClock;
    /** Rede da sincronização; só faz efeito junto com `wallClock`. */
    readonly syncNetwork?: SyncNetworkPorts;
    /** Log de falhas inesperadas; o padrão descarta, para quem não tem onde registrar. */
    readonly onUnexpectedError?: UnexpectedErrorListener;
}

/**
 * Adaptadores de rede da sincronização (mobile-shell-design §5.1). Sem eles o núcleo ainda
 * captura e aplica lotes (os testes fazem assim), mas a tela de Dispositivos não conecta.
 */
export interface SyncNetworkPorts extends SyncPlatformInfo {
    readonly transport: Transport;
    readonly discovery: Discovery | null;
    readonly keyStore: KeyStore;
    readonly random: RandomSource;
    readonly snapshots: SnapshotPort | null;
}

/** Os Services montados, para quem compõe casos de uso no próprio processo (testes, jobs). */
export interface CoreServices {
    readonly profiles: ProfileService;
    readonly onboarding: OnboardingService;
    readonly accounts: AccountService;
    readonly creditCards: CreditCardService;
    readonly categories: CategoryService;
    readonly tags: TagService;
    readonly partners: PartnerService;
    readonly notes: NoteService;
    readonly goals: GoalService;
    readonly deletions: CascadeDeletionService;
    readonly transactions: TransactionService;
    readonly recurrences: RecurrenceService;
    readonly consolidation: StatementConsolidationService;
    readonly invoices: InvoiceService;
    readonly balances: AccountBalanceService;
    readonly recalculation: BalanceRecalculationService;
    readonly integrity: BalanceIntegrityService;
    readonly reports: ReportService;
    /** `null` quando o núcleo foi montado sem `wallClock`. */
    readonly sync: SyncService | null;
}

/** O núcleo montado. */
export interface Core extends CoreApi {
    readonly services: CoreServices;
}

/** O que a abertura do banco precisa da plataforma além da conexão. */
export interface OpenDatabaseOptions {
    /**
     * Pasta `backups/` ao lado do banco. Obrigatória, com `null` explícito para banco em
     * memória: sendo opcional, um shell que esquecesse de passá-la migraria sem cópia — e o
     * backup é o único `down` que existe (backend-design §4.6).
     */
    readonly backups: BackupDirectory | null;
    /** Instante da cópia, que entra no nome do arquivo de backup. */
    readonly clock: Clock;
    /** Migrations embutidas; parametrizável só para testar o runner. */
    readonly migrations?: readonly Migration[];
}

/**
 * Prepara o banco para uso: configuração obrigatória da conexão, backup e migrations
 * pendentes, nessa ordem (backend-design §4.5, passos 1 a 4). Fica separado de `createCore`
 * porque pode falhar de formas que a plataforma trata antes de existir UI — banco mais novo
 * que o app, backup ou migration que falhou. O passo 5, a verificação de integridade, roda
 * depois de montar o núcleo, pela rota `integrity.verifyBalances`, porque usa a rotina de
 * recálculo dos Services.
 *
 * @param database Conexão recém-aberta pelo adaptador da plataforma.
 * @param options Pasta de backups, relógio e, nos testes, as migrations.
 * @return O relatório das migrations aplicadas e do backup gravado.
 * @throws {SchemaNewerThanAppError} Quando o banco é mais novo que o app.
 * @throws {MigrationBackupError} Quando a cópia de segurança falha; nada é migrado.
 * @throws {MigrationIntegrityError} Quando uma migration deixa chave estrangeira quebrada.
 * @throws {MigrationFailedError} Quando o SQL de uma migration falha; ela é desfeita.
 */
export function openDatabase(database: Database, options: OpenDatabaseOptions): MigrationReport {
    configureConnection(database);
    const backup = options.backups === null ? null : new PreMigrationBackup(database, options.backups, options.clock);
    return new MigrationRunner(database, options.migrations ?? embeddedMigrations, backup).migrate();
}

/**
 * Raiz de composição do núcleo: o único lugar que conhece as implementações concretas.
 * Services e Controllers dependem de interfaces de Repository e de portas, e só aqui elas
 * são ligadas ao SQLite e aos adaptadores da plataforma — trocar o driver é trocar a
 * `Database` injetada, sem tocar em regra (database-design §3.3).
 *
 * @param ports Adaptadores da plataforma; o banco já precisa ter passado por `openDatabase`.
 * @return O núcleo com o despacho de rotas e os Services.
 */
export function createCore(ports: CorePorts): Core {
    const { clock, ids, wallClock } = ports;
    const captured = wallClock === undefined ? null : capturing(ports.database, wallClock);
    const database = captured ?? ports.database;
    const onUnexpected = ports.onUnexpectedError ?? ((): void => undefined);
    const unitOfWork = new UnitOfWork(database);

    const profiles = new SqliteProfileRepository(database, clock);
    const accounts = new SqliteAccountRepository(database, clock);
    const creditCards = new SqliteCreditCardRepository(database, clock);
    const statements = new SqliteBankStatementRepository(database, clock);
    const invoices = new SqliteInvoiceRepository(database, clock);
    const transactions = new SqliteTransactionRepository(database, clock);
    const references = new SqliteReferenceRepository(database);
    const categories = new SqliteCategoryRepository(database, clock);
    const tags = new SqliteTagRepository(database, clock);
    const partners = new SqlitePartnerRepository(database, clock);
    const notes = new SqliteNoteRepository(database, clock);
    const goals = new SqliteGoalRepository(database, clock);
    const deletions = new SqliteDeletionRepository(database, clock);
    const ledger = new SqliteBalanceLedgerRepository(database);
    const recurrenceRepository = new SqliteRecurrenceRepository(database, clock);
    const reportDefinitions = new SqliteReportDefinitionRepository(database, clock);
    const reportQueries = new SqliteReportQueryRepository(database);
    const fixedReports = new SqliteFixedReportRepository(database);
    const overviewQueries = new SqliteOverviewRepository(database);

    const recalculation = new BalanceRecalculationService(unitOfWork, accounts, statements, invoices, ledger, clock);
    const impacts = new ImpactCalculator(invoices, creditCards);
    const consolidation = new StatementConsolidationService(unitOfWork, accounts, statements, invoices, transactions, profiles);
    const invoiceService = new InvoiceService(unitOfWork, creditCards, accounts, invoices, transactions, consolidation, impacts, recalculation);
    const composer = new TransactionComposer(profiles, accounts, creditCards, transactions, references, categories, tags, goals, consolidation, invoiceService);
    const recurrenceService = new RecurrenceService(unitOfWork, ids, clock, composer, transactions, recurrenceRepository, impacts, recalculation);
    const transactionService = new TransactionService(unitOfWork, ids, composer, accounts, transactions, consolidation, recurrenceService, impacts, recalculation, clock);
    const profileService = new ProfileService(unitOfWork, ids, profiles, accounts, creditCards);
    const accountService = new AccountService(unitOfWork, ids, profileService, accounts, statements, recalculation, goals);
    const creditCardService = new CreditCardService(unitOfWork, ids, profileService, accountService, creditCards, invoices, recalculation, ledger, clock);
    const categoryService = new CategoryService(unitOfWork, ids, profileService, categories);
    const tagService = new TagService(unitOfWork, ids, profileService, tags);
    const partnerService = new PartnerService(unitOfWork, ids, profileService, partners);
    const noteService = new NoteService(unitOfWork, ids, profileService, notes);
    const goalService = new GoalService(unitOfWork, ids, clock, profileService, goals, transactions, accounts, statements);
    const onboardingService = new OnboardingService(unitOfWork, profileService, accountService, categoryService);
    const cascadeDeletion = new CascadeDeletionService(unitOfWork, deletions, accounts, creditCards, invoices, transactions, recalculation);
    const balances = new AccountBalanceService(unitOfWork, profiles, accounts, recalculation);
    const reportService = new ReportService(unitOfWork, ids, profileService, reportDefinitions, reportQueries);
    const fixedReportService = new FixedReportService(unitOfWork, clock, profileService, partners, transactions, fixedReports, balances);
    const overviewService = new OverviewService(unitOfWork, clock, profileService, overviewQueries, invoices, accounts);
    const integrity = new BalanceIntegrityService(unitOfWork, accounts, statements, invoices, recalculation, clock);
    const syncService = wallClock === undefined ? null : syncServiceOf(database, unitOfWork, ids, clock, wallClock, accounts, recurrenceRepository, transactions, recalculation);
    const importService = new ImportService(
        unitOfWork, clock, ids, composer, transactions, accounts, creditCards, invoices, categories, tags,
        accountService, creditCardService, categoryService, tagService, recurrenceService, invoiceService, impacts, recalculation,
    );

    const syncController = syncControllerOf(syncService, captured, wallClock, ports.syncNetwork, onUnexpected);
    const transactionController = new TransactionController(transactionService, onUnexpected);
    const recurrenceController = new RecurrenceController(recurrenceService, new SeriesPlanner(unitOfWork, transactionService, composer, transactions, recurrenceRepository), onUnexpected);
    const statementController = new StatementController(consolidation, balances, onUnexpected);
    const invoiceController = new InvoiceController(invoiceService, onUnexpected);
    const integrityController = new IntegrityController(integrity, onUnexpected);
    const profileController = new ProfileController(profileService, onboardingService, onUnexpected);
    const accountController = new AccountController(accountService, cascadeDeletion, onUnexpected);
    const creditCardController = new CreditCardController(creditCardService, cascadeDeletion, onUnexpected);
    const categoryController = new CategoryController(categoryService, onUnexpected);
    const tagController = new TagController(tagService, onUnexpected);
    const partnerController = new PartnerController(partnerService, onUnexpected);
    const noteController = new NoteController(noteService, onUnexpected);
    const reportController = new ReportController(reportService, onUnexpected);
    const fixedReportController = new FixedReportController(fixedReportService, onUnexpected);
    const overviewController = new OverviewController(overviewService, onUnexpected);
    const goalController = new GoalController(goalService, onUnexpected);
    const importController = new ImportController(importService, onUnexpected);

    const handlers: RouteHandlers = {
        'profiles.list': (raw) => profileController.list(raw),
        'profiles.create': (raw) => profileController.create(raw),
        'profiles.update': (raw) => profileController.update(raw),
        'profiles.setDefaultAccount': (raw) => profileController.setDefaultAccount(raw),
        'profiles.setDefaultCreditCard': (raw) => profileController.setDefaultCreditCard(raw),
        'onboarding.start': (raw) => profileController.startOnboarding(raw),
        'accounts.list': (raw) => accountController.list(raw),
        'accounts.transferTargets': (raw) => accountController.transferTargets(raw),
        'accounts.create': (raw) => accountController.create(raw),
        'accounts.update': (raw) => accountController.update(raw),
        'accounts.disable': (raw) => accountController.disable(raw),
        'accounts.enable': (raw) => accountController.enable(raw),
        'accounts.deletionImpact': (raw) => accountController.deletionImpact(raw),
        'accounts.delete': (raw) => accountController.delete(raw),
        'creditCards.list': (raw) => creditCardController.list(raw),
        'creditCards.create': (raw) => creditCardController.create(raw),
        'creditCards.update': (raw) => creditCardController.update(raw),
        'creditCards.disable': (raw) => creditCardController.disable(raw),
        'creditCards.enable': (raw) => creditCardController.enable(raw),
        'creditCards.deletionImpact': (raw) => creditCardController.deletionImpact(raw),
        'creditCards.delete': (raw) => creditCardController.delete(raw),
        'categories.tree': (raw) => categoryController.tree(raw),
        'categories.create': (raw) => categoryController.createCategory(raw),
        'categories.update': (raw) => categoryController.renameCategory(raw),
        'categories.delete': (raw) => categoryController.deleteCategory(raw),
        'subCategories.create': (raw) => categoryController.createSubCategory(raw),
        'subCategories.update': (raw) => categoryController.renameSubCategory(raw),
        'subCategories.delete': (raw) => categoryController.deleteSubCategory(raw),
        'tags.list': (raw) => tagController.list(raw),
        'tags.create': (raw) => tagController.create(raw),
        'tags.update': (raw) => tagController.rename(raw),
        'tags.delete': (raw) => tagController.delete(raw),
        'partners.list': (raw) => partnerController.list(raw),
        'partners.save': (raw) => partnerController.save(raw),
        'notes.list': (raw) => noteController.list(raw),
        'notes.create': (raw) => noteController.create(raw),
        'notes.update': (raw) => noteController.rewrite(raw),
        'notes.delete': (raw) => noteController.delete(raw),
        'goals.list': (raw) => goalController.list(raw),
        'goals.options': (raw) => goalController.options(raw),
        'goals.contributions': (raw) => goalController.contributions(raw),
        'goals.create': (raw) => goalController.create(raw),
        'goals.update': (raw) => goalController.update(raw),
        'goals.archive': (raw) => goalController.archive(raw),
        'goals.unarchive': (raw) => goalController.unarchive(raw),
        'goals.delete': (raw) => goalController.delete(raw),
        'transactions.create': (raw) => transactionController.create(raw),
        'transactions.update': (raw) => transactionController.update(raw),
        'transactions.delete': (raw) => transactionController.delete(raw),
        'transactions.get': (raw) => transactionController.get(raw),
        'transactions.listByPeriod': (raw) => transactionController.listByPeriod(raw),
        'transactions.nameSuggestions': (raw) => transactionController.nameSuggestions(raw),
        'transactions.setPaid': (raw) => transactionController.setPaid(raw),
        'transactions.setPartner': (raw) => transactionController.setPartner(raw),
        'recurrences.list': (raw) => recurrenceController.list(raw),
        'recurrences.occurrences': (raw) => recurrenceController.occurrences(raw),
        'recurrences.preview': (raw) => recurrenceController.preview(raw),
        'recurrences.planCreate': (raw) => recurrenceController.planCreate(raw),
        'recurrences.planUpdate': (raw) => recurrenceController.planUpdate(raw),
        'recurrences.planDelete': (raw) => recurrenceController.planDelete(raw),
        'recurrences.topUp': (raw) => recurrenceController.topUp(raw),
        'statements.get': (raw) => statementController.getStatement(raw),
        'statements.profileInvoices': (raw) => statementController.profileInvoices(raw),
        'balances.ofProfile': (raw) => statementController.profileBalances(raw),
        'balances.rebuildAccount': (raw) => statementController.rebuildAccount(raw),
        'invoices.suggest': (raw) => invoiceController.suggest(raw),
        'invoices.get': (raw) => invoiceController.get(raw),
        'invoices.listByCard': (raw) => invoiceController.listByCard(raw),
        'invoices.pay': (raw) => invoiceController.pay(raw),
        'invoices.reopen': (raw) => invoiceController.reopen(raw),
        'integrity.verifyBalances': (raw) => integrityController.verifyBalances(raw),
        'reports.list': (raw) => reportController.list(raw),
        'reports.get': (raw) => reportController.get(raw),
        'reports.create': (raw) => reportController.create(raw),
        'reports.update': (raw) => reportController.update(raw),
        'reports.delete': (raw) => reportController.delete(raw),
        'reports.run': (raw) => reportController.run(raw),
        'reports.preview': (raw) => reportController.preview(raw),
        'reports.byPartner': (raw) => fixedReportController.byPartner(raw),
        'reports.entriesWithoutPartner': (raw) => fixedReportController.entriesWithoutPartner(raw),
        'reports.balanceProjection': (raw) => fixedReportController.balanceProjection(raw),
        'overview.spending': (raw) => overviewController.spending(raw),
        'overview.pending': (raw) => overviewController.pending(raw),
        'overview.nextInvoices': (raw) => overviewController.nextInvoices(raw),
        'imports.run': (raw) => importController.run(raw),
        'sync.status': (raw) => syncController.status(raw),
        'sync.createGroup': (raw) => syncController.createGroup(raw),
        'sync.open': (raw) => syncController.open(raw),
        'sync.close': (raw) => syncController.close(raw),
        'sync.createInvite': (raw) => syncController.createInvite(raw),
        'sync.cancelInvite': (raw) => syncController.cancelInvite(raw),
        'sync.join': (raw) => syncController.join(raw),
        'sync.connect': (raw) => syncController.connect(raw),
        'sync.removeMember': (raw) => syncController.removeMember(raw),
        'sync.leave': (raw) => syncController.leave(raw),
    };

    return {
        services: {
            profiles: profileService,
            onboarding: onboardingService,
            accounts: accountService,
            creditCards: creditCardService,
            categories: categoryService,
            tags: tagService,
            partners: partnerService,
            notes: noteService,
            goals: goalService,
            deletions: cascadeDeletion,
            transactions: transactionService,
            recurrences: recurrenceService,
            consolidation,
            invoices: invoiceService,
            balances,
            recalculation,
            integrity,
            reports: reportService,
            sync: syncService,
        },
        call: (route, input) => handlers[route](input),
        dispatch: (route, input): Promise<CoreResult<unknown>> => {
            if (!isRoute(route, handlers)) {
                return Promise.resolve({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Rota desconhecida', details: { field: 'route', reason: route } } });
            }
            return handlers[route](input);
        },
    };
}

/**
 * Instala a captura na conexão e a embrulha no decorator que carimba (sync-plan §3.1). A
 * captura nasce ligada só se o aparelho já pertence a um grupo; criar ou entrar num grupo a
 * liga depois. Roda depois de `openDatabase`, para que as migrations fiquem fora dela.
 *
 * @param database Conexão já migrada.
 * @param wallClock Relógio de parede do HLC.
 * @return A porta decorada, que todo Repository passa a usar.
 */
function capturing(database: Database, wallClock: WallClock): CapturingDatabase {
    installCapture(database, new SqliteSyncLedgerRepository(database).findState() !== null);
    return new CapturingDatabase(database, wallClock);
}

/**
 * Monta as rotas da tela de Dispositivos. Sem `wallClock` não há sincronização nenhuma, e
 * toda rota responde `sync-unavailable`; sem a rede, o estado responde, mas conectar não.
 *
 * @param sync Service da sincronização, ou `null`.
 * @param captured Porta decorada, cujo commit dispara o modo ao vivo.
 * @param wallClock Relógio de parede.
 * @param network Adaptadores de rede da plataforma.
 * @param onUnexpected Log de falha inesperada.
 * @return As rotas, ou um substituto que recusa todas.
 */
function syncControllerOf(
    sync: SyncService | null,
    captured: CapturingDatabase | null,
    wallClock: WallClock | undefined,
    network: SyncNetworkPorts | undefined,
    onUnexpected: (error: unknown) => void,
): Pick<SyncController, 'status' | 'createGroup' | 'open' | 'close' | 'createInvite' | 'cancelInvite' | 'join' | 'connect' | 'removeMember' | 'leave'> {
    if (sync === null || captured === null || wallClock === undefined) {
        const unavailable = (): Promise<CoreResult<never>> => Promise.resolve({
            ok: false,
            error: toCoreError(new BusinessRuleViolation('sync-unavailable', 'núcleo montado sem wallClock'), onUnexpected),
        });
        return { status: unavailable, createGroup: unavailable, open: unavailable, close: unavailable, createInvite: unavailable, cancelInvite: unavailable, join: unavailable, connect: unavailable, removeMember: unavailable, leave: unavailable };
    }
    const counters: SyncCounters = { appliedBatches: 0, revivedRows: 0 };
    const coordinator = network === undefined ? null : new SyncCoordinator(sync, { ...network, wallClock }, {
        changed: () => undefined,
        applied: (report) => {
            counters.appliedBatches++;
            counters.revivedRows += report.revived.length;
        },
    });
    if (coordinator !== null) {
        captured.onCommit(() => {
            coordinator.notifyLocalChange();
        });
    }
    const platform: SyncPlatformInfo = network ?? { platform: 'desktop', localAddresses: () => [] };
    return new SyncController(new SyncDevicesService(sync, coordinator, platform, counters), onUnexpected);
}

/**
 * Monta os Services da sincronização sobre a porta decorada.
 *
 * @param database Porta com captura.
 * @param unitOfWork Unidade de trabalho do núcleo.
 * @param ids Gerador de ids.
 * @param clock Relógio do schema.
 * @param wallClock Relógio de parede.
 * @param accounts Repository de contas.
 * @param recurrences Repository de recorrências.
 * @param transactions Repository de lançamentos.
 * @param recalculation Recálculo de saldos.
 * @return O Service da sincronização.
 */
function syncServiceOf(
    database: Database,
    unitOfWork: UnitOfWork,
    ids: IdGenerator,
    clock: Clock,
    wallClock: WallClock,
    accounts: SqliteAccountRepository,
    recurrences: SqliteRecurrenceRepository,
    transactions: SqliteTransactionRepository,
    recalculation: BalanceRecalculationService,
): SyncService {
    const ledger = new SqliteSyncLedgerRepository(database);
    const replica = new SqliteReplicaRepository(database);
    const applier = new BatchApplier(unitOfWork, ledger, replica, accounts, recurrences, transactions, recalculation, clock, wallClock);
    return new SyncService(unitOfWork, ids, wallClock, ledger, new SqliteSyncMemberRepository(database, clock), new ChangeExtractor(ledger, replica), applier);
}

/**
 * @param route Nome recebido do transporte.
 * @param handlers Tabela de rotas conhecidas.
 * @return `true` quando o nome é uma rota do mapa; estreita o tipo para indexar a tabela
 * sem cast.
 */
function isRoute(route: string, handlers: RouteHandlers): route is CoreRoute {
    return Object.hasOwn(handlers, route);
}
