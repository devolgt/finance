# Glossário

Termos do domínio e da arquitetura, com o identificador correspondente no código quando há um. As páginas da wiki usam estes termos no sentido definido aqui.

## A

- **Abertura do banco** (`openDatabase`): configura a conexão, faz o backup e aplica as migrations antes de montar o núcleo.
- **Acerto** (`PartnerSettlement`): transferência sugerida entre sócios para igualar os aportes à participação.
- **Adaptador** (`BetterSqliteDatabase`, `ExpoSqliteDatabase`): implementação fina e sem regra de uma porta para uma plataforma.
- **Agendamento pós-frame** (`afterFrame`): adia a chamada ao núcleo para depois do frame corrente, para o toque ser desenhado antes de a thread bloquear.
- **Análise** (`analysis`): opção do formato que acrescenta o resultado (entradas − saídas) ou a variação mês a mês.
- **Análise da importação** (`analyzeImport`): função pura que planeja avulsos, séries e problemas, usada na prévia e na gravação.
- **Anotação** (`Note`): texto livre do perfil, sem vínculo; a primeira linha é o título.
- **Aparelho / dispositivo** (`DeviceId`): uma instalação do app com id UUID v4 e par de chaves próprios; é membro de no máximo um grupo.
- **APK distribuído** (`pnpm dist:mobile`): APK de release assinado com a chave do usuário, instalado diretamente.
- **Aporte**: receita de perfil empresarial ou transferência vinda de outro perfil para ele, com o sócio que pôs o dinheiro.
- **App de contrato** (`apps/mobile-contract`): app de teste que roda no Hermes a suíte da porta `Database` e os vetores de ouro.
- **Arco exclusivo**: par de chaves estrangeiras anuláveis em que exatamente uma é preenchida (`bank_statement_id`/`invoice_id`), garantido na aplicação.
- **Arredondamento meio para longe do zero** (`roundHalfAwayFromZero`): `2,345 → 2,35`, `-2,345 → -2,35`, sobre a representação decimal mais curta.
- **Atrasado** (`PendingSummary.overdue`): item em aberto que venceu antes de hoje.
- **Avulsa** (`single`): transação sem `recurrence_id`; grupo próprio na dimensão de recorrência.

## B

- **Backfill de ativação** (`SyncLedgerRepository.backfill`): entrada em `sync_rows` para toda linha existente ao criar o grupo.
- **Backup antes de migrar** (`PreMigrationBackup`): cópia `VACUUM INTO` em `backups/pre-v{N}-{data}-{hora}.sqlite`, três mais recentes.
- **Banco de dez anos** (`pnpm db:history`): banco determinístico de referência para a medição.
- **Banco de histórico** (`pnpm db:history`): banco reproduzível de dez anos usado na medição de desempenho.
- **Banco mais novo que o app** (`SchemaNewerThanAppError`): `user_version` acima da última migration conhecida; o app não abre.
- **Base de data** (`ReportDateBasis`): data que decide o mês no relatório personalizado — `payment`, `due` ou `created`.
- **Base do ritmo** (`paceBase`): guardado no fim do mês de referência (`past`, `current` ou `estimated`), de onde ritmo e projeção partem.

## C

