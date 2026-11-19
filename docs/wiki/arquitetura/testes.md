# Testes

Esta página descreve a estratégia de testes do Finanças como ela existe hoje: onde está o risco, as
ferramentas, as camadas da suíte, por que os testes usam SQLite real e não mocks, os testes de mesa e
de propriedade, o tratamento de tempo e de dinheiro nos testes, os testes de migration e de contrato
dos adaptadores, a paridade entre Node e Hermes, a medição de desempenho, os testes dos apps e o que
bloqueia um merge. O código testado está descrito em [Núcleo](core.md) e
[Banco de dados](banco-de-dados.md).

## 1. Estratégia

### 1.1 Onde o risco está

Os bugs prováveis deste sistema não são exceções: são **números errados que parecem certos**. A suíte
existe para pegar casos como:

- uma compra cair na fatura errada por causa do dia de fechamento — inclusive o dia 31 em meses de 30
  dias e em fevereiro;
- uma transação com soft delete entrar num total;
- editar março e o fechamento de abril não acompanhar;
- uma transação mudar de contêiner e só o contêiner novo ser recalculado;
- uma fatura paga não entrar no extrato do mês do pagamento;
- parcelas que não somam o total; ocorrências de recorrência duplicadas ou recriadas depois de
  excluídas;
- os escopos "somente esta", "esta e as futuras" e "todas" tocarem linhas a mais ou a menos;
- transferências contadas duas vezes no total do perfil;
- o celular calcular um valor diferente do desktop.

Cada técnica abaixo cobre uma parte dessa lista.

### 1.2 Ferramentas

| Ferramenta | Papel |
|---|---|
| **Vitest** | Runner de todos os pacotes TypeScript (`core`, `client`, `sqlite-expo`, `tokens`, desktop). TypeScript nativo, rápido, o mesmo runner em todo lugar |
| **fast-check** | Testes baseados em propriedades (§2.3, §2.6) |
| **better-sqlite3 `:memory:`** | Banco real por teste, com todas as migrations aplicadas pelo runner de produção, em milissegundos |
| **Playwright** | Testes de ponta a ponta do app desktop empacotado pelo `electron-vite` (§6.1) |
| **Jest** | Testes do app do celular e do app de contrato, no preset do React Native (§6.2) |
| **Maestro** | Fluxos no emulador Android: contrato no Hermes e teste de fumaça do app (§4.2, §7.3) |

Não há métrica de cobertura de linhas nem mutation testing (§7.4).

### 1.3 As camadas da suíte

| Camada | O que cobre | Banco | Onde |
|---|---|---|---|
| Domínio puro | `Money`, arredondamento, divisão de parcelas, ciclo de fatura, calendário de recorrências, HLC, ordenação de nomes | Nenhum | `packages/core/test/domain` |
| Service | Cada caso de uso, de ponta a ponta até o SQL, pelas rotas | SQLite real em memória | `packages/core/test/services` |
| Testes de mesa | Cenários financeiros com resultado calculado à mão (§2.2) | SQLite real em memória | `balances.table.test.ts` e outros |
| Propriedades | Sequências aleatórias de operações contra invariantes (§2.3) | SQLite real em memória | `balances.property.test.ts` |
| Sincronização | Captura, aplicação de lotes, protocolo e convergência entre réplicas (§2.6) | Várias réplicas em memória | `packages/core/test/sync`, `test/protocol` |
| Infraestrutura | Contrato da porta, migrations embutidas e travadas, backup, SQL de períodos, cópia do banco (§3) | Real | `packages/core/test/infrastructure` |
| Paridade | Vetores de ouro (§4) | — | `test/golden` no `core` e no `client` |
| `client` | View-models, formulários, formatação, hooks e sequência de abertura, contra o núcleo real | SQLite real em memória | `packages/client/test` |
| Apps | Telas, processo do núcleo, abertura e fluxos completos (§6) | Real | `apps/*/test`, `apps/desktop/e2e` |

### 1.4 Onde ficam e quando escrever

Regra do projeto (`CLAUDE.md`): **toda regra de negócio nova ou alterada ganha teste Vitest em
`packages/<pacote>/test`**. Os títulos de `describe`/`it` são frases em PT-BR que dizem a regra
verificada e, quando houver, a seção da wiki que a define, para que uma falha diga o que quebrou.

## 2. Testes do núcleo

### 2.1 SQLite real, não mocks

