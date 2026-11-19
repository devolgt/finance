# Decisões de arquitetura

Registro das decisões que moldam o sistema e continuam valendo: o contexto, o que foi
escolhido, as alternativas descartadas com o motivo e o custo aceito. As páginas da wiki
descrevem o *como*; aqui fica o *porquê* e o que reabriria cada decisão.

O código cita estas decisões como `decisoes §N`. A numeração é estável: uma decisão
substituída ganha o status "substituída por §M" em vez de ser apagada ou renumerada.

## Índice

**Produto e arquitetura geral**

- [1. Local-first, sem servidor e sem custo recorrente](#adr-1)
- [2. Núcleo em camadas no estilo MVC com portas e raiz de composição](#adr-2)
- [3. Núcleo em TypeScript puro, sem dependência do Node](#adr-3)
- [4. TypeScript estrito além do `strict`](#adr-4)
- [5. Fronteiras de arquitetura verificadas por lint](#adr-5)
- [6. Pacotes internos exportam o fonte TypeScript, sem etapa de build](#adr-6)
- [7. Monorepo pnpm no modo isolado](#adr-7)

**Desktop e celular**

- [8. Electron como shell do desktop, e não Tauri](#adr-8)
- [9. React nos dois apps, compartilhando a camada headless e não a UI](#adr-9)
- [10. React Native com Expo para o celular](#adr-10)
- [11. Núcleo no runtime JavaScript principal, com o `expo-sqlite` síncrono](#adr-11)
- [12. NativeWind sobre os tokens compartilhados no celular](#adr-12)
- [13. Tailwind, shadcn/ui e tokens como dados no desktop](#adr-13)
- [14. Erros atravessam a fronteira como resultado, e `INTERNAL` é fatal no desktop](#adr-14)
- [15. O renderer fala direto com o `utilityProcess` por `MessagePort`](#adr-15)
- [16. Formatação sem `Intl`, ordenação sem `localeCompare` e paridade provada no Hermes](#adr-16)
- [17. Preferências do aparelho fora do banco](#adr-17)
- [18. TanStack Router com hash e mês de referência como *search param* no desktop](#adr-18)
- [19. Invalidação de cache por rota inteira, num mapa central testado](#adr-19)
- [20. Recharts pelo componente `Chart` do shadcn/ui](#adr-20)
- [21. electron-vite e electron-builder, sem recompilar o `better-sqlite3`](#adr-21)
- [22. Relato de problema por endereço pré-preenchido, sem token](#adr-22)
- [23. Banco do celular fora do backup em nuvem, sem cifra própria e sem OTA](#adr-23)
- [24. Distribuição do Android por APK assinado localmente; iOS em aberto](#adr-24)
- [25. Folhas inferiores sobre o `Modal` do React Native](#adr-25)
- [26. Metro resolve os pacotes do app como singletons, em vez de `node-linker=hoisted`](#adr-26)

**Núcleo e banco de dados**

- [27. SQLite embarcado como armazenamento](#adr-27)
- [28. Dinheiro como double (`REAL`/`number`) com arredondamento nas fronteiras](#adr-28)
- [29. Moeda única por perfil, valor convertido na entrada](#adr-29)
- [30. Porta de banco síncrona](#adr-30)
- [31. UUID v4 em TEXT, e v5 determinístico para linhas identificadas pelo conteúdo](#adr-31)
- [32. Soft delete em todas as tabelas](#adr-32)
- [33. Estrutura no banco, significado na aplicação](#adr-33)
- [34. Saldos como cache recalculado, nunca incrementado](#adr-34)
- [35. Migrations: `user_version`, só para a frente, imutáveis, runner próprio com backup](#adr-35)
- [36. SQL escrito à mão nos Repositories, sem ORM](#adr-36)
- [37. Drivers `better-sqlite3` no desktop e testes, `expo-sqlite` no celular](#adr-37)
- [38. Testes com SQLite real em memória, sem mocks de Repository](#adr-38)
- [39. Anexos em disco, não como BLOB](#adr-39)
- [40. Vetores de ouro para paridade entre Node e Hermes](#adr-40)

**Sincronização**

- [41. Sincronização própria sobre SQLite puro, no núcleo compartilhado](#adr-41)
- [42. Topologia par a par, sem fonte da verdade](#adr-42)
- [43. Last-writer-wins por célula, ordenado por um relógio lógico híbrido](#adr-43)
- [44. Relógios de linha e de célula com vetor de versões, sem log de mudanças](#adr-44)
- [45. Captura por triggers TEMP e carimbo no decorator da porta Database](#adr-45)
- [46. Caches de saldo não trafegam e o recálculo não carimba `updated_at`](#adr-46)
- [47. Colisão de chave natural: sobrevive o menor id, resolvida antes da escrita](#adr-47)
- [48. Filho vivo sob pai excluído revive o pai](#adr-48)
- [49. Sincronização só na mesma rede local](#adr-49)
- [50. Sincronização só com a tela de Dispositivos aberta](#adr-50)
- [51. Um par de chaves por aparelho, fora do banco](#adr-51)
- [52. Noise (KK e IKpsk2) em TypeScript puro sobre @noble, no núcleo](#adr-52)
- [53. Entrada no grupo por aparelho vazio, por lote completo nos apps](#adr-53)
- [54. Convite em QR compacto (base32) e só o desktop convida](#adr-54)

**Cadastros, contas, cartões e transações**

- [55. Desativar como ação padrão, numa coluna própria](#adr-55)
- [56. Exclusão em cadeia com escopo único para o alerta e a execução](#adr-56)
- [57. Conta e cartão padrão como colunas do perfil](#adr-57)
- [58. A moeda do perfil é a unidade, e a troca só sem lançamentos](#adr-58)
- [59. Fatura paga ou em aberto, com pagamento parcial como transferência negativa](#adr-59)
- [60. A fatura escolhida é a verdade](#adr-60)
- [61. Transferência como uma linha só](#adr-61)
- [62. O tipo da transação é fixo desde a criação](#adr-62)
- [63. Recorrência materializa transações reais, com horizonte e marca d'água](#adr-63)
- [64. O id da ocorrência vem do número, não da data](#adr-64)
- [65. Escopo sempre perguntado, só o que mudou se propaga e o plano sai de um ensaio](#adr-65)
- [66. Mudar a periodicidade ou a forma recomeça a série; quantidade e fim a remodelam](#adr-66)
- [67. Compras do cartão agrupadas na linha da fatura sem filtro](#adr-67)
- [68. Primeiro uso numa unidade de trabalho](#adr-68)
- [69. O dia do pagamento da fatura é registro, não regra](#adr-69)
- [70. Limite usado sem as ocorrências futuras de séries fixas](#adr-70)
- [71. Progresso da meta calculado na leitura, sem coluna de progresso](#adr-71)
- [72. Progresso pelas pagas até hoje; ritmo a partir do fim do mês de referência](#adr-72)
- [73. Meta vinculada ao saldo de uma conta de investimento](#adr-73)
- [74. Retirada como marca na transferência vinculada](#adr-74)
- [75. Desativar e arquivar como colunas próprias, não `deleted_at`](#adr-75)
- [76. Sócios gravados como lista inteira](#adr-76)
- [77. Remover sócio apaga o vínculo dos lançamentos](#adr-77)
- [78. Sócio só nos aportes, não nas despesas](#adr-78)
- [79. Unicidade de nomes conferida na aplicação, sem diferenciar maiúsculas](#adr-79)
- [80. Excluir subcategoria em uso exige mover os lançamentos](#adr-80)
- [81. Anotação sem campo de título](#adr-81)

**Relatórios, visão do mês e importação**

- [82. Relatórios personalizados no lugar de uma tela por pergunta](#adr-82)
- [83. Definição do relatório em JSON versionado numa coluna](#adr-83)
- [84. Projeção de saldo pelo método direto, com faixa de incerteza](#adr-84)
- [85. Importação: o núcleo recebe linhas normalizadas e a análise é a mesma na prévia e na gravação](#adr-85)
- [86. Importação numa unidade de trabalho, sem proveniência, com cópia do banco antes](#adr-86)
- [87. Gastos da Visão geral com a compra no cartão no mês do vencimento da fatura](#adr-87)
- [88. Distribuição por sócio divide os aportes de todos os períodos](#adr-88)
- [89. Relatórios personalizados usam a data da própria transação, escolhida na definição](#adr-89)
- [90. Modelo de mapeamento da importação nas preferências do aparelho](#adr-90)

<a id="adr-1"></a>

## 1. Local-first, sem servidor e sem custo recorrente

- **Status:** vigente
- **Contexto:** projeto de uso pessoal, sem monetização, que precisa durar anos com os dados financeiros do próprio usuário. Qualquer infraestrutura paga ou sempre ligada vira custo e ponto de falha permanentes, e entregar os dados a um serviço de terceiros contraria o objetivo de ser dono deles.
- **Decisão:** cada dispositivo guarda o conjunto completo dos dados num arquivo SQLite local e funciona offline; os dispositivos do usuário são pares iguais que sincronizam diretamente na rede local, sem servidor central. Nada no uso do dia a dia depende de rede.
- **Alternativas descartadas:** backend hospedado com banco gerenciado (custo recorrente e dados fora do controle do usuário); serviço de sincronização em nuvem de terceiros, gratuito ou não (dependência externa que pode mudar de preço ou acabar, e dados em servidor alheio); sincronização remota pela internet entre os próprios dispositivos (exigiria relay ou exposição de portas; recusada por design para manter a superfície de ataque restrita à rede local).
- **Consequências:** os dispositivos só convergem quando estão na mesma rede com a tela de sincronização aberta; o backup é responsabilidade do usuário (exportar cópia do banco); não há multiusuário nem acesso web. Reabriria a decisão a necessidade de acessar os dados fora de casa sem levar o aparelho ou um uso compartilhado por várias pessoas.

<a id="adr-2"></a>

## 2. Núcleo em camadas no estilo MVC com portas e raiz de composição

- **Status:** vigente
- **Contexto:** a mesma regra de negócio serve ao desktop, ao celular e aos testes, com drivers de SQLite diferentes por plataforma. A aplicação é essencialmente CRUD com cálculo de saldos e relatórios, mantida por uma pessoa.
- **Decisão:** camadas Request (schemas zod) → Controller (despacho de rota, DTO, erro como valor) → Service (regra e transação via `UnitOfWork`) → Repository (interface; SQL em `infrastructure/sqlite`) → Model (domínio imutável). Tudo que é da plataforma entra por portas (`Database`, `Clock`, `IdGenerator`, `WallClock`, `BackupDirectory`, portas de rede), e as implementações concretas são ligadas num único lugar, `createCore`.
- **Alternativas descartadas:** arquitetura hexagonal ou clean completa, com casos de uso e mapeadores por entidade (mais cerimônia do que o domínio pede); fatias verticais por funcionalidade sem camadas (a regra de saldo é transversal e acabaria duplicada); ORM com active record (acopla o domínio ao driver, e o driver muda por plataforma).
- **Consequências:** uma rota nova toca várias pastas (request, dto, controller, service, routes, createCore e, no `client`, classificação, invalidação e hook); em troca, trocar de driver é trocar a `Database` injetada e os testes rodam o núcleo real sobre SQLite em memória. Reabriria a decisão um consumidor que precisasse de outro modelo de execução (por exemplo, assíncrono por natureza).

<a id="adr-3"></a>

## 3. Núcleo em TypeScript puro, sem dependência do Node

- **Status:** vigente
- **Contexto:** A mesma regra de negócio precisa rodar no Electron (Node), no React Native (Hermes, sem `fs`, `crypto` do Node, `Buffer` nem módulos nativos) e eventualmente num servidor, sem reescrita por plataforma. O risco do domínio é exatidão, não desempenho.
- **Decisão:** Um pacote `@finance/core` em TypeScript que só usa ECMAScript padrão e bibliotecas puras; tudo que é da plataforma entra por portas, e a regra é verificada por lint (`no-restricted-imports`, `no-restricted-syntax`, `no-restricted-globals`). Como consequência, o celular é React Native/Expo, o único shell que reaproveita o núcleo sem reescrita.
- **Alternativas descartadas:** Rust compilado para WASM e nativo: velocidade desnecessária, duas toolchains, serialização em cada chamada e bindings por plataforma. Kotlin Multiplatform: não roda no Electron. Flutter/Dart: o desktop em Electron não reaproveita Dart, e trocar o Electron descartaria o runtime que também serve um serviço web. Flutter ou nativo no celular: exigiriam reimplementar a camada Service.
- **Consequências:** O `number` do JS é o `REAL` do SQLite, sem conversão. É preciso garantir paridade Node/Hermes (vetores de ouro, app de contrato) e evitar `Intl`, `localeCompare` e `Date` no núcleo. Reabriria a decisão um gargalo de CPU real que o SQL não absorva.

<a id="adr-4"></a>

## 4. TypeScript estrito além do `strict`

- **Status:** vigente
- **Contexto:** o risco real do sistema é a exatidão de saldos, datas e ids que não podem se misturar; erros desse tipo passam silenciosos em produção e corrompem relatórios por meses. O mesmo código roda em dois runtimes (Node e Hermes), onde um bug de tipo só apareceria no aparelho.
- **Decisão:** `tsconfig.base.json` com `strict` mais `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `useUnknownInCatchVariables`, `noImplicitOverride`, `noImplicitReturns` e `verbatimModuleSyntax`; ESLint com `typescript-eslint` `strictTypeChecked`, retorno explícito em funções, modificador de acesso explícito e `switch` exaustivo. Ids e valores sensíveis usam tipos marcados (`Brand`) e Value Objects (`Money`, `LocalDate`, `YearMonth`); sem `any` e sem `as` para silenciar o compilador.
- **Alternativas descartadas:** só `strict` (deixa passar acesso a índice possivelmente indefinido e opcional confundido com `undefined`, as duas fontes mais comuns de `NaN` em somas); JavaScript com JSDoc (sem o rigor do verificador nos limites entre camadas); validação apenas em tempo de execução (o erro apareceria no uso, não na compilação).
- **Consequências:** código mais verboso (checagens de índice, conversões explícitas) e configuração de lint mais lenta por exigir informação de tipos. Reabriria a decisão uma ferramenta que entregasse a mesma garantia com menos cerimônia.

<a id="adr-5"></a>

## 5. Fronteiras de arquitetura verificadas por lint

- **Status:** vigente
- **Contexto:** o núcleo e o `client` rodam no Node (Electron, testes) e no Hermes (React Native). Um import do Node, um `new Date()`, um `Math.random()` ou um `Intl` dentro deles funciona em todos os testes no Node e só quebra — ou dá resultado diferente — no celular. Da mesma forma, uma tela do celular que chamasse o núcleo direto pularia o agendamento pós-frame e o cache de consultas.
- **Decisão:** as fronteiras ficam em `eslint.config.js`, por pasta: o `core` não importa Node nem plataforma e não usa relógio, aleatoriedade, `crypto`, `Intl`, `localeCompare` ou `toLocale*` fora das portas; o `client` não importa React DOM, React Native, Electron nem Node e não usa `Intl`; o `sqlite-expo` só conhece as portas do núcleo; as telas do celular só importam tipos do núcleo; `tokens/src` não tem dependências. `pnpm check` falha em qualquer violação.
- **Alternativas descartadas:** disciplina e revisão (a quebra só apareceria no aparelho, tarde); pacotes separados com `dependencies` restritas apenas (não pegam `Date`, `Math.random`, `Intl` nem import de módulo embutido do Node); ferramenta dedicada de arquitetura (dependency-cruiser e similares: mais uma ferramenta para algo que o ESLint já expressa).
- **Consequências:** toda regra nova de fronteira é uma entrada no lint, com mensagem que aponta o motivo; o desktop não tem regra própria porque o isolamento vem dos processos do Electron. Reabriria a decisão uma fronteira que o ESLint não consiga expressar.

<a id="adr-6"></a>

## 6. Pacotes internos exportam o fonte TypeScript, sem etapa de build

- **Status:** vigente
- **Contexto:** os pacotes de `packages/*` são consumidos por Vite (desktop), Metro (celular), Vitest, Jest e scripts do Node; todos já sabem compilar TypeScript. Um `dist` compilado por pacote teria de ser regerado a cada mudança antes de qualquer consumidor enxergá-la.
- **Decisão:** `exports` dos pacotes apontam para `./src/*.ts`; o `tsc` roda só como verificador (`noEmit`, `allowImportingTsExtensions`), e os scripts de Node da raiz executam `.ts` com `--experimental-transform-types`.
- **Alternativas descartadas:** build por pacote com `tsc` ou `tsup` e project references (passo extra, `dist` desatualizado e mapas de fonte entre pacotes); um único pacote sem workspace (perde as fronteiras por pacote e as dependências declaradas por consumidor).
- **Consequências:** cada consumidor precisa saber transpilar os pacotes do workspace (o Jest do celular lista as exceções em `transformIgnorePatterns`; o electron-vite empacota os pacotes internos). Reabriria a decisão publicar um pacote fora do monorepo.

<a id="adr-7"></a>

## 7. Monorepo pnpm no modo isolado

- **Status:** vigente
- **Contexto:** núcleo, camada headless, adaptadores, tokens e três apps evoluem juntos e precisam mudar no mesmo commit; o celular e o desktop exigem versões e módulos nativos diferentes.
- **Decisão:** um repositório com workspace pnpm (`packages/*`, `apps/*`), dependências internas por `workspace:*`, versão do pnpm fixada em `packageManager`, scripts da raiz por `pnpm -r` e `--filter`, e o `node_modules` isolado padrão do pnpm. `allowBuilds` restringe os scripts de instalação.
- **Alternativas descartadas:** vários repositórios (mudanças de contrato entre núcleo e apps exigiriam publicar e atualizar versões a cada passo); npm ou Yarn workspaces (hoisting permite importar dependência não declarada, o que esconderia violações de fronteira); `node-linker=hoisted` no pnpm (resolveria o Metro sem configuração, mas mudaria o monorepo inteiro e perderia o isolamento); orquestradores como Nx ou Turborepo (sem build entre pacotes, `pnpm -r` basta).
- **Consequências:** o Metro precisa de configuração para resolver React, Expo e módulos nativos a partir do app, e o app do celular declara dependências que o Babel carrega pelo nome. Reabriria a decisão um tempo de CI que pedisse cache de tarefas.

<a id="adr-8"></a>

## 8. Electron como shell do desktop, e não Tauri

- **Status:** vigente
- **Contexto:** o núcleo é TypeScript puro com a porta `Database` síncrona e `transaction(fn)` síncrono, rodando fora da thread de UI sobre um arquivo SQLite comum no disco. O shell também precisa hospedar o transporte da sincronização (TCP, mDNS, chaveiro). O mobile já é React Native, então o shell desktop precisa se justificar sozinho.
- **Decisão:** Electron. O núcleo roda num `utilityProcess` com Node completo e o `better-sqlite3` síncrono; o renderer é o Chromium embarcado, na versão fixada pelo projeto; o `utilityProcess` fornece `node:net`, mDNS (`bonjour-service`) e o `safeStorage` como adaptadores das portas de rede da sincronização.
- **Alternativas descartadas:**
  - Tauri com o núcleo na webview e o `tauri-plugin-sql`: API assíncrona atravessando o IPC; a porta síncrona deixa de ser implementável e `transaction(fn)` volta a exigir fila ou mutex.
  - Tauri com SQLite WASM: o arquivo passa a viver no armazenamento privado da webview (OPFS), não num arquivo comum; backup, inspeção e snapshot passam a depender de exportar.
  - Tauri com o núcleo num *sidecar* Node: três runtimes (Rust, webview, Node com módulo nativo), a economia de disco e memória quase some e cada chamada ganha um salto a mais.
  - Reescrever o núcleo em Rust: duas implementações da mesma regra de negócio.
  - Webview do sistema em geral: três motores diferentes (WebView2, WKWebView, WebKitGTK), com o WebKitGTK — o mais lento e divergente — justamente no Linux, onde o projeto é desenvolvido.
- **Consequências:** instalador na casa de 100 MB, ~330 MB de memória com a janela aberta (medido), atualizações maiores e acompanhamento das versões do Chromium. Como o núcleo só enxerga portas, trocar de shell custa o adaptador de banco, o processo hospedeiro e o preload. Reabriria a decisão: custo de memória ou disco virar problema real, medido; ou amadurecer um shell com webview do sistema e runtime JavaScript com SQLite síncrono (Electrobun, com `bun:sqlite`, é o candidato a observar).

<a id="adr-9"></a>

## 9. React nos dois apps, compartilhando a camada headless e não a UI

- **Status:** vigente
- **Contexto:** o mobile é React Native. Relatórios do desktop têm estado interativo rico (filtros, período, drill-down, comparação). O que vale compartilhar entre desktop e celular é a lógica de apresentação, que decide números e frases.
- **Decisão:** React DOM + Vite no renderer do desktop; um pacote `packages/client`, sem `react-dom`, `react-native`, `electron`, Node nem `Intl` (verificado por lint), com o `CoreClient`, hooks de dados (TanStack Query), view-models, formulários, formatadores e a sequência de abertura. Componentes visuais são por plataforma.
- **Alternativas descartadas:**
  - Vue, Svelte, Solid: sem renderer mantido para mobile nativo; nada de hooks nem estado compartilhado.
  - Vanilla (DOM direto, Web Components): reatividade reinventada à mão e nada compartilhado.
  - UI única em React Native com `react-native-web`: os primitivos são de toque e tela estreita, e o desktop denso (tabelas, hover, menus de contexto, atalhos) viraria uma camada a contornar; o código compartilhado seria justamente o de layout, que deve diferir entre celular e monitor.
- **Consequências:** as telas existem duas vezes (desktop e celular), mas sem regra; toda regra de apresentação que uma tela precisa migra para o `client`. React é dependência par do `client` (`^19.2`) e os dois apps precisam usar a mesma versão maior.

<a id="adr-10"></a>

## 10. React Native com Expo para o celular

- **Status:** vigente
- **Contexto:** a régua é quanto do backend o celular reimplementaria. Uma regra de saldo ou de convergência escrita duas vezes pode divergir em silêncio, e a sincronização promete réplicas iguais byte a byte (HLC, UUID v5, arredondamento do `Money`, sobrevivente de colisão).
- **Decisão:** React Native com Expo (SDK 58, Nova Arquitetura, Hermes), *development build*, projetos nativos gerados pelo `expo prebuild` e não versionados, sem serviços pagos do Expo. O núcleo roda no Hermes sem reimplementação; o celular escreve só adaptadores sem regra e as telas.
- **Alternativas descartadas:**
  - Nativo (Kotlin + Swift): todo o núcleo e a sincronização duas vezes — três implementações contando o desktop.
  - Flutter e Kotlin Multiplatform: uma segunda implementação inteira do núcleo, em outra linguagem.
  - Capacitor: compartilharia até a UI, mas o núcleo rodaria na webview, com SQLite assíncrono pela ponte ou WASM fora de arquivo comum, e listener TCP fraco — o mesmo problema do Tauri.
  - NativeScript: o núcleo rodaria, mas sem renderer React mantido o `client` deixaria de ser compartilhado.
  - React Native sem Expo: o mais caro para um desenvolvedor só é atualizar o React Native; com o Expo vira subir o SDK, com os módulos (`expo-sqlite`, `expo-secure-store`, `expo-camera`...) versionados juntos.
  - Expo Go: não carrega os módulos nativos de socket TCP e mDNS.
- **Consequências:** adaptadores medidos em 335 linhas contra 24.286 compartilhadas. Reabriria: o `expo-sqlite` perder a API síncrona ou o `STRICT` (outro driver JSI, como o `op-sqlite`, entraria trocando só o adaptador), ou o Hermes não aguentar o núcleo na escala do projeto (a primeira resposta seria um runtime secundário, não outro framework).

<a id="adr-11"></a>

## 11. Núcleo no runtime JavaScript principal, com o `expo-sqlite` síncrono

- **Status:** vigente
- **Contexto:** o app do celular tem um único consumidor do núcleo, a própria UI, e a porta `Database` é síncrona. A pergunta é se a UI chama o núcleo e o SQLite no mesmo runtime ou se interpõe uma camada.
- **Decisão:** o núcleo roda na thread JavaScript principal e chama o SQLite pela API síncrona do `expo-sqlite`, via JSI (`packages/sqlite-expo`). O `DirectCoreClient` agenda cada chamada para depois do frame corrente. Chamadas interativas têm orçamento de p95 ≤ 50 ms no aparelho de referência (Galaxy S23 FE) com um banco de dez anos; operações longas viram telas e não são fatiadas em `await`s.
- **Alternativas descartadas:**
  - API HTTP local em `127.0.0.1`: serialização e assincronia sem ganho, e no Android qualquer app do aparelho conecta em `localhost` — mais uma superfície de ataque sobre dados financeiros.
  - Backend do Electron em `nodejs-mobile`: um runtime Node a mais (dezenas de MB), manutenção irregular, `better-sqlite3` por ABI móvel e ponte assíncrona, sem o motivo da topologia do desktop.
  - Módulo nativo dono do banco: ou o SQL e a regra migram para Kotlin/Swift (reimplementação), ou o módulo vira só um driver — o que o `expo-sqlite` já é.
  - API assíncrona do `expo-sqlite`: quebra a porta síncrona e traz de volta a fila em torno de toda escrita.
  - Runtime JavaScript secundário: a melhor topologia em tese, mas os runtimes secundários com bundle completo ainda são experimentais; fica como rota de escape (`WorkerCoreClient`).
- **Consequências:** toques que dependem de JavaScript esperam a chamada ao banco terminar; em troca, nenhuma transação atravessa um `await`, então o sistema nunca suspende o app no meio de uma escrita. Reabriria: a medição no aparelho de referência estourar o orçamento, o que aciona o `WorkerCoreClient`, trocado só na raiz de composição.

<a id="adr-12"></a>

## 12. NativeWind sobre os tokens compartilhados no celular

- **Status:** vigente
- **Contexto:** o desktop usa Tailwind v4 com tokens gerados de `packages/tokens`; o celular precisa do mesmo vocabulário de classes e do mesmo tema claro/escuro sem manter uma segunda cópia dos tokens.
- **Decisão:** NativeWind 4.2 (Tailwind 3) com um preset gerado dos mesmos dados (`nativewind-preset.generated.cjs`), substituindo o tema padrão do Tailwind; o tema troca pelas variáveis de cor aplicadas na raiz (`vars`).
- **Alternativas descartadas:**
  - NativeWind 5, que leria o mesmo CSS do desktop: ainda em RC no SDK adotado.
  - `StyleSheet` puro: tokens reescritos num segundo formato e tema escuro ligado à mão em cada componente; fica como rota de escape, gerado de `packages/tokens`.
  - Tamagui: sistema de design e compilador próprios; o desktop teria de adotá-lo para manter o vocabulário.
  - Restyle: tema tipado, mas com vocabulário diferente do Tailwind.
- **Consequências:** uma etapa a mais no build do Metro, que precisa acompanhar as versões do Expo; a colisão do `fontFamily.sans` do preset do NativeWind é coberta por teste. Reabriria: o NativeWind deixar de acompanhar o Expo, ou a v5 ficar estável (aí o celular passa a ler o mesmo CSS do desktop).

<a id="adr-13"></a>

## 13. Tailwind, shadcn/ui e tokens como dados no desktop

- **Status:** vigente
- **Contexto:** tema claro e escuro desde o início, uma paleta de tokens, IBM Plex Sans com algarismos tabulares e o mesmo vocabulário visual no desktop e no celular; o desktop precisa de menus de contexto, diálogos, popovers e navegação por teclado acessíveis.
- **Decisão:** `packages/tokens` com cores, tipografia, raios e espaçamento como dados sem dependências; Tailwind CSS v4 com o CSS gerado (`theme.generated.css`, variáveis por tema e bloco `@theme` que zera as escalas padrão); componentes shadcn/ui copiados para o repositório sobre o Radix, com as classes traduzidas para os tokens; tema por classe `.dark` na raiz; teste que acusa cor literal no renderer.
- **Alternativas descartadas:**
  - CSS Modules / CSS puro: nada compartilhado com o celular; os tokens seriam escritos duas vezes e divergiriam.
  - CSS-in-JS (styled-components, Emotion): tema resolvido a cada render e troca de tema re-renderizando a árvore.
  - Biblioteca pronta (MUI, Mantine, Ant): linguagem visual própria a desfazer e sem equivalente em React Native com a mesma API.
- **Consequências:** o código dos componentes é do projeto e precisa ser mantido; classe fora dos tokens simplesmente não gera estilo (e o teste transforma isso em erro). Reabriria: uma mudança no Tailwind que impeça zerar as escalas padrão.

<a id="adr-14"></a>

## 14. Erros atravessam a fronteira como resultado, e `INTERNAL` é fatal no desktop

- **Status:** vigente
- **Contexto:** o IPC do Electron serializa por *structured clone*; uma exceção do `utilityProcess` chegaria ao renderer sem classe nem campos. A UI precisa tratar cada falha prevista com frase própria.
- **Decisão:** toda rota devolve `CoreResult` (`{ ok: true, data } | { ok: false, error: { code, message, details } }`), com `ErrorCode` fechado e `details` só de primitivos; o `client` trata os códigos num `switch` exaustivo (`describeError`) e converte falha em `CoreCallError` para o TanStack Query. No desktop, `INTERNAL`, exceção de renderização, promessa rejeitada sem tratamento, queda do `utilityProcess` e exceção no processo principal trocam o app inteiro por uma tela de erro com relato de problema.
- **Alternativas descartadas:**
  - Exceções serializadas à mão: cada lado reconstruiria classes, e um código novo não quebraria a compilação da UI.
  - Seguir usando depois de `INTERNAL`: estado desconhecido poderia mostrar número errado ou gravar dado pela metade.
- **Consequências:** todo código de erro novo obriga a atualizar a UI; um bug no núcleo encerra a sessão de uso no desktop até reabrir o app. No celular o `INTERNAL` ainda não é fatal (aparece no estado da consulta).

<a id="adr-15"></a>

## 15. O renderer fala direto com o `utilityProcess` por `MessagePort`

- **Status:** vigente
- **Contexto:** o processo principal cuida de janelas, menus e diálogos; passar as rotas por ele o tornaria gargalo e um segundo lugar onde a validação poderia ser esquecida.
- **Decisão:** o principal cria um `MessageChannelMain` por carregamento de página e entrega uma ponta ao `utilityProcess` e a outra ao preload; o `IpcCoreClient` correlaciona requisição e resposta por número; o preload guarda a ponta e expõe só `call`. O principal atende só canais fixos (preferências, abertura, diálogos, relato), cada um validado.
- **Alternativas descartadas:**
  - `ipcRenderer.invoke` até o principal e dele ao núcleo: um salto a mais por chamada e o principal no caminho de toda rota.
  - Expor o `MessagePort` ou o `ipcRenderer` ao renderer: o renderer é entrada não confiável.
- **Consequências:** o principal precisa reconectar cada janela a cada carregamento e, ao trocar o banco, subir um `utilityProcess` novo.

<a id="adr-16"></a>

## 16. Formatação sem `Intl`, ordenação sem `localeCompare` e paridade provada no Hermes

- **Status:** vigente
- **Contexto:** o mesmo código roda no Node/Chromium (desktop, testes) e no Hermes (celular), com ICUs diferentes. O mesmo saldo nunca pode aparecer de dois jeitos, e listas precisam sair na mesma ordem.
- **Decisão:** formatadores próprios no `client`, a partir do `Money` já arredondado; comparador explícito de nomes no domínio (`compareNames`, dobra de acento e caixa por tabela própria); lint proibindo `Intl`, `localeCompare` e `toLocale*` no núcleo e `Intl` no `client` e nas telas do celular; vetores de ouro gerados no Node e recalculados no Hermes pelo `apps/mobile-contract`, que também roda a suíte de contrato da porta `Database` contra o `expo-sqlite`, no emulador do CI.
- **Alternativas descartadas:**
  - `Intl.NumberFormat` e `localeCompare('pt-BR')`: divergem em detalhes entre runtimes (espaço não separável, símbolo da moeda, ordem).
  - Confiar só nos testes do Node: não pegam o que muda no Hermes nem no driver do aparelho.
- **Consequências:** formatação de datas e dinheiro é código do projeto; o JSON dos vetores precisa ficar em dia com o código (`pnpm golden:generate`) e nunca ser regenerado para aceitar a saída do Hermes.

<a id="adr-17"></a>

## 17. Preferências do aparelho fora do banco

- **Status:** vigente
- **Contexto:** tema, último perfil, último mês e data da última cópia são escolhas de um aparelho; dois aparelhos sincronizados podem estar em perfis e meses diferentes.
- **Decisão:** um `preferences.json` por aparelho (`userData` no desktop; diretório de documentos no celular, fora da pasta do banco), com leitura tolerante; no desktop só o processo principal grava, e `lastExportAt` só depois de a cópia existir.
- **Alternativas descartadas:**
  - Tabela no banco: seria replicada pela sincronização e levada junto ao restaurar ou importar o banco.
- **Consequências:** as preferências não acompanham o usuário para outro aparelho; trocar o banco não muda o tema nem o mês.

<a id="adr-18"></a>

## 18. TanStack Router com hash e mês de referência como *search param* no desktop

- **Status:** vigente
- **Contexto:** o app empacotado é servido de `file://`; o mês de referência, os filtros e o drill-down precisam ser tipados e sobreviver à navegação e ao recarregamento.
- **Decisão:** TanStack Router com `createHashHistory`; o mês de referência é o *search param* `period`, preservado por `retainSearchParams`, com `lastPeriod` como valor inicial. No celular, sem URL e com uma pilha por aba, o mês é estado do shell salvo nas preferências.
- **Alternativas descartadas:**
  - Histórico do navegador: sem servidor para responder a `/transactions` em `file://`.
  - Mês em contexto React no desktop: perder-se-ia no recarregamento, e cada tela leria de um lugar diferente.
  - Mês como parâmetro de rota no celular: as pilhas por aba perderiam o parâmetro ao trocar de aba.
- **Consequências:** desktop e celular guardam o mês de jeitos diferentes, com as mesmas funções de período do `client`.

<a id="adr-19"></a>

## 19. Invalidação de cache por rota inteira, num mapa central testado

- **Status:** vigente
- **Contexto:** uma escrita num mês muda o saldo de abertura de todos os meses seguintes, as comparações e os relatórios; saldo velho na tela é o pior erro possível num app de finanças.
- **Decisão:** um mapa `Record<WriteRoute, ReadRoute[]>` no `client`, aplicado por `useCoreMutation`, invalidando rotas de leitura inteiras; um teste executa cada escrita contra o núcleo real e confere que toda leitura cujo resultado mudou está no mapa. Ensaios do diálogo de revisão ficam fora e sem cache.
- **Alternativas descartadas:**
  - Invalidação pelo mês ou pela entidade da escrita: é onde o saldo velho se esconde.
  - `invalidateQueries` espalhado pelas telas: não dá para testar que nenhuma escrita deixa dado velho.
- **Consequências:** refaz mais consultas que o estritamente necessário — milissegundos num SQLite local. Toda rota de escrita nova precisa declarar o que invalida para compilar.

<a id="adr-20"></a>

## 20. Recharts pelo componente `Chart` do shadcn/ui

- **Status:** vigente
- **Contexto:** os relatórios do desktop precisam de gráficos com tema claro e escuro e acessibilidade dos valores.
- **Decisão:** Recharts pelo `Chart` do shadcn/ui, reescrito com cor de série restrita a token e sem `Intl`; todo gráfico acompanhado da tabela equivalente.
- **Alternativas descartadas:**
  - Biblioteca em canvas para milhares de pontos: o volume dos relatórios é de dezenas de pontos, e SVG sobra.
- **Consequências:** o estilo inline injetado exige `style-src 'unsafe-inline'` na CSP (script inline continua proibido). Reabriria: um relatório com volume que o SVG não aguente.

<a id="adr-21"></a>

## 21. electron-vite e electron-builder, sem recompilar o `better-sqlite3`

- **Status:** vigente
- **Contexto:** quatro alvos de build (main, preload, utility, renderer), empacotamento para Linux (onde o projeto é desenvolvido) e Windows, e um módulo nativo.
- **Decisão:** electron-vite para os quatro alvos com HMR; electron-builder com `.deb` e NSIS, gerados no Linux; `better-sqlite3` 13 (N-API, binários prontos) carregado no Electron sem recompilação (`npmRebuild: false`), fora do `asar`; ícone de `packages/assets`, o mesmo do celular.
- **Alternativas descartadas:**
  - Quatro configurações de Vite à mão: o electron-vite resolve os alvos e o HMR.
  - Recompilar o `better-sqlite3` para o ABI do Electron: exigiria compilador, quebraria os testes do núcleo que usam a mesma cópia no Node e geraria o binário do Linux no `.exe`.
- **Consequências:** o Windows exige o Wine no Linux para o desinstalador do NSIS; não há instalador de macOS.

<a id="adr-22"></a>

## 22. Relato de problema por endereço pré-preenchido, sem token

- **Status:** vigente
- **Contexto:** o usuário precisa mandar o erro e o log ao desenvolvedor, sem servidor e sem dar ao renderer acesso a endereços ou arquivos.
- **Decisão:** o renderer manda só texto; o processo principal valida, lê o fim dos logs, troca a pasta pessoal por `~`, corta o log para caber no limite do endereço e abre com `shell.openExternal` uma issue pré-preenchida no GitHub ou um `mailto:`, com destino fixo. No celular, o log vai pela folha de compartilhamento.
- **Alternativas descartadas:**
  - Criar a issue pela API: exigiria um token com escrita no repositório dentro do app, que qualquer um poderia extrair.
  - Servidor intermediário: infraestrutura e custo recorrente que o projeto recusa.
- **Consequências:** quem envia é o usuário, pela própria conta, depois de revisar; o log enviado é só o trecho final.

<a id="adr-23"></a>

## 23. Banco do celular fora do backup em nuvem, sem cifra própria e sem OTA

- **Status:** vigente
- **Contexto:** os dados não podem sair da rede do usuário, e nada pode ter custo recorrente. O sistema faria backup em nuvem do diretório do app sem o usuário configurar.
- **Decisão:** `allowBackup` e `fullBackupContent` desligados e regras de extração excluindo tudo de `cloud-backup` e `device-transfer`; o banco não é cifrado pelo app; a chave do aparelho no `expo-secure-store` com `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; cópia exportada só por `VACUUM INTO` e folha de compartilhamento, nunca o arquivo vivo; atualização só por APK novo.
- **Alternativas descartadas:**
  - Backup automático do Google: enviaria o histórico financeiro inteiro a um terceiro, em silêncio.
  - SQLCipher: protegeria contra o mesmo ataque que a cifra do armazenamento do Android já cobre e tornaria o arquivo ilegível para ferramentas SQLite comuns.
  - Expor o arquivo vivo a outros apps: risco de corrupção em WAL e escrita fora da captura da sincronização.
  - EAS Update ou servidor próprio de OTA: serviço hospedado para um único usuário.
- **Consequências:** um celular perdido só se recupera pareando outro aparelho ou de uma cópia exportada; um build com migration precisa chegar a todos os aparelhos antes de voltarem a sincronizar.

<a id="adr-24"></a>

## 24. Distribuição do Android por APK assinado localmente; iOS em aberto

- **Status:** vigente
- **Contexto:** a restrição "sem custo recorrente" esbarra nas lojas e, no iOS, no programa pago da Apple.
- **Decisão:** APK de release assinado com uma chave do usuário fora do repositório (`pnpm dist:mobile`), instalado diretamente; sem as variáveis da chave, o Gradle assina com a chave de depuração (CI e medição); `versionCode` derivado da versão. O iOS não é suportado enquanto o usuário não escolher entre Apple ID gratuito (reassinar a cada 7 dias) e o programa pago.
- **Alternativas descartadas:**
  - Play Store: desnecessária para um único usuário.
  - Chave dentro do repositório: o script recusa.
- **Consequências:** o APK distribuído e o development build não convivem no mesmo aparelho; perder a chave obriga a desinstalar (e perder o banco) para atualizar.

<a id="adr-25"></a>

## 25. Folhas inferiores sobre o `Modal` do React Native

- **Status:** vigente
- **Contexto:** o celular faz as escolhas em folhas inferiores; o plano previa o `@gorhom/bottom-sheet`.
- **Decisão:** componente `Sheet` próprio sobre o `Modal`, renderizado no lugar (não num portal), com animação no driver nativo e sem animação quando o sistema pede menos movimento.
- **Alternativas descartadas:**
  - `@gorhom/bottom-sheet`: no aparelho, o `present()` registrava o portal, mas nenhuma view chegava à árvore nativa, sem erro.
- **Consequências:** sem o arrastar para fechar; a folha enxerga os contextos de quem a abriu (núcleo, perfil, tema). Reabriria: a biblioteca funcionar com a Nova Arquitetura no SDK adotado.

<a id="adr-26"></a>

## 26. Metro resolve os pacotes do app como singletons, em vez de `node-linker=hoisted`

- **Status:** vigente
- **Contexto:** no modo isolado do pnpm, `packages/client` e `packages/sqlite-expo` levavam ao bundle outras variantes de `react-native`, `expo-modules-core` e `expo-sqlite`, quebrando o contexto do React e registrando módulos nativos duas vezes.
- **Decisão:** o `metro.config.js` resolve todo pacote declarado pelo app (mais `react-native` e `expo-modules-core`) a partir do próprio app; o app declara também o que o Babel do NativeWind carrega pelo nome.
- **Alternativas descartadas:**
  - `node-linker=hoisted`: mudaria a instalação do monorepo inteiro.
- **Consequências:** uma configuração própria do Metro a manter a cada SDK; dependências que parecem sobrar no `package.json` do app não podem ser removidas.

<a id="adr-27"></a>

## 27. SQLite embarcado como armazenamento

- **Status:** vigente
- **Contexto:** O app precisa de um banco embarcado, gratuito, que rode no desktop e no celular, sem servidor, e que não impeça a sincronização entre dispositivos. Os relatórios são relacionais e orientados a mês, e o arquivo financeiro precisa continuar legível por décadas.
- **Decisão:** Um único arquivo SQLite por dispositivo, com tabelas `STRICT`, `CHECK`, índices parciais e chaves estrangeiras com ações `ON DELETE`.
- **Alternativas descartadas:** PostgreSQL/MySQL: exigem servidor sempre ligado, então falham nas restrições de zero infraestrutura e zero custo. DuckDB: OLAP, ruim para muitas escritas pequenas e fraco no celular (continua sendo opção para consultar o mesmo arquivo em relatórios pesados no desktop). PouchDB/RxDB: a sincronização vem pronta, mas as agregações relacionais por mês ficam bem mais difíceis. Realm/Atlas Device Sync: descontinuado pela MongoDB. libSQL/Turso: a parte da sincronização puxa para um serviço hospedado com custo recorrente; ficar no SQLite puro mantém a opção aberta sem migração.
- **Consequências:** A sincronização foi escrita no próprio núcleo, sobre SQLite puro. O banco aceita linhas que violam regras entre colunas (ver [ADR 33](#adr-33)). Reabriria a decisão um requisito de servidor multiusuário ou um volume analítico que o SQLite não atenda.

<a id="adr-28"></a>

## 28. Dinheiro como double (`REAL`/`number`) com arredondamento nas fronteiras

- **Status:** vigente
- **Contexto:** O app não se limita a moedas de duas casas, taxas de câmbio precisam de muitas casas, e o valor precisa atravessar SQLite e JavaScript sem conversão.
- **Decisão:** Toda coluna monetária é `REAL`; no núcleo, o Value Object `Money` (valor `number` + `Currency`) arredonda só ao persistir e apresentar, meio para longe do zero sobre a representação decimal mais curta (`toPrecision(15)`), compara com epsilon de meia unidade mínima e divide distribuindo o resto na primeira parte. Saldos nunca são incrementados (ver [ADR 34](#adr-34)).
- **Alternativas descartadas:** Inteiros em centavos: escala fixa errada para moedas de 0 ou 3 casas e para `conversion_rate`. Biblioteca decimal (`decimal.js`, `big.js`): protege contra um erro abaixo do epsilon e acrescenta um segundo tipo numérico a converter em toda leitura e escrita. Soma compensada (Kahan): o erro de somar um mês e encadear fechamentos fica mais de dez mil vezes abaixo de meio centavo, e cada fechamento é arredondado ao persistir. `Math.round(x * 100) / 100`: erra `1,005` e arredonda negativos para o lado errado.
- **Consequências:** O banco não protege contra desvio de arredondamento; a aplicação precisa arredondar nas fronteiras e comparar com `Money.equals`. Teto de entrada de ±1 trilhão para caber nos 15 dígitos lidos. Reabriria a decisão um requisito de valores com mais de 15 dígitos significativos.

<a id="adr-29"></a>

## 29. Moeda única por perfil, valor convertido na entrada

- **Status:** vigente
- **Contexto:** Uma conta pode ser mantida em moeda estrangeira, mas moeda estrangeira não é foco do app, e saldos e relatórios precisam ser somas simples.
- **Decisão:** Toda coluna monetária está na moeda do perfil (`profiles.currency`). `transactions.value` é gravado já convertido; `currency` e `conversion_rate` são só proveniência, nunca usados em cálculo. `accounts.currency` é rótulo; a conta estrangeira que se afasta da realidade pelo câmbio sai do consolidado com `consider_balance = 0`.
- **Alternativas descartadas:** Armazenar cada conta na sua moeda: empurraria uma conversão para cada total do perfil, maquinário multimoeda que o projeto não quer. Guardar o valor original em moeda estrangeira: não consultável e desnecessário; quem quiser registra na descrição.
- **Consequências:** O saldo de conta estrangeira não bate com o banco real. Transferência entre perfis e mover transação entre perfis exigem a mesma moeda, e a moeda do perfil fica travada quando ele recebe transferências de outro. Reabriria a decisão um requisito real de contabilidade multimoeda.

<a id="adr-30"></a>

## 30. Porta de banco síncrona

- **Status:** vigente
- **Contexto:** Um caso de uso (as duas pontas de uma escrita, uma série inteira de recorrência, o recálculo de saldos, a captura da sincronização) precisa estar numa única transação, sobre uma única conexão.
- **Decisão:** A porta `Database` é síncrona (`run`, `get`, `all`, `exec`, `transaction(fn)` com função síncrona); os Controllers devolvem `Promise` só na fronteira de transporte. No desktop o núcleo roda num `utilityProcess` dedicado para não travar a janela.
- **Alternativas descartadas:** Porta assíncrona: outro trecho poderia intercalar um `await` no meio da transação alheia, exigindo fila ou mutex em toda escrita. Núcleo no processo principal do Electron: uma consulta lenta congelaria janelas e menus.
- **Consequências:** Uma consulta bloqueia a thread do núcleo; no celular ela divide a thread JS com a UI e o `client` adia a chamada para depois do frame. Ambos os drivers escolhidos precisam oferecer API síncrona. Reabriria a decisão um driver de plataforma sem API síncrona.

<a id="adr-31"></a>

## 31. UUID v4 em TEXT, e v5 determinístico para linhas identificadas pelo conteúdo

- **Status:** vigente
- **Contexto:** Vários dispositivos criam registros offline e depois sincronizam; extratos, faturas, ocorrências de recorrência e vínculos de tag existem "uma vez por chave natural".
- **Decisão:** Chave primária `TEXT` de 36 caracteres, minúscula; UUID v4 pela porta `IdGenerator`; UUID v5 calculado no núcleo, com namespace fixo, para extratos, faturas, ocorrências e vínculos de tag. Tabelas rowid comuns. Quem gera o id é a aplicação.
- **Alternativas descartadas:** Autoincremento: dois aparelhos gerariam o mesmo id e reconciliar exigiria reescrever chaves. UUID v7: a localidade no índice é imensurável nesta escala e nada ordena pela chave. `BLOB` de 16 bytes: economia desprezível, perde a legibilidade. `WITHOUT ROWID`: ganho imensurável, e é o que as ferramentas não esperam. v5 como porta: precisa dar o mesmo resultado em todo dispositivo, então mora no núcleo.
- **Consequências:** Recriar uma linha determinística excluída a revive. O namespace e o formato das chaves naturais nunca mudam. Reabriria a decisão uma escala em que o tamanho das chaves pese.

<a id="adr-32"></a>

## 32. Soft delete em todas as tabelas

- **Status:** vigente
- **Contexto:** Exclusões precisam se propagar entre dispositivos, e um hard delete não deixa nada para replicar.
- **Decisão:** Nada é removido fisicamente: excluir preenche `deleted_at`. Toda unicidade é índice único parcial `WHERE deleted_at IS NULL`, toda leitura filtra linhas vivas, e a exclusão em cadeia é feita pela camada Service seguindo o grafo das chaves estrangeiras. Desativar (conta, cartão) usa coluna própria (`disabled_at`).
- **Alternativas descartadas:** Hard delete com `ON DELETE CASCADE`: não replica e perde histórico. Reusar `deleted_at` para desativação: `deleted_at` significa "não existe mais" para leituras e sincronização.
- **Consequências:** As ações `ON DELETE` viram rede de segurança, não mecanismo. Esquecer o filtro numa consulta ressuscita transações nos totais, por isso os testes de mesa incluem linhas excluídas. Uma purga futura só pode remover o que todos os aparelhos confirmaram.

<a id="adr-33"></a>

## 33. Estrutura no banco, significado na aplicação

- **Status:** vigente
- **Contexto:** O SQLite consegue garantir tipos, domínios, referências e unicidade, mas regras que relacionam colunas ou linhas mudam com o negócio e precisam ser visíveis ao código que as cumpre.
- **Decisão:** O banco garante `STRICT`, `CHECK` de domínio de uma coluna, chaves estrangeiras e índices únicos parciais; arcos exclusivos, `paid`/`payment_date`, sócios só em perfil empresarial, participações somando 100, sinal de `value` e nomes únicos sem acento ficam nos Services e entidades. `updated_at` é carimbado pela aplicação, sem trigger. Vocabulário usa `ON DELETE NO ACTION`, não `RESTRICT`.
- **Alternativas descartadas:** `CHECK` entre colunas (ex.: "extrato ou fatura"): regra escondida no armazenamento, cara de mudar (exige reconstruir a tabela). Trigger para `updated_at`: lógica escondida. `RESTRICT` no vocabulário: verificado no instante da remoção, quebraria o cascade de perfil.
- **Consequências:** O banco aceita linhas inválidas; a validação fica em pontos de controle únicos (`TransactionComposer`, entidades) e os testes cobrem estados inválidos.

<a id="adr-34"></a>

## 34. Saldos como cache recalculado, nunca incrementado

- **Status:** vigente
- **Contexto:** O app abre numa tela de saldo, então recalcular o histórico a cada leitura é caro; mas incrementar o cache acumula erro de float e eterniza bugs pontuais.
- **Decisão:** Saldos de contas, extratos (inicial e final, consolidado e previsto) e faturas são materializados como cache e sempre reconstruídos por uma única rotina (`BalanceRecalculationService`) a partir das transações do mês afetado, propagando para os meses seguintes. Extratos e faturas são uma linha por mês. O progresso de metas não é armazenado.
- **Alternativas descartadas:** `saldo += valor`: acumula erro e desvio permanente. Calcular tudo na leitura: caro na tela inicial e para navegar meses. Cache do progresso de meta: lido raramente sobre poucas linhas; seria um segundo valor a manter correto em troca de nada.
- **Consequências:** Uma consulta agregada por mês afetado em cada escrita. A rotina serve de oráculo para a verificação de integridade (numa transação desfeita), que só relata desvios. O recálculo não carimba `updated_at`, para não virar mudança sincronizada.

<a id="adr-35"></a>

## 35. Migrations: `user_version`, só para a frente, imutáveis, runner próprio com backup

- **Status:** vigente
- **Contexto:** Cada aparelho é uma produção, atualizada sem supervisão e possivelmente pulando versões; uma migration pela metade deixaria o usuário sem o histórico.
- **Decisão:** Versão no `PRAGMA user_version`; migrations SQL numeradas, sem `down`, travadas por `checksums.lock` e embutidas no bundle (`pnpm embed:migrations`); runner próprio no núcleo, uma transação por migration com `foreign_key_check`; backup `VACUUM INTO` antes (três cópias); banco mais novo que o app não abre; migrations de dados determinísticas, fora da captura da sincronização.
- **Alternativas descartadas:** Tabela `schema_migrations`: mais uma tabela a excluir da sincronização, para uma rastreabilidade sem leitor. Migrations `down`: ninguém as roda no aparelho e apagam dados. Timestamps no nome: há uma única linha de versões. Drizzle Kit/Prisma Migrate: geram DDL de um schema TS (segunda fonte da verdade) e não rodam no celular. Kysely migrator/Umzug: pressupõem API assíncrona e leitura de diretório, sem backup nem recusa de versão. Migrations por adaptador: duas implementações do mesmo procedimento crítico. Uma transação para todas as migrations: uma falha voltaria o aparelho à versão inicial em vez de parar na anterior utilizável.
- **Consequências:** Corrigir erro exige migration nova. O procedimento de reconstrução de tabela (desligar `foreign_keys` fora da transação) ainda precisa ser implementado no runner.

<a id="adr-36"></a>

## 36. SQL escrito à mão nos Repositories, sem ORM

- **Status:** vigente
- **Contexto:** O schema é escrito à mão e documentado, a porta de banco é síncrona e o núcleo roda no Hermes.
- **Decisão:** Interfaces de Repository no domínio e implementações `Sqlite*Repository` com SQL explícito sobre a porta `Database`, com mapeamento manual `snake_case` ↔ `camelCase` e leitura tipada (`RowReader`).
- **Alternativas descartadas:** Prisma/TypeORM: não rodam no React Native com driver síncrono. Drizzle e afins: querem ser donos do schema, criando uma segunda fonte da verdade.
- **Consequências:** Mais código de mapeamento, mas o SQL é o contrato e as consultas agregadas ficam visíveis e testáveis contra SQLite real.

<a id="adr-37"></a>

## 37. Drivers `better-sqlite3` no desktop e testes, `expo-sqlite` no celular

- **Status:** vigente
- **Contexto:** A porta síncrona exige drivers com API síncrona e transação; o mesmo driver deve rodar em produção e nos testes do desktop.
- **Decisão:** `better-sqlite3` (embarca o SQLite, mínimo 3.38 por `STRICT` e `json_valid`) no Electron e no Vitest; `expo-sqlite` com API síncrona (`prepareSync`, `withTransactionSync`) no celular. Adaptadores finos em pacotes próprios, verificados pela mesma suíte de contrato.
- **Alternativas descartadas:** `node:sqlite`: ainda saindo do estado experimental e com bug de truncamento silencioso de `TEXT` com NUL em 2026; com a porta, trocar depois é mudança local.
- **Consequências:** Recompilar o módulo nativo para o Electron. O celular confere as capacidades do SQLite na abertura, porque uma configuração de build pode trocar a versão embarcada.

<a id="adr-38"></a>

## 38. Testes com SQLite real em memória, sem mocks de Repository

- **Status:** vigente
- **Contexto:** Metade dos bugs prováveis mora no SQL (filtro de soft delete, escopo de série, `SUM` no contêiner errado).
- **Decisão:** Testes de Service abrem um banco `:memory:` com as migrations de produção e chamam o núcleo inteiro; só `Clock`, `IdGenerator` e `WallClock` são substituídos por adaptadores determinísticos de verdade. Testes de mesa calculados à mão, propriedades com fast-check contra um oráculo independente, suíte nos fusos UTC e America/Sao_Paulo.
- **Alternativas descartadas:** Mocks de Repository: devolvem o que o teste manda e escondem os bugs de SQL. Oráculo = a própria rotina de recálculo: aprovaria o bug dela no cache. Cobertura de linhas como meta: não diz se o teste detectaria o bug.
- **Consequências:** Suíte um pouco mais lenta que com mocks, ainda em milissegundos por teste. O mutation testing previsto (Stryker) não foi adotado.

<a id="adr-39"></a>

## 39. Anexos em disco, não como BLOB

- **Status:** vigente
- **Contexto:** Fotos de recibos e PDFs chegam a megabytes e são escritos uma vez e lidos raramente.
- **Decisão:** `attachments` guarda só o nome; os bytes ficariam em `profile/{profileID}/attachments/{transactionID}/{name}`.
- **Alternativas descartadas:** BLOB no banco: incharia o arquivo que todo backup e toda sincronização movem.
- **Consequências:** Backup e exportação precisariam cobrir a árvore de anexos; linha e arquivo podem se desencontrar. Hoje a tabela existe mas não há caso de uso nem porta de arquivos.

<a id="adr-40"></a>

## 40. Vetores de ouro para paridade entre Node e Hermes

- **Status:** vigente
- **Contexto:** O núcleo roda no Node e no Hermes; arredondamento, UUID v5 e ordenação de texto podem divergir entre runtimes sem que o Vitest perceba.
- **Decisão:** O Node gera `vectors.json` para casos difíceis; o app de contrato recalcula no Hermes no emulador do CI. O núcleo não usa `Intl`/`localeCompare`.
- **Alternativas descartadas:** Confiar nos testes do Node: não exercitam o Hermes. Regenerar os vetores para aceitar a saída do Hermes: esconderia a divergência.
- **Consequências:** Toda mudança intencional nesses cálculos exige `pnpm golden:generate`.

<a id="adr-41"></a>

## 41. Sincronização própria sobre SQLite puro, no núcleo compartilhado

- **Status:** vigente
- **Contexto:** o sistema é gratuito, sem servidor, roda no desktop e no celular, e o schema é relacional, com chaves estrangeiras e índices únicos parciais. Os dados não podem sair da rede do usuário.
- **Decisão:** o motor continua SQLite puro; a sincronização é código TypeScript do `packages/core`, falando SQL pela porta `Database`, sem extensão nativa — acompanha qualquer binding SQLite de cada plataforma.
- **Alternativas descartadas:**
  - Litestream: streaming de um único escritor para object storage; é backup, não sincronização com múltiplos escritores, e não tem mobile.
  - cr-sqlite: CRDT LWW por coluna, o mais próximo em espírito, mas é extensão nativa carregável (difícil no iOS), parada desde 2024, e não comporta índices únicos fora da chave primária nem chaves estrangeiras garantidas.
  - libSQL/Turso, PowerSync, ElectricSQL: exigem serviço hospedado ou banco no servidor.
  - Evolu: é dono do schema e da camada de consultas e sincroniza por relay, fora da rede local.
  - Extensão de sessão do SQLite: não está nos bindings mobile típicos e resolve conflito por "ordem de aplicação", não por relógio.
  - PouchDB/RxDB: já descartados como motor de banco.
  - Sincronizar o arquivo `.sqlite` por Dropbox/Syncthing: dois escritores no mesmo arquivo produzem cópias em conflito ou corrupção em WAL; só serve como backup unidirecional feito com `VACUUM INTO`.
  - Reproduzir operações de negócio no receptor: toda sincronização reexecutaria a lógica de negócio; invasivo em todo o código.
- **Consequências:** o projeto mantém o próprio motor de replicação (captura, extração, aplicação, convergência) e os testes de propriedade que o sustentam. Reabriria a decisão uma biblioteca de sincronização sem servidor, multiplataforma, que respeite chaves estrangeiras e índices únicos parciais.

<a id="adr-42"></a>

## 42. Topologia par a par, sem fonte da verdade

- **Status:** vigente
- **Contexto:** o caso de uso principal é lançar despesas no celular longe do computador, ou seja, escrever offline.
- **Decisão:** todo aparelho é réplica completa e igual; qualquer par de membros sincroniza; o primeiro aparelho só tem o papel de criar o grupo. Quem entra começa vazio.
- **Alternativas descartadas:**
  - Desktop como autoridade e celular como cliente fino: o celular não funcionaria offline.
  - Um "dono" cujos dados vencem os conflitos: descartaria trabalho mais novo (uma correção feita no celular às 10:00 perderia para uma edição do desktop das 09:00 ainda não sincronizada).
- **Consequências:** as regras de merge precisam convergir independentemente da ordem de chegada (o que os testes de propriedade verificam). Dois bancos que cresceram de forma independente nunca são mesclados: quem entra precisa estar vazio.

<a id="adr-43"></a>

## 43. Last-writer-wins por célula, ordenado por um relógio lógico híbrido

- **Status:** vigente
- **Contexto:** edições concorrentes em aparelhos diferentes precisam se reconciliar sem perder trabalho intencional, e "a mais recente" precisa ter ordem estável mesmo com relógios imprecisos.
- **Decisão:** cada coluna de cada linha é resolvida independentemente; vence o maior HLC (`{ms 13}.{contador 5}.{device_id}`, comparável como string). A exclusão é a coluna `deleted_at`. Sessões com relógios divergindo mais de 2 minutos são recusadas.
- **Alternativas descartadas:**
  - LWW por linha sobre `updated_at`: precisão de segundo, confia cegamente no relógio de parede e perde edições concorrentes em colunas diferentes.
  - CRDTs completos (Automerge, Yjs): feitos para texto colaborativo e documentos aninhados; aqui toda coluna é escalar e os valores agregados (saldos) são derivados.
- **Consequências:** é preciso guardar um relógio por célula alterada; relógios muito errados bloqueiam a sessão até o usuário corrigir a hora. Reabriria a decisão um tipo de dado que precise de merge não escalar (texto colaborativo, contadores).

<a id="adr-44"></a>

## 44. Relógios de linha e de célula com vetor de versões, sem log de mudanças

- **Status:** vigente
- **Contexto:** sob LWW, um valor superado nunca mais é necessário; um log cresceria sem limite.
- **Decisão:** `sync_rows` (relógio da criação) e `sync_cells` (relógio de cada célula alterada depois), indexadas por `(origin, seq)`; uma sequência por transação de escrita local; `sync_vector` prefixo-completo por origem. O que falta a um par é "tudo com sequência maior que o vetor dele", com os valores atuais lidos da tabela de domínio.
- **Alternativas descartadas:**
  - Log de operações/valores: redundante sob LWW e cresce sem compactação.
  - Uma entrada de relógio por célula desde a criação: multiplicaria o custo por linha, quando a maioria das linhas é escrita uma vez.
- **Consequências:** o histórico se compacta sozinho; uma unidade de trabalho trafega junta; o repasse entre três aparelhos é natural. O vetor só pode avançar com lotes aplicados inteiros numa transação.

<a id="adr-45"></a>

## 45. Captura por triggers TEMP e carimbo no decorator da porta Database

- **Status:** vigente
- **Contexto:** são cerca de 70 pontos de escrita em 14 repositórios, vários upserts `ON CONFLICT DO UPDATE` que não sabem quais colunas mudaram, e uma exclusão em cascata que monta o nome da tabela em tempo de execução. Uma escrita esquecida vira divergência silenciosa.
- **Decisão:** triggers `TEMP`, gerados do `PRAGMA table_info` a cada abertura e só nesta conexão, marcam linhas inseridas e colunas alteradas numa tabela temporária e abortam hard delete; o decorator `CapturingDatabase` toma sequência e HLC no fim da transação mais externa, antes do commit, e grava `sync_rows`/`sync_cells`. Uma flag temporária desliga a captura durante a aplicação de lotes. Toda tabela precisa estar classificada no `SyncCatalog`.
- **Alternativas descartadas:**
  - Instrumentar cada Repository: grande, frágil, e os upserts não sabem o que mudou.
  - Triggers que também carimbassem o HLC: o HLC precisa do relógio de parede e do estado do aparelho, que o SQL não tem; e triggers gravados no arquivo capturariam também as migrations.
- **Consequências:** edições manuais no arquivo (fora do app) ficam invisíveis e podem ser sobrescritas — aceito. Uma tabela nova exige classificação (teste falha sem ela). O commit que carimba é também o gatilho do modo ao vivo.

<a id="adr-46"></a>

## 46. Caches de saldo não trafegam e o recálculo não carimba `updated_at`

- **Status:** vigente
- **Contexto:** saldos de conta, extrato e fatura são caches derivados dos lançamentos; com a captura por trigger, qualquer escrita neles viraria mudança sincronizada.
- **Decisão:** as colunas de saldo são `derived` no catálogo: não trafegam, chegam como `0` e são recalculadas após a aplicação. O recálculo deixou de carimbar `updated_at`. `recurrences.materialized_count` mescla como máximo.
- **Alternativas descartadas:**
  - Sincronizar os caches por LWW: mesclaria duas respostas em vez dos fatos por trás delas.
  - Manter o carimbo de `updated_at` no recálculo: cada recálculo viraria mudança, e o receptor (que recalcula sem captura) ficaria com outro `updated_at`, quebrando a convergência.
- **Consequências:** `updated_at` de contas, extratos e faturas reflete só revisões do usuário; a aplicação de lotes paga o recálculo das contas afetadas.

<a id="adr-47"></a>

## 47. Colisão de chave natural: sobrevive o menor id, resolvida antes da escrita

- **Status:** vigente
- **Contexto:** nomes de categoria, subcategoria, tag e anexo são digitados pelo usuário (sem id determinístico possível) e únicos entre linhas vivas.
- **Decisão:** sobrevive a linha de menor id; a perdedora recebe soft delete e os filhos são redirecionados (`merge`). Para ocorrências de recorrência, a perdedora só perde `recurrence_id`/`occurrence` e continua viva (`unlink`). A resolução acontece antes da escrita, e o ajuste é escrita local que se propaga.
- **Alternativas descartadas:**
  - Escolher pela linha mais recente ou pela local: dependeria de quem aplica e de quando, e as réplicas divergiriam.
  - Resolver depois da escrita: o índice único não é adiável como as chaves estrangeiras.
  - Excluir a ocorrência perdedora: apagaria dado financeiro.
- **Consequências:** o usuário pode ver um nome "sumir" para o equivalente de outro aparelho, com os lançamentos levados junto.

<a id="adr-48"></a>

## 48. Filho vivo sob pai excluído revive o pai

- **Status:** vigente
- **Contexto:** o merge por célula não vê relações; um lançamento novo pode chegar para uma conta excluída no outro aparelho.
- **Decisão:** a pós-aplicação revive o pai dono (chaves `CASCADE`/`NO ACTION`) com escrita local e reporta; se o pai tem uma gêmea viva por chave natural, o filho vai para ela.
- **Alternativas descartadas:**
  - Excluir o filho em cascata: apagaria dado financeiro por um merge que o usuário não viu.
  - Deixar o órfão: quebraria as invariantes de propriedade do schema.
- **Consequências:** uma exclusão pode ser desfeita pela sincronização; excluir de novo é uma ação deliberada.

<a id="adr-49"></a>

## 49. Sincronização só na mesma rede local

- **Status:** vigente
- **Contexto:** o produto promete que os dados nunca passam por rede ou serviço de terceiros, e nada pode exigir servidor.
- **Decisão:** conexão TCP direta entre aparelhos; só se aceita e só se disca para endereços privados, link-local, unique-local e loopback; CGNAT e públicos são recusados. É regra de produto, não limitação de versão.
- **Alternativas descartadas:**
  - P2P pela internet (WebRTC, hole punching): precisa de rendezvous e relay.
  - "Caixa postal" em pasta na nuvem: leva os dados a um terceiro.
  - VPN overlay (Tailscale, ZeroTier): faz aparelhos remotos parecerem locais; a faixa `100.64/10` é recusada.
  - Servidor HTTP no desktop acessado pelo navegador: o navegador não fala o canal Noise, HTTPS local exige certificado próprio em cada aparelho, HTTP exporia os dados, e não funciona offline.
- **Consequências:** aparelhos que nunca estão juntos na mesma rede não sincronizam. A localidade é segunda camada; a segurança vem das chaves e da cifra.

<a id="adr-50"></a>

## 50. Sincronização só com a tela de Dispositivos aberta

- **Status:** vigente
- **Contexto:** dados mudando por baixo de outra tela (um editor aberto) gerariam conflito na interface; o iOS exige primeiro plano para escutar de qualquer forma.
- **Decisão:** o coordenador escuta, anuncia, disca e mantém o modo ao vivo só enquanto a tela de Dispositivos está aberta (no celular, em foco e em primeiro plano); sair dela encerra tudo. Sem sincronização em segundo plano.
- **Alternativas descartadas:**
  - Sincronizar sempre que o app está aberto: alterações remotas chegariam com editores abertos.
  - Sincronização em segundo plano: exige serviços de plataforma e reabre o problema dos editores.
- **Consequências:** conflitos entre um editor aberto e uma edição remota não existem (não são bug a apontar em review); o usuário precisa abrir a tela nos dois aparelhos para sincronizar, e a interface não promete "sincronizado agora" fora dela.

<a id="adr-51"></a>

## 51. Um par de chaves por aparelho, fora do banco

- **Status:** vigente
- **Contexto:** remover um aparelho perdido precisa ser simples; uma cópia do banco não pode permitir se passar pelo aparelho.
- **Decisão:** chave X25519 por aparelho; a pública em `sync_members`, a privada no cofre da plataforma: `safeStorage` do Electron (no processo principal, arquivo em `userData`) e `expo-secure-store` no Android com `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Num Linux sem chaveiro, o modo de texto simples do Electron com o arquivo em `0600`.
- **Alternativas descartadas:**
  - Chave compartilhada do grupo: remover um aparelho exigiria trocar as chaves de todos.
  - Chave no SQLite: iria junto em toda cópia e backup.
  - Módulo nativo de chaveiro no desktop: o `safeStorage` já expõe o chaveiro do sistema sem dependência nova.
  - Recusar sincronizar num Linux sem chaveiro: o aparelho nunca sincronizaria; a defesa principal (chave fora do banco e dos backups) continua valendo com o arquivo restrito.
- **Consequências:** trocar o chaveiro do sistema invalida a chave e o aparelho precisa parear de novo.

<a id="adr-52"></a>

## 52. Noise (KK e IKpsk2) em TypeScript puro sobre @noble, no núcleo

- **Status:** vigente
- **Contexto:** desktop e celular precisam falar exatamente o mesmo protocolo autenticado e cifrado; o Hermes não tem `crypto`, e TLS numa rede local exigiria certificados.
- **Decisão:** `Noise_KK_25519_ChaChaPoly_BLAKE2s` nas sessões (as duas chaves já conhecidas); `IKpsk2` no pareamento, com PSK = BLAKE2s(prefixo, segredo de 128 bits do QR, id do grupo). Uma mensagem em claro (versão, modo, id) antecede o handshake e entra no prólogo. O anfitrião só registra o membro e consome o convite depois que a primeira mensagem cifrada do convidado decifra.
- **Alternativas descartadas:**
  - TLS: exige PKI ou certificados autoassinados com confiança manual em cada aparelho.
  - Implementações nativas por plataforma: dois protocolos para manter iguais; fica como plano B só para a primitiva, por trás de porta, se a vazão no Hermes não bastar.
  - Consumir o convite ao receber a conexão: qualquer conexão da rede, ou uma recusa por relógio, queimaria o QR.
- **Consequências:** a conformidade depende dos vetores públicos do Noise nos testes; a vazão no Hermes é medida pelo app de contrato.

<a id="adr-53"></a>

## 53. Entrada no grupo por aparelho vazio, por lote completo nos apps

- **Status:** vigente
- **Contexto:** dois históricos independentes não se mesclam; no uso real o desktop cria o grupo com o banco real e o celular entra.
- **Decisão:** só entra quem não tem dados; os apps entram pelo lote completo da sessão (`snapshots: null`). O snapshot por `VACUUM INTO` com `adoptSnapshot` existe no núcleo, testado, e é ligado fornecendo a `SnapshotPort`. O celular com dados move o banco para `backups/antes-de-entrar-no-grupo-*.sqlite`, com confirmação.
- **Alternativas descartadas:**
  - Mesclar um aparelho que já tem dados: sem o histórico de relógios, não há forma correta.
  - Snapshot já nos apps: trocaria o arquivo do banco no meio da sessão, com reabertura do app, para um ganho que só aparece com bancos grandes.
- **Consequências:** um banco de anfitrião muito grande entra num lote só, sem progresso; ligar o snapshot é trocar a porta.

<a id="adr-54"></a>

## 54. Convite em QR compacto (base32) e só o desktop convida

- **Status:** vigente
- **Contexto:** a câmera do celular precisa ler o QR com folga na tela do computador; o desktop não tem câmera; o celular não sabe o próprio IP do Wi-Fi sem outra dependência nativa.
- **Decisão:** convite binário em base32 com prefixo `FINANCAS1:` (~160 caracteres, QR de ~45×45 módulos), o mesmo texto para "Copiar convite"; validade de 5 minutos, uso único. O desktop entra colando o texto; o celular não mostra "Adicionar dispositivo". QR com tokens próprios (escuro sobre claro nos dois temas). Sem convite por código digitado por ora.
- **Alternativas descartadas:**
  - Convite em JSON: ~330 caracteres, QR de ~69×69 módulos, denso demais.
  - Celular convidando sem endereço no QR, ou com `expo-network` só para isso: a dependência não se paga, porque o grupo nasce no computador.
  - Código de 8 caracteres: exige PAKE (CPace) e limite de tentativas; fica para depois, e o handshake já recebe a PSK como entrada.
- **Consequências:** dois celulares não conseguem formar um grupo sozinhos; QR invertido no tema escuro não é usado.

<a id="adr-55"></a>

## 55. Desativar como ação padrão, numa coluna própria

- **Status:** vigente
- **Contexto:** contas e cartões saem de uso (conta encerrada, cartão cancelado), mas o histórico deles sustenta extratos, faturas, saldos e relatórios. Excluir apagaria esse histórico e mudaria saldos de outras contas.
- **Decisão:** a ação padrão é desativar (`disabled_at`, migration `0002`): some das escolhas de lançamentos novos, continua em todo histórico, saldo e total, e pode ser reativada. Lançamentos que já estão nela continuam editáveis, e as recorrências continuam emitindo. Excluir é a ação explícita.
- **Alternativas descartadas:** reaproveitar `deleted_at`, porque ele significa "não existe mais" para toda leitura e para a sincronização; um booleano sem instante, porque fugiria do formato de timestamp das demais colunas; parar as recorrências ao desativar, porque desativar não deve mudar nenhum saldo, nem o previsto.
- **Consequências:** toda escolha de origem e destino precisa distinguir "escolha nova" de "escolha já gravada" (`SelectionPolicy`). Uma série numa conta desativada só para se o usuário excluir "esta e as futuras". A decisão seria reaberta se fosse preciso esconder contas encerradas também dos relatórios.

<a id="adr-56"></a>

## 56. Exclusão em cadeia com escopo único para o alerta e a execução

- **Status:** vigente
- **Contexto:** excluir uma conta arrasta cartões, faturas, transferências que chegam, recorrências e metas, e muda o saldo de outras contas. O usuário precisa confirmar exatamente o que será apagado.
- **Decisão:** um `DeletionScope` calculado por uma consulta só serve ao alerta (`deletionImpact`) e à exclusão. A exclusão é soft delete de toda a cadeia numa unidade de trabalho, seguida do recálculo completo das contas sobreviventes afetadas. A tela exige digitar o nome e oferece "Desativar em vez disso".
- **Alternativas descartadas:** duas consultas, uma para o alerta e outra para a exclusão, porque poderiam discordar e apagar mais (ou menos) do que o usuário confirmou; `DELETE` físico, porque a sincronização propaga exclusões por `deleted_at`; bloquear a exclusão enquanto houver dependentes, porque obrigaria o usuário a desmontar a cadeia à mão; recálculo a partir de um mês, porque a cadeia toca meses quaisquer.
- **Consequências:** o recálculo completo é caro, mas a ação é rara. Um novo tipo de dependente precisa entrar no escopo, senão fica órfão.

<a id="adr-57"></a>

## 57. Conta e cartão padrão como colunas do perfil

- **Status:** vigente
- **Contexto:** o atalho "Débito / Crédito" precisa de no máximo uma conta padrão e um cartão padrão por perfil, inclusive com a sincronização entre aparelhos.
- **Decisão:** as colunas `profiles.default_account_id` e `default_credit_card_id` (migration `0008`). A escolha é conferida ao gravar (do perfil e ativa). Desativada ou excluída depois, ela deixa de valer na leitura sem ser apagada.
- **Alternativas descartadas:** um marcador `is_default` em cada conta ou cartão, porque exigiria desmarcar o anterior na mesma escrita, e a mescla célula a célula da sincronização deixaria dois padrões quando dois aparelhos escolhessem ao mesmo tempo; apagar a escolha ao desativar, porque reativar não devolveria o padrão.
- **Consequências:** a leitura do perfil precisa filtrar o padrão inválido. Reabriria se o padrão passasse a ser por tipo de lançamento.

<a id="adr-58"></a>

## 58. A moeda do perfil é a unidade, e a troca só sem lançamentos

- **Status:** vigente
- **Contexto:** todo valor gravado é denominado na moeda do perfil. Não há cotação nem conversão no app.
- **Decisão:** a moeda do perfil é a unidade de tudo. A moeda da conta é rótulo, e a moeda de origem da transação é proveniência. Trocar a moeda do perfil só é permitido enquanto não há lançamentos dele nem transferências que chegam a ele (`profile-currency-locked`). A troca reetiqueta sem converter.
- **Alternativas descartadas:** converter todo o histórico na troca, porque não há taxa confiável e outra precisão arredondaria os valores; moeda por conta como unidade, porque todo total e relatório exigiria conversão.
- **Consequências:** uma conta em moeda estrangeira não concilia com o banco e só sai do total por "considerar no saldo". Transferência entre perfis e mover para outro perfil exigem a mesma moeda.

<a id="adr-59"></a>

## 59. Fatura paga ou em aberto, com pagamento parcial como transferência negativa

- **Status:** vigente
- **Contexto:** a fatura precisa pesar no saldo da conta pagadora no mês certo, e o usuário às vezes paga só uma parte.
- **Decisão:** a fatura tem dois estados. Pagar vincula a fatura ao extrato da conta pagadora do cartão no mês do pagamento; reabrir desfaz o vínculo. O pagamento parcial é uma transferência de valor negativo na fatura, com a conta que pagou como destino, já paga. A conta do pagamento total não se escolhe.
- **Alternativas descartadas:** um estado "paga parcialmente" com valor pago na fatura, porque criaria um caso especial em todo cálculo de saldo; pagar a fatura por qualquer conta, porque o vínculo com o extrato da pagadora é o modelo do recálculo (`ImpactCalculator`).
- **Consequências:** o parcial deve ser menor que o valor a pagar. Quitar tudo é "Pagar fatura". Pagar por outra conta exige parcial ou trocar a pagadora no cartão.

<a id="adr-60"></a>

## 60. A fatura escolhida é a verdade

- **Status:** vigente
- **Contexto:** o banco às vezes lança uma compra num ciclo diferente do que a data e o fechamento sugerem.
- **Decisão:** o app sugere a fatura pela data da compra e pelo ciclo. A fatura gravada é a verdade e nunca é recalculada, nem quando a data ou o ciclo do cartão muda. Escolher uma fatura paga a reabre, com aviso.
- **Alternativas descartadas:** derivar a fatura da data a cada leitura, porque moveria em silêncio compras colocadas à mão e impediria espelhar a fatura real; recusar o lançamento em fatura paga, porque o usuário precisa registrar compras que o banco incluiu depois.
- **Consequências:** mudar o dia de fechamento não reorganiza o passado. Séries no cartão guardam um deslocamento de fatura (`invoice_offset`).

<a id="adr-61"></a>

## 61. Transferência como uma linha só

- **Status:** vigente
- **Contexto:** a transferência mexe em duas contas, possivelmente de perfis diferentes, e precisa sincronizar sem divergir.
- **Decisão:** uma linha, no contêiner da origem, com `destination_account_id`. A data de caixa, o valor e a situação de pago são os mesmos dos dois lados, e os encargos ficam na origem.
- **Alternativas descartadas:** duas pernas ligadas, porque editar ou sincronizar uma sem a outra deixaria as pontas com valores diferentes e o dinheiro sumiria entre os meses.
- **Consequências:** origem e destino compartilham a data, então a TED que sai num dia e cai no outro fica registrada numa data só. O saldo do destino soma as transferências que chegam, e os relatórios precisam evitar contagem dupla.

<a id="adr-62"></a>

## 62. O tipo da transação é fixo desde a criação

- **Status:** vigente
- **Contexto:** o tipo decide a direção do efeito, a conta de destino e quem alimenta meta.
- **Decisão:** a edição recusa trocar o tipo (`transaction-type-locked`) em qualquer escopo. O formulário trava o seletor.
- **Alternativas descartadas:** permitir a troca com limpeza dos vínculos, porque deixava vínculos inválidos (meta numa despesa) e mudava saldos de forma pouco visível.
- **Consequências:** para mudar o tipo, o usuário exclui e lança de novo.

<a id="adr-63"></a>

## 63. Recorrência materializa transações reais, com horizonte e marca d'água

- **Status:** vigente
- **Contexto:** cada parcela precisa cair numa fatura, ser paga e editada individualmente e pesar no saldo do mês.
- **Decisão:** a regra emite linhas reais de `transactions` e guarda o modelo e o calendário (migration `0004`). As parceladas são gravadas inteiras; as fixas, até um horizonte móvel de 12 meses. A marca d'água `materialized_count` só avança, e o complemento roda na abertura, por série, cada uma na própria transação.
- **Alternativas descartadas:** expandir o modelo na leitura, porque a ocorrência virtual não tem contêiner, pagamento nem edição própria; gravar a fixa até o fim, porque uma fixa até 2099 emitiria centenas de linhas; complementar procurando "existe linha para esta data", porque recriaria ocorrências excluídas e não é idempotente; copiar o modelo de uma ocorrência existente, porque um valor atípico vazaria para as seguintes.
- **Consequências:** a abertura escreve no banco, e a sincronização precisa mesclar a marca d'água (o maior valor vale). A falha de uma série vai para o log sem bloquear as outras.

<a id="adr-64"></a>

## 64. O id da ocorrência vem do número, não da data

- **Status:** vigente
- **Contexto:** dois aparelhos podem completar a mesma série offline, e a data das ocorrências muda quando o dia âncora é trocado.
- **Decisão:** o id determinístico é derivado de (série, número da ocorrência). O índice único é por `(recurrence_id, occurrence)`, e o índice por data foi removido. Gerar um número já excluído revive a linha com `created_at` novo.
- **Alternativas descartadas:** id pela data gerada, porque duplicaria ocorrências entre aparelhos quando o dia muda; unicidade por data, porque fazia o complemento falhar quando o usuário movia uma ocorrência para a data de outra.
- **Consequências:** duas ocorrências da mesma série podem vencer no mesmo dia, e "futuras" é definido pelo número.

<a id="adr-65"></a>

## 65. Escopo sempre perguntado, só o que mudou se propaga e o plano sai de um ensaio

- **Status:** vigente
- **Contexto:** editar uma ocorrência pode querer valer para uma linha, para as futuras ou para todas. Ocorrências pagas não são protegidas.
- **Decisão:** sempre perguntar "somente esta", "esta e as futuras" ou "todas". Nos escopos de série, só o que mudou na editada vai para as outras; pago e data de pagamento ficam individuais. A criação e os escopos de série passam por um diálogo de revisão cujo plano vem da própria operação, executada numa transação desfeita (`UnitOfWork.rehearse`). "Somente esta" grava direto.
- **Alternativas descartadas:** um escopo padrão, porque nenhum acerta mais que metade das vezes e reescreveria histórico em silêncio; copiar o formulário inteiro, porque quebraria o resto do arredondamento das parcelas; prever o plano com uma segunda implementação das regras, porque poderia discordar do que é gravado.
- **Consequências:** o ensaio custa uma execução a mais por confirmação. A "editada à mão" é aproximada por `updated_at` acima de `created_at` mais 1 segundo.

<a id="adr-66"></a>

## 66. Mudar a periodicidade ou a forma recomeça a série; quantidade e fim a remodelam

- **Status:** vigente
- **Contexto:** mudar a série pode manter o calendário (quantidade de parcelas, fim) ou trocá-lo (frequência, parcelada ↔ fixa).
- **Decisão:** com o mesmo calendário, a regra continua e só se cria ou se apaga o que a mudança exige (`reshapeSeries`). Com calendário novo, a regra antiga termina antes da editada, a editada e as futuras são excluídas e nasce uma regra nova na editada (`restartSeries`). Mudar a série vale sempre para "esta e as futuras".
- **Alternativas descartadas:** regenerar todas as futuras em qualquer mudança, porque apagava pagamentos e edições sem necessidade; manter a mesma regra com calendário novo, porque a numeração antiga não diz nada no calendário novo (uma diária virando mensal gravaria décadas).
- **Consequências:** as ocorrências passadas ficam na regra antiga, sem vínculo com a nova. As excluídas saem mesmo pagas, e a revisão mostra isso antes.

<a id="adr-67"></a>

## 67. Compras do cartão agrupadas na linha da fatura sem filtro

- **Status:** vigente
- **Contexto:** listadas uma a uma, as compras no cartão poluem a lista do mês de Transações.
- **Decisão:** sem filtro, cada fatura que pesa no mês vira uma linha (data de caixa da fatura, valor a pagar líquido dos parciais). O pagamento parcial fica como linha própria. Com qualquer filtro, as compras voltam uma a uma. As faturas vêm da mesma consulta do extrato (`statements.profileInvoices`).
- **Alternativas descartadas:** sempre listar as compras, pela poluição; sempre agrupar, porque o filtro é a forma de achar uma compra.
- **Consequências:** o resultado da lista agrupada conta o parcial pelo efeito na conta pagadora. A compra de cartão sem conta pagadora no perfil continua avulsa.

<a id="adr-68"></a>

## 68. Primeiro uso numa unidade de trabalho

- **Status:** vigente
- **Contexto:** um perfil sem conta, ou sem nenhuma subcategoria, não permite lançar nada e deixaria o app num estado que nenhuma tela trata.
- **Decisão:** `onboarding.start` cria o perfil, a primeira conta e as categorias sugeridas numa única unidade de trabalho.
- **Alternativas descartadas:** criar o perfil e depois pedir a conta noutra tela, porque uma falha no meio deixaria o perfil sem conta.
- **Consequências:** o formulário do primeiro uso pede dados da conta junto com os do perfil.

<a id="adr-69"></a>

## 69. O dia do pagamento da fatura é registro, não regra

- **Status:** vigente
- **Contexto:** o vínculo da fatura paga guarda só o mês, mas o extrato precisa mostrar a fatura no dia em que o dinheiro saiu.
- **Decisão:** a coluna `invoices.payment_date` (migration `0003`) é gravada e apagada junto do vínculo e não decide nada. Ela é nula nas faturas pagas antes da migration.
- **Alternativas descartadas:** inventar o dia das faturas antigas (primeiro ou último do mês), porque mostraria uma data que não aconteceu; fazer o dia decidir a situação, porque duplicaria a fonte da verdade com o vínculo.
- **Consequências:** as faturas antigas aparecem sem dia ("Paga no extrato de mês") e vão para o fim do mês no extrato.

<a id="adr-70"></a>

## 70. Limite usado sem as ocorrências futuras de séries fixas

- **Status:** vigente
- **Contexto:** as séries fixas são gravadas 12 meses à frente. Somá-las ao limite reservaria um ano de assinatura ainda não cobrada.
- **Decisão:** o limite usado soma o valor a pagar das faturas em aberto até a fatura aberta hoje. Das faturas posteriores, soma só o comprometido (compras avulsas lançadas adiante e parcelas). A fatura credora conta zero.
- **Alternativas descartadas:** somar todas as faturas em aberto, pelo motivo acima; contar só a fatura aberta hoje, porque ignoraria parcelas já reservadas pelo banco.
- **Consequências:** a regra depende do "hoje" do relógio e da distinção entre parcelada e fixa no repositório (`committedInvoiceTypeTotals`).

<a id="adr-71"></a>

## 71. Progresso da meta calculado na leitura, sem coluna de progresso

- **Status:** vigente
- **Contexto:** a meta precisa mostrar quanto já foi guardado, e esse valor depende de transações vinculadas, do dia de pagamento de faturas e, na meta vinculada a conta, dos extratos da conta — dados que mudam por muitas rotas diferentes.
- **Decisão:** `goals` guarda só o alvo e a origem do progresso (`kind`, `account_id`); o progresso é somado a cada leitura por `measureGoalProgress`, a partir de uma consulta única de vínculos (`SqliteGoalRepository.selectLinks`) ou dos extratos da conta.
- **Alternativas descartadas:** coluna de progresso em cache, como os saldos de conta — exigiria recalcular em toda escrita de transação, fatura e extrato, e divergiria da tabela de vinculadas na primeira falha; diferente dos saldos, as metas são lidas raramente, então somar na leitura custa pouco.
- **Consequências:** `goals.list` e `goals.contributions` são invalidadas por toda escrita de dinheiro; por isso o campo "Meta" do lançamento lê a rota leve `goals.options`. Reabriria a decisão uma tela que liste metas com frequência alta e muitos vínculos.

<a id="adr-72"></a>

## 72. Progresso pelas pagas até hoje; ritmo a partir do fim do mês de referência

- **Status:** vigente
- **Contexto:** séries fixas são geradas 12 meses à frente, e a tela navega por meses de referência passados e futuros.
- **Decisão:** o guardado soma só as vinculadas pagas até hoje (num cartão, pelo dia em que a fatura foi paga), com sinal e sem encargos, independente do mês. Prazo, ritmo e projeção contam do último dia do mês de referência, em meses médios (365,2425 ÷ 12 dias), partindo do guardado nesse mesmo ponto (`paceBase`: real num mês encerrado, hoje no atual, hoje + média × meses num futuro). A média vai do mês da 1ª contribuição até o de referência (ou o atual), com mês vazio valendo zero.
- **Alternativas descartadas:** somar todas as vinculadas, inclusive futuras — daria a meta por cumprida antes da hora; partir o ritmo do guardado de hoje em qualquer mês — contava duas vezes os aportes entre um mês passado e hoje e ignorava os meses entre hoje e um mês futuro; contar meses pelo calendário — 31/01 → 28/02 valeria um mês inteiro e 01/02 → 28/02 quase um.
- **Consequências:** fora do mês atual a tela precisa explicar a base ("No fim de jan/2026 havia R$ 500,00 guardados.") para não contradizer o total. Reabriria a decisão querer projetar aportes agendados.

<a id="adr-73"></a>

## 73. Meta vinculada ao saldo de uma conta de investimento

- **Status:** vigente
- **Contexto:** uma meta pode ser simplesmente o saldo de uma conta de investimento, e vincular cada depósito pelo campo "Meta" seria redundante.
- **Decisão:** `kind = 2` com `account_id`: o guardado é o saldo consolidado de hoje; cada mês do extrato entra como vínculo sem transação (variação do consolidado), e o saldo de abertura como `startingBalance`, fora da média. Só contas de investimento do perfil (`goal-account-not-investment`); a meta não recebe lançamentos (`goal-funded-by-account`); trocar para esse tipo desfaz os vínculos; a conta que é saldo de meta (ativa ou arquivada) não muda de tipo (`account-type-funds-goal`); excluir a conta exclui a meta em cadeia.
- **Alternativas descartadas:** aceitar conta corrente — o saldo do dia a dia não diz quanto foi juntado; desfazer o vínculo em silêncio quando a conta muda de tipo — a meta mudaria de significado sem o usuário ver; manter vínculos de lançamentos sem efeito após a troca de tipo — confundiria quem os visse.
- **Consequências:** um mesmo cálculo serve aos dois tipos; meses depois do atual ficam fora do progresso da conta. Reabriria a decisão permitir outros tipos de conta como reserva.

<a id="adr-74"></a>

## 74. Retirada como marca na transferência vinculada

- **Status:** vigente
- **Contexto:** guardar numa poupança e retirar para um imprevisto precisa descontar da meta.
- **Decisão:** coluna `goal_withdrawal` em `transactions` e `recurrences` (migration `0005`); marcada, a transferência entra com sinal invertido no progresso. Só a transferência retira (`goal-withdrawal-requires-transfer`); sem meta, a marca é descartada em silêncio.
- **Alternativas descartadas:** permitir retirada pela receita — receita sempre traz dinheiro; recusar a marca sem meta — obrigaria desmarcar a retirada antes de tirar a meta do lançamento.
- **Consequências:** a série copia a marca para as ocorrências; excluir a meta ou trocar o tipo zera a marca junto com o vínculo.

<a id="adr-75"></a>

## 75. Desativar e arquivar como colunas próprias, não `deleted_at`

- **Status:** vigente
- **Contexto:** contas, cartões e metas precisam sair de vista sem perder o histórico que os referencia.
- **Decisão:** colunas `disabled_at` (contas e cartões, migration `0002`) e `archived_at` (metas, migration `0006`), nulas quando ativos e com o instante UTC do primeiro desativar/arquivar. A linha sai das escolhas de lançamentos novos, mas continua nos cálculos; o lançamento já vinculado continua editável.
- **Alternativas descartadas:** reaproveitar `deleted_at` — significa "não existe mais" para toda leitura e para a sincronização; renomear "desativado" para "arquivado" em contas e cartões — mantido o termo existente.
- **Consequências:** toda consulta de escolhas filtra a coluna; a tela tem visualizações (ativas/desativadas; ativas/atingidas/arquivadas). Categorias, subcategorias e tags não têm estado equivalente.

<a id="adr-76"></a>

## 76. Sócios gravados como lista inteira

- **Status:** vigente
- **Contexto:** a soma das participações precisa dar 100%.
- **Decisão:** uma rota só, `partners.save`, recebe a lista completa e cria, regrava e remove numa transação, conferindo a soma no resultado (em centésimos inteiros, até duas casas decimais). Lista vazia é aceita. Só o sócio que mudou é regravado.
- **Alternativas descartadas:** CRUD por sócio — cada passo de uma redivisão (60/40 → 50/50) passaria por um estado que a soma recusa; tolerar soma diferente de 100% — parte dos aportes ficaria sem dono na divisão.
- **Consequências:** a tela edita um rascunho e salva tudo de uma vez. A soma não é garantida depois de uma mescla da sincronização (limitação conhecida).

<a id="adr-77"></a>

## 77. Remover sócio apaga o vínculo dos lançamentos

- **Status:** vigente
- **Contexto:** lançamentos e séries apontam para o sócio que aportou; o sócio pode sair.
- **Decisão:** o soft delete do sócio zera `partner_id` em `transactions` e `recurrences`; os lançamentos ficam "sem sócio atribuído", e a tela avisa quantos antes de salvar.
- **Alternativas descartadas:** só ignorar o sócio excluído no relatório — editar o lançamento esbarraria num sócio que não existe, e as próximas ocorrências da série nasceriam com ele.
- **Consequências:** o sócio removido não volta pelo id; os lançamentos precisam ser reatribuídos pelo relatório por sócio (`transactions.setPartner`).

<a id="adr-78"></a>

## 78. Sócio só nos aportes, não nas despesas

- **Status:** vigente
- **Contexto:** toda despesa do perfil empresarial é paga com o dinheiro da empresa; o que cada sócio põe nela é o que entra.
- **Decisão:** o sócio só cabe na receita de perfil empresarial e na transferência que chega a um perfil empresarial vinda de outro perfil (com o sócio do perfil de destino); o resto recusa sócio novo (`partner-requires-contribution`). Despesa com sócio já gravada mantém o sócio enquanto perfil e destino não mudam.
- **Alternativas descartadas:** registrar quem pagou cada despesa (o modelo anterior) — não reflete o caixa da empresa; limpar o sócio das despesas antigas — apagaria histórico do usuário.
- **Consequências:** o relatório por sócio divide o total de aportes de todos os períodos; receita de serviço fica sem sócio, fora da divisão. A distribuição de lucro pela participação não existe.

<a id="adr-79"></a>

## 79. Unicidade de nomes conferida na aplicação, sem diferenciar maiúsculas

- **Status:** vigente
- **Contexto:** categorias e tags são únicas no perfil, e subcategorias na categoria, sem diferenciar maiúsculas.
- **Decisão:** o service confere com `sameName` (NFC + minúsculas) e recusa com `CONFLICT` apontando o campo; os índices únicos `NOCASE` ficam como rede de segurança.
- **Alternativas descartadas:** confiar só no `COLLATE NOCASE` — só dobra ASCII ("Saúde"/"SAÚDE" passariam) e, quando pega, falha com erro de SQL sem campo; conferir na tela — só o núcleo vê todos os nomes.
- **Consequências:** na sincronização, nomes iguais criados offline colidem pela chave natural e sobrevive a linha de menor id, com os filhos redirecionados.

<a id="adr-80"></a>

## 80. Excluir subcategoria em uso exige mover os lançamentos

- **Status:** vigente
- **Contexto:** toda transação aponta para uma subcategoria viva.
- **Decisão:** excluir subcategoria (ou categoria) com lançamentos exige `moveTo`, fora das subcategorias excluídas e do mesmo perfil; mover e excluir numa unidade de trabalho.
- **Alternativas descartadas:** apagar os lançamentos em cascata — mudaria saldos por uma ação de cadastro; subcategoria de sistema "sem categoria" — não existe subcategoria de sistema no modelo.
- **Consequências:** o núcleo não move subcategoria entre categorias nem guarda ordem; mudar a categoria de uma subcategoria é criar outra e excluir movendo.

<a id="adr-81"></a>

## 81. Anotação sem campo de título

- **Status:** vigente
- **Contexto:** a lista de anotações precisa de um rótulo por item.
- **Decisão:** a primeira linha não vazia do texto é o título (`summarizeNote`), e o resto é a prévia; o núcleo apara o texto para que o título nunca seja uma linha vazia.
- **Alternativas descartadas:** campo de título à parte — poderia discordar do texto.
- **Consequências:** a busca procura no texto inteiro; o texto é uma coluna só, então edições concorrentes não se mesclam na sincronização (vence a mais recente).

<a id="adr-82"></a>

## 82. Relatórios personalizados no lugar de uma tela por pergunta

- **Status:** vigente
- **Contexto:** o MVP tinha cinco relatórios fixos (por categoria, fluxo por conta, impacto do cartão, por sócio, por tag), cada um com rota, domínio, DTOs, view-model e tela próprios. Toda pergunta nova pedia uma tela nova, e o usuário queria montar as próprias perguntas.
- **Decisão:** a página de Relatórios lista definições salvas pelo usuário (nome + filtro + formato), executadas por uma consulta montada a partir de listas fechadas de filtros e dimensões (`ReportService`, `SqliteReportQueryRepository`, Strategy por dimensão). Ficam fixos só os que o editor não expressa: a projeção de saldo (todo perfil) e a distribuição por sócio (perfil empresarial). Os relatórios fixos antigos foram removidos com rotas, domínio e telas.
- **Alternativas descartadas:** manter as telas fixas e acrescentar o editor (duas fontes de números para a mesma pergunta, e manutenção dobrada); um editor livre com SQL ou expressões (inseguro e sem garantia de que os números sigam as regras do domínio).
- **Consequências:** perderam-se comparações específicas (mesmo mês do ano anterior, média de 3 meses, situação de cada fatura, peso do cartão nas entradas) e o drill-down; os encargos ficam fora da soma. Reabriria a decisão uma pergunta frequente que nenhum filtro + agrupamento expresse — o caminho é um novo relatório fixo, como os dois atuais.

<a id="adr-83"></a>

## 83. Definição do relatório em JSON versionado numa coluna

- **Status:** vigente
- **Contexto:** o filtro tem cerca de dez listas de ids (categorias, contas, cartões, tags, sócios, metas...) e o formato, várias opções; a definição precisa sincronizar entre aparelhos.
- **Decisão:** coluna `report_definitions.definition` com JSON `{ version: 1, filter, layout }`, lido pelo mesmo schema zod da entrada da rota e revalidado no domínio; JSON inválido vira `CorruptRowError`. A definição inteira é uma célula de sincronização (vence a edição mais recente inteira).
- **Alternativas descartadas:** uma tabela de vínculo por lista de ids (nenhuma consulta além de "carregar a definição" a justificaria, e o merge por coluna misturaria filtros de duas edições); colunas por campo (o merge campo a campo poderia montar uma combinação que ninguém montou).
- **Consequências:** referências a cadastros não têm chave estrangeira — a posse é conferida no Service ao salvar, e um cadastro excluído continua na definição sem casar com nada. Mudança de formato pede `version: 2` com conversão na leitura, sem migration de dados. Reabriria a decisão a necessidade de consultar relatórios por cadastro referenciado.

<a id="adr-84"></a>

## 84. Projeção de saldo pelo método direto, com faixa de incerteza

- **Status:** vigente
- **Contexto:** a primeira versão somava a média do resultado de todos os meses; a linha saía reta, tratava aluguel, parcelas e salário como incerteza e não sabia quando uma parcela acabava.
- **Decisão:** saldo de hoje + variação do saldo previsto de cada mês (o que já está lançado: séries, parcelas, contas em aberto, faturas) + média dos avulsos pagos nos meses fechados da janela (12, 6, 3 ou 1), com faixa saldo ∓ σ√t usando o desvio-padrão amostral dos avulsos.
- **Alternativas descartadas:** média simples do resultado mensal (conta as séries duas vezes e ignora o fim das parcelas); incluir o mês corrente na média (está pela metade e puxa a média para baixo); desvio populacional (subestima a incerteza com poucos meses); sazonalidade pelo mesmo mês do ano anterior (fica para depois).
- **Consequências:** um avulso já lançado para um mês futuro conta no comprometido e a média ainda é somada nesse mês; séries que o usuário ainda vai criar só aparecem pela média dos avulsos. Reabriria a decisão um histórico longo que permita modelar sazonalidade.

<a id="adr-85"></a>

## 85. Importação: o núcleo recebe linhas normalizadas e a análise é a mesma na prévia e na gravação

- **Status:** vigente
- **Contexto:** a importação mistura formato de arquivo (codificação, separadores, datas, números, colunas) e regras de negócio (séries, faturas, perfis); a revisão precisa mostrar exatamente o que será gravado.
- **Decisão:** o `client`/renderer leem o arquivo e entregam `ImportRow` normalizadas (datas ISO, números, textos aparados, nomes do arquivo); o núcleo não conhece CSV. `analyzeImport` é uma função pura do domínio, chamada pela tela de revisão e de novo pelo `ImportService` sobre a mesma entrada.
- **Alternativas descartadas:** enviar o arquivo ao núcleo (acoplaria regras ao formato e ao CSV); calcular a prévia no `client` com outra implementação (a prévia poderia discordar do que é gravado).
- **Consequências:** o renderer decodifica os bytes, porque o `client` não tem `TextDecoder`; a importação existe só no desktop. Reabriria a decisão a importação no celular ou um formato que precise de leitura no núcleo.

<a id="adr-86"></a>

## 86. Importação numa unidade de trabalho, sem proveniência, com cópia do banco antes

- **Status:** vigente
- **Contexto:** um arquivo real tem milhares de linhas; uma falha no meio não pode deixar metade gravada, e reimportar o mesmo arquivo é um risco.
- **Decisão:** toda a importação numa unidade de trabalho, com o recálculo de saldos uma vez no fim sobre o impacto acumulado; nenhum registro de proveniência; a revisão oferece (marcada por padrão) exportar uma cópia do banco antes, e cancelar ou falhar a cópia não importa nada.
- **Alternativas descartadas:** recalcular por lançamento (quadrático em milhares de linhas); registrar proveniência por linha para detectar reimportação (modelagem e sincronização extras para um uso raro).
- **Consequências:** reimportar duplica os lançamentos, e a cópia é o caminho de volta. Reabriria a decisão a importação recorrente (por exemplo, extratos mensais do banco), que exigiria deduplicação.

<a id="adr-87"></a>

## 87. Gastos da Visão geral com a compra no cartão no mês do vencimento da fatura

- **Status:** vigente
- **Contexto:** a regra-mestra de caixa põe a compra no cartão no mês em que a fatura foi paga; na Visão geral, uma fatura paga com atraso mudava os gastos de mês e confundia a leitura do mês.
- **Decisão:** em `overview.spending`, o lançamento de conta conta no mês do extrato (pagamento, ou vencimento em aberto) e a compra no cartão no mês do **vencimento da fatura**, paga ou não (`OVERVIEW_FLOWS_CTE`).
- **Alternativas descartadas:** mês do pagamento da fatura (atraso muda o mês dos gastos); data da compra (não é quando o dinheiro sai e não concordaria com o extrato).
- **Consequências:** a Visão geral e os números que usam a regra-mestra inteira (distribuição por sócio, projeção, metas) podem pôr a mesma compra em meses diferentes quando a fatura é paga com atraso. Reabriria a decisão uma reclamação de divergência entre a Visão geral e o extrato.

<a id="adr-88"></a>

## 88. Distribuição por sócio divide os aportes de todos os períodos

- **Status:** vigente
- **Contexto:** a primeira versão dividia as despesas do mês do perfil empresarial entre os sócios; mas toda despesa da empresa é paga com dinheiro da empresa, e o que cada sócio põe nela é o dinheiro que entra.
- **Decisão:** o relatório divide os **aportes** (receitas e transferências vindas de outro perfil, com sócio) de todos os períodos pela participação; o mês só recorta indicadores e a lista de entradas sem sócio. Entradas sem sócio ficam fora da divisão. Com saldo previsto negativo no mês, os sócios cobrem o déficit com aportes na empresa, no lugar do acerto entre eles. Sócio só é vinculável a aportes (`partner-requires-contribution`).
- **Alternativas descartadas:** dividir despesas (não reflete quem financia a empresa); recorte mensal dos aportes (o desequilíbrio de um mês se compensa nos seguintes); cobrir déficit com transferências entre sócios (o dinheiro precisa ir para a empresa).
- **Consequências:** despesas com sócio gravadas antes da regra ficam sem efeito no relatório; a distribuição do lucro pela participação não é modelada. Reabriria a decisão a necessidade de distribuir lucro.

<a id="adr-89"></a>

## 89. Relatórios personalizados usam a data da própria transação, escolhida na definição

- **Status:** vigente
- **Contexto:** a regra-mestra de caixa (compra no cartão no mês em que a fatura foi paga) exige junção com faturas e extratos e responde só uma pergunta; o editor precisa de uma data simples para o mês e para a dimensão de mês.
- **Decisão:** a definição escolhe a base: `payment` (o `payment_date` da própria transação; a em aberto fica fora), `due` (o `due_date`; no cartão, a data da compra) ou `created` (dia UTC do `created_at`).
- **Alternativas descartadas:** aplicar a regra-mestra nos personalizados (o usuário não teria como perguntar pela data da compra; a dimensão de mês dependeria do pagamento da fatura); converter `created_at` para o fuso do usuário (o núcleo não conhece o fuso).
- **Consequências:** um relatório personalizado por pagamento não coincide com o extrato para compras no cartão; transações lançadas tarde da noite podem cair no dia seguinte na base `created`. Reabriria a decisão a necessidade de um relatório que bata com o extrato mês a mês.

<a id="adr-90"></a>

## 90. Modelo de mapeamento da importação nas preferências do aparelho

- **Status:** vigente
- **Contexto:** o usuário importa arquivos do mesmo formato mais de uma vez e quer reaproveitar a ligação de colunas.
- **Decisão:** os modelos ficam no `preferences.json` do desktop (até 30, validados no processo principal), reconhecidos pelos cabeçalhos do arquivo em qualquer ordem.
- **Alternativas descartadas:** guardar no banco (não é dado financeiro e seria replicado pela sincronização para aparelhos que nem importam).
- **Consequências:** o modelo não acompanha o usuário em outro computador. Reabriria a decisão a importação em mais de um aparelho.