- **Cadastro de sócios** (`partners.save`, `ReplacePartnersCommand`): gravação da lista inteira de sócios numa transação.
- **Camada headless** (`packages/client`): hooks, view-models, formulários, formatadores e abertura compartilhados pelos dois apps.
- **Captura** (`installCapture`, `CapturingDatabase`): triggers `TEMP` que marcam células sujas e o decorator que as carimba com sequência e HLC antes do commit.
- **Cartão de crédito** (`CreditCard`): cartão quitado por uma conta pagadora do mesmo perfil.
- **Catálogo de sincronização** (`SyncCatalog`, `SYNCED_TABLES`, `LOCAL_TABLES`): classificação explícita de cada tabela, caches, colunas por máximo e chaves naturais.
- **Categoria** (`Category`): nível superior da classificação, do perfil; não classifica transações diretamente.
- **Categorias sugeridas** (`SUGGESTED_CATEGORIES`): árvore inicial criada no primeiro uso do perfil.
- **Célula**: uma coluna de uma linha; a unidade de merge da sincronização.
- **Chave natural** (`NaturalKey`): unicidade entre linhas vivas que duas réplicas podem violar ao mesclar; resolvida por `merge` ou `unlink`.
- **Ciclo de faturamento** (`BillingCycle`): dias de fechamento e de vencimento do cartão, com ajuste para o último dia do mês.
- **Ciclo de vida do app** (`AppLifecycle`, `useAppForeground`): ponto único que escuta o `AppState` e liga ou desliga a sincronização.
- **Client** (`@finance/client`): camada de apresentação headless compartilhada pelos dois shells: `CoreClient`, hooks, view-models, formulários e formatadores.
- **Cobertura** (`PartnerCoverage`): aporte de cada sócio para cobrir o saldo previsto negativo do mês.
- **Código de erro** (`ErrorCode`): conjunto fechado de códigos de falha que atravessam a fronteira.
- **Colisão `merge` / `unlink`** (`CollisionStrategy`): perdedora com soft delete e filhos redirecionados / perdedora com as colunas da chave limpas e viva.
- **Colisão de nome** (`NaturalKey`, estratégia `merge`): dois cadastros vivos com o mesmo nome após sincronizar; sobrevive o de menor id.
- **Coluna derivada** (`derived`): cache de saldo que não trafega e é recalculado após a aplicação.
- **Comparador de dinheiro** (`toEqualMoney`): matcher Vitest que compara com o epsilon da moeda.
- **Competência** (`Invoice.period`): mês da fatura, aquele em que ela fecha.
- **Complemento** (`recurrences.topUp`): emissão das ocorrências que faltam até o horizonte de 12 meses, série a série.
- **Considerar no saldo** (`considerBalance`): liga ou desliga a entrada da conta no total do perfil.
- **Consolidado** (`BalancePair.consolidated`): saldo do que já aconteceu (transações pagas e faturas pagas).
- **Consolidado / previsto** (`BalancePair`): saldo do que já aconteceu / do que vai acontecer se nada mudar.
- **Conta** (`Account`): conta corrente (`checking`) ou de investimentos (`investment`) de um perfil.
- **Conta padrão / cartão padrão** (`defaultAccountId`, `defaultCreditCardId`): origem que o atalho "Débito / Crédito" escolhe no lançamento novo.
- **Contêiner** (`TransactionContainer`): extrato ou fatura em que a transação cai, exatamente um.
- **Contêiner mensal** (`bank_statements`, `invoices`): extrato da conta ou fatura do cartão de um mês, ao qual toda transação pertence.
- **Contribuição** (`GoalContribution`): vínculo que já conta no progresso, com o dia em que o dinheiro se moveu.
- **Convite** (`InvitePayload`, `encodeInvite`): grupo, anfitrião, chave, endereços, porta, segredo de 128 bits e validade, em base32 com prefixo `FINANCAS1:`.
- **Coordenador** (`SyncCoordinator`): dono do listener, do anúncio, da busca, das sessões e do convite enquanto a tela de Dispositivos está aberta.
- **Cópia do banco** (`copyDatabaseTo`, `inspectDatabaseCopy`): arquivo gerado por `VACUUM INTO` para exportar, e conferido antes de importar.
- **CoreCallError** (`CoreCallError`): exceção do lado da UI que carrega o `CoreError` para o TanStack Query.
- **CoreClient** (`CoreClient`): interface pela qual a UI chama o núcleo; `IpcCoreClient` no desktop, `DirectCoreClient` no celular e nos testes.
- **CoreResult** (`CoreResult`): resultado de uma rota, `{ ok: true, data }` ou `{ ok: false, error }`; erro esperado nunca é exceção.

## D