Os testes de Service **não mockam o Repository**. Cada teste monta um
[`TestWorld`](../../../packages/core/test/support/TestWorld.ts): um banco `better-sqlite3` em memória,
`openDatabase` com as migrations embutidas e o núcleo inteiro de `createCore` por cima, chamado pelas
mesmas rotas que a UI usa.

**Por quê:** metade dos bugs da §1.1 mora no SQL — o `deleted_at IS NULL` esquecido, o `WHERE` do
escopo "esta e as futuras", o `SUM` no contêiner errado. Um mock de Repository devolve o que o teste
mandou e esconde exatamente essas falhas. O banco em memória é rápido o bastante para não haver troca.
É também o único jeito de testar a configuração da conexão e o cascade
([Banco de dados](banco-de-dados.md) §3.2).

Detalhes do `TestWorld` que fazem diferença:

- **Os cadastros de apoio (perfil, conta, cartão, subcategoria) são semeados por SQL direto**, para que
  um teste de saldo não falhe por um defeito no cadastro; os testes dos cadastros usam as rotas.
- **As conferências leem direto das tabelas** (`statementRow`, `accountRow`, `invoiceRow`), para que a
  asserção não dependa do código testado.
- **`onUnexpectedError` relança**: um bug nunca passa como um `INTERNAL` silencioso.

Só as portas de tempo e de ids são substituídas, por adaptadores **de verdade** cujo comportamento o
teste controla ([adapters.ts](../../../packages/core/test/support/adapters.ts)), não por mocks:

- `FixedClock`: "hoje" fixado e movido pelo teste (`set`); `now()` é meio-dia UTC de "hoje";
- `SequentialIds`: UUIDs v4 válidos e previsíveis, com um namespace por réplica nos testes de
  sincronização, para falhas reproduzíveis;
- `ManualWallClock`: milissegundos controlados para o HLC.

O `client` tem o equivalente, `ClientWorld`, para testar view-models e hooks contra o núcleo real.

### 2.2 Testes de mesa

São a base de confiança do resto: **cenários financeiros concretos com o resultado calculado à mão**,
escritos como dado → quando → então, com o cálculo esperado em comentário. Uma conta, alguns meses de
lançamentos e os saldos esperados de cada mês, no consolidado e no previsto.

O catálogo está em [balances.table.test.ts](../../../packages/core/test/services/balances.table.test.ts)
(numerado pelos casos abaixo) e, para recorrências, em
[recurrences.test.ts](../../../packages/core/test/services/recurrences.test.ts):

1. Mês simples: receitas e despesas pagas e em aberto numa conta corrente.
2. Compra no cartão antes, **no** e depois do dia de fechamento, e lançada à mão numa fatura diferente
   da sugerida — inclusive numa fatura já paga.
3. Cartão com fechamento no dia 31 em abril, em fevereiro e em fevereiro bissexto.
4. Fatura de março paga em abril, entrando no extrato de abril.
5. Parcelamento de R$ 1.000,00 em 3x ("total") e de 12x R$ 100,00 ("por parcela"), atravessando a
   virada do ano.
6. Recorrência mensal no dia 31; anual em 29/02.
7. Transferência entre duas contas do perfil; pagamento parcial de fatura e sua exclusão; reabertura de
   fatura paga.
8. Edição de uma transação de janeiro com os fechamentos seguintes já calculados.
9. Transação movida de uma fatura para um extrato.
10. Os três escopos de edição e de exclusão de recorrência, com ocorrências pagas.
11. Conta com `consider_balance = 0` fora do consolidado; saldo inicial editado depois de meses
    lançados.
12. Estorno: despesa de cartão negativa reduzindo a fatura; consolidado e previsto do mesmo mês.
13. Transação com soft delete nos cenários acima.

Também há cenários de encargos (sempre custo da origem), virada do mês, entradas e saídas do extrato,
dia do pagamento da fatura e extrato pela data de pagamento. Um teste de mesa que codifica uma regra
adivinhada só prova que o código concorda com o palpite: a regra é fechada (e documentada nas páginas
de [regras de negócio](../README.md)) antes do teste.

### 2.3 Invariantes e testes de propriedade

[balances.property.test.ts](../../../packages/core/test/services/balances.property.test.ts) usa o
fast-check para gerar sequências aleatórias de operações — criar (receita, despesa, transferência, em
conta ou cartão, com fatura deslocada), editar, marcar pago, excluir, pagamento parcial, pagar e reabrir
fatura, avançar o relógio — sobre um cenário fixo de duas contas e dois cartões (um fechando no dia 31).
Depois de **cada** operação verifica:

