# Regras de trabalho neste projeto

## Projeto

Monorepo pnpm em TypeScript estrito (Node 24) de finanças pessoais: núcleo compartilhado + app desktop (Electron) + app mobile (React Native), com sincronização entre dispositivos.

- `packages/core` — núcleo em camadas Request → Controller → Service → Repository → Model, com domínio puro (`Money`, `LocalDate`, `Invoice`...) e portas (`Database`, `Clock`, `IdGenerator`) implementadas em `infrastructure/`. O que cada pacote pode importar é verificado pelo `eslint.config.js`.
- `packages/client` — camada headless compartilhada pelos dois apps (hooks, queries, view-models, formulários).
- `packages/sqlite-better` / `packages/sqlite-expo` — adaptadores `better-sqlite3` (desktop e testes) e `expo-sqlite` (celular) da porta `Database`.
- `packages/tokens` — tokens de design; `packages/assets` — arquivos de marca (o ícone do Finanças em todos os formatos).
- `apps/desktop`, `apps/mobile`, `apps/mobile-contract` — app Electron, app Expo e app de contrato que prova a paridade do núcleo no Hermes.
- `docs/wiki/` — wiki técnica: arquitetura, tecnologias, mapa do sistema, regras de negócio e decisões (ADRs). **Consulte a página do módulo antes de alterá-lo**; as regras de negócio estão lá.

## Wiki — atualizada na mesma entrega

Toda alteração que muda uma regra de negócio, a arquitetura, uma dependência ou uma decisão atualiza a página correspondente de `docs/wiki/` no mesmo commit. Decisão nova ou revista ganha um ADR em `docs/wiki/decisoes.md`, e a antiga recebe o status "substituída por §N" em vez de ser apagada. As seções da wiki são numeradas e citadas pelo código: ao renumerar, atualize as citações (`grep -rn "<página> §" packages apps`).

**Por quê:** a wiki substituiu os planos e designs antigos como fonte da verdade documental; se ela ficar para trás do código, as citações nos docblocks passam a apontar para regras que não valem mais.

Comandos (na raiz):

- `pnpm check` — lint + typecheck + testes; rodar antes de dar uma entrega por concluída.
- `pnpm test`, `pnpm typecheck`, `pnpm lint` — etapas isoladas.
- `pnpm embed:migrations` — regenerar após criar/alterar migration em `db/migrations`, porque o mobile usa as migrations embutidas.

## Idioma

- PT-BR com acentuação correta em mensagens de commit, comentários, docblocks e documentação.
- Identificadores de código (tipos, classes, funções, variáveis, arquivos) em inglês.

## Padrão de código — obrigatório

Todo código implementado, corrigido ou refatorado deve seguir este padrão, não apenas "funcionar":

- **Tipagem estrita:** sem `any`, sem `as` para silenciar o compilador; tipos marcados (`Brand`) para ids e valores que não podem se misturar.
- **Contratos explícitos:** validação de entrada com schemas zod em `requests/`, DTOs de resposta em `dto/` e Value Objects no domínio, em vez de objetos soltos e tipos primitivos.
- **Imutabilidade:** propriedades `readonly`; operações retornam novas instâncias em vez de mutar.
- **Desacoplamento da infraestrutura:** domínio e services dependem só de portas; implementações concretas entram apenas pela raiz de composição (`createCore`).
- **Design Patterns** quando resolvem um problema real (Strategy, Repository, Factory...), nunca por enfeite.
- **Testes:** toda regra de negócio nova ou alterada ganha teste Vitest em `packages/<pacote>/test`.

## Docblock com motivação — obrigatório

Toda função, método, classe e tipo criado ou editado (inclusive privados, closures nomeadas, helpers de teste e migrations) tem docblock JSDoc. Ao editar, atualize o docblock se a motivação mudou.

- **Explique o porquê, não o quê:** o problema que resolve, a invariante que protege, a falha que evita ou por que a alternativa óbvia foi descartada. O que o código faz se lê no próprio código.
- **Regra de negócio é citada explicitamente**, com domínio e regra (ex.: `// Regra de negócio (Relatórios, relatorios §2.1): todo valor conta no mês do pagamento`), referenciando a seção da wiki no formato `<página> §N` (nome do arquivo de `docs/wiki/` sem `.md`). Regra nova entra na wiki antes de ser citada.
- **`@param nome Descrição`** para todo parâmetro: o que é e por que a função precisa dele. Não repita o tipo — a assinatura TS já o declara.
- **`@return`** sempre que a função retornar algo: o que vem e em que situação (ex.: quando pode ser `null` ou vazio). Funções `void` dispensam.
- **`@throws`** quando a função lançar erro de forma intencional.