- **Data de caixa** (`Transaction.cashDate`): data de pagamento, ou o vencimento enquanto em aberto. Decide o extrato da transação de conta.
- **Data local** (`LocalDate`): data de calendário sem fuso, `YYYY-MM-DD`.
- **Desativação** (`disabled_at`): conta ou cartão fora das escolhas de lançamentos novos, mas presente em saldos e relatórios.
- **Desativar** (`disabled_at`): tira a conta ou o cartão das escolhas novas sem apagar nem mudar saldo.
- **Deslocamento de fatura** (`invoice_offset`): meses entre a fatura escolhida e a sugerida, numa série de cartão.
- **Devcontainer**: ambiente de desenvolvimento em Docker com Node, pnpm e toolchain Android, sem nada instalado no host.
- **Development build** (`expo-dev-client`): build do app com o cliente de desenvolvimento do Expo, que carrega módulos nativos fora do Expo Go.
- **Dia âncora** (`anchor_day`): dia do mês ou da semana que a série procura. Num mês curto, vale o último dia.
- **Dimensão** (`ReportDimension`): critério de agrupamento (mês, tipo, categoria, subcategoria, origem, tag, sócio, situação, recorrência, entrada ou saída).
- **Dinheiro** (`Money`): Value Object imutável de valor + moeda, com arredondamento, epsilon e divisão.
- **DirectCoreClient** (`DirectCoreClient`): implementação do `CoreClient` que chama o núcleo no mesmo runtime; usada no celular e nos testes.

## E

- **Efeito na origem / no destino** (`originEffect`, `destinationEffect`): quanto a transação soma ao saldo de cada lado.
- **Encargos** (`charges`): juros e tarifas, sempre custo da origem.
- **Ensaio** (`UnitOfWork.rehearse`): executa uma operação numa transação desfeita para ver o resultado sem gravar.
- **Entrada ou saída** (`flow`): dimensão que separa cada transação em movimentos por conta do perfil, pelo efeito no saldo.
- **Epsilon monetário**: meia unidade mínima da moeda, tolerância de toda comparação de dinheiro.
- **Erro de domínio** (`DomainError`): falha prevista que vira código (`ErrorCode`); o resto é bug e vira `INTERNAL`.
- **Escopo** (`EditScope`): "somente esta" (`single`), "esta e as futuras" (`future`) ou "todas" (`all`).
- **Escopo da exclusão** (`DeletionScope`): conjunto único que o alerta conta e que a exclusão apaga.
- **Estimado** (`estimated`): média mensal dos avulsos pagos nos meses fechados da janela.
- **Estorno**: lançamento de valor negativo, que inverte o efeito do tipo.
- **Exclusão em cadeia** (`CascadeDeletionService`): soft delete de uma conta ou cartão e de tudo que depende dele.
- **Extrato** (`BankStatement`): contêiner mensal da conta, uma linha por mês, com quatro saldos em cache.

## F

- **Faixa** (`low`/`high`): cenário pessimista e otimista, saldo ∓ σ√t.
- **Falha fatal** (`FailFastCoreClient`, `FailureGate`): no desktop, erro desconhecido que troca o app pela tela de erro.
- **Fatura** (`Invoice`): contêiner mensal do cartão, paga ou em aberto.
- **Fatura sugerida** (`invoices.suggest`): fatura que o ciclo indica para a data da compra. A escolhida é a verdade.
- **Fechamento provável** (`closingDaySuggestion`): dia de fechamento sugerido para um cartão novo pelas datas de compra.
- **Filtro do relatório** (`ReportFilter`): intervalo de tempo, base de data e atributos da transação; lista vazia não restringe.
- **Folha inferior** (`Sheet`): painel de escolha que sobe do rodapé do celular, sobre o `Modal`.
- **Formato do relatório** (`ReportLayout`): tabela, barras, linha ou pizza, com dimensão principal, secundária opcional, medida e análise.
- **Fronteira de lint**: regra do `eslint.config.js` que proíbe imports ou APIs numa pasta para manter a arquitetura verificável.

## G

- **Grupo "sem"** (chave `null`): grupo das transações sem tag, sem sócio etc.
- **Grupo de sincronização** (`GroupId`): o conjunto de aparelhos que compartilham os dados; criado pelo primeiro aparelho.
- **Guardado** (`saved`): soma das contribuições pagas até hoje (mais o saldo inicial, na meta vinculada a conta).

## H