- todo saldo em cache bate, dentro do epsilon, com um **oráculo independente** escrito no próprio teste
  (150 execuções);
- em todo mês, inicial + entradas + saídas = final no extrato, nos dois saldos (100 execuções).

O oráculo é independente da rotina de recálculo de produção de propósito: um recálculo com bug aprovaria
o mesmo bug no cache. Toda falha do fast-check imprime a semente e a sequência mínima, que vira um teste
fixo de regressão.

Invariantes que o desenho também quer e são cobertos por testes de Service dirigidos, não por
propriedades: parcelas vivas de uma série "total" somam o total; nenhuma ocorrência excluída reaparece
depois do complemento; transferências internas somam zero no perfil; a verificação de integridade não
encontra nada depois das operações ([integrity.test.ts](../../../packages/core/test/services/integrity.test.ts)).

### 2.4 Tempo e fuso horário

- **Nada no núcleo lê o relógio do sistema** (lint, [Núcleo](core.md) §7). Testes que dependem de
  "hoje" — saldo do mês corrente, complemento de recorrências, escopo "futuras", fatura em aberto —
  fixam o `FixedClock` numa data explícita.
- **A suíte roda duas vezes no CI**, com `TZ=UTC` e com `TZ=America/Sao_Paulo` (§7.2). Datas são texto
  sem fuso e timestamps são UTC; um `Date` construído no lugar errado só aparece como bug perto da
  meia-noite, num fuso diferente de UTC. Rodar nos dois faz o bug aparecer no CI, e não às 22h de um
  dia 31. O `SystemClock` do `client` tem teste próprio para a diferença entre `now` (UTC) e `today`
  (local).

### 2.5 Comparando dinheiro

O matcher `expect(valor).toEqualMoney('1234.56')`
([matchers.ts](../../../packages/core/test/support/matchers.ts), carregado em todo teste do `core` pelo
`setupFiles`) compara com o epsilon da moeda usando o mesmo `Money.equals` de produção. Aceita um
`Money` ou um `MoneyResponse`. O esperado é escrito como string decimal, para o teste dizer o que um
humano conferiria no extrato. Comparar dinheiro com `toBe` ou `===` contraria a convenção (não há regra
de lint para isso).

### 2.6 Sincronização

Os testes da sincronização (`packages/core/test/sync` e `test/protocol`) cobrem a captura das escritas,
a aplicação de lotes, a lista de membros, as rotas da tela de Dispositivos, o canal Noise e o convite. O
teste de **convergência**
([convergence.property.test.ts](../../../packages/core/test/sync/convergence.property.test.ts)) usa
fast-check para gerar operações e trocas aleatórias entre réplicas em memória e exige que todas terminem
idênticas nas tabelas de domínio (100 execuções). Detalhes em [Sincronização](sincronizacao.md).

## 3. Banco de dados

### 3.1 Migrations

O que existe hoje:

- **Migrations embutidas iguais aos arquivos**:
  [database.test.ts](../../../packages/core/test/infrastructure/database.test.ts) falha se
  `embedded.generated.ts` divergir de `db/migrations/*.sql` (mensagem: rode `pnpm embed:migrations`).
- **Imutabilidade**: o mesmo arquivo recalcula o SHA-256 de cada migration e o compara com o
  `checksums.lock`, lido sem passar pelo script que o grava, para que um bug no script não aprove a si
  mesmo ([Banco de dados](banco-de-dados.md) §5.3).
- **Aplicação e recusa** pela suíte de contrato (§3.2): migrations aplicadas uma vez com `user_version`
  registrado, banco mais novo que o app recusado, migration com erro de SQL vira `MigrationFailedError`
  e mantém as anteriores.
- **Backup** ([migrationBackup.test.ts](../../../packages/core/test/infrastructure/migrationBackup.test.ts)):
  cópia com os dados de antes, nada copiado em banco novo ou em dia, falha mantendo o backup para
  restaurar, falha na cópia impedindo a migration, rotação de três cópias ordenada pelo instante.
- **Caminhos de falha da abertura** nos shells: banco mais novo, migration que falha (e que falha de
  novo, oferecendo o backup da primeira tentativa), restauração pela metade, marca ilegível, arquivo que
  não é SQLite, série que falha no complemento (`apps/desktop/test/openCore.test.ts`,
  `packages/client/test/startup.test.ts`, `apps/mobile/test/restoreBackup.test.ts`).
- **Cópia do banco** ([databaseCopy.test.ts](../../../packages/core/test/infrastructure/databaseCopy.test.ts)):
  exportar e conferir antes de importar, recusando versão mais nova e SQLite de outro programa.

