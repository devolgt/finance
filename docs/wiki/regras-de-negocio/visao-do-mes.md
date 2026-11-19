# Visão do mês

Esta página cobre a tela que abre o app — a **Visão geral** no desktop e o **Início** no celular —
e as regras de saldo que ela e as demais telas compartilham: consolidado e previsto, o saldo do
perfil e do mês, o patrimônio, os gastos e entradas do mês, os atrasados e as próximas faturas. As
regras da conta em si (extrato, saldo inicial, desativar) estão em [Contas](contas.md), e as da
fatura em [Cartões e faturas](cartoes-e-faturas.md).

## 1. O que a tela responde e de onde vem cada número

A Visão geral só tem rotas próprias para as perguntas que nenhuma outra tela responde; os saldos,
os cartões do mês e as metas vêm das rotas das próprias telas, para que a Visão geral e cada tela
**nunca discordem** ([`OverviewService.ts`](../../../packages/core/src/services/overview/OverviewService.ts)).

| Bloco | Rota | Depende de |
|---|---|---|
| Saldo consolidado (com o previsto) e patrimônio | `accounts.list` | Mês de referência (§2.3) |
| Gastos e entradas do mês, "Gastos por mês", "Para onde foi no mês" | `overview.spending` | Mês de referência (§3) |
| Selo de atrasados e painel do que está em aberto | `overview.pending` | Hoje (§4) |
| Próximas faturas (indicador) e próxima fatura no bloco de cartões | `overview.nextInvoices` | Hoje (§5) |
| Cartões com a fatura do mês | `creditCards.list` | Mês de referência |
| Metas | `goals.list` | Mês de referência |
| Anotações | `notes.list` | — |

Peças: [`OverviewController.ts`](../../../packages/core/src/controllers/OverviewController.ts),
`OverviewService`, [`SqliteOverviewRepository.ts`](../../../packages/core/src/infrastructure/sqlite/SqliteOverviewRepository.ts),
o domínio [`SpendingSummary.ts`](../../../packages/core/src/domain/overview/SpendingSummary.ts) e
[`PendingItems.ts`](../../../packages/core/src/domain/overview/PendingItems.ts), e o view-model
[`overviewView.ts`](../../../packages/client/src/viewModels/overviewView.ts), usado pelo desktop e pelo
celular (§6).

## 2. Saldos

### 2.1 Consolidado e previsto

Regra de negócio (Saldos): todo saldo de conta e de extrato tem **dois** valores, sempre lado a lado
([`BalancePair.ts`](../../../packages/core/src/domain/balance/BalancePair.ts)):

- **consolidado:** soma só transações pagas e faturas pagas — o que já aconteceu;
- **previsto:** soma todas as transações vivas e as faturas em aberto no mês do vencimento — o que
  vai acontecer se nada mudar.

Os dois seguem a mesma cadeia e a mesma rotina; existem como par (`BalancePair`) para que nenhum
código consiga atualizar um e esquecer o outro. O movimento de um mês (`MonthlyMovement`) junta as
transações do extrato, as transferências e investimentos que chegam à conta no mês da data de
caixa, as faturas pagas vinculadas ao extrato e — só no previsto — as faturas em aberto no mês do
vencimento. O SQL só soma `value` e `charges` por mês, tipo e pago; quem decide direção, encargos e
o que é consolidado é o domínio.

### 2.2 Cadeia e recálculo

- Regra de negócio (Extrato): o saldo inicial de cada extrato é o final do extrato vivo **anterior**
  da mesma conta — ou o saldo inicial da conta, no primeiro —, e o final é o inicial mais o movimento
  do mês, nos dois saldos (`recomputeChain` em
  [`StatementChain.ts`](../../../packages/core/src/domain/balance/StatementChain.ts)). Editar março
  recalcula março e todos os meses seguintes. Um mês com movimento e sem extrato ganha extrato
  (`periodsMissingStatement`), para que a transferência que chega ou a fatura que vence nele não suma
  do saldo.
