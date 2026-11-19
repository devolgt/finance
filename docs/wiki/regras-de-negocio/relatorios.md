# Relatórios

Esta página reúne as regras de negócio dos relatórios: o critério de "mês de caixa" que vários
números do app compartilham, os relatórios personalizados (definição salva com filtro e formato),
os dois relatórios fixos (distribuição por sócio e projeção de saldo) e como as perguntas dos
antigos relatórios fixos (por categoria, impacto do cartão, fluxo por conta, por tag) se respondem
hoje. Os identificadores de regra (`F1`, `A4`, `L8`, `P6`, `B5`...) são citados no código e
ficam estáveis.

Os relatórios existem só no desktop; o celular não tem a página de Relatórios (ver
[Limitações conhecidas](#12-limitações-conhecidas)).

## 1. Peças e responsabilidades

### 1.1 Personalizados e fixos

A página de Relatórios tem dois tipos de relatório:

- **Personalizados:** definições salvas pelo usuário, com nome, filtro e formato (§3 a §6). Uma
  tela por pergunta foi trocada por um editor em que o usuário monta a pergunta — ver
  [decisões](../decisoes.md), [ADR 82](../decisoes.md#adr-82).
- **Fixos:** os que o editor não expressa, porque não são "filtro + agrupamento". Ficam no topo
  da lista: a **projeção de saldo** (todo perfil, §8) e a **distribuição por sócio** (só perfil
  empresarial, §7).

A agregação fica no SQL, num Repository só de leitura, e a regra de negócio (ordem, totais,
divisão, projeção) fica no domínio, em funções puras — o mesmo princípio do resto do núcleo (ver
[Core](../arquitetura/core.md)).

### 1.2 Onde mora cada peça

| Peça | Arquivo | Papel |
|---|---|---|
| Definição | [`ReportDefinition.ts`](../../../packages/core/src/domain/report/ReportDefinition.ts) | Entidade do perfil: nome, filtro e formato, com os invariantes da linha |
| Filtro | [`ReportFilter.ts`](../../../packages/core/src/domain/report/ReportFilter.ts) | Value Object; dá a janela de meses (`windowFor`) |
| Formato | [`ReportLayout.ts`](../../../packages/core/src/domain/report/ReportLayout.ts) | Value Object; formatos, dimensões e medida |
| Montagem | [`ReportResult.ts`](../../../packages/core/src/domain/report/ReportResult.ts) | `buildReportResult`: ordena, completa os meses vazios e põe os totais |
| Contrato | [`reportRequests.ts`](../../../packages/core/src/requests/reportRequests.ts), [`dto/reports/`](../../../packages/core/src/dto/reports) | Entrada validada (o mesmo schema lê o JSON gravado) e saída serializável |
| Gravação | [`SqliteReportDefinitionRepository.ts`](../../../packages/core/src/infrastructure/sqlite/SqliteReportDefinitionRepository.ts) | Tabela `report_definitions`, definição em JSON |
| Consulta | [`SqliteReportQueryRepository.ts`](../../../packages/core/src/infrastructure/sqlite/SqliteReportQueryRepository.ts) | Monta o SQL a partir de listas fechadas de filtros e dimensões |
| Orquestração | [`ReportService.ts`](../../../packages/core/src/services/report/ReportService.ts) | Cadastro, posse das referências e execução |
| Fixos | [`FixedReportService.ts`](../../../packages/core/src/services/report/FixedReportService.ts), [`PartnerReport.ts`](../../../packages/core/src/domain/report/PartnerReport.ts), [`BalanceProjection.ts`](../../../packages/core/src/domain/report/BalanceProjection.ts), [`SqliteFixedReportRepository.ts`](../../../packages/core/src/infrastructure/sqlite/SqliteFixedReportRepository.ts) | Distribuição por sócio e projeção de saldo |
| Mês de caixa em SQL | [`periodSql.ts`](../../../packages/core/src/infrastructure/sqlite/periodSql.ts) | `REPORT_SOURCES_CTE`, `PARTNER_ENTRIES_CTE`, `invoiceDueKeySql`, `cashDateSql` |
| Telas | [`packages/client/src/viewModels/`](../../../packages/client/src/viewModels) (`reportEditor`, `reportView`, `partnerReport`, `balanceProjection`) e [`apps/desktop/src/renderer/src/reports/`](../../../apps/desktop/src/renderer/src/reports) | Rascunho do editor, tabela e gráfico, telas dos fixos |

Controllers: [`ReportController.ts`](../../../packages/core/src/controllers/ReportController.ts)
(personalizados) e [`FixedReportController.ts`](../../../packages/core/src/controllers/FixedReportController.ts)
(fixos).

## 2. Mês de caixa (regra-mestra)

### 2.1 A regra

Regra de negócio (Relatórios): **quando um número responde "quanto dinheiro saiu ou entrou no
mês", ele conta no mês em que o dinheiro de fato se move na conta** — o regime de caixa —, e não
no mês da compra.

| Situação | Mês em que conta |
|---|---|
| Transação de conta paga | Mês do `payment_date` (é o mês do extrato em que ela está) |
| Transação de conta em aberto | Mês do `due_date` — a data prevista do pagamento |
| Compra no cartão com fatura paga | Mês do **extrato em que a fatura foi paga** (`invoices.bank_statement_id`), não o da compra |
| Compra no cartão com fatura em aberto | Mês do **vencimento da fatura** |

É a mesma regra que posiciona os valores nos extratos: a transação de conta cai no extrato do mês
da data de caixa (`Transaction.cashDate`, `cashDateSql`), e a fatura em aberto pesa no previsto do
mês do vencimento (ver [Cartões e faturas](cartoes-e-faturas.md)). Ler o extrato, em vez de repetir
a regra das datas, garante que relatório e extrato nunca discordem sobre em que mês um valor pesa.
Pagar ou reabrir uma fatura muda o mês das compras dela, e isso é o esperado.

Em SQL, a regra está em `REPORT_SOURCES_CTE` ([`periodSql.ts`](../../../packages/core/src/infrastructure/sqlite/periodSql.ts)):
`report_invoices` dá o mês de pagamento de cada fatura (extrato de pagamento, ou o mês de
vencimento por `invoiceDueKeySql`) e `report_transactions` aplica o critério a cada transação.
As CTEs filtram o perfil, o soft delete de toda tabela envolvida e o arco exclusivo íntegro
(extrato **ou** fatura). Uma fatura cujo extrato de pagamento foi excluído volta a contar como em
aberto, como no saldo. O mês de vencimento da fatura em SQL é conferido contra
`BillingCycle.dueDateOf` para todos os pares de dias em
[`periodSql.test.ts`](../../../packages/core/test/infrastructure/periodSql.test.ts).

### 2.2 Onde ela vale hoje

| Número | Critério | Onde |
|---|---|---|
| Distribuição por sócio (§7) | Regra-mestra inteira (`REPORT_SOURCES_CTE` + `PARTNER_ENTRIES_CTE`) | `SqliteFixedReportRepository.contributionTotalsByPartner` |
| Projeção de saldo (§8) | Fechamentos dos extratos; avulsos pelo mês de caixa | `closingHistories`, `nonRecurringResults` |
| Gastos e entradas da Visão geral | Regra-mestra, **exceto** a compra no cartão, que conta no mês de vencimento da fatura, paga ou não | [Visão do mês §3.1](visao-do-mes.md#31-mês-dos-gastos) |
| Progresso de meta por lançamentos | Dia do pagamento na conta; no cartão, o dia em que a fatura foi paga | `SqliteGoalRepository.selectLinks` (ver [Metas](metas.md)) |
| Relatórios personalizados (§4.1) | **Não** usam a regra-mestra: a definição escolhe a data (`payment`, `due` ou `created`) da própria transação | `SqliteReportQueryRepository` |

Nos personalizados, a base `payment` usa o `payment_date` **da própria transação**, inclusive na
compra no cartão — a data de pagamento da fatura não é usada (§4.1). Ver [decisões](../decisoes.md),
[ADR 89](../decisoes.md#adr-89).

## 3. Relatório personalizado: o modelo

### 3.1 Definição salva

Regra de negócio (Relatórios): um relatório personalizado é uma **definição salva do perfil**,
com três partes.

| Parte | O que o usuário escolhe |
|---|---|
| Nome | Como o relatório aparece na lista; 1 a 100 caracteres, único no perfil sem diferenciar maiúsculas |
| Filtro | Quais transações entram: intervalo de tempo, a data que decide o mês e qualquer atributo da transação (§4) |
| Formato | Como os dados aparecem: tabela agrupada ou gráfico (barras, linha, pizza), com o agrupamento e a medida (§5) |

A definição **não guarda resultado**: abrir o relatório roda o filtro contra as transações do
momento, então editar uma transação nunca deixa um relatório desatualizado. Excluir é soft
delete da definição; nenhuma transação é tocada.

O nome tem limite de 100 (maior que os 45 dos cadastros) porque é a pergunta que o relatório
responde ("Gastos com o carro nos últimos 12 meses"), e não um rótulo de seletor. A unicidade do
nome e a posse das referências relacionam linhas e por isso ficam no `ReportService` (`sameName`);
a entidade só garante o invariante da própria linha (ver [Core](../arquitetura/core.md)).

### 3.2 Rotas

| Rota | Entrada | Saída |
|---|---|---|
| `reports.list` | `profileId` | Definições do perfil, por nome |
| `reports.get` | `id` | A definição |
| `reports.create` | `profileId`, `name`, `filter`, `layout` | A definição criada |
| `reports.update` | `id`, `name`, `filter`, `layout` | A definição regravada |
| `reports.delete` | `id` | `null` |
| `reports.run` | `id`, `period` (mês de referência) | O resultado da definição salva |
| `reports.preview` | `profileId`, `period`, `filter`, `layout` | O resultado sem salvar, para o editor mostrar ao vivo |
| `reports.byPartner` | `profileId` (empresarial), `period` | Distribuição por sócio (§7) |
| `reports.entriesWithoutPartner` | `profileId` (empresarial), `period` | Entradas do mês sem sócio e o total (§7) |
| `reports.balanceProjection` | `profileId`, `basis` (`12` padrão, `6`, `3` ou `1`) | Projeção de saldo (§8) |

`reports.preview` aplica **as mesmas regras** da definição salva, inclusive a conferência das
referências, para que o resultado ao vivo nunca mostre algo que o salvar depois recusaria.

O resultado (`ReportResult`) traz a janela, os grupos da dimensão principal (e da secundária),
as células (soma arredondada como `MoneyResponse` e quantidade), os totais por linha, por coluna e
o geral, e a marca `overlapping` quando a tag é uma das dimensões (§5.5). Células e totais são
lidos numa unidade de trabalho só, para virem do mesmo estado do banco.

## 4. Filtro

### 4.1 Intervalo de tempo

| # | Pergunta | Regra |
|---|---|---|
| F1 | Qual é o mês final? | O **mês de referência** da barra superior (padrão), ou um **mês fixo** gravado na definição |
| F2 | Quantos meses? | O mês final **mais N meses anteriores**, N de 0 a 35 — no máximo 36 meses. N = 0 é só o mês final |
| F3 | Qual data decide o mês? | **Pagamento** (`payment_date`, padrão), **vencimento** (`due_date`) ou **lançamento** (`created_at`) |

- **F1, mês fixo × referência:** a definição com mês fixo ignora o mês de referência, para que
  "Ano de 2025" continue mostrando 2025 enquanto o usuário navega pelos meses
  (`ReportFilter.windowFor`).
- **F2, limite de 36 meses:** impede que um relatório salvo vire, sem querer, uma varredura do
  histórico inteiro a cada abertura, e mantém o gráfico de linha legível
  (`REPORT_MAX_PREVIOUS_MONTHS`).
- **F3, pagamento:** a transação **em aberto** não tem mês de pagamento e fica fora. Vale a data
  da própria transação, inclusive na compra no cartão (a data de pagamento da fatura não é usada).
  "Pago" exige `paid = 1` **e** `payment_date` preenchido, a mesma regra de `Transaction.isPaid`.
- **F3, vencimento:** é o `due_date` da transação, que na compra no cartão é a data da compra (ver
  [Transações](transacoes.md)).
- **F3, lançamento:** é o dia, **em UTC**, do `created_at` — quando o registro entrou no app; a
  transação importada conta no dia da importação. O núcleo não conhece o fuso do usuário (o
  `Clock` só dá a data de hoje), então uma transação digitada depois das 21h no horário de
  Brasília pode cair no dia seguinte e, no último dia do mês, no mês seguinte.

Implementação: `DATE_SQL` em [`SqliteReportQueryRepository.ts`](../../../packages/core/src/infrastructure/sqlite/SqliteReportQueryRepository.ts).

### 4.2 Atributos da transação

| # | Filtro | Regra |
|---|---|---|
| A1 | Tipos | Receita, despesa, transferência, investimento |
| A2 | Categorias e subcategorias | Entra a transação cuja subcategoria **ou** a categoria dessa subcategoria está escolhida |
| A3 | Contas e cartões | A **origem**: o extrato da conta ou a fatura do cartão em que a transação está; contas e cartões escolhidos se somam (OU) |
| A4 | Tags | **Qualquer uma** das escolhidas (padrão) ou **todas**; só vínculos e tags vivos contam |
| A5 | Sócios | O sócio vinculado à transação |
| A6 | Metas | A meta vinculada à transação |
| A7 | Situação | Todas (padrão), só pagas ou só em aberto |
| A8 | Valor | Mínimo e máximo, inclusivos, sobre o `value` com sinal (o estorno é negativo) |

Regra de negócio (Relatórios): **lista vazia não restringe**. Dentro de um filtro as escolhas se
somam (OU); entre filtros diferentes, todos precisam valer (E). Categoria e subcategoria são um
filtro só, como conta e cartão. Exemplo: "despesas" + "Mercado, Restaurante" + tag "viagem" =
despesas de Mercado ou Restaurante marcadas com "viagem" (`filterSql`).

O filtro de tags fica num subselect, e não numa junção, para que a transação com várias tags
continue contando uma vez quando a tag não é dimensão (`tagFilterSql`). Os valores-limite são
números, e não `Money`: o filtro não conhece a moeda, e o `value` gravado já está na moeda do
perfil. As listas perdem as repetições na criação, para que duas definições equivalentes não
pareçam diferentes na sincronização. Cada lista aceita até 500 ids (`REPORT_LIST_MAX`), para que
uma entrada malformada não monte um `IN (...)` com milhares de parâmetros.

**Perfil e transferência recebida.** Entram as transações cujo contêiner (extrato ou fatura) é
do perfil, com o soft delete conferido em toda tabela envolvida, **e a transferência que chega de
outro perfil**. Ela é uma linha do perfil de origem (ver [Transações](transacoes.md)), mas o
dinheiro entra numa conta do destino; sem ela, o relatório de transferências do destino não via o
que recebeu. No destino ela entra pela conta de destino (é a "origem" dela em A3 e na dimensão de
origem) e pelo sócio, que é do destino. A categoria, a subcategoria, as tags e a meta são do perfil
de origem: ela cai em "Sem categoria", "Sem subcategoria" e "Sem tag", e um filtro por esses
cadastros não a inclui (`INCOMING_SQL`).

**Referências conferidas ao salvar.** Toda categoria, subcategoria, conta, cartão, tag, sócio e
meta do filtro precisa existir e ser do perfil, ou a gravação é recusada com `NOT_FOUND`. Um
cadastro excluído **depois** de salvo continua na definição e **não casa com nada**; ele não é
removido em silêncio, porque um filtro "só a categoria X" que perdesse o X viraria "todas as
categorias". Por isso `reports.update` aceita os ids que a definição já tinha, mesmo mortos, e só
confere os novos — mudar o nome não exige limpar o filtro antes (`ReportService.assertReferences`).

**Contas e cartões desativados** entram normalmente: o histórico não muda.

## 5. Formato

### 5.1 Formatos e dimensões

| # | Pergunta | Regra |
|---|---|---|
| L1 | Formatos | **Tabela** (sempre agrupada), **barras**, **linha** ou **pizza** |
| L2 | Agrupamento | Uma **dimensão principal** obrigatória e uma **secundária** opcional. Na tabela, a principal são as linhas e a secundária, as colunas; no gráfico, a principal é o eixo e a secundária, as séries |
| L3 | Dimensões | Mês (pela data do F3), tipo, entrada ou saída, categoria, subcategoria, origem (conta ou cartão), tag, sócio, situação, recorrência |
| L4 | Medida | **Soma do valor** ou **quantidade de lançamentos** |
| L5 | Principal e secundária iguais | Recusado (`report-dimensions-repeated`): agrupar duas vezes pela mesma coisa só preenche a diagonal |
| L6 | Recorrência | **Fixas**, **parceladas** e **avulsas** (§5.4) |
| L7 | Pizza | Só a dimensão principal, uma fatia por grupo; com secundária, recusado (`report-pie-secondary`), porque um círculo só divide um todo |
| L8 | Entrada ou saída | Pelo efeito no saldo das contas do perfil, qualquer que seja o tipo (§5.3) |
| L9 | Análise | Campo do formato, desligado por padrão: a informação a mais que cada configuração ganha (§5.7) |

Tabela e gráfico têm a mesma forma, então trocar de um para o outro não pede outra configuração.
Cada dimensão é uma Strategy em SQL (`dimensionSql`) com a própria chave, rótulo e junção; tag,
sócio e recorrência entram por `LEFT JOIN`, para que a transação sem eles caia no grupo "sem" em
vez de sumir. O sócio precisa ser do perfil: na transferência para outro perfil ele é do destino,
e no relatório da origem a linha fica sem sócio. O SQL é montado só a partir de listas fechadas,
com todo valor variável em parâmetro nomeado. Agrupar por sócio só é oferecido em perfil
empresarial (`reportEditor`).

### 5.2 Medida e soma do valor

A **soma do valor** soma o `value` como gravado. O estorno (negativo) abate o próprio grupo, e os
**encargos ficam fora**, porque são custo do meio de pagamento e mudam de sentido conforme o tipo
(ver [Transações](transacoes.md)). Somar receitas e despesas no mesmo grupo dá o volume
movimentado, não o saldo; para ver entradas × saídas, agrupa-se por entrada ou saída (L8). A
**quantidade** conta lançamentos.

### 5.3 Entrada e saída (L8)

Com a dimensão `flow`, cada transação vira **um movimento por conta do perfil que ela toca**:

- a **origem**, quando é do perfil: a receita soma; despesa, transferência e investimento
  subtraem; o `value` negativo inverte;
- o **destino** da transferência ou do investimento, quando é do perfil: soma o `value`.

Consequências:

- A transferência entre contas do perfil conta **nos dois lados** (saída e entrada); a que vem de
  outro perfil só como entrada; a que vai para outro perfil só como saída.
- A soma passa a ser o **efeito no saldo**, com a saída negativa — também nos totais em que a
  dimensão não aparece: o total da linha e o geral são o líquido (entradas − saídas), e a
  transferência interna se anula nele (`ReportLayout.measuresFlow`).
- A quantidade conta cada transação uma vez (`COUNT(DISTINCT t.id)`).
- Na dimensão de origem, cada movimento fica com a própria conta: a chegada de uma transferência
  interna é da conta de destino.
- O filtro de conta e de cartão (A3) vale **por movimento**: filtrando a corrente, a
  transferência dela para a corretora entra só como saída, e a que chega a ela, só como entrada
  (`flowSourceSql`). Filtrar a linha inteira faria o líquido da conta deixar de ser o efeito no
  saldo dela.
- Na pizza vale o tamanho de cada lado.

### 5.4 Recorrência (L6)

A ocorrência de uma série conta como fixa ou parcelada **pelo tipo da regra** (ver
[Recorrências](recorrencias.md)), e a transação sem `recurrence_id` é **avulsa** — um grupo de
verdade (chave `single`), não um grupo "sem". A regra excluída continua valendo para a ocorrência
que ficou viva: a parcela que sobrou continua sendo parcela, assim como o nome de um cadastro
excluído continua legível (`recurrenceGroupSql`).

### 5.5 Tag como dimensão e totais

Regra de negócio (Relatórios): com a tag numa das dimensões, a transação com duas tags **conta
nas duas**. Por isso o **total geral é calculado à parte**, contando cada transação uma vez; nesse
caso ele é menor que a soma das linhas, e a tela avisa. Os totais por linha e por coluna seguem a
mesma regra. É por isso que o banco devolve as somas em quatro níveis (`ReportAggregation`: células,
totais da principal, da secundária e geral) em vez de o domínio somar as células.

### 5.6 Ordem, grupos "sem" e nomes

- **Grupo sem valor:** a transação sem tag cai em "Sem tag", sem sócio em "Sem sócio". O grupo tem
  chave `null`, e a tela dá o rótulo.
- **Ordem** (`buildReportResult`): o mês é cronológico e traz **todos os meses da janela**,
  inclusive os sem lançamento (com zero), para que o gráfico de linha não pule meses. Tipo,
  situação, recorrência e entrada × saída seguem a ordem fixa do domínio. As demais dimensões vão do
  maior para o menor na medida escolhida (valor absoluto da soma, ou quantidade), com desempate pelo
  rótulo, e o grupo "sem" vai por último. A comparação de texto é por código de caractere, sem
  `localeCompare`, porque Chromium e Hermes ordenam acentos de jeitos diferentes.
- **Nomes:** os rótulos de categoria, conta, tag etc. vêm do cadastro. Um grupo de cadastro
  excluído (com a transação ainda viva) aparece com o nome que ele tinha, que continua na linha
  excluída. Mês, tipo, situação, recorrência, entrada/saída e os grupos "sem" são rotulados pela
  tela (`reportGroupLabel`), para o texto ser o mesmo do resto do app.

### 5.7 Análise (L9)

Um campo liga/desliga do formato, gravado no JSON com padrão desligado (a definição de antes
dele lê sem análise, ainda na `version: 1`). O que ela acrescenta depende da configuração, e o
editor diz, embaixo da caixa, o que ela acrescenta no formato escolhido. Os cálculos ficam no
`client` ([`reportView.ts`](../../../packages/client/src/viewModels/reportView.ts)), a partir do
resultado do núcleo, para que qualquer tela mostre o mesmo:

- **Entrada ou saída, na soma:** o **resultado**, entradas menos saídas. Na tabela, o total dessa
  divisão passa a se chamar "Resultado"; no gráfico, é um ponto a mais no eixo ou uma série a mais;
  na pizza, uma linha a mais na legenda. Na quantidade não há resultado: a diferença entre
  quantidades não mede nada.
- **Mês numa das divisões, na tabela:** cada valor ganha o **percentual de variação** em relação
  ao mesmo grupo no mês anterior (a linha de cima, ou a coluna à esquerda), e os totais do mês
  também. A conta é `(atual − anterior) / |anterior|`: a saída (negativa) que fica mais negativa
  aparece como redução. Sem mês anterior ou com ele zerado não há percentual. A variação usa as
  cores dos tokens `in` e `out` (do + e do −), e não verde e vermelho, porque subir é bom ou ruim
  conforme o que se mede.

### 5.8 Pizza e gráficos

- **Pizza:** só grupo de soma positiva vira fatia — um negativo (estorno maior que a compra) não
  tem ângulo e deixaria as participações sem somar 100%; a tela avisa e a tabela traz todos. A
  participação é sobre a soma das fatias. Os grupos além do quarto maior viram "Outros", e as fatias
  mantêm a ordem do resultado. No editor, o campo da segunda divisão some na pizza, mas fica
  guardado no rascunho para quem volta a barras ou tabela.
- **Séries:** o gráfico desenha até cinco séries — as quatro maiores e "Outros"
  (`REPORT_CHART_MAX_SERIES`), com as cores dos tokens `accent`, `out`, `dot`, `muted` e `ink2`; a
  tabela continua com todas, e todo gráfico tem a alternância para a tabela equivalente.
- **Eixo pela chave:** o eixo é pela **chave** do grupo, e o rótulo só entra na hora de escrever:
  o Recharts junta categorias de mesmo texto, e numa janela de 13 meses os dois "jan" virariam um
  só. Pela mesma razão, o mês só perde o ano no eixo quando a janela inteira cabe num ano.

## 6. Armazenamento e sincronização

### 6.1 Tabela e JSON versionado

Tabela `report_definitions` (migration [`0007_report_definitions.sql`](../../../db/migrations/0007_report_definitions.sql)):
`id`, `profile_id`, `name` (1 a 100 caracteres), `definition` (JSON do filtro e do formato), mais
`created_at`, `updated_at` e `deleted_at`, como toda tabela (ver
[Banco de dados](../arquitetura/banco-de-dados.md)). O nome é único no perfil, sem diferenciar
maiúsculas, conferido no Service (`sameName`), como o das tags: o `NOCASE` do SQLite só dobra ASCII.

O filtro e o formato ficam numa coluna JSON com `version: 1`, lida pelo **mesmo schema zod** da
entrada da rota (`storedReportContentSchema`) e revalidada no domínio. Um JSON que não passa é
corrupção — a aplicação só grava o que validou — e vira `CorruptRowError` em vez de um relatório
que filtra outra coisa em silêncio. Uma mudança futura de formato ganha `version: 2` e uma
conversão na leitura, sem migration de dados. Ver [decisões](../decisoes.md), [ADR 83](../decisoes.md#adr-83).

### 6.2 Sincronização

A definição sincroniza como as demais tabelas (`report_definitions` em
[`SyncCatalog.ts`](../../../packages/core/src/domain/sync/SyncCatalog.ts)). A unidade de merge é a
coluna, e a definição inteira é **uma célula**: duas edições concorrentes do mesmo relatório não se
misturam campo a campo, e vence a mais recente inteira. Misturar campo a campo poderia produzir uma
combinação que nenhum dos dois montou (a dimensão de um com o filtro do outro). Detalhes do merge em
[Sincronização](../arquitetura/sincronizacao.md).

## 7. Distribuição por sócio (relatório fixo)

### 7.1 Regras

Relatório **fixo** do perfil empresarial (`reports.byPartner` e `reports.entriesWithoutPartner`).
Não se monta no editor, porque a divisão pela participação e o acerto não são um filtro com
agrupamento. No perfil pessoal a lista não o oferece, e as duas rotas recusam com
`partner-requires-business-profile` — recusar, em vez de devolver vazio, impede a tela de mostrar
"nenhum sócio" onde sócio nem existe.

Regra de negócio (Sócios — aportes): toda despesa de um perfil empresarial é paga com o dinheiro da
empresa; o que cada sócio põe na empresa é o dinheiro que **entra** vinculado a ele. O relatório
divide os **aportes**, e não as despesas — ver [decisões](../decisoes.md), [ADR 88](../decisoes.md#adr-88).

| # | Pergunta | Regra |
|---|---|---|
| P1 | Período | Os aportes de **todos os períodos** formam o total e a divisão. O mês de referência só recorta os indicadores do mês ("Aportes em out/2026", "Entradas sem sócio em out/2026") e a lista de entradas sem sócio, pelo **mês de caixa** (§2.1) |
| P2 | O que é aporte? | **Receita** do perfil empresarial e **transferência que chega a ele de outro perfil**, com sócio. A receita vale o que entrou no saldo (valor − encargos); a transferência, o valor (os encargos são da origem). Despesa, investimento e transferência entre contas do próprio perfil não são aporte |
| P3 | "Deveria ter aportado" | Total de aportes **com sócio** × participação. Ex.: Matheus (60%) e Gustavo (40%) aportaram R$ 1.000,00 cada; do total de R$ 2.000,00, Matheus deveria R$ 1.200,00 e Gustavo R$ 800,00. Entradas sem sócio ficam **fora da divisão**: a receita de serviço é lucro, não aporte. Com as participações somando 100%, a sobra do arredondamento vai para os maiores restos, e a divisão soma exatamente o total |
| P4 | Acerto | Diferença = aportou − deveria. O maior devedor paga o maior credor até zerar um dos dois — no exemplo, "Matheus transfere R$ 200,00 para Gustavo". **Sem acerto** quando as participações não somam 100%: as diferenças não fechariam em zero |
| P5 | Entradas sem sócio | As entradas do mês (P2) sem sócio vivo do perfil, com a mesma fonte das somas: a lista soma o indicador. A transferência aparece como "Transferência recebida", com a conta de origem do outro perfil |
| P6 | Saldo negativo do mês | Quando o **saldo previsto** das contas do perfil ao fim do mês de referência (com os lançamentos em aberto, para cobrir as contas a pagar antes de vencerem) fica negativo, os sócios cobrem o déficit com **aportes na empresa**, e não com transferências entre si. Novo total = aportes + déficit, dividido pela participação (P3); cada sócio aporta a parte dele menos o que já aportou. Ex.: 60% com R$ 2.438,36 e 40% com R$ 1.625,58 aportados e R$ 398,10 de déficit → aportam R$ 238,86 e R$ 159,24. Se um sócio já aportou mais que a parte dele no novo total, o total sobe até alcançá-la: ele não aporta, os outros completam a proporção e a sobra fica no caixa. A cobertura toma o lugar do acerto na tela. **Sem cobertura** quando as participações não somam 100% |

Onde mora: `buildPartnerReport`, `allocateByShares`, `settle` e `cover` em
[`PartnerReport.ts`](../../../packages/core/src/domain/report/PartnerReport.ts); somas em
`contributionTotalsByPartner` sobre `REPORT_SOURCES_CTE` + `PARTNER_ENTRIES_CTE`
([`periodSql.ts`](../../../packages/core/src/infrastructure/sqlite/periodSql.ts)); tela em
[`partnerReport.ts`](../../../packages/client/src/viewModels/partnerReport.ts).

### 7.2 Decisões de implementação

- **Onde o sócio pode ser vinculado** (`TransactionComposer.assertPartner`): só no aporte (P2).
  Em outro lançamento a gravação recusa com `partner-requires-contribution`; numa entrada de perfil
  pessoal, com `partner-requires-business-profile`. Na transferência entre perfis a linha é do
  perfil de origem, mas o sócio é do perfil **de destino**. Detalhes em [Sócios](socios.md).
- **Despesa com sócio gravada antes da regra dos aportes** fica como está: não conta como aporte,
  e editar a despesa mantém o sócio enquanto perfil e destino não mudam; só não ganha um sócio novo.
- **Sócio excluído** (soft delete) ou de outro perfil conta como sem sócio: o vínculo morto não diz
  mais quem aportou, e a lista pede para atribuir de novo.
- **Todos os sócios vivos aparecem**, mesmo sem aporte, pela participação (maior primeiro) e
  depois pelo nome.
- **Saldo previsto do mês (P6):** sai dos fechamentos dos extratos (`closingHistories` e
  `closingAt`), os mesmos da projeção de saldo (§8), para que os dois relatórios concordem sobre o
  fim do mês; mês sem extrato repete o fechamento anterior.
- **Centavos inteiros:** a divisão, o acerto e a cobertura trabalham em unidades menores, para que
  a soma das partes seja o total e o acerto zere as diferenças sem sobra. A soma das participações
  tem tolerância de `1e-9`, porque 33,33 + 33,33 + 33,34 não dá 100 exato em ponto flutuante.
- **Uma divisão só:** `allocateByShares` faz a divisão usada tanto no "Deveria ter aportado"
  quanto na cobertura do déficit, para que as duas colunas nunca discordem por um centavo. O
  cadastro de sócios não mostra valores ([sócios §4](socios.md#4-telas)).
- **Atribuir pelo relatório:** a rota `transactions.setPartner` troca só o sócio de uma transação
  — numa série, só a ocorrência —, conferindo a mesma regra de aporte. Não recalcula saldo: o sócio
  não pesa em nenhum.
- **Tela:** indicadores, tabela dos sócios, "Aportou × deveria" com o acerto (ou a cobertura) e as
  entradas sem sócio ficam empilhados no detalhe, porque ao lado da lista de relatórios a tabela e o
  gráfico lado a lado não cabem.

## 8. Projeção de saldo (relatório fixo)

### 8.1 Regras

Relatório **fixo** de todo perfil (`reports.balanceProjection`): o saldo das contas do total no fim
do mês corrente e de cada um dos 12 meses seguintes. Segue o **método direto** das projeções de
fluxo de caixa: o que já está comprometido entra pelo valor lançado, só o que ainda não existe é
estimado pelo histórico, e a estimativa vem com uma faixa de incerteza. A média simples do
resultado de todos os meses foi descartada — ver [decisões](../decisoes.md), [ADR 84](../decisoes.md#adr-84).

| # | Pergunta | Regra |
|---|---|---|
| B1 | Janela da estimativa | Os últimos **12** (padrão), **6**, **3** ou **1** mês **fechado** — o corrente fica fora, porque está pela metade. Escolhida na tela e **não gravada**. Os meses antes do primeiro extrato das contas do total não entram (o app não era usado neles); a tela avisa quando a estimativa usou menos meses que os pedidos |
| B2 | Já lançado (comprometido) | A **variação do saldo previsto** das contas do total no mês: tudo o que está lançado — parcelas, séries fixas (gravadas 12 meses à frente), contas em aberto, faturas no mês do vencimento, transferências para outros perfis e para contas fora do total. No mês corrente entra o que falta: previsto do fim do mês − consolidado do fim do mês, inclusive o que venceu e não foi pago |
| B3 | Estimado (não lançado) | A **média dos avulsos** (lançamentos sem série) **pagos** nos meses da janela, pelo efeito no saldo das contas do total e pelo mês de caixa. As séries ficam fora da média porque já estão no B2 — contá-las nos dois seria contar duas vezes. No mês corrente vale a fração dos dias que faltam |
| B4 | Partida e horizonte | Do saldo **consolidado de hoje** das contas do total (o mesmo da tela de Contas) até 12 meses depois do corrente: `saldo(k) = saldo(k−1) + já lançado(k) + estimado(k)` |
| B5 | Faixa | **Cenário pessimista e otimista** = saldo ∓ `σ × √t`, com σ o desvio-padrão **amostral** mensal dos avulsos e *t* os meses desde hoje (o corrente conta a fração que falta). Meses independentes somam variâncias, então a incerteza cresce com a raiz do horizonte, como num intervalo de previsão. Com menos de dois meses na janela não há como medir a variação e a faixa fica fechada (a tela avisa); com mais meses e avulsos iguais em todos (um perfil só de séries), σ é zero e a faixa também fecha, com um aviso próprio |

Onde mora: `projectionBasisMonths`, `buildBalanceProjection` e `closingAt` em
[`BalanceProjection.ts`](../../../packages/core/src/domain/report/BalanceProjection.ts);
`FixedReportService.balanceProjection`; tela em
[`balanceProjection.ts`](../../../packages/client/src/viewModels/balanceProjection.ts).

O desvio-padrão é amostral (divide por `n − 1`) porque a janela é uma amostra dos meses possíveis,
e com poucos meses o populacional subestimaria a incerteza.

### 8.2 Histórico e avulsos

- **Resultado do histórico pela variação do saldo:** o resultado de um mês fechado é quanto o
  consolidado das contas do total mudou nele, pelos fechamentos dos extratos
  (`SqliteFixedReportRepository.closingHistories`), a mesma cadeia que dá o saldo de partida. A
  parte dos avulsos vem de `nonRecurringResults`, e a das séries é a diferença — a tela mostra as
  duas, para que se veja por que só os avulsos formam a estimativa.
- **Mês sem extrato** repete o fechamento do extrato vivo anterior; antes do primeiro extrato vale
  o saldo inicial da conta, para que a conta aberta no meio da janela não conte o saldo inicial
  como entrada (`closingAt`).
- **Avulsos pelo mês de caixa e pelo efeito no saldo** (`nonRecurringResults`), por quatro caminhos:
  1. o lançamento de uma conta do total, no mês do extrato (a receita soma, os demais tipos
     subtraem, os encargos saem); a transferência ou o investimento para outra conta do total soma
     também no destino, e as duas pernas se anulam;
  2. a transferência que chega a uma conta do total vinda de fora dele (outro perfil, ou conta fora
     do total), que só soma;
  3. a compra no cartão, no mês em que a fatura foi paga por uma conta do total;
  4. o pagamento parcial de fatura, que sai da conta do total no mês do próprio pagamento e abate as
     compras no mês em que a fatura é paga, que entra líquida dele — sem isso ele caía nas séries.
- O mês da janela sem nenhum avulso vale zero na média, em vez de sumir dela.

### 8.3 Decisões de implementação

- **Contas do total:** só as com "considerar no saldo" ligado, desativadas incluídas — o mesmo
  recorte do saldo do perfil (ver [Contas](contas.md)). A transferência para uma conta fora do
  total é saída.
- **Sem o mês de referência:** a projeção parte de hoje (o `Clock`), e não do mês da barra, porque o
  saldo de partida é o de hoje.
- **Arredondamento:** a estimativa e os saldos são acumulados sem arredondar e arredondados só na
  saída, para que o erro não cresça a cada mês.
- **Tela:** três indicadores (saldo hoje; avulsos por mês, com a cor e o sinal de entrada ou saída;
  saldo no último mês com a faixa), as linhas do saldo projetado e dos cenários de hoje até o 12º
  mês com a alternância para a tabela (já lançado, avulsos estimados, saldo e faixa por mês) e a
  tabela dos meses da estimativa (resultado, séries e avulsos).

## 9. Perguntas dos antigos relatórios fixos

Os relatórios fixos por categoria, impacto do cartão, fluxo por conta e por tag **não existem
mais**: rotas, domínio, DTOs e telas foram removidos em favor do editor ([ADR 82](../decisoes.md#adr-82)). As
perguntas que eles respondiam se montam como relatórios personalizados. As diferenças de regra
abaixo são o que se perdeu ou mudou ao trocar a tela fixa pelo editor.

### 9.1 Por categoria

Filtro tipo **despesa**, dimensão principal **categoria** (ou subcategoria), secundária **mês**
para comparar meses; a análise (L9) dá a variação mês a mês. Diferenças: a soma não inclui os
encargos (§5.2); o mês vem da base F3 escolhida (a compra no cartão conta pela própria data, não
pela fatura); não há comparação com o mesmo mês do ano anterior nem com a média dos três meses
anteriores, nem o drill-down até os lançamentos. A Visão geral mostra as maiores categorias do mês
pela regra de caixa ([Visão do mês §3.4](visao-do-mes.md#34-maiores-categorias)).

### 9.2 Impacto do cartão

Filtro pelos **cartões** (A3), dimensão **mês** (base `due` dá a data da compra; `payment`, o
pagamento da compra) e secundária **origem** para separar os cartões. A grade de situação de cada
fatura (paga, em aberto, aberta, futura) e o "peso nas entradas" não existem como relatório; a
situação das faturas vive na tela Cartões ([Cartões e faturas](cartoes-e-faturas.md)) e a próxima
fatura de cada cartão, na Visão geral ([Visão do mês §5](visao-do-mes.md#5-próximas-faturas)).

### 9.3 Fluxo por conta

Dimensão **entrada ou saída** (L8), com **origem** ou **mês** na outra divisão, e o filtro por
conta valendo por movimento (§5.3): o líquido é o efeito no saldo da conta. A cadeia
inicial → entradas → saídas → faturas → final por mês vive no extrato da tela Contas; a separação
de um extrato em entradas, saídas e faturas é `statementMovements`/`statementFlows`
([`StatementFlows.ts`](../../../packages/core/src/domain/statement/StatementFlows.ts)), a lista única
que o extrato lê para que nenhum movimento entre num cálculo e falte no outro (ver
[Contas](contas.md)).

### 9.4 Por tag

Dimensão principal **tag** (§5.5) — a transação com duas tags conta nas duas e o total geral a
conta uma vez —, com secundária **categoria** ou **tipo**. Para o "total líquido" de uma tag
(despesas menos receitas, como um reembolso marcado "reembolsável"), agrupa-se por entrada ou
saída (L8) com o filtro da tag (A4).

## 10. Telas

Desktop, em [`apps/desktop/src/renderer/src/reports/`](../../../apps/desktop/src/renderer/src/reports):

- `/reports` lista os relatórios — os fixos no topo (projeção em todo perfil, distribuição por sócio
  no empresarial), depois os salvos por nome — e mostra o aberto. O relatório aberto fica no
  *search param* `report`: o id do salvo ou a chave do fixo (`projection` ou `partners`); sem ele,
  abre o primeiro fixo. Parâmetro malformado é descartado em vez de derrubar a rota
  ([`reportsSearch.ts`](../../../apps/desktop/src/renderer/src/reports/reportsSearch.ts)).
- `/reports/edit` é o editor, com o resultado ao vivo pela rota `reports.preview` e a barra do mês,
  porque o resultado depende dele. A exclusão pede confirmação.
- O rascunho do editor, a validação de conforto (F2, L5, L7, mínimo ≤ máximo), a descrição do
  período e dos filtros e os rótulos ficam em
  [`reportEditor.ts`](../../../packages/client/src/viewModels/reportEditor.ts); um cadastro excluído
  depois de salvo continua no filtro e aparece como tal.
- Toda escrita invalida os resultados de relatório que muda, fixos incluídos
  ([`invalidation.ts`](../../../packages/client/src/queries/invalidation.ts)).

## 11. Testes

| Arquivo | Cobre |
|---|---|
| [`test/domain/reportDefinition.test.ts`](../../../packages/core/test/domain/reportDefinition.test.ts) | Janela de meses (virada de ano, mês fixo × referência, limites de N), mínimo e máximo, listas sem repetição, dimensões repetidas, ordem, preenchimento dos meses e a sobreposição da tag |
| [`test/services/reports.definitions.test.ts`](../../../packages/core/test/services/reports.definitions.test.ts) | Nome único, referências de outro perfil recusadas, cadastro excluído que continua na definição, soft delete |
| [`test/services/reports.run.test.ts`](../../../packages/core/test/services/reports.run.test.ts) | As três bases de data, cada filtro e a combinação E/OU, estorno, tag como dimensão e o total à parte, grupos "sem", fixas × parceladas × avulsas, entrada × saída, transferência recebida de outro perfil, perfil vizinho fora, `preview` = `run` |
| [`test/services/reports.partner.test.ts`](../../../packages/core/test/services/reports.partner.test.ts) | Aportes de todos os períodos × mês, receita fora da divisão, encargos, sócio sem aporte, sócio excluído, maior resto, acerto com três sócios, participações fora de 100%, cobertura do déficit, `setPartner` |
| [`test/services/reports.projection.test.ts`](../../../packages/core/test/services/reports.projection.test.ts) | Janela com virada de ano e perfil novo; séries × avulsos; já lançado; fração do mês corrente; faixa pela raiz do horizonte; janela sem faixa; sem histórico; perfil empresarial |
| [`test/infrastructure/periodSql.test.ts`](../../../packages/core/test/infrastructure/periodSql.test.ts) | Mês de vencimento da fatura em SQL = `BillingCycle.dueDateOf` |
| `packages/client/test/` [`reportEditor`](../../../packages/client/test/reportEditor.test.ts), [`reportView`](../../../packages/client/test/reportView.test.ts), [`partnerReport`](../../../packages/client/test/partnerReport.test.ts), [`balanceProjection`](../../../packages/client/test/balanceProjection.test.ts), [`invalidation`](../../../packages/client/test/invalidation.test.ts) | Rascunho e regravação, descrição dos filtros, rótulos, tabela, gráfico e "Outros", pizza, análise; telas dos fixos e avisos; invalidação |
| [`apps/desktop/e2e/reports.spec.ts`](../../../apps/desktop/e2e/reports.spec.ts), [`partnerReport.spec.ts`](../../../apps/desktop/e2e/partnerReport.spec.ts) | Montar, salvar, editar e excluir; pizza; análise; gráfico de 13 meses; projeção no topo; distribuição por sócio com atribuição |

## 12. Limitações conhecidas

- **Sem relatórios no celular:** a página de Relatórios, o editor e os fixos existem só no desktop.
- **Sem busca por texto** no nome ou na descrição: o `LIKE` do SQLite só ignora maiúsculas em
  ASCII ("Açaí" não acharia "AÇAÍ"), e a busca certa pede uma função de comparação própria
  (`foldName`) registrada no adaptador.
- **Sem medida líquida** própria (entradas − saídas): hoje se obtém agrupando por entrada ou saída.
- **Sem drill-down** até os lançamentos de um grupo nem comparação com o mesmo mês do ano anterior.
- **Nome único só local:** a unicidade do nome é conferida no Service, e `report_definitions` não
  tem chave natural na sincronização; dois aparelhos que criem relatórios de mesmo nome antes de
  sincronizar ficam com os dois.
- **Projeção:** um avulso já lançado para um mês futuro conta no B2 e a média do B3 ainda é somada
  inteira nesse mês; uma série nova que o usuário ainda vai criar só aparece pela parte de avulsos
  que a média traz; não há sazonalidade (13º salário, IPVA).