- **Hash do grupo** (`groupHash`): identificador do grupo anunciado no mDNS sem revelar o id.
- **Hermes**: motor JavaScript do React Native, onde o núcleo roda no celular; não tem Node, `crypto` nem o mesmo ICU do Chromium.
- **HLC — relógio lógico híbrido** (`HybridLogicalClock`): `{ms 13}.{contador 5}.{device_id}`, ordenável como string, que preserva causalidade com relógio de parede impreciso.
- **Horizonte** (`fixedSeriesHorizon`): 12 meses a partir de hoje, o limite até onde as fixas são gravadas.
- **Horizonte das fixas** (`fixedSeriesHorizon`): último dia que uma série fixa grava agora (12 meses à frente).

## I

- **Id determinístico** (`deriveUuid`, `APP_UUID_NAMESPACE`): UUID v5 da chave natural de extratos, faturas, vínculos de tag e ocorrências.
- **Id marcado** (`Brand`): `string` distinguida pelo compilador por entidade (`AccountId`, `InvoiceId`...).
- **Impacto** (`BalanceImpact`): faturas e contas (a partir de um mês) que uma escrita obriga a recalcular.
- **Instante** (`Timestamp`): data e hora UTC `YYYY-MM-DD HH:MM:SS`, precisão de segundo.
- **Invalidação** (`invalidatedBy`): mapa do `client` que diz quais leituras em cache uma escrita torna obsoletas.
- **IpcCoreClient** (`IpcCoreClient`): implementação do desktop do `CoreClient`, sobre `MessagePort` com número de correlação.

## J

- **Já lançado** (`scheduled`): variação do saldo previsto das contas do total num mês da projeção.
- **Janela da média** (`BalanceProjectionBasis`): 12, 6, 3 ou 1 mês fechado usado na estimativa.

## L

- **Last-writer-wins (LWW)**: regra de merge em que vence a escrita com o maior relógio, aplicada por célula.
- **Ligação de colunas** (`ColumnMapping`): qual coluna do arquivo alimenta cada campo do app.
- **Limite usado** (`limitUsed`): o que as faturas em aberto reservam do limite, sem as fixas futuras.
- **Linha normalizada** (`ImportRow`): linha do arquivo já lida pelo client, sem nada do formato.
- **Listagem única de movimentos** (`movementList`): mesma lista e mesmas ações em Transações, no extrato e na fatura.
- **Local-first**: arquitetura em que cada dispositivo guarda o conjunto completo dos dados e funciona sem rede; a sincronização é um extra, não um requisito.
- **Lote** (`SyncBatch`, `SyncBatchDto`): as mudanças que faltam a um par, agrupadas por transação de origem, com o vetor `through`.

## M

- **Maior resto** (`allocateByShares`): distribuição dos centavos de sobra às maiores frações descartadas.
- **Mapa de invalidação** (`INVALIDATIONS`): para cada rota de escrita, as leituras do cache que ela torna velhas.
- **Marca d'água** (`materialized_count`): quantas ocorrências uma recorrência já emitiu; só avança.
- **Média mensal** (`averagePerMonth`): contribuições desde o mês da 1ª até o de referência, divididas pelos meses, com mês vazio valendo zero.
- **Membro** (`SyncMember`, `sync_members`): linha replicada com nome, plataforma, chave pública, quem adicionou e `removed_at`.
- **Mensagem em claro** (`clearHello`): versão, modo e id de quem liga, enviada antes do handshake e amarrada no prólogo.
- **Mês de caixa** (`REPORT_SOURCES_CTE`, `cashDateSql`): mês em que o dinheiro se move na conta — pagamento ou vencimento em aberto na conta; extrato de pagamento ou vencimento da fatura no cartão.
- **Mês de referência** (`period`, `lastPeriod`): mês que as telas com período mostram, fixo na barra superior ou na faixa do celular.
- **Mês fixo** (`ReportPeriodAnchor` `fixed`): mês final gravado na definição, que ignora o mês de referência.
- **Mesmo nome** (`sameName`): comparação de nomes sem caixa, com normalização NFC.
- **Meta** (`Goal`): objetivo de guardar um valor-alvo, de um perfil, com data-alvo opcional; nunca de gasto.
- **Meta arquivada** (`archived`, `archived_at`): meta fora da lista padrão e das escolhas de lançamentos novos, com vínculos e progresso intactos.
- **Meta atingida** (`reached`): guardado de hoje igual ou acima do alvo.
- **Meta por lançamentos** (`kind = 1`): meta cujo progresso soma as receitas e transferências vinculadas pelo campo "Meta".
- **Meta vinculada a conta** (`kind = 2`): meta cujo progresso é o saldo consolidado de hoje de uma conta de investimento.
- **Migration**: arquivo `db/migrations/NNNN_nome.sql` que avança o `PRAGMA user_version`.
- **Migrations embutidas** (`embedded.generated.ts`): os `.sql` de `db/migrations` como strings no núcleo, geradas por `pnpm embed:migrations`.
- **Modelo** (`RecurrenceTemplate`): conteúdo que a regra copia para cada ocorrência.
- **Modelo de mapeamento** (`MappingTemplate`): ligação de colunas salva com nome nas preferências do aparelho.
- **Modo ao vivo** (`live`, `notifyLocalChange`): fase da sessão em que cada commit local é enviado imediatamente.
- **Moeda** (`Currency`): código ISO 4217 com as casas decimais da moeda.
- **Moeda do perfil** (`Profile.currency`): unidade de todo valor gravado no perfil. Fica travada depois do primeiro lançamento.
- **Mover lançamentos** (`moveTo`): subcategoria que recebe os lançamentos de uma exclusão de categoria ou subcategoria em uso.
- **Mover para outro perfil** (`profileId` em `transactions.update`): edição que leva a transação (ou a série inteira) a outro perfil.
- **Mundo de teste** (`TestWorld`): banco em memória migrado com o núcleo montado e relógio/ids controlados.