- Saldos em cache **nunca são incrementados**: são reconstruídos a partir das transações por **uma**
  rotina ([`BalanceRecalculationService.ts`](../../../packages/core/src/services/balance/BalanceRecalculationService.ts)),
  chamada pelo lançamento, pelo pagamento de fatura, pela importação e pelo reparo. Incrementar
  acumularia erro de float a cada escrita e tornaria permanente qualquer bug pontual.
- Quem escreve calcula o impacto **antes e depois** da escrita (`ImpactCalculator`) e soma os dois
  (`BalanceImpact`), para que o contêiner antigo e o novo sejam recalculados juntos; a importação e
  as recorrências acumulam o impacto e recalculam uma vez no fim.
- `recomputeChain` é deliberadamente a implementação mais simples, sem atalho incremental, porque é
  o oráculo dos testes de propriedade
  ([`balances.property.test.ts`](../../../packages/core/test/services/balances.property.test.ts)).

Detalhes do cache, da integridade e do reparo em [Banco de dados](../arquitetura/banco-de-dados.md).

### 2.3 Saldo do mês, do perfil e patrimônio

- **Saldo de um mês:** o fechamento do extrato daquele mês; um mês sem extrato herda o fechamento
  do último anterior, e uma conta sem extrato até ali mostra o saldo inicial
  (`currentAccountBalances`, `AccountService.list`). A Visão geral mostra o saldo do **mês de
  referência**, o mesmo número do rodapé da tela Contas.
- **Saldo do perfil (total):** soma só as contas com "considerar no saldo" ligado; a conta
  desativada continua somando, porque o dinheiro dela existe. A transferência entre contas do perfil
  soma zero no total por construção — sai de uma e entra na outra —, e só os encargos da origem pesam.
  A contagem do subtítulo ("3 contas no total") conta as mesmas contas.