Não existem hoje (§9): a comparação "instalação limpa = atualização" dos `sqlite_schema` normalizados e
bancos de cada versão publicada (`db/fixtures/vN.sqlite`) atualizados até a versão atual.

### 3.2 Contrato dos adaptadores

Uma única suíte ([databaseContract.ts](../../../packages/core/src/contract/databaseContract.ts),
`@finance/core/contract`) verifica o que o núcleo espera da porta `Database`: SQLite 3.38+ com
`STRICT`, rollback em exceção, commit devolvendo o valor, `REAL` como `number` e `NULL` como `null`,
inteiros acima de 32 bits e centavos sem perda, `STRICT` respeitado, parâmetro nomeado repetido, reuso de
instrução, leitura parcial seguida de escrita, `foreign_keys` ligado com hard delete de perfil
cascateando, migrations, banco mais novo recusado e falha de migration. `runDatabaseContract` roda todos
os casos e lista cada violação sem parar na primeira (há um teste com um adaptador propositalmente
quebrado para provar isso).

Ela roda em três lugares, para que a diferença entre drivers apareça ali, e não como um saldo diferente
entre celular e desktop:

1. contra o `better-sqlite3`, no `core`;
2. contra o `ExpoSqliteDatabase` sobre um dublê (`FakeExpoConnection`), no `sqlite-expo`, junto com os
   testes das particularidades do adaptador ([Banco de dados](banco-de-dados.md) §6.2);
3. contra o `expo-sqlite` real no Hermes, pelo app de contrato no emulador (§4.2).

## 4. Paridade entre runtimes

### 4.1 Vetores de ouro

O Node calcula as saídas de entradas difíceis — arredondamento, divisão de parcelas, UUID v5,
ordenação de nomes no `core`; formatadores no `client` — e grava `vectors.json` em cada pacote
([Núcleo](core.md) §8). Os testes `test/golden/goldenVectors.test.ts` conferem que:

- o arquivo versionado está em dia com o código (se o código mudou de propósito,
  `pnpm golden:generate` regrava);
- ele sobrevive à ida e volta pelo JSON;
- o UUID v5 bate com o exemplo publicado no RFC 9562 e a divisão dá o resto à primeira parcela.

### 4.2 App de contrato

`apps/mobile-contract` é um app Android mínimo, em APK de release (bytecode do Hermes, sem Metro), que
roda a suíte de contrato contra o `expo-sqlite` real e recalcula os vetores de ouro do `core` e do
`client` no aparelho, mostrando "Contrato: passou" ou a lista do que divergiu
([README](../../../apps/mobile-contract/README.md)). Roda no CI pelo fluxo Maestro
`.maestro/contract.yaml` (§7.3); `pnpm --filter @finance/mobile-contract test` roda o mesmo contrato no
Node. Se passa no Node e falha no aparelho, a causa é do Hermes ou do `expo-sqlite`: corrige-se o código
ou o adaptador, nunca se regenera o vetor para aceitar a saída do Hermes.

## 5. Desempenho

### 5.1 Banco de histórico

`pnpm db:history <arquivo>`
([generate-history-database.ts](../../../packages/core/scripts/generate-history-database.ts)) gera um
banco de dez anos de uso, reproduzível por semente, que o desktop abre e que vai para o celular numa
build de desenvolvimento. Recusa sobrescrever arquivo existente (o caminho pode ser, por engano, o banco
real) e termina com `integrity.verifyBalances`. O teste
[historyDatabase.test.ts](../../../packages/core/test/fixtures/historyDatabase.test.ts) confere que os
saldos do banco gerado batem com o recálculo e que a mesma semente gera as mesmas transações.

### 5.2 Benchmark das chamadas interativas

As chamadas interativas (lançar e as leituras que seguem um toque) têm orçamento de **p95 ≤ 50 ms**
(`INTERACTIVE_P95_BUDGET_MS`). O roteiro está em
[interactiveBenchmark.ts](../../../packages/core/src/benchmark/interactiveBenchmark.ts) e é o mesmo no
Node e no aparelho, para que a diferença seja do runtime e não da medição:

- `pnpm bench:core <arquivo>` mede no Node sobre o banco de histórico (40 rodadas por operação) e sai
  com código 1 se alguma operação estourar o orçamento;
- `pnpm bench:android` mede no emulador;
- no desktop, o projeto Playwright `measure` mede pela UI.