## N

- **Noise KK / IKpsk2**: padrões de handshake da sessão (chaves conhecidas dos dois lados) e do pareamento (só a do anfitrião, mais PSK).
- **Nome de cadastro** (`requireName`, `REGISTRY_NAME_MAX_LENGTH`): nome aparado de 1 a 45 caracteres.
- **Núcleo** (`@finance/core`): pacote TypeScript com toda a regra de negócio, sem Node nem plataforma, que roda igual no Electron e no Hermes.

## O

- **Ocorrência** (`transactions.occurrence`): número da transação na série. É a chave do id determinístico.
- **Orçamento interativo** (`INTERACTIVE_P95_BUDGET_MS`): p95 ≤ 50 ms das chamadas interativas no aparelho de referência.
- **Origem** (`source`): a conta do extrato ou o cartão da fatura em que a transação está.

## P

- **Pagamento parcial**: transferência de valor negativo na fatura, com a conta que pagou como destino.
- **Pai dono**: chave estrangeira `CASCADE` ou `NO ACTION`; se excluído com filho vivo, é revivido após a aplicação.
- **Participação** (`percentage`): fração do sócio no perfil, com até duas casas decimais; as do perfil somam 100%.
- **Patrimônio**: soma do consolidado de todas as contas, inclusive as fora do saldo total.
- **Pendente** (`pending`): vinculada em aberto ou paga com data futura; ainda não conta.
- **Perfil** (`Profile`): raiz do tenant. Tudo pertence a um perfil, que define a moeda e o tipo (pessoal ou empresarial).
- **Plano da série** (`SeriesPlanner`): o que uma operação de série exclui, cria e altera, obtido por ensaio desfeito.
- **Ponte** (`FinanceBridge`): lista fechada do que o renderer pode pedir ao resto do app.
- **Porta** (`Database`, `Clock`, `IdGenerator`, `WallClock`, `BackupDirectory`, `Transport`...): interface pela qual o núcleo recebe algo da plataforma.
- **Pós-aplicação** (`ApplyPass`): redirecionamento das perdedoras, corte de ocorrências além do término, revivência de pais e recálculo de saldos, na mesma transação do lote.
- **Preferências do aparelho** (`DevicePreferences`, `preferences.json`): tema, último perfil, último mês e última cópia, fora do banco.
- **Preload** (`apps/desktop/src/preload/index.ts`): script em sandbox que publica a ponte `window.finance` e guarda a ponta do canal do núcleo.
- **Previsto** (`BalancePair.projected`): saldo se nada mudar (todas as transações e as faturas em aberto no mês do vencimento).
- **Primeiro uso** (`onboarding.start`): criação do perfil, da primeira conta e das categorias sugeridas numa unidade de trabalho.
- **Problema da linha** (`ImportIssue`): motivo pelo qual uma linha não é importada.
- **Processo do núcleo** (`utilityProcess`): processo Node do desktop dono da única conexão com o banco, que atende as rotas.
- **Processo principal** (`apps/desktop/src/main`): processo Node do Electron que cria janelas e o processo do núcleo, abre diálogos e guarda as preferências, sem executar rotas.
- **Projeção** (`projectedGap`): quanto a meta fica acima ou abaixo do alvo na data-alvo, no ritmo da média.
- **Projeção de saldo** (`BalanceProjection`): saldo de hoje mais o já lançado e a estimativa dos avulsos por 12 meses.
- **Próxima fatura** (`nextInvoices`): primeira fatura em aberto com valor a pagar de cada cartão, de hoje em diante.
- **PSK do convite** (`invitePsk`): chave pré-compartilhada do `IKpsk2`, derivada do segredo e do id do grupo.

