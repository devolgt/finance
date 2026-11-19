# Contas

Regras das contas (corrente e de investimentos): o cadastro, o extrato mensal, os saldos
consolidado e previsto, o recálculo e a verificação de integridade, as transferências, e a
diferença entre desativar e excluir uma conta. O cartão de crédito e a fatura estão em
[cartões e faturas](cartoes-e-faturas.md); a transação em si, em [transações](transacoes.md).

## 1. Conta

### 1.1 Cadastro

Uma conta pertence a um perfil e tem ([`Account.ts`](../../../packages/core/src/domain/account/Account.ts)):

- **tipo**: `checking` (corrente) ou `investment` (investimentos);
- **nome**: de 1 a 45 caracteres, aparado, **não único** — duas contas "Corrente" em bancos
  diferentes são legítimas;
- **rótulo de moeda** (`currencyLabel`): a moeda da conta no mundo real, só descritiva. Todo
  valor da conta está na moeda do perfil ([perfis §2.1](perfis.md#21-a-moeda-é-a-unidade-de-todo-valor));
  sem rótulo, vale a moeda do perfil;
- **considerar no saldo** (`considerBalance`): desligado, tira a conta do total do perfil
  mantendo o próprio histórico — a válvula de escape para conta no exterior, cujo saldo
  convertido se afasta do que o banco informa;
- **saldo inicial** (`openingBalance`).

Rotas: `accounts.list`, `accounts.create`, `accounts.update`, `accounts.disable`,
`accounts.enable`, `accounts.deletionImpact`, `accounts.delete`, `accounts.transferTargets`
([`AccountService`](../../../packages/core/src/services/account/AccountService.ts)).

### 1.2 Saldo inicial

Regra de negócio (Contas): o saldo inicial é o saldo que a conta já tinha **antes do primeiro
extrato** — dado do usuário, não cache, e não uma transação (um lançamento "Saldo inicial"
apareceria como receita nos relatórios por categoria). É o inicial do primeiro extrato vivo da
conta ([§3.2](#32-cadeia-de-fechamentos)), então **editá-lo recalcula todos os extratos da
conta**. Mudar "considerar no saldo" não recalcula nada: o total do perfil é somado na leitura.
Saldo em branco no formulário é zero.

Teste de mesa "saldo inicial editado depois de meses lançados" em
[`accounts.test.ts`](../../../packages/core/test/services/accounts.test.ts).

### 1.3 Conta de investimento vinculada a meta

Regra de negócio (Metas): a conta de investimento que é o saldo de uma [meta](metas.md) (mesmo
arquivada) **não muda de tipo** (`account-type-funds-goal`); a meta passaria a medir o dinheiro
do dia a dia como guardado. Recusar, e não desfazer o vínculo, evita apagar a escolha do
usuário em silêncio (`AccountService.update`).

## 2. Extrato

### 2.1 Uma linha por conta por mês

Regra de negócio (Extrato): o extrato (`bank_statements`,
[`BankStatement.ts`](../../../packages/core/src/domain/statement/BankStatement.ts)) é o contêiner
mensal da conta — **uma linha por conta por mês** —, com quatro saldos em cache: inicial e
final, consolidado e previsto. O id é derivado da chave natural (conta, competência), para que
dois aparelhos que abrem "o extrato de março" offline gerem o mesmo id. Um mês sem linha não é
erro: é um mês sem movimento, cujo inicial e final repetem o fechamento anterior.

O extrato é criado sob demanda (`StatementConsolidationService.ensureStatement`) quando algo cai
no mês, sempre na mesma unidade de trabalho do recálculo que corrige os saldos provisórios dele.

### 2.2 O que entra no movimento do mês

Regra de negócio (Extrato): entram no movimento de um mês
([`MonthlyMovement.ts`](../../../packages/core/src/domain/balance/MonthlyMovement.ts),
[`StatementFlows.ts`](../../../packages/core/src/domain/statement/StatementFlows.ts)):

1. as transações do extrato, pelo **efeito na origem** ([transações §1.2](transacoes.md#12-sinal-do-valor-e-estorno));
2. as transferências e investimentos que **chegam** à conta, pelo efeito no destino, no mês da
   data de caixa — o pagamento parcial de fatura é uma delas, com valor negativo;
3. as faturas **pagas** vinculadas ao extrato, no consolidado e no previsto;
4. só no **previsto**, as faturas **em aberto** dos cartões que a conta paga, no mês do
   vencimento ([cartões e faturas §3.5](cartoes-e-faturas.md#35-onde-a-fatura-pesa)).

A transação de conta cai no extrato do mês da sua **data de caixa** — a de pagamento, ou o
vencimento enquanto em aberto ([transações §2.2](transacoes.md#22-a-data-de-caixa-decide-o-extrato)).

### 2.3 Entradas e saídas pelo sinal do efeito

Regra de negócio (Extrato): as entradas e saídas do mês (`statementFlows`, devolvidas em
`statements.get` como `inflows`/`outflows`) contam cada movimento pelo **sinal do efeito no
saldo da conta**, e não pelo tipo: estorno de despesa é entrada, receita com tarifa maior que o
valor é saída, pagamento parcial de fatura é saída. Cada uma tem consolidado e previsto, somadas
sem arredondar, e a propriedade **inicial + entradas + saídas = final** vale nos dois saldos.
A lista de movimentos e as somas saem da mesma função (`statementMovements`), que também
alimenta o [relatório de fluxo por conta](relatorios.md), para que a tela nunca mostre um total
que a tabela não explica.

Testes: "Entradas e saídas do extrato" em
[`balances.table.test.ts`](../../../packages/core/test/services/balances.table.test.ts) e a
propriedade em [`balances.property.test.ts`](../../../packages/core/test/services/balances.property.test.ts).

### 2.4 A tabela do extrato

Regra de negócio (Extrato): cada linha mostra a **data de caixa** e o **efeito nesta conta**
([`statementTable.ts`](../../../packages/client/src/viewModels/statementTable.ts)):

- transação paga no dia do pagamento, em aberto no vencimento;
- transferência que chega com o efeito no destino;
- fatura paga no dia do pagamento ("ver fatura" abre a fatura); a paga sem dia gravado
  (anterior à migration `0003`) vai para o fim do mês, porque não se sabe em que ponto ela
  entrou;
- fatura em aberto no vencimento, com a nota de que pesa só no previsto.

No desktop e no celular, o extrato usa a listagem única de movimentos
([transações §8.3](transacoes.md#83-listagem-única-de-movimentos)).

## 3. Saldos consolidado e previsto

### 3.1 Os dois saldos

Regra de negócio (Saldos): todo saldo de conta e de extrato é um par
([`BalancePair.ts`](../../../packages/core/src/domain/balance/BalancePair.ts)):

- **consolidado** (realizado): só transações pagas e faturas pagas — o que já aconteceu;
- **previsto**: todas as transações vivas e as faturas em aberto no mês do vencimento — o que
  vai acontecer se nada mudar.

Os dois seguem a mesma cadeia e a mesma rotina; existem como par para que nenhum código consiga
atualizar um e esquecer o outro.

### 3.2 Cadeia de fechamentos

Regra de negócio (Extrato): o inicial de cada extrato é o final do extrato vivo **anterior** da
mesma conta — ou o saldo inicial da conta, no primeiro —, e o final é o inicial mais o movimento
do mês ([`StatementChain.ts`](../../../packages/core/src/domain/balance/StatementChain.ts)). Por
isso editar março recalcula março e todos os meses seguintes. Um mês com movimento e sem
extrato ganha um, senão a fatura que vence nele sumiria do saldo. O fechamento é arredondado na
fronteira de persistência, nunca antes (ver [core](../arquitetura/core.md)).

### 3.3 Saldo exibido e total do perfil

Regra de negócio (Contas): o saldo da conta é o fechamento do extrato do **mês corrente**; um
mês sem extrato herda o fechamento do último anterior, e uma conta sem extrato até ali mostra o
saldo inicial (`currentAccountBalances`). Extratos futuros (parcelas, fixas) não entram: são
previsão de meses que ainda não chegaram. A lista de contas (`accounts.list`) aplica a mesma
regra ao mês pedido.

Regra de negócio (Saldos): o **total do perfil** soma só as contas com "considerar no saldo"
ligado, **incluindo as desativadas** — o dinheiro delas existe
([`AccountBalanceService`](../../../packages/core/src/services/balance/AccountBalanceService.ts)).
Transferências entre contas do perfil somam zero no total por construção; só os encargos da
origem pesam.

### 3.4 Recálculo

Regra de negócio (Saldos): saldos nunca são incrementados — são **reconstruídos** a partir das
transações pela rotina única de recálculo
([`BalanceRecalculationService`](../../../packages/core/src/services/balance/BalanceRecalculationService.ts)),
na mesma unidade de trabalho da escrita que os mexeu. Cada escrita declara o impacto
(`BalanceImpact`: conta e mês a partir do qual recalcular) do estado antigo **e** do novo,
porque mudar de mês, de conta ou de fatura afeta os dois lados.

Na tela de lançamento, editar ou lançar num mês passado mostra o aviso de que os meses
seguintes serão recalculados (`recalculationNotice` do `client`), para o mês de onde o
lançamento sai e para onde vai: os números que o usuário já conferia vão mudar.

### 3.5 Verificação de integridade

Regra de negócio (Saldos): um saldo em cache que diverge do recalculado é bug a ser **exposto,
não corrigido em silêncio**. A rota `integrity.verifyBalances`
([`BalanceIntegrityService`](../../../packages/core/src/services/integrity/BalanceIntegrityService.ts))
roda na abertura do app, recalcula tudo numa unidade de trabalho **desfeita** e devolve os
desvios (conta, extrato ou fatura, campo, valor gravado e recalculado) para o log, sem corrigir.
A correção é a ação explícita `balances.rebuildAccount`. O cache da própria conta só é desvio
quando não corresponde a nenhum estado legítimo (o saldo inicial ou o fechamento de algum
extrato até o mês corrente), porque na virada do mês ele ainda aponta o fechamento anterior.
Usa a própria rotina de recálculo como oráculo, para que duas implementações da mesma regra não
discordem. A sequência de abertura está em [core](../arquitetura/core.md).

Testes: [`integrity.test.ts`](../../../packages/core/test/services/integrity.test.ts).

## 4. Transferências

### 4.1 Uma linha só

Regra de negócio (Transferência): transferência (`transference`) e investimento (`investment`)
são os únicos tipos com **conta de destino**, e são **uma única linha**, no contêiner da
origem. Saem da origem e entram no destino no mês da mesma data de caixa, com o mesmo valor e a
mesma situação de pago dos dois lados; os encargos ficam na origem
([transações §1.3](transacoes.md#13-encargos)). Editar ou excluir afeta as duas contas ao mesmo
tempo. O destino precisa ser diferente da origem (`destination-equals-origin`). Ver
[decisões](../decisoes.md) ([ADR 61](../decisoes.md#adr-61)).

### 4.2 Transferência entre perfis

Regra de negócio (Transferência entre perfis): a conta de destino de uma **transferência** pode
ser de outro perfil — mover dinheiro da conta pessoal para a da empresa é um fato que os dois
lados registram. Condições (`TransactionComposer.requireDestination`):

1. só `transference`; investimento fica no perfil (`reference-outside-profile`);
2. a origem é uma **conta**; o pagamento parcial de fatura não cruza perfis
   (`cross-profile-transfer-requires-account`);
3. os dois perfis têm a **mesma moeda** (`cross-profile-transfer-currency-mismatch`), porque a
   linha grava um único valor.

A linha pertence ao perfil de **origem** (subcategoria, tags e meta são dele). O perfil de
destino a vê na lista do mês e no extrato, **só para leitura**. `accounts.transferTargets`
oferece as contas dos outros perfis de mesma moeda. Testes:
[`crossProfileTransfers.test.ts`](../../../packages/core/test/services/crossProfileTransfers.test.ts).

### 4.3 Transferência não é receita nem despesa do perfil

Regra de negócio (Transações): no resultado do perfil (lista de transações, relatórios),
transferências e investimentos **dentro do perfil** ficam de fora — só movem dinheiro entre
contas dele. A transferência entre perfis entra: para este perfil o dinheiro de fato saiu ou
chegou ([transações §8.2](transacoes.md#82-resultado-do-mês)).

## 5. Desativar e excluir conta

Regra de negócio (Contas e Cartões): a ação padrão é **desativar**, que não apaga nada nem muda saldo; **excluir** é a ação explícita, que apaga em cadeia depois de um alerta com tudo o que será apagado. O cartão segue as mesmas regras ([cartões e faturas §6](cartoes-e-faturas.md#6-desativar-e-excluir-cartão)).

### 5.1 Desativar

Regra de negócio (Contas): **desativar** é a ação padrão no lugar de excluir. A conta
desativada:

1. some das escolhas de **novos** lançamentos — origem, destino, conta pagadora de cartão novo,
   conta do pagamento parcial, conta padrão (`account-disabled`);
2. continua nos extratos, faturas, saldos, totais e relatórios, porque o histórico não muda;
3. aparece nas listas marcada como desativada (no celular, numa seção à parte) e pode ser
   reativada.

Desativar não apaga nada nem muda saldo, por isso não recalcula e não pede confirmação (se
desfaz com "Reativar"). Editar um lançamento que **já está** na conta desativada continua
permitido — corrigir o histórico não exige reativar —, e a [recorrência](recorrencias.md#8-séries-e-cadastros)
que usa a conta continua emitindo. É uma coluna própria (`disabled_at`, migration
[`0002_disabled_registries.sql`](../../../db/migrations/0002_disabled_registries.sql)), e não
`deleted_at`, porque `deleted_at` significa "não existe mais" para toda leitura e para a
sincronização. Ver [decisões](../decisoes.md) ([ADR 55](../decisoes.md#adr-55)).

Onde mora: `Account.disable`/`enable`, `TransactionComposer.assertSelectable` (política
`newChoice` × `generated`), `transactionSourceOptions` e `destinationAccountOptions` do `client`.
Testes: "conta desativada nas escolhas de lançamentos" em
[`accounts.test.ts`](../../../packages/core/test/services/accounts.test.ts) e
[`transactionEditor.test.ts`](../../../packages/client/test/transactionEditor.test.ts).

### 5.2 Excluir em cadeia: o que é apagado junto

Regra de negócio (Contas): excluir a conta apaga, em cadeia
([`DeletionRepository`](../../../packages/core/src/repositories/DeletionRepository.ts)):

| Item | Por quê |
|---|---|
| Os extratos e as transações da conta | São dela |
| Os cartões que ela paga, com as faturas e os lançamentos delas | O cartão não existe sem a conta que o quita |
| As transferências e investimentos em que ela é a **conta de destino**, inclusive de outro perfil | A linha única ficaria sem um dos lados |
| As recorrências com a conta (ou um cartão que ela paga) como origem, ou com a conta como destino | A regra não emite para quem não existe mais |
| As metas vinculadas à conta | O progresso delas é o saldo da conta |

Faturas que sobrevivem, mas estavam pagas num extrato da conta excluída (o cartão trocou de
conta pagadora depois do pagamento), **voltam a ficar em aberto**.

### 5.3 O alerta é o escopo

Regra de negócio (Contas): antes de excluir, `accounts.deletionImpact` devolve **tudo o que será
apagado**, contado por item, e **nomeia as outras contas cujo saldo vai mudar** — uma
transferência apagada mexe na conta do outro lado; um pagamento de fatura apagado devolve o
valor à conta pagadora. As séries aparecem à parte ("N repetições, que param de gerar
lançamentos"), porque é um efeito no futuro que a contagem de hoje não mostra. Contagem zero não
vira frase ([`deletionImpact.ts`](../../../packages/client/src/viewModels/deletionImpact.ts)).

Alerta e exclusão partem do **mesmo** `DeletionScope`, calculado pela mesma consulta: duas
consultas poderiam discordar e apagar mais (ou menos) do que o usuário confirmou. A tela pede a
confirmação forte — **digitar o nome** — e oferece "Desativar em vez disso" (desktop
`DeletionDialog`, celular `DeletionSheet`). Ver [decisões](../decisoes.md) ([ADR 56](../decisoes.md#adr-56)).

### 5.4 Execução

Regra de negócio (Exclusão em cadeia): soft delete de toda a cadeia numa **única unidade de
trabalho**, seguido do **recálculo completo** de cada conta sobrevivente afetada
([`CascadeDeletionService`](../../../packages/core/src/services/deletion/CascadeDeletionService.ts)).
Completo, e não a partir de um mês, porque a cadeia toca meses quaisquer; é uma ação rara. As
contas afetadas incluem a pagadora atual de cada fatura apagada (previsto) e a dona do extrato
em que ela foi paga (consolidado), que divergem se a pagadora mudou depois do pagamento.

Testes: "excluir conta em cadeia" em
[`deletion.test.ts`](../../../packages/core/test/services/deletion.test.ts) (o apagado é
exatamente o contado; os saldos da outra conta voltam),
[`deletionImpact.test.ts`](../../../packages/client/test/deletionImpact.test.ts) e o bloco de
cadeias em [`recurrences.test.ts`](../../../packages/core/test/services/recurrences.test.ts).

## 6. Telas de contas

As regras acima aparecem assim nas telas (desktop `AccountsScreen`, celular `AccountsScreen` e
`AccountStatementScreen`):

- **Lista:** cada conta com consolidado e previsto do fim do mês de referência; a conta fora do
  total aparece esmaecida e fora da soma; desativadas marcadas (no celular, numa seção
  "Desativadas"); o total mostra consolidado e previsto; selo "Padrão" na conta padrão.
- **Extrato:** saldo inicial e final, entradas e saídas, cada um com consolidado e previsto; a
  tabela de movimentos de [§2.4](#24-a-tabela-do-extrato).
- **Ações:** criar, editar, usar como padrão, desativar/reativar e excluir (com o alerta de
  [§5.3](#53-o-alerta-é-o-escopo)).

Testes de tela: [`accounts.spec.ts`](../../../apps/desktop/e2e/accounts.spec.ts),
[`accounts.test.tsx`](../../../apps/mobile/test/accounts.test.tsx).

## 7. Limitações conhecidas

- **Conta no exterior:** o saldo de uma conta em outra moeda é a soma dos valores convertidos
  pelas taxas de cada lançamento e se afasta do que o banco informa; não há conciliação. A
  saída prevista é desligar "considerar no saldo" ([§1.1](#11-cadastro)).
- **Verificação de integridade parcial:** `integrity.verifyBalances` confere só os saldos em
  cache. Transações órfãs (sem extrato nem fatura) e anexos ausentes ainda não são procurados.
  Um cache de conta errado que coincida com o fechamento de um mês anterior passa despercebido,
  porque não se sabe quando o saldo foi gravado ([§3.5](#35-verificação-de-integridade)).
- **Data da lista × data do extrato:** a lista de Transações filtra lançamentos de conta pelo
  vencimento, e o extrato, pela data de caixa
  ([transações §9](transacoes.md#9-limitações-conhecidas)).
