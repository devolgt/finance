# Transações

Regras do lançamento: os quatro tipos, o contêiner (extrato ou fatura), o sinal do valor e os
encargos, pago e data de pagamento, os vínculos com categoria, tags, meta e sócio, as escolhas de
origem e destino, o formulário de lançamento, mover para outro perfil, a exclusão e a lista do
mês. A repetição (parcelado e fixo) está em [recorrências](recorrencias.md).

## 1. A transação

### 1.1 Tipos e contêiner

Toda movimentação de dinheiro é uma transação
([`Transaction.ts`](../../../packages/core/src/domain/transaction/Transaction.ts)) de um destes tipos
([`TransactionType.ts`](../../../packages/core/src/domain/transaction/TransactionType.ts)):

| Tipo | Código | Efeito na origem | Conta de destino |
|---|---|---|---|
| Receita | `income` | soma | não tem |
| Despesa | `expense` | subtrai | não tem |
| Transferência | `transference` | subtrai | obrigatória; pode ser de outro perfil |
| Investimento | `investment` | subtrai | obrigatória; do mesmo perfil |

Regra de negócio (Transações): toda transação pertence a **exatamente um contêiner mensal** —
o **extrato** de uma conta ou a **fatura** de um cartão. O banco aceita as duas chaves nulas ou
as duas preenchidas; no núcleo, a união discriminada `TransactionContainer` torna esses estados
irrepresentáveis
([`TransactionContainer.ts`](../../../packages/core/src/domain/transaction/TransactionContainer.ts)).
Na conta, o extrato é o do mês da data de caixa ([§2.2](#22-a-data-de-caixa-decide-o-extrato)); no
cartão, a fatura escolhida ([cartões e faturas §2.2](cartoes-e-faturas.md#22-fatura-sugerida-e-fatura-escolhida)).

### 1.2 Sinal do valor e estorno

Regra de negócio (Transações): o valor é lançado **positivo** e o tipo dá a direção. Um valor
**negativo inverte o efeito**: despesa negativa no cartão é **estorno** e reduz a fatura; receita
negativa é devolução. Assim o estorno fica na mesma subcategoria da compra que desfaz, e os
relatórios mostram o gasto líquido. Nenhum relatório lê o sinal sem o tipo. No formulário, o valor
é digitado sem sinal e maior que zero, e o botão "±" grava o negativo.

### 1.3 Encargos

Regra de negócio (Encargos): `charges` (juros e tarifas) é **sempre custo da origem**, em qualquer
tipo, e nunca chega ao destino (`originEffect`, `destinationEffect`):

| Lançamento | Origem | Destino |
|---|---|---|
| Despesa 100, encargos 2 | −102 | — |
| Receita 1.000, tarifa 10 | +990 | — |
| Transferência 500, TED 8 | −508 | +500 |

A fórmula é linear em valor e encargos, o que permite aplicá-la sobre somas agregadas por tipo no
SQL. Encargos não têm sinal no formulário. Testes: "Encargos — sempre custo da origem" em
[`balances.table.test.ts`](../../../packages/core/test/services/balances.table.test.ts).

### 1.4 Moeda de origem é proveniência

O valor é gravado **já convertido** para a moeda do perfil. A moeda de origem e a taxa de
conversão (padrão: a moeda do perfil e `1`) são só registro do que o usuário afirma; **nenhum
cálculo multiplica pela taxa**.

### 1.5 O tipo é fixo desde a criação

Regra de negócio (Transações): o tipo **não muda** numa edição (`transaction-type-locked`,
`Transaction.assertTypeKept`), em nenhum escopo de série. Trocar o tipo inverteria a direção do
efeito, criaria ou sumiria com a conta de destino e mudaria quem pode alimentar uma meta,
deixando vínculos inválidos. Lançar com outro tipo é excluir e lançar de novo. No formulário, o
seletor de tipo fica travado na edição. Ver [decisões](../decisoes.md) ([ADR 62](../decisoes.md#adr-62)).

### 1.6 Invariantes do conteúdo

Conferidos no domínio (`Transaction.validated`):

1. nome aparado, de 1 a 100 caracteres; descrição aparada, vazia vira nula;
2. transferência e investimento exigem conta de destino (`destination-required`); os outros tipos
   não aceitam (`destination-not-allowed`);
3. o destino é diferente da conta de origem (`destination-equals-origin`);
4. só receita e transferência se vinculam a uma meta (`goal-requires-saving-type`), e só a
   transferência **retira** dela (`goal-withdrawal-requires-transfer`) — ver [metas](metas.md);
5. tags sem repetição; número de ocorrência só junto com a série.

As regras que relacionam linhas (posse pelo perfil, conta ou cartão desativado, sócio só em perfil
empresarial, fatura do mesmo cartão) têm ponto único de controle no
[`TransactionComposer`](../../../packages/core/src/services/transaction/TransactionComposer.ts),
compartilhado com as recorrências para que as duas escritas nunca divirjam.

## 2. Pago e data de pagamento

### 2.1 Andam juntos

Regra de negócio (Transações): **pago e data de pagamento andam juntos** — a transação está paga
exatamente quando tem data de pagamento (`Transaction.isPaid` deriva de `paymentDate`). Não existe
"pago sem data" nem "data sem pago", porque é a data que decide o extrato. O schema da rota
(`paymentDate` em [`transactionRequests.ts`](../../../packages/core/src/requests/transactionRequests.ts))
não tem um campo `paid` separado.

### 2.2 A data de caixa decide o extrato

Regra de negócio (Extrato): a transação de conta cai no extrato do mês da sua **data de caixa**
(`Transaction.cashDate`): a data de pagamento quando paga, o vencimento enquanto em aberto. O
aluguel que vence em 28/09 e é pago em 02/10 está no extrato de outubro. Pagar, desmarcar ou
mudar a data de pagamento para outro mês **muda a transação de extrato**, e os dois meses são
recalculados. Vale também para o destino da transferência (uma data só dos dois lados). Na
transação de cartão a data de pagamento não decide nada: o contêiner é a fatura.

Testes: "Extrato pela data de pagamento" em
[`balances.table.test.ts`](../../../packages/core/test/services/balances.table.test.ts).

### 2.3 Marcar como pago

Regra de negócio (Transações): `transactions.setPaid` — o atalho `P` e o botão de situação da
linha — marca a transação como paga com a data de **hoje** (do `Clock`) e desmarcar limpa a data;
pedir o estado em que ela já está não muda nada, nem a data de um pagamento registrado
(`TransactionService.setPaid`).

Quem pode marcar pago (`movementPermissions` do `client`):

- **compra no cartão: não** — a situação dela é a da fatura (pagar ou reabrir em Cartões); a
  exceção é o **pagamento parcial**, que é dinheiro saindo da conta no dia dele;
- **transferência recebida de outro perfil: não** — a linha é do perfil de origem, e aqui é só
  leitura;
- no formulário, o campo "Pago" só aparece numa conta.

Testes: "marcar como pago" em [`accounts.test.ts`](../../../packages/core/test/services/accounts.test.ts),
[`movementList.test.ts`](../../../packages/client/test/movementList.test.ts).

## 3. Vínculos

- **Subcategoria:** obrigatória em toda transação, inclusive transferência e pagamento parcial (não
  há subcategoria de sistema). Ver [categorias e tags](categorias-e-tags.md).
- **Tags:** opcionais ao criar, explícitas na edição completa (`tagIds`). Ver
  [categorias e tags](categorias-e-tags.md).
- **Meta:** só receita e transferência; a transferência pode guardar ou retirar. Ver [metas](metas.md).
- **Sócio que aportou:** só em entrada de perfil empresarial; atribuível sem a edição completa por
  `transactions.setPartner`. Ver [sócios](socios.md).
- **Anexos:** existe a tabela `attachments` no schema, mas nenhuma rota os cria; ver
  [§9](#9-limitações-conhecidas).

## 4. Escolhas de origem e destino

### 4.1 Desativados fora das escolhas novas

Regra de negócio (Contas e Cartões): conta ou cartão desativado não é escolha para um **lançamento
novo** (origem, destino, conta do pagamento parcial), mas o lançamento antigo que **já está** nele
continua editável sem reativá-lo — "novo" é a escolha, não a transação
(`TransactionComposer.assertSelectable`, política `newChoice`). A ocorrência emitida por uma
recorrência usa a política `generated` e é aceita ([recorrências §8](recorrencias.md#8-séries-e-cadastros)).
O formulário oferece só os ativos, mais a origem atual na edição (`transactionSourceOptions`,
`destinationAccountOptions`). O destino nunca oferece a própria conta de origem, e oferece contas
de outros perfis (com o nome do perfil) só numa transferência que sai de uma conta.

### 4.2 Atalho Débito / Crédito

Regra de negócio (Lançamentos): na **despesa nova**, o atalho "Débito · conta / Crédito · cartão"
escolhe a origem (`paymentMethodSource` do `client`):

1. vale a conta padrão (débito) ou o cartão padrão (crédito) do perfil
   ([perfis §3](perfis.md#3-conta-e-cartão-padrão-do-lançamento));
2. sem padrão, vale a **única** conta ou o único cartão ativo;
3. com vários e sem padrão, nenhum — escolher um por conta própria lançaria na conta errada sem o
   usuário perceber;
4. a despesa nova abre no débito; o filtro de conta ou cartão da tela tem prioridade; com o atalho
   à vista, o campo de origem lista só o lado escolhido.

### 4.3 Nome sugerido

Regra de negócio (Lançamentos): no lançamento **novo**, o campo Nome sugere nomes já lançados do
**mesmo tipo** (`transactions.nameSuggestions`, `matchNameSuggestions`), sem diferenciar acento e
maiúscula (`nameSuggestionKey`): primeiro os que começam pelo texto, depois os que o contêm, até
oito. Escolher copia a categoria e a conta ou o cartão do lançamento **cadastrado** mais recente
com esse nome, quando ainda são escolha válida — pela data de cadastro, para que a parcela futura
de uma série não esconda a mudança de hoje. Na edição não há sugestão: trocar a categoria porque o
nome mudou desfaria uma escolha gravada.

Testes: [`nameSuggestions.test.ts`](../../../packages/core/test/services/nameSuggestions.test.ts) e
os blocos "atalho Débito / Crédito" e "autocomplete do campo Nome" de
[`transactionEditor.test.ts`](../../../packages/client/test/transactionEditor.test.ts).

## 5. O formulário de lançamento

### 5.1 Um formulário, os mesmos schemas

Desktop (`TransactionForm`, num diálogo) e celular (`TransactionFormScreen`, rota
`/new-transaction`, `?id=` na edição) leem o formulário pelo mesmo `transactionForm` do `client`,
validado pelos schemas das rotas `transactions.create`/`update`; a recusa do núcleo que aponta um
campo aparece abaixo dele (`coreErrorField`). Campos: tipo, valor (com "±"), nome, descrição, data
(vencimento), pago e data de pagamento (só em conta), encargos, conta **ou** cartão, fatura (no
cartão), conta de destino (transferência e investimento), subcategoria com busca, tags, meta, sócio
(perfil empresarial), perfil ([§6](#6-mover-para-outro-perfil)) e "Repetir"
([recorrências §3](recorrencias.md#3-criar-uma-série)).

Na criação, os opcionais têm o padrão do domínio (encargos 0, taxa 1, sem tags), para o lançamento
rápido enviar só o essencial. Na **edição, todos os campos são explícitos**: a edição substitui a
transação inteira, e um padrão faria o cliente que omitisse `charges` apagar o valor gravado em
silêncio.

A prévia do valor usa a mesma regra de sinal do núcleo (`previewTransactionValue`): o tipo dá a
direção, o negativo a inverte (etiqueta "estorno"), os encargos são custo da origem.

### 5.2 Avisos antes de salvar

1. **Fatura paga será reaberta** ([cartões e faturas §2.2](cartoes-e-faturas.md#22-fatura-sugerida-e-fatura-escolhida)).
2. **Meses seguintes serão recalculados** quando o mês de onde o lançamento sai ou para onde vai é
   passado ([contas §3.4](contas.md#34-recálculo)).
3. A compra nova no cartão avisa em que fatura caiu, com "Ver fatura" — na lista sem filtro ela
   fica dentro da linha da fatura ([cartões e faturas §5](cartoes-e-faturas.md#5-compras-agrupadas-na-linha-da-fatura)).

Toda escrita recalcula, na mesma unidade de trabalho, os saldos do estado antigo **e** do novo
(`TransactionService.update`).

Testes: [`transactionForm.test.ts`](../../../packages/client/test/transactionForm.test.ts),
[`transactionEditor.test.ts`](../../../packages/client/test/transactionEditor.test.ts),
[`transactions.spec.ts`](../../../apps/desktop/e2e/transactions.spec.ts),
[`newTransaction.test.tsx`](../../../apps/mobile/test/newTransaction.test.tsx).

## 6. Mover para outro perfil

Regra de negócio (Mover para outro perfil): a edição pode levar a transação para **outro perfil**
(`profileId` em `transactions.update`; nulo ou igual mantém). Como a transação não tem
`profile_id` próprio, mover é trocar a conta ou o cartão por um do perfil de destino, e todas as
referências (subcategoria, tags, meta, sócio, destino) passam a ser conferidas contra ele
(`TransactionComposer.resolveOwner`).

1. Os dois perfis têm a **mesma moeda** (`transaction-move-currency-mismatch`): o valor não é
   convertido.
2. Numa ocorrência de série, a **série inteira** vai junto, sempre em "todas"; mover só uma
   ocorrência é recusado (`recurrence-move-requires-all`) — ver
   [recorrências §5.5](recorrencias.md#55-mover-de-perfil-leva-a-série-inteira).
3. A transferência recebida de outro perfil continua só leitura: quem a move é o perfil de origem.
4. O recálculo cobre as contas dos dois perfis numa só unidade de trabalho.

Na tela, é o campo **Perfil** do formulário: trocar o perfil esvazia conta ou cartão, fatura,
destino, categoria, tags e meta, que passam a ser escolhidos entre os do outro perfil; voltar ao
original devolve as escolhas. Só aparecem perfis da mesma moeda.

Testes: [`moveProfile.test.ts`](../../../packages/core/test/services/moveProfile.test.ts).

## 7. Excluir um lançamento

Regra de negócio (Transações): excluir (`transactions.delete`) é soft delete com recálculo. A
confirmação diz **de onde o valor sai e quais saldos mudam**, e não um aviso genérico
(`describeTransactionDeletion`; [perfis §5.3](perfis.md#53-confirmações-dizem-o-que-muda)):

- de um extrato, recalcula a conta dali em diante; numa transferência, as duas contas;
- excluir o **pagamento parcial** devolve o valor à fatura e à conta que pagou;
- numa ocorrência de série, a exclusão pergunta o escopo
  ([recorrências §6](recorrencias.md#6-excluir-com-escopo)); "somente esta" exclui só a ocorrência,
  e a marca d'água impede que o complemento a recrie.

A confirmação abre pelo botão do formulário, pela tecla `Del` e pelo menu de contexto.

## 8. A lista de transações do mês

### 8.1 Quais transações entram

`transactions.listByPeriod` devolve as transações vivas do perfil com **vencimento** no mês, mais
as transferências recebidas de outros perfis (só leitura). Os filtros (conta ou cartão, categoria,
subcategoria, tag, situação, busca sem diferenciar acento) rodam no `client`
(`buildTransactionTable`), e ficam na URL no desktop.

### 8.2 Resultado do mês

Regra de negócio (Transações): o "resultado" da lista é o efeito no saldo das entradas e saídas
visíveis; transferências e investimentos **dentro do perfil** ficam de fora — só movem dinheiro
entre contas do perfil, e somá-los mostraria uma saída que não é gasto. A transferência **entre
perfis** entra. Na lista agrupada, o pagamento parcial conta pelo efeito na conta pagadora
([cartões e faturas §5](cartoes-e-faturas.md#5-compras-agrupadas-na-linha-da-fatura)). No celular,
`transactionTotals` soma entradas e saídas pela mesma regra, para os números do topo fecharem.

### 8.3 Listagem única de movimentos

Transações, o extrato de Contas e a fatura de Cartões usam a **mesma listagem**
([`movementList.ts`](../../../packages/client/src/viewModels/movementList.ts); desktop
`MovementGrid`, celular por dia): o mesmo teclado (`↑↓`, `Enter` edita, `P` marca pago, `Del`
exclui), o mesmo menu de contexto e as mesmas ações (`useTransactionActions`). As colunas se
adaptam — "Conta / fatura" só em Transações; a fatura não tem situação, que é a dela — e o valor é
o de cada tela: efeito no perfil, efeito nesta conta, quanto soma à fatura. A situação
"Pendente/Pago" é um botão na linha onde marcar pago vale ([§2.3](#23-marcar-como-pago)). Toda
escolha de cadastro nos formulários usa um seletor com busca (`Combobox` no desktop, folha com
busca no celular); listas curtas e fixas (tipo, moedas, frequência, faturas sugeridas) continuam
num seletor simples.

Entrada e saída não dependem só da cor: sinal, `⇄` em transferência e o rótulo de estorno
(`formatTransactionAmount`). Sem filtro, as compras do cartão ficam agrupadas na linha da fatura
([cartões e faturas §5](cartoes-e-faturas.md#5-compras-agrupadas-na-linha-da-fatura)).

Testes: [`movementList.test.ts`](../../../packages/client/test/movementList.test.ts),
[`viewModels.test.ts`](../../../packages/client/test/viewModels.test.ts),
[`transactionDays.test.ts`](../../../packages/client/test/transactionDays.test.ts),
[`movements.spec.ts`](../../../apps/desktop/e2e/movements.spec.ts),
[`transactions.test.tsx`](../../../apps/mobile/test/transactions.test.tsx).

## 9. Limitações conhecidas

- **Data da lista × data do extrato:** a lista de Transações filtra lançamentos de conta pelo
  **vencimento**, enquanto o extrato e a linha da fatura usam a data de caixa. A despesa que vence
  em 28/10 e é paga em 02/11 aparece em outubro em Transações e em novembro no extrato. Está em
  aberto qual das duas a lista deve seguir.
- **Anexos:** a tabela `attachments` existe no schema (e o soft delete de uma transação a
  acompanha), mas não há rota nem tela para anexar arquivos.