## R

- **Raiz de composição** (`createCore`, `openMobileCore`, `openCore`): o único lugar que conhece as implementações concretas e as liga às portas.
- **Raiz de composição do celular** (`openMobileCore`): único arquivo do app que conhece o núcleo e os adaptadores concretos.
- **Reabrir fatura** (`invoices.reopen`): desfaz o vínculo do pagamento com o extrato.
- **Recálculo** (`BalanceRecalculationService`): rotina única que reconstrói os saldos a partir das transações.
- **Recorrência** (`Recurrence`): regra que emite transações repetidas, parceladas (`installments`) ou fixas (`fixed`).
- **Recusa de sessão** (`SessionRefusal`): `clock`, `version`, `not-member`, `removed`, `no-invite`, `has-data`.
- **Regra de endereços locais** (`isLocalAddress`): faixas privadas, link-local, unique-local e loopback; recusa públicos e CGNAT.
- **Regra violada** (`BusinessRule`): conjunto fechado de identificadores de regras recusadas com `BUSINESS_RULE_VIOLATION`.
- **Relatório fixo** (`FixedReportService`): relatório que não se monta no editor — projeção de saldo e distribuição por sócio.
- **Relatório personalizado** (`ReportDefinition`): definição salva do perfil com nome, filtro e formato, executada a cada abertura.
- **Relógio** (`Clock`): porta com `now()` (UTC) e `today()` (data local do usuário).
- **Relógio de parede** (`WallClock`): porta de milissegundos usada só pelo HLC e pela verificação de divergência.
- **Relógio efetivo**: o relógio de uma célula em `sync_cells` ou, sem entrada lá, o da linha em `sync_rows`.
- **Renderer** (`apps/desktop/src/renderer`): a janela React, tratada como entrada não confiável.
- **Resultado do núcleo** (`CoreResult`): união `ok`/`error` devolvida por toda rota no lugar de exceções.
- **Resumo de gastos** (`SpendingSummary`): gastos de 6 meses, média, entradas e maiores categorias da Visão geral.
- **Retirada** (`goal_withdrawal`): marca da transferência vinculada que tira dinheiro da meta e desconta do progresso.
- **Ritmo necessário** (`requiredPerMonth`): quanto guardar por mês, a partir da base, para chegar ao alvo na data.
- **Rota** (`CoreRoute`): nome de uma operação do núcleo, como `'accounts.list'`, com entrada e saída tipadas em `CoreRoutes`.
- **Rota de escape** (`WorkerCoreClient`): núcleo num runtime JavaScript secundário, caso o orçamento estoure; ainda não existe.
- **Rotina de recálculo** (`BalanceRecalculationService`): única rotina que reconstrói os caches de saldo a partir das transações.

## S

