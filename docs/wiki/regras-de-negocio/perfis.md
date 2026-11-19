# Perfis

O perfil é a raiz de todos os dados do usuário: a moeda em que todo valor é gravado, o tipo
(pessoal ou empresarial), a conta e o cartão padrão do lançamento e o primeiro uso, que cria o
primeiro perfil. A página também reúne as regras que valem para todos os cadastros financeiros
(desativar × excluir, soft delete, confirmações que dizem o que muda).

## 1. O perfil como tenant

### 1.1 Tudo pertence a um perfil

Regra de negócio (Perfis): todo registro financeiro pertence, direta ou transitivamente, a um
perfil — contas, cartões, categorias, tags, metas, sócios, anotações, recorrências. A transação
não tem `profile_id` próprio: o perfil vem do contêiner (o extrato da conta ou a fatura do
cartão), e toda referência do lançamento (subcategoria, tags, meta, sócio, conta de destino)
precisa ser do mesmo perfil (`reference-outside-profile`). A conferência é da camada Service,
porque o banco não relaciona linhas de tabelas diferentes (ver
[Banco de dados](../arquitetura/banco-de-dados.md)); o ponto único de controle é o
[`TransactionComposer`](../../../packages/core/src/services/transaction/TransactionComposer.ts).

A única referência que atravessa perfis é a **transferência entre perfis**
([contas §4.2](contas.md#42-transferência-entre-perfis)). Mover um lançamento para outro perfil
é uma edição explícita ([transações §6](transacoes.md#6-mover-para-outro-perfil)).

Não há exclusão de perfil no app: as rotas são `profiles.list`, `profiles.create`,
`profiles.update`, `profiles.setDefaultAccount` e `profiles.setDefaultCreditCard`
([`ProfileService`](../../../packages/core/src/services/profile/ProfileService.ts)).

### 1.2 Tipo pessoal ou empresarial

Regra de negócio (Perfis): o tipo (`personal` ou `business`) decide se o perfil tem
[sócios](socios.md) — só o empresarial aceita (`Profile.acceptsPartners`), e só nele uma
entrada pode registrar quem aportou. O tipo é escolhido na criação e **não muda depois**:
`profiles.update` não o recebe, porque trocar de empresarial para pessoal deixaria sócios e
aportes sem sentido.

Invariantes do domínio ([`Profile.ts`](../../../packages/core/src/domain/profile/Profile.ts)):
nome aparado, de 1 a 45 caracteres; moeda ISO 4217 de três letras maiúsculas (`Currency`).

## 2. Moeda do perfil

### 2.1 A moeda é a unidade de todo valor

Regra de negócio (Perfis): a moeda do perfil é a **unidade** de todo valor monetário gravado
nele — saldos, transações, faturas, metas. A moeda de uma conta é só um rótulo
([contas §1.1](contas.md#11-cadastro)) e a moeda de origem de uma transação é só proveniência
([transações §1.4](transacoes.md#14-moeda-de-origem-é-proveniência)): nenhum cálculo converte
valores.

### 2.2 Moeda travada depois do primeiro lançamento

Regra de negócio (Perfis): renomear o perfil é livre, mas **trocar a moeda só é permitido
enquanto o perfil não tem lançamentos**. A troca só reetiqueta (`Profile.withCurrency`), não
converte: com lançamentos, cada valor passaria a significar outra quantia de dinheiro, e uma
moeda de outra precisão (iene, dinar) arredondaria o histórico. O caso de uso legítimo é quem
escolheu a moeda errada no primeiro uso. Ver [decisões](../decisoes.md) ([ADR 58](../decisoes.md#adr-58)).

- Conta como lançamento do perfil a transação viva num contêiner dele **e a transferência que
  chega** a uma conta dele vinda de outro perfil — o valor dela foi gravado na moeda comum aos
  dois, e trocar a moeda daqui mudaria a unidade do que ela somou
  (`SqliteProfileRepository.hasTransactions`).
- A recusa é `profile-currency-locked`, com `details.field = 'currency'`; os formulários
  (desktop e celular) a mostram abaixo do campo da moeda (`coreErrorField` do `client`).
- Onde mora: `ProfileService.update`. Testes:
  [`profiles.test.ts`](../../../packages/core/test/services/profiles.test.ts) e
  [`coreErrorField.test.ts`](../../../packages/client/test/coreErrorField.test.ts).

As moedas oferecidas nos formulários são as de `CURRENCY_OPTIONS`
([`currencies.ts`](../../../packages/client/src/forms/currencies.ts)); um cadastro com moeda fora
da lista (gravado por outro aparelho) continua aparecendo como opção na edição.

## 3. Conta e cartão padrão do lançamento

### 3.1 A regra

Regra de negócio (Lançamentos): cada perfil tem **no máximo uma conta padrão e um cartão
padrão**, que o atalho "Débito / Crédito" do lançamento novo escolhe
([transações §4.2](transacoes.md#42-atalho-débito--crédito)). Colunas
`profiles.default_account_id` e `profiles.default_credit_card_id`, da migration
[`0008_default_sources.sql`](../../../db/migrations/0008_default_sources.sql).

1. Ao escolher, a conta ou o cartão precisa ser **do próprio perfil** (`reference-outside-profile`)
   e estar **ativo** (`account-disabled`, `credit-card-disabled`): o atalho que escolhesse um
   desativado só trocaria a escolha por um erro ao salvar.
2. Escolher outro substitui o anterior; `null` tira o padrão.
3. Se a conta ou o cartão for desativado ou excluído depois, ele **deixa de valer como padrão
   na leitura** (`SqliteProfileRepository`), sem apagar a escolha: reativar devolve o padrão,
   como reativar devolve todo o resto ([§5.1](#51-desativar-é-o-padrão-excluir-é-explícito)).

Onde mora: `ProfileService.setDefaultAccount` / `setDefaultCreditCard`. Testes: bloco "conta e
cartão padrão do lançamento" de [`profiles.test.ts`](../../../packages/core/test/services/profiles.test.ts).

### 3.2 Por que fica no perfil

A regra "no máximo um" vale por construção numa coluna só. Um marcador por linha em
`accounts`/`credit_cards` dependeria de desmarcar o anterior na mesma escrita, e a sincronização,
que mescla célula a célula, deixaria duas contas marcadas quando dois aparelhos escolhessem
padrões diferentes ao mesmo tempo. Ver [decisões](../decisoes.md) ([ADR 57](../decisoes.md#adr-57)).

## 4. Primeiro uso

### 4.1 Perfil, primeira conta e categorias numa unidade de trabalho

Regra de negócio (Primeiro uso): a rota `onboarding.start`
([`OnboardingService`](../../../packages/core/src/services/onboarding/OnboardingService.ts)) cria
**o perfil e a primeira conta na mesma unidade de trabalho** — se a conta falha, o perfil
também não fica. Um perfil sem conta não tem onde lançar nada e reabriria o app num estado que
nenhuma tela trata.

Na mesma unidade entram as **categorias sugeridas** (`suggestedCategories`, ligado por padrão;
`CategoryService.seedSuggested`), porque toda transação aponta para uma subcategoria e, sem
nenhuma, o primeiro lançamento seria recusado (ver [categorias e tags](categorias-e-tags.md)).
A semeadura pula as que já existem pelo nome. Ver [decisões](../decisoes.md) ([ADR 68](../decisoes.md#adr-68)).

Testes: bloco "primeiro uso" de [`profiles.test.ts`](../../../packages/core/test/services/profiles.test.ts).

### 4.2 A tela de primeiro uso

- **Banco sem perfil abre o primeiro uso, fora do shell.** No desktop é o `whenEmpty` do
  provedor do perfil ativo, e não uma rota: o roteador só existe com um perfil ativo. No
  celular, sem perfil o shell não abre.
- **Formulário:** perfil (nome, tipo, moeda) e primeira conta (nome, saldo inicial; no desktop
  também o tipo). Validado pelo `readOnboardingForm` do `client`, que roda o mesmo schema
  (`startOnboardingRequest`) que o núcleo aplica na fronteira, então a mensagem da tela e a
  recusa do núcleo nunca discordam. Regra de negócio (Contas): **saldo em branco é zero**.
  A conta nasce na moeda do perfil; no celular ela nasce corrente (investimento se escolhe
  depois, em Contas).
- **Ao concluir:** o perfil criado vira o aberto e o mês de referência volta ao corrente, para
  que rota e mês guardados de um banco anterior não valham.
- **"Entrar num grupo existente"** leva à entrada num grupo de sincronização, que só é possível
  num aparelho ainda sem dados (ver [sincronização](../arquitetura/sincronizacao.md)).

Onde mora: [`onboardingForm.ts`](../../../packages/client/src/forms/onboardingForm.ts),
[`FirstUseScreen.tsx` (desktop)](../../../apps/desktop/src/renderer/src/firstUse/FirstUseScreen.tsx),
[`FirstUseScreen.tsx` (celular)](../../../apps/mobile/src/screens/FirstUseScreen.tsx). Testes:
[`onboardingForm.test.ts`](../../../packages/client/test/onboardingForm.test.ts),
[`firstUse.spec.ts`](../../../apps/desktop/e2e/firstUse.spec.ts),
[`firstUse.test.tsx`](../../../apps/mobile/test/firstUse.test.tsx).

## 5. Regras que valem para todos os cadastros financeiros

### 5.1 Desativar é o padrão; excluir é explícito

Regra de negócio (Contas e Cartões): a ação padrão sobre conta ou cartão é **desativar**, que
não apaga nada nem muda saldo; excluir é a ação explícita, precedida do alerta com tudo o que
será apagado. Detalhes em [contas §5.1](contas.md#51-desativar),
[contas §5.2](contas.md#52-excluir-em-cadeia-o-que-é-apagado-junto) e
[cartões e faturas §6](cartoes-e-faturas.md#6-desativar-e-excluir-cartão). Ver
[decisões](../decisoes.md) ([ADR 55](../decisoes.md#adr-55)).

### 5.2 Exclusão é soft delete

Toda exclusão do app carimba `deleted_at` (soft delete), inclusive em cadeia, e nunca roda
`DELETE`: a sincronização propaga exclusões por `deleted_at`. Um registro excluído some de toda
leitura; um id derivado (ocorrência de série, extrato, fatura) pode ser **revivido** quando volta
a ser gerado (ver [recorrências §4.1](recorrencias.md#41-o-número-da-ocorrência-é-a-identidade)).

### 5.3 Confirmações dizem o que muda

Regra de interface (confirmações): **nada de aviso genérico**. Toda confirmação de uma ação
destrutiva ou que mexe em saldos diz o que está em jogo — o que será apagado, de onde o valor
sai, quais outras contas e meses mudam de saldo. Exemplos:

- exclusão em cadeia de conta ou cartão: contagem de cada item e as outras contas afetadas
  ([contas §5.3](contas.md#53-o-alerta-é-o-escopo));
- exclusão de um lançamento: de onde o valor sai e quais saldos mudam
  ([transações §7](transacoes.md#7-excluir-um-lançamento));
- pagar e reabrir fatura: o extrato que recebe ou devolve o valor e o saldo antes → depois
  ([cartões e faturas §3](cartoes-e-faturas.md#3-pagamento-da-fatura));
- edição e exclusão de séries: o diálogo de revisão lista o que será excluído, criado e
  alterado ([recorrências §7](recorrencias.md#7-diálogos-de-escopo-e-de-revisão)).

As frases moram em view-models do `client` (`describeAccountDeletion`,
`describeTransactionDeletion`, `describeInvoicePayment`, `describeSeriesPlan`…), para que
desktop e celular digam a mesma coisa.

### 5.4 Toda escrita recalcula os saldos na mesma unidade de trabalho

Qualquer escrita que mexe em dinheiro grava, garante o contêiner (extrato ou fatura) e
recalcula os saldos afetados numa única unidade de trabalho: um saldo nunca fica visível pela
metade. Ver [contas §3.4](contas.md#34-recálculo).

## 6. Limitações conhecidas

- Não há exclusão de perfil nem troca do tipo depois de criado.
- A lista de moedas dos formulários é curta (`CURRENCY_OPTIONS`); outras moedas só entram por
  dado já gravado.