O benchmark **não** roda no `pnpm check`; o teste
[interactiveBenchmark.test.ts](../../../packages/core/test/benchmark/interactiveBenchmark.test.ts) só
garante que o roteiro mede as operações, deixa o banco como encontrou e formata o veredito.

## 6. Testes dos apps

### 6.1 Desktop

`pnpm --filter @finance/desktop test` roda o Vitest (processo do núcleo, abertura do banco, protocolo
IPC, telas por área), depois `electron-vite build` e o projeto Playwright `e2e`
([apps/desktop/e2e](../../../apps/desktop/e2e/)), que abre o Electron de verdade e percorre os fluxos
(primeiro uso, lançamentos, cartões, recorrências, relatórios, sincronização...). Os projetos `measure`
e `packaged` (app empacotado) rodam à parte. Detalhes em [Desktop](desktop.md).

### 6.2 Mobile

`apps/mobile` usa Jest com o preset do React Native para telas, navegação, abertura e restauração do
banco, adaptadores da sincronização e o tema; o teste de fumaça no emulador (Maestro, `apps/mobile/.maestro`)
abre o APK de release num banco vazio e chega ao primeiro uso. Detalhes em [Mobile](mobile.md).

## 7. O que bloqueia um merge

### 7.1 `pnpm check`

Na raiz, `pnpm check` = `pnpm lint && pnpm typecheck && pnpm test`: ESLint com as regras de fronteira
([Núcleo](core.md) §7), `tsc` de cada pacote (código e testes) e o `test` de cada pacote — incluindo os
testes de migration, o contrato, os vetores de ouro e o Playwright do desktop. Rode antes de dar uma
entrega por concluída (`CLAUDE.md`).

### 7.2 CI em dois fusos

O workflow [check.yml](../../../.github/workflows/check.yml) roda `pnpm check` em todo push para
`master` e em todo pull request, numa matriz `TZ=UTC` e `TZ=America/Sao_Paulo` (§2.4), com Node 24 e
`pnpm install --frozen-lockfile`; o Electron roda num X virtual (`xvfb-run`).

### 7.3 Workflow do celular

O workflow [mobile.yml](../../../.github/workflows/mobile.yml) roda quando muda algo que entra no bundle
do celular (`packages/core`, `client`, `sqlite-expo`, `tokens`, `apps/mobile*`, `db/migrations`, o
lockfile): gera os APKs de release, sobe um emulador Android x86_64 e roda primeiro o contrato
(§4.2) e depois o teste de fumaça do app. O contrato roda antes porque, se o núcleo diverge no Hermes,
a falha de fumaça seria só consequência.

### 7.4 Sem mutation testing nem cobertura

O desenho previa mutation testing com Stryker nos módulos de saldo, fatura, parcelamento e recorrência,
com meta de 90% de mutantes mortos bloqueando o CI. **Isso não existe hoje**: não há configuração do
Stryker no repositório. Também não há métrica de cobertura de linhas, de propósito — cobertura não diz se
um teste detectaria o bug.

## 8. Como escrever um teste novo

1. **Regra de domínio pura** (cálculo de data, dinheiro, calendário): teste em
   `packages/core/test/domain`, sem banco.
2. **Caso de uso**: um `TestWorld` com o "hoje" que importa, semeando o mínimo e chamando a rota
   (`world.ok(route, input)`, `world.create(...)`); confira lendo as tabelas e comparando dinheiro com
   `toEqualMoney`.
3. **Regra de saldo**: acrescente o cenário ao teste de mesa, com o cálculo esperado em comentário, e
   inclua uma transação excluída quando fizer sentido.
4. **Valor que pode divergir entre runtimes** (arredondamento, texto, formatação): acrescente entradas
   aos vetores de ouro e rode `pnpm golden:generate`.
5. **Migration nova**: `pnpm embed:migrations` atualiza o embutido e o lock; os testes de §3.1 conferem.
6. Docblock com motivação também nos helpers de teste (`CLAUDE.md`).

## 9. Limitações conhecidas

- **Mutation testing** (Stryker) não existe (§7.4).
- **Testes de migration com dados**: não há bancos de versões anteriores versionados nem a comparação
  de schema entre instalação limpa e atualização (§3.1).
- **Propriedades** cobrem só os saldos e a convergência da sincronização; recorrências e escopos têm
  testes dirigidos, não sequências aleatórias.
- **Lint não proíbe `toBe`/`===` em dinheiro** (§2.5).
- **O benchmark** não roda no CI de cada pull request (§5.2).