- **Saldo de hoje:** `AccountBalanceService.profileBalances` lê o cache das contas (que existe para a
  tela inicial abrir sem consultar extratos), mas o confere contra o mês corrente antes
  (`refreshCurrentBalance`), porque na virada do mês nenhuma transação muda e o cache ainda apontaria
  o fechamento do mês anterior. É o ponto de partida da projeção de saldo
  ([Relatórios §8](relatorios.md#8-projeção-de-saldo-relatório-fixo)).
- **Patrimônio:** soma o consolidado de **todas** as contas, inclusive as fora do total: os
  investimentos que o usuário não quer ver no saldo do dia a dia continuam sendo dele
  (`overviewKpis`).

## 3. Gastos e entradas do mês

### 3.1 Mês dos gastos

Regra de negócio (Visão geral): os gastos e as entradas seguem o **regime de caixa**
([Relatórios §2.1](relatorios.md#21-a-regra)), com uma variação no cartão
(`OVERVIEW_FLOWS_CTE`):

- **lançamento de conta:** o mês do **extrato** em que está — o do pagamento quando pago, o do
  vencimento em aberto. Ler o extrato garante que a Visão geral e Contas concordem;
- **compra no cartão:** o mês do **vencimento da fatura**, paga ou não. Pagar a fatura com atraso não
  muda o mês dos gastos, que é o do ciclo.

Por que a variação: ver [decisões](../decisoes.md), [ADR 87](../decisoes.md#adr-87).

### 3.2 Gastos e entradas

- **Gasto** é a **despesa**, da conta e do cartão, pelo `value` como gravado, **sem os encargos** —
  como na soma dos relatórios. O estorno (negativo) abate o mês dele
  (`SqliteOverviewRepository.expensesByMonth`).
- **Entrada** é a **receita** do perfil e a **transferência ou investimento que chega de outro
  perfil**, pelo valor que chega (os encargos são da origem). A transferência entre contas do próprio
  perfil não é entrada: o dinheiro já era do perfil, e contá-la inflaria as entradas a cada
  movimentação entre contas. A de fora conta no mês do extrato de origem, que é o da mesma data de
  caixa (`incomeOfMonth`).

### 3.3 Janela e média

- O gráfico "Gastos por mês" mostra **6 meses** terminando no mês de referência
  (`SPENDING_MONTHS`, `spendingWindow`); mês sem gasto vem com zero.
- A **média** é a dos meses do gráfico, mas começa no **primeiro mês com gasto** da janela: num
  perfil que começou há dois meses, os meses vazios de antes puxariam a média para baixo e todo mês
  pareceria "acima da média". Sem gasto na janela, não há média, e o indicador diz que não há com o
  que comparar em vez de "0%" (`overviewSpendingKpis`).
- O valor da média fica numa legenda embaixo do gráfico, e não sobre a linha, porque cobria a barra
  do mês. As alturas são relativas ao maior valor entre as barras e a média; o mês negativo (estorno
  maior que as compras) fica sem barra.

### 3.4 Maiores categorias

"Para onde foi no mês" mostra as **5 maiores** categorias de despesa do mês de referência pelo nome
e junta as demais em "outras" (`TOP_CATEGORIES`, `buildSpendingSummary`). A categoria é a da
subcategoria do lançamento, com o nome da linha mesmo quando a categoria foi excluída e o gasto
continua vivo.

- A categoria **zerada ou negativa** (estornos maiores que as compras) fica fora: não tem tamanho
  de barra nem participação.
- A participação é sobre a soma das categorias com gasto positivo (maiores e outras), para que os
  percentuais fechem 100% mesmo com estornos (`categoryShares`).
- Empates seguem o nome por `compareNames` e, por fim, o id, para o ranking não mudar entre o
  desktop e o celular.
- O resumo não tem definição salva nem link para Relatórios: é um resumo próprio da Visão geral.

## 4. Atrasados e em aberto

### 4.1 Atrasado e em aberto até o fim do mês

Regra de negócio (Visão geral): **atrasado** é o que venceu **antes de hoje** e não foi pago, de
qualquer mês — o que vence hoje ainda está em dia. O painel mostra os atrasados e, embaixo, o que
ainda **vence até o último dia do mês de hoje** (`buildPendingSummary`, `pendingUntil`). A rota parte
de hoje, e não do mês de referência: atraso é sempre em relação a hoje, em qualquer mês que a barra
mostre.

- Entram os lançamentos de conta em aberto e as **faturas inteiras** em aberto com valor a pagar
  (`amountDue`; a zerada ou com crédito não é dívida), de qualquer competência — um atraso antigo não
  pode sumir do selo por estar longe.
- A compra no cartão **não** aparece sozinha: ela é paga junto da fatura, e é a fatura inteira que
  fica atrasada.
- O cartão desativado continua com as faturas, porque a dívida não some ao desativar.
- A transferência que chega de outro perfil aparece, para consulta.
- Mesma data: ordem pelo nome com `compareNames`, depois o id, para o Início do celular e a Visão
  geral do desktop listarem igual.

### 4.2 Sentido e totais

Cada item tem um sentido (`PendingDirection`), que decide em qual total entra:

- `in` — a receber (receita; transferência que chega de outro perfil; estorno em aberto, cujo efeito
  é positivo);
- `out` — a pagar (despesa, transferência para outro perfil, fatura);
- `transfer` — transferência ou investimento entre contas do próprio perfil, que não muda o
  patrimônio e por isso não entra em "a pagar" nem em "a receber".

O valor é o efeito na origem — a receita sem os encargos, a despesa e a transferência com eles —, e
o sinal do efeito decide o sentido. A tela mostra o sinal ou o ⇄ no texto, e não só a cor.

### 4.3 Selo, painel e "Marcar como pago"

- O **selo** ao lado do título diz "N atrasados" com os totais a pagar e a receber, ou "Nada
  atrasado". Sem atraso, o selo ainda abre o painel quando há algo em aberto até o fim do mês
  (`pendingBadge`, `pendingPanel`). Não há lista "Próximos 30 dias": o que está em aberto mora no
  painel.
- **Marcar como pago/recebido** grava o pagamento pela rota `transactions.setPaid` com a data de
  hoje — o que pode mudar o mês do lançamento —, e o "Desfazer" volta o lançamento a pendente.
- A **transferência que chega de outro perfil** não tem a ação: quem a marca como paga é o perfil de
  origem, dono da linha.
- A **fatura** não se paga daqui: o pagamento pede conta, valor e data, e a linha leva à fatura na
  tela Cartões.

## 5. Próximas faturas

Regra de negócio (Visão geral): a **próxima fatura** de cada cartão é a primeira **em aberto, com
valor a pagar, que vence de hoje em diante** (`nextInvoices`). A que já venceu fica de fora porque
está no selo de atrasados. Faturas do mesmo dia seguem o nome do cartão por `compareNames`.

- O indicador "Próximas faturas" soma a próxima fatura de cada cartão e diz quando vence (ou "a
  primeira vence dd/mm" quando há mais de uma data).
- O bloco de cartões mostra a fatura do **mês de referência** (a mesma da lista de Cartões, paga ou
  em aberto; a competência sem lançamentos mostra só o vencimento) e, quando não é ela, a próxima em
  aberto — para que o resumo diga o que vem a pagar mesmo num mês já fechado (`overviewCardRows`).

## 6. Desktop e celular

- **Desktop** ([`OverviewScreen.tsx`](../../../apps/desktop/src/renderer/src/overview/OverviewScreen.tsx)):
  até cinco indicadores (saldo consolidado com o previsto, patrimônio, gastos, entradas, próximas
  faturas) numa grade fluida, o gráfico de gastos e as maiores categorias, contas separadas pelo
  total (as de fora num grupo à parte, só com o consolidado; desativadas com etiqueta), cartões com
  a fatura do mês e a próxima, metas com "Prazo vencido" e o ritmo necessário (ver
  [Metas](metas.md)), anotações e o selo de atrasados.
- **Celular** ([`HomeScreen.tsx`](../../../apps/mobile/src/screens/HomeScreen.tsx)): os atrasados no
  topo (com marcar e desfazer), o saldo consolidado com o previsto, as contas — as de fora do total no
  grupo "Fora do saldo total" — e a fatura do mês de cada cartão. Usa os mesmos view-models
  (`pendingPanel`, `overviewAccounts`, `overviewCardRows`) e o mesmo total da tela Contas, para os
  apps nunca discordarem. Não tem o gráfico de gastos nem as maiores categorias.

As rotas `overview.*` são invalidadas por toda escrita que mexe em dinheiro e pelos nomes de
categoria ([`invalidation.ts`](../../../packages/client/src/queries/invalidation.ts)).

## 7. Testes

| Arquivo | Cobre |
|---|---|
| [`packages/core/test/services/overview.test.ts`](../../../packages/core/test/services/overview.test.ts) | Gastos pelo regime de caixa com o cartão no vencimento da fatura; entradas sem as transferências internas; atrasado de qualquer mês e a fatura inteira; marcar e desmarcar; próxima fatura por cartão; perfil sem movimento; maiores categorias e "outras" |
| [`packages/core/test/services/balances.table.test.ts`](../../../packages/core/test/services/balances.table.test.ts), [`balances.property.test.ts`](../../../packages/core/test/services/balances.property.test.ts) | Saldos consolidado e previsto, cadeia e recálculo contra o oráculo |
| [`packages/client/test/overviewView.test.ts`](../../../packages/client/test/overviewView.test.ts) | Indicadores, gráfico, categorias, contas, cartões, metas, selo e painel |
| [`apps/desktop/e2e/overview.spec.ts`](../../../apps/desktop/e2e/overview.spec.ts), [`apps/mobile/test/home.test.tsx`](../../../apps/mobile/test/home.test.tsx) | Visão geral no app empacotado (marcar pelo selo e desfazer, resumos, navegação) e o Início do celular |

## 8. Limitações conhecidas

- O Início do celular não tem os indicadores de gastos, entradas, patrimônio, nem metas e anotações
  da Visão geral do desktop.
- Os gastos da Visão geral põem a compra no cartão no mês do vencimento da fatura, enquanto o
  relatório por sócio e a projeção a põem no mês em que a fatura foi paga; uma fatura paga com atraso
  aparece em meses diferentes nos dois lugares ([ADR 87](../decisoes.md#adr-87)).