- **Saldo consolidado**: o que já aconteceu — transações pagas e faturas pagas.
- **Saldo inicial** (`openingBalance`): saldo da conta antes do primeiro extrato. É dado do usuário, não cache.
- **Saldo previsto**: o que vai acontecer — todas as transações vivas e as faturas em aberto no mês do vencimento.
- **Sem sócio atribuído**: entrada sem `partner_id`; fica fora da divisão do relatório por sócio.
- **Sequência de abertura** (`openCoreSequence`): orquestração comum aos dois apps que abre, migra, monta, verifica e complementa, decidindo quando bloquear.
- **Sequência de origem** (`seq`): número da transação de escrita local no aparelho de origem; uma por transação.
- **Série importada** (`PlannedSeries`): linhas do arquivo agrupadas numa recorrência fixa ou parcelada.
- **Sessão** (`LiveSession`, `dialSession`, `acceptSession`): conexão autenticada com um par: handshake, membros, vetores, lotes e modo ao vivo.
- **Shell**: app de uma plataforma (`@finance/desktop`, `@finance/mobile`) que só tem telas e adaptadores, sem regra de negócio.
- **Sinal tipográfico** (`MINUS`): o `−` (U+2212) usado nos valores negativos, no lugar do hífen.
- **Snapshot de entrada** (`SnapshotPort`, `adoptSnapshot`): cópia do banco do anfitrião para quem entra; existe no núcleo, desligado nos apps.
- **Sobreposição** (`overlapping`): marca de que a tag é dimensão e os totais não são a soma das células.
- **Sócio** (`Partner`): pessoa com participação de 0 a 100% num perfil empresarial.
- **Soft delete** (`deleted_at`): exclusão por marcação; a linha viva tem `deleted_at IS NULL`.
- **Subcategoria** (`SubCategory`): nível inferior da classificação; toda transação aponta para uma.
- **Suíte de contrato** (`runDatabaseContract`): testes da porta `Database` que todo adaptador precisa passar, no Node e no aparelho.

## T

- **Tag** (`Tag`): etiqueta livre do perfil que cruza categorias; um lançamento pode ter várias.
- **Tela de bloqueio** (`BlockingScreen`, `StartupStatus`): tela mostrada quando a abertura do banco não termina em `ready`.
- **Teste de mesa**: cenário financeiro com resultado calculado à mão antes do código.
- **Teto monetário** (`MONEY_MAX_AMOUNT`): ±1 trilhão, limite de todo valor informado pelo usuário.
- **Tipo da meta** (`GoalFunding`): de onde vem o progresso — `transactions` (lançamentos vinculados) ou `account` (saldo de uma conta de investimento).
- **Tokens de design** (`@finance/tokens`): cores, tipografia e espaçamentos como dados, que geram o tema do desktop e o preset do NativeWind.
- **Transação** (`Transaction`): lançamento de receita, despesa, transferência ou investimento num extrato ou numa fatura.
- **Transferência entre perfis**: transferência cuja conta de destino é de outro perfil da mesma moeda. No destino, é só leitura.
- **Trava das migrations** (`checksums.lock`): hashes SHA-256 das migrations publicadas, que impedem editá-las.
- **`through`**: vetor de quem envia um lote; o que o receptor passa a possuir ao aplicá-lo inteiro.

## U

- **Unidade de trabalho** (`UnitOfWork`): transação reentrante que engloba um caso de uso inteiro; `runAlone` e `rehearse` são as variantes isolada e sempre desfeita.
- **Uso da tag** (`TagWithUsage`): contagem, total em módulo sem encargos e último vencimento dos lançamentos marcados.
- **utilityProcess**: processo do Electron que, no desktop, roda o núcleo e é dono da única conexão com o banco.

## V

- **Valor a pagar** (`amountDue`): total da fatura em módulo. Uma fatura credora conta zero.
- **Verificação de integridade** (`integrity.verifyBalances`): conferência, na abertura, dos saldos em cache contra o recálculo, sem corrigir.
- **Vetor de versões** (`VersionVector`, `sync_vector`): por origem, a maior sequência possuída; prefixo-completo.
- **Vetores de ouro** (`golden`): valores calculados no Node e recalculados no Hermes para provar que o núcleo e o `client` dão o mesmo resultado nos dois runtimes.
- **View-model** (`packages/client/src/viewModels`): função pura que transforma um DTO no que a tela mostra.
- **Vínculo da meta** (`transactions.goal_id`, `GoalLink`): ligação de um lançamento (ou de um mês do extrato, na meta vinculada a conta) com a meta.
- **Visualização da lista** (`GoalListView`, `RegistryListView`): filtro da lista lateral — ativas/atingidas/arquivadas em Metas, ativos/desativados em Contas e Cartões.