```ts
/**
 * Calcula o saldo do extrato a partir da fatura paga, e não da data da compra, porque o
 * relatório precisa refletir quando o dinheiro de fato saiu da conta.
 * Regra de negócio (Relatórios): compras no cartão contam no extrato em que a fatura foi paga.
 *
 * @param invoice Fatura cujo pagamento define o mês em que as compras entram no extrato.
 * @param statement Extrato de destino; fornece o saldo de abertura sobre o qual o valor é somado.
 * @return O novo extrato com o saldo atualizado; o original não é alterado.
 * @throws InvoiceNotPaidError Quando a fatura ainda não foi paga e não tem mês de pagamento.
 */
```

## Formatação — sem espaços de alinhamento

Siga o `.editorconfig`: 4 espaços por nível (2 em YAML), nunca tab. **Não alinhe código em colunas** com espaços extras — nem `=`, nem `:` de objetos, nem descrições de `@param`, nem comentários de fim de linha. Em docblock, a continuação de uma linha longa começa logo após o ` * `.

**Por quê:** o alinhamento quebra quando entra um nome mais longo e obriga a reformatar as linhas vizinhas, sujando o diff e escondendo a alteração real no review.

```ts
// Errado
const companyId   = request.companyId;
const workareaId  = request.workareaId;

// Certo
const companyId = request.companyId;
const workareaId = request.workareaId;
```

## Telas — convenções de UI

**Antes de criar ou alterar qualquer tela** (desktop ou mobile), leia as convenções de UI vigentes em `docs/wiki/arquitetura/desktop.md` §7 (valem também para o celular) e a seção de telas da página de regras de negócio do módulo.

- Desktop: Tailwind + shadcn/ui. Mobile: NativeWind. Cores, tipografia e espaçamentos só a partir de `packages/tokens` (nunca valor literal).
- Mudança de layout ou navegação que contrarie uma convenção da §7 é combinada antes de implementar e, aprovada, atualiza a wiki.

**Por quê:** as convenções (tema claro/escuro, mês de referência fixo, entrada/saída sem depender só da cor) valem para todas as telas; ignorá-las gera retrabalho e inconsistência entre desktop e celular.

## Versionamento — obrigatório em toda alteração

Cada pacote tem a própria versão SemVer no `package.json`. **Toda alteração de código ajusta, na mesma entrega, a versão de cada pacote que ela tocou** — e só deles.

| Caminho alterado | Versão a ajustar |
|------------------|------------------|
| `apps/desktop/**` | `apps/desktop/package.json` |
| `apps/mobile/**` | `apps/mobile/package.json` |
| `apps/mobile-contract/**` | `apps/mobile-contract/package.json` |
| `packages/client/**` | `packages/client/package.json` |
| `packages/core/**` | `packages/core/package.json` |
| `packages/sqlite-better/**` ou `db/migrations/**` (banco) | `packages/sqlite-better/package.json` |
| `packages/sqlite-expo/**` | `packages/sqlite-expo/package.json` |
| `packages/tokens/**` | `packages/tokens/package.json` |
| `packages/assets/**` | `packages/assets/package.json` |
| qualquer um dos acima | `package.json` da raiz (versão do produto) |

O incremento segue o tipo do commit (Conventional Commits):

- `feat` → minor (`1.4.2` → `1.5.0`).
- `fix`, `perf`, `refactor`, `style` → patch (`1.4.2` → `1.4.3`).
- `BREAKING CHANGE` ou `!` no tipo → major (`1.4.2` → `2.0.0`).
- `docs`, `test`, `chore`, `ci`, `build` → sem alteração de versão.
- A raiz recebe o maior incremento entre os pacotes alterados.
- Pacote novo nasce em `1.0.0`.

Exemplos:

- Melhoria de layout no desktop (`style(desktop)`): só `apps/desktop` e a raiz sobem patch.
- Nova feature com migration, rota no core e tela (`feat`): `sqlite-better`, `core`, `client` (se os hooks/queries mudarem), `desktop` e a raiz sobem minor.

Uma entrega com vários commits sobe a versão uma vez por commit, conforme o tipo de cada um. Antes de dar a entrega por concluída, confira com `git diff --stat` quais pacotes foram tocados e se cada um teve a versão ajustada.

**Por quê:** a versão de cada pacote precisa refletir o histórico dele; ajustar depois, em lote, leva a números trocados entre pacotes e a versões que não correspondem a nenhum commit.

## Git

- **Commit:** pelo comando `/commit` (`.claude/commands/commit.md`), que monta a mensagem em Conventional Commits/PT-BR e só commita após pedido explícito do usuário.
- Nunca rode `git add` por conta própria; o usuário decide o que vai para o stage.
- `push`/`merge` exigem confirmação própria e separada — autorizar o commit não autoriza o push.
- Fluxos que dependem de interação com o usuário (validação, commit) rodam na conversa principal, nunca como sub-agente: o sub-agente não consegue perguntar nem confirmar nada.
