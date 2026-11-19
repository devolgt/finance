# Tecnologias

Stack do projeto e o papel de cada dependência declarada nos `package.json` da raiz, de `packages/*` e de `apps/*`: para que é usada (com o lugar onde é importada) e, quando a escolha não é óbvia, por que ela e não outra. Dependências repetidas em vários pacotes são explicadas uma vez, na seção 4. No fim, os scripts do repositório, o devcontainer e a CI.

## 1. Stack em resumo

| Área | Escolha |
|---|---|
| Runtime de desenvolvimento e do desktop | Node 24 (`engines` da raiz: `>=24 <25`), Electron 44 no app |
| Runtime do celular | Hermes (React Native 0.88, Expo SDK 58) |
| Linguagem | TypeScript ~6 em modo estrito, ESM |
| Monorepo | pnpm 12 com workspace (`packages/*`, `apps/*`) |
| Banco | SQLite: `better-sqlite3` (desktop e testes no Node), `expo-sqlite` (celular) |
| Validação | zod 4 (Requests do núcleo, formulários, mensagens de IPC) |
| UI desktop | React 19 + React DOM, TanStack Router e Query, Tailwind 4, shadcn/ui (Radix), Recharts |
| UI celular | React Native + Expo Router, TanStack Query, NativeWind 4 (Tailwind 3) |
| Criptografia da sincronização | `@noble/ciphers`, `@noble/curves`, `@noble/hashes` (Noise em TypeScript puro) |
| Testes | Vitest (pacotes e desktop), Jest + jest-expo (celular), Playwright (desktop E2E), fast-check, Maestro (emulador) |
| Lint | ESLint 10 em flat config com `typescript-eslint` `strictTypeChecked` e regras de fronteira |
| Empacotamento | electron-vite + electron-builder (`.deb`, `.exe`); `expo prebuild` + Gradle (APK) |
| Ambiente | Devcontainer Docker com toolchain Android; CI no GitHub Actions |

## 2. Linguagem, lint e formatação

### 2.1 TypeScript

Todos os pacotes estendem [tsconfig.base.json](../../tsconfig.base.json): `strict` mais `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`, `useUnknownInCatchVariables` e `verbatimModuleSyntax`. O alvo é ES2022 com `lib` ES2023 e `types: []`, para que nenhum tipo do Node vaze para o núcleo sem ser pedido. `noEmit` e `allowImportingTsExtensions`: o TypeScript só verifica tipos; quem gera código é o bundler ou o runner de testes (ver §3.2). Cada pacote tem `typecheck` próprio, com `tsconfig.src.json` (só o fonte, sem tipos do Node) separado do `tsconfig.json` (fonte e testes) onde a diferença importa. O motivo do modo estrito está em [decisões](decisoes.md) ([ADR 4](decisoes.md#adr-4)).

### 2.2 ESLint

[eslint.config.js](../../eslint.config.js), em flat config:

- `@eslint/js` (`recommended`) e `typescript-eslint` (`strictTypeChecked`, com `projectService`) para todo o repositório, mais `consistent-type-imports`, `explicit-function-return-type`, `explicit-member-accessibility`, `switch-exhaustiveness-check` e `restrict-template-expressions`.
- **Regras de fronteira por pasta**, que tornam a arquitetura verificável: o núcleo não importa Node nem plataforma e não usa `Date`, `Math.random`, `crypto`, `Intl`, `localeCompare` ou `toLocale*`; o `client` não importa React DOM, React Native, Electron nem Node; `sqlite-expo` só conhece as portas do núcleo; as telas do celular só falam com o `client`; `tokens/src` não tem dependências. O detalhe está em [mapa do sistema §1](mapa-do-sistema.md).
- Arquivos `.js`/`.mjs` sem verificação por tipos; os arquivos de configuração do celular em CommonJS.

### 2.3 EditorConfig

[.editorconfig](../../.editorconfig): 4 espaços por nível (2 em YAML), sem tab. Não há Prettier: a formatação é a do editor, e o [CLAUDE.md](../../CLAUDE.md) proíbe alinhar código em colunas.

## 3. pnpm e o workspace

### 3.1 Workspace

[pnpm-workspace.yaml](../../pnpm-workspace.yaml) declara `packages/*` e `apps/*`; a versão do pnpm é fixada pelo campo `packageManager` da raiz (`pnpm@12.8.1`, via Corepack). Os pacotes internos se referenciam com `workspace:*`. `allowBuilds` libera só os scripts de instalação necessários (`esbuild`, `electron`) e bloqueia os dispensáveis (`electron-winstaller`, `@parcel/watcher`, cujos binários já vêm prontos). A escolha do pnpm está em [decisões](decisoes.md) ([ADR 7](decisoes.md#adr-7)).

O pnpm roda no modo isolado (padrão, sem `node-linker=hoisted`): cada pacote só enxerga o que declara. Isso tem dois efeitos visíveis no celular: o [metro.config.js](../../apps/mobile/metro.config.js) resolve React, Expo e os módulos nativos sempre a partir do app (senão o bundle levaria duas cópias de `react-native`), e o app declara dependências que o Babel carrega pelo nome (§5.9).

### 3.2 Pacotes sem build

Os pacotes de `packages/*` exportam o fonte `.ts` diretamente (`"exports": { ".": "./src/index.ts" }`). Vite (desktop), Metro (celular), Vitest e Jest compilam o TypeScript ao consumir; os scripts de Node da raiz rodam `.ts` com `--experimental-transform-types`. Não existe `dist` intermediário para ficar desatualizado. Ver [ADR 6](decisoes.md#adr-6).

## 4. Dependências compartilhadas entre pacotes

| Dependência | Onde | Para quê |
|---|---|---|
| `typescript` | todos (raiz `~6.0.0`, pacotes `6.0.3`) | Verificação de tipos (`typecheck`); a raiz o usa no ESLint. |
| `@types/node` | todos os pacotes | Tipos do Node **só para testes e scripts**; o `tsconfig.src.json` do núcleo, do `client` e do `sqlite-expo` não os carrega. |
| `vitest` | `core`, `client`, `sqlite-expo`, `tokens`, `desktop` | Runner de testes no Node. Escolhido por entender ESM e TypeScript sem configuração, coerente com o Vite do desktop. |
| `zod` | `core`, `client`, `desktop`, `mobile` | Validação de entrada. No núcleo, os schemas da camada Request (`core/src/requests`) e a validação de mensagens do protocolo de sincronização; no `client`, os formulários (`client/src/forms`); no desktop, as mensagens do `utilityProcess` ([serveCore.ts](../../apps/desktop/src/utility/serveCore.ts)) e os parâmetros de busca das rotas; no celular, preferências e versões lidas do disco. Uma única biblioteca para todos os limites de confiança, com o tipo TS derivado do schema. |
| `react` | `client` (peer), `desktop`, `mobile`, `mobile-contract` | UI nas duas pontas. O `client` declara `react` como peer para os hooks usarem a cópia do app. |
| `@types/react` | `client`, `desktop`, `mobile`, `mobile-contract` | Tipos do React. |
| `@tanstack/react-query` | `client`, `desktop`, `mobile` | Cache das leituras do núcleo e mutações com invalidação ([coreHooks.ts](../../packages/client/src/hooks/coreHooks.ts)). Os apps a declaram também para que o bundler resolva uma cópia só. |
| `react-hook-form` | `desktop`, `mobile` | Estado dos formulários das telas ([form.tsx](../../apps/desktop/src/renderer/src/components/form.tsx) no desktop, [form.tsx](../../apps/mobile/src/ui/form.tsx) no celular); a validação vem dos formulários do `client`. |
| `tailwindcss` | `desktop` (4.x), `mobile` (3.x) | Estilo por classes. No celular fica na 3.x porque o NativeWind 4 é construído sobre ela. |
| `better-sqlite3` | `sqlite-better`, `desktop`, `sqlite-expo` (dev) | Driver SQLite síncrono do Node. No `sqlite-better`, o adaptador; no desktop, a única dependência de produção (módulo nativo, fica fora do bundle); no `sqlite-expo`, o dublê `FakeExpoConnection` dos testes. |
| `@types/better-sqlite3` | `sqlite-better`, `sqlite-expo` | Tipos do driver. |
| `expo-sqlite`, `expo-file-system` | `sqlite-expo` (peer e dev), `mobile`, `mobile-contract` | Driver SQLite do celular (API síncrona via JSI) e acesso a arquivos (localização do banco, backups, cópias). |
| `expo`, `react-native` | `mobile`, `mobile-contract` | Runtime e SDK do app Android. |
| `babel-preset-expo`, `jest`, `jest-expo`, `@react-native/jest-preset`, `@testing-library/react-native`, `test-renderer`, `@types/jest` | `mobile`, `mobile-contract` | Toolchain de testes do celular: Jest com o preset do Expo (que se apoia no preset do React Native), React Native Testing Library e o renderizador de teste que ela usa. |
| `@finance/sqlite-better` (dev) | `core`, `client`, `mobile`, `mobile-contract` | Rodar o núcleo real sobre SQLite em memória nos testes do Node, em vez de mocks do banco. |

## 5. Dependências por pacote

### 5.1 Raiz

- `eslint`, `@eslint/js`, `typescript-eslint`: lint do repositório inteiro (§2.2), rodado uma vez na raiz (`pnpm lint`), não por pacote.
- `typescript`: necessário ao `typescript-eslint` para as regras com tipos.

### 5.2 `@finance/core`

- `@noble/hashes`: SHA-1 do UUID v5 dos ids determinísticos ([DeterministicIds.ts](../../packages/core/src/domain/shared/DeterministicIds.ts)) e BLAKE2s/HMAC do Noise e utilitários de bytes do protocolo.
- `@noble/curves`: X25519, a troca de chaves do Noise ([Noise.ts](../../packages/core/src/protocol/noise/Noise.ts)).
- `@noble/ciphers`: ChaCha20-Poly1305, a cifra do canal seguro.
- `zod`: §4.
- Dev: `fast-check` para testes de propriedade (recálculo de saldos, relógio híbrido, UTF-8, convergência da sincronização); `@finance/sqlite-better` para os testes sobre SQLite real.

Por que as `@noble`: são JavaScript puro, auditadas e sem dependências, e rodam iguais no Node e no Hermes — o Hermes não tem WebCrypto nem `node:crypto`, e o núcleo não pode depender de plataforma. Com elas, o handshake e a cifra são código do núcleo, idênticos nas duas pontas. O raciocínio da criptografia está em [sincronização](arquitetura/sincronizacao.md).

### 5.3 `@finance/client`

- `@finance/core`: tipos do contrato de rotas e Value Objects puros (`Money`, `LocalDate`, `YearMonth`) usados nos formatadores e view-models.
- `@tanstack/react-query`, `zod`, `react` (peer): §4.
- Dev: `@testing-library/react` e `happy-dom` para os testes de hooks ([hooks.test.tsx](../../packages/client/test/hooks.test.tsx)), com um DOM leve em vez do jsdom; `react-dom` para o renderizador desses testes.

### 5.4 `@finance/sqlite-better`

- `better-sqlite3`: o driver (§4). O pacote não depende de `@finance/core`: espelha os tipos da porta para não criar ciclo, já que o núcleo usa este adaptador nos próprios testes; a suíte de contrato do núcleo garante que a forma bate.

### 5.5 `@finance/sqlite-expo`

- `@finance/core`: a porta `Database` e a suíte de contrato (`@finance/core/contract`).
- `expo-sqlite`, `expo-file-system` como **peer**: quem instala o módulo nativo é o app, numa versão só.
- Dev: `better-sqlite3` para o dublê do driver nos testes do Node.

### 5.6 `@finance/tokens`

Sem dependências de produção, por regra de lint. Dev: `vitest`, `typescript`, `@types/node`. O gerador ([writeThemeCss.ts](../../packages/tokens/scripts/writeThemeCss.ts), `pnpm tokens:css`) roda direto no Node 24.

### 5.7 `@finance/assets`

Sem dependências: só arquivos de ícone exportados por `./icons/*`. O uso de cada formato está no [README do pacote](../../packages/assets/README.md).

### 5.8 `@finance/desktop`

Produção:

- `better-sqlite3`: única entrada de `dependencies`, porque é módulo nativo e precisa ir para o instalador como arquivo (`asarUnpack`); todo o resto é empacotado pelo Vite e fica em `devDependencies`.

Processo e build:

- `electron`: o shell (processos principal, `utilityProcess` e renderer).
- `electron-vite`, `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`: build dos três alvos (main, preload, renderer) e do `utilityProcess` ([electron.vite.config.ts](../../apps/desktop/electron.vite.config.ts)), com a CSP injetada no HTML.
- `electron-builder`: instaladores `.deb` e `.exe` ([electron-builder.yml](../../apps/desktop/electron-builder.yml)).
- `@playwright/test`: testes E2E sobre o Electron real, nos projetos `e2e`, `measure` e `packaged` ([playwright.config.ts](../../apps/desktop/playwright.config.ts)).
- `bonjour-service`: descoberta mDNS dos dispositivos na sincronização, no `utilityProcess` ([syncAdapters.ts](../../apps/desktop/src/utility/syncAdapters.ts)). O transporte usa o `net` do próprio Node.

Renderer:

- `react-dom`: renderização ([main.tsx](../../apps/desktop/src/renderer/src/main.tsx)).
- `@tanstack/react-router`: rotas com histórico por hash e parâmetros de busca validados ([router.tsx](../../apps/desktop/src/renderer/src/router.tsx)); hash porque o app empacotado é servido de `file://`.
- `@tanstack/react-table`: a grade de movimentos ([MovementGrid.tsx](../../apps/desktop/src/renderer/src/transactions/MovementGrid.tsx)).
- `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, `lucide-react`, `sonner`: a base do shadcn/ui em `components/ui` — primitivos acessíveis (diálogo, popover, tooltip, menu de contexto), variantes, junção de classes (`lib/cn.ts`), animações, ícones e avisos (toasts).
- `recharts`: gráficos dos relatórios ([chart.tsx](../../apps/desktop/src/renderer/src/components/ui/chart.tsx)).
- `qrcode` (e `@types/qrcode`): o QR code do convite na tela de dispositivos.
- `@fontsource/ibm-plex-sans`: a fonte empacotada no app, porque a CSP só permite fontes locais e o app funciona offline.
- `@finance/core`, `@finance/client`, `@finance/sqlite-better`, `@finance/tokens`, `@finance/assets`: os pacotes internos (ícone do instalador, CSS de tema).

### 5.9 `@finance/mobile`

Navegação, UI e estilo:

- `expo-router` (com `expo-linking`): rotas por arquivo em `app/`, uma pilha por aba.
- `react-native-screens`, `react-native-safe-area-context`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-worklets`: módulos nativos de que o Expo Router e o NativeWind dependem; só `safe-area-context` e `gesture-handler` são importados direto pelo app.
- `nativewind`, `react-native-css-interop`, `tailwindcss` 3: classes Tailwind no React Native, com o preset gerado por `@finance/tokens`.
- `@babel/plugin-transform-react-jsx` (dev), `react-native-css-interop`, `babel-preset-expo`: carregados pelo nome a partir do [babel.config.js](../../apps/mobile/babel.config.js); no modo isolado do pnpm, sem estarem declarados no app, o bundle de release falha.
- `@shopify/flash-list`: a lista virtualizada de transações.
- `react-native-svg`: os ícones ([Icon.tsx](../../apps/mobile/src/ui/Icon.tsx)).
- `@expo-google-fonts/ibm-plex-sans` com `expo-font`: a mesma fonte do desktop, embutida no build pelo plugin do `app.config.ts`.
- `expo-status-bar`, `expo-system-ui`, `expo-splash-screen`: barra de status conforme o tema, cor do sistema e tela de abertura.
- `expo-constants`: versão do app para Ajustes ([appVersions.ts](../../apps/mobile/src/platform/appVersions.ts)).
- `expo-dev-client`: o development build (`pnpm dev:mobile`, `expo start --dev-client`).

Plataforma e sincronização (adaptadores das portas, em `src/platform`):

- `expo-crypto`: `randomUUID` para a porta `IdGenerator` e bytes aleatórios para a sincronização — o Hermes não tem `crypto`.
- `expo-secure-store`: cofre da chave privada do aparelho.
- `react-native-tcp-socket`: transporte TCP da sincronização.
- `react-native-zeroconf`: descoberta mDNS/NSD.
- `expo-camera`: leitura do QR code do convite ([JoinGroupScreen.tsx](../../apps/mobile/src/sync/JoinGroupScreen.tsx)).
- `expo-document-picker`, `expo-sharing`: importar e exportar a cópia do banco e compartilhar o log ([sharing.ts](../../apps/mobile/src/platform/sharing.ts)).
- `expo-sqlite`, `expo-file-system`, `@finance/sqlite-expo`: o banco.

Os testes usam o núcleo real sobre `@finance/sqlite-better` em memória (§4).

### 5.10 `@finance/mobile-contract`

App mínimo, sem router nem NativeWind, para reduzir as causas de falha ao que interessa: `expo`, `react-native`, `react`, `expo-sqlite`, `expo-file-system`, `@finance/sqlite-expo`, `@finance/core` (suíte de contrato, vetores de ouro, benchmark de criptografia), `@finance/client` (vetores de ouro do `client`) e `@finance/tokens` (cores da tela de resultado). Em dev, o mesmo Jest do celular e `@finance/sqlite-better`, para rodar o contrato também no Node. Ver [testes](arquitetura/testes.md).

## 6. Ferramentas de teste

O papel de cada camada de teste está em [testes](arquitetura/testes.md); aqui, só as ferramentas:

- **Vitest**: testes de `core`, `client`, `sqlite-expo`, `tokens` e os unitários do desktop.
- **fast-check**: testes de propriedade no núcleo.
- **Playwright**: E2E do desktop, abrindo o Electron real.
- **Jest + jest-expo + React Native Testing Library**: telas do celular no Node.
- **Maestro**: fluxos no emulador Android na CI (`.maestro/` do app e do app de contrato).
- **Vetores de ouro** (`golden`): valores calculados no Node (`pnpm golden:generate`) e recalculados no Hermes pelo app de contrato.

## 7. Build e empacotamento

- **Desktop**: `electron-vite build` gera `apps/desktop/out`; `electron-builder` gera `.deb` (Linux) e `.exe` NSIS (Windows) em `apps/desktop/release`. O `better-sqlite3` 13 é N-API e traz binários prontos, então não há recompilação (`npmRebuild: false`).
- **Celular**: `expo prebuild` gera o projeto Android e o Gradle monta o APK (debug para desenvolvimento, release para teste e distribuição). O `versionCode` deriva da versão do `package.json`.

## 8. Scripts do repositório

| Script | Comando | Para quê |
|---|---|---|
| [embed-migrations.mjs](../../scripts/embed-migrations.mjs) | `pnpm embed:migrations` | Embute os `.sql` de `db/migrations` em `embedded.generated.ts` (o celular não tem um diretório de arquivos para varrer em tempo de execução, e o desktop empacotado não deveria depender de um) e mantém o `checksums.lock`, que recusa migration publicada alterada ou removida. Um teste falha se o embutido divergir dos arquivos. |
| [android-emulator.sh](../../scripts/android-emulator.sh) | `pnpm emulator:android` | Abre o emulador, criando o AVD no volume `~/.android` na primeira vez. |
| [android-benchmark.sh](../../scripts/android-benchmark.sh) | `pnpm bench:android` | Mede abertura e chamadas interativas no aparelho com um banco de dez anos; apaga o app instalado. |
| [android-dist.sh](../../scripts/android-dist.sh) | `pnpm dist:mobile` | APK distribuído, assinado com a chave do usuário (variáveis `FINANCE_ANDROID_*`); recusa APK assinado com a chave de depuração. |
| [generate-history-database.ts](../../packages/core/scripts/generate-history-database.ts) | `pnpm db:history` | Banco sintético de dez anos para as medições. |
| [benchmark-database.ts](../../packages/core/scripts/benchmark-database.ts) | `pnpm bench:core` | Linha de base de desempenho do núcleo no Node. |
| [electron-vite.mjs](../../apps/desktop/scripts/electron-vite.mjs) | `pnpm dev:desktop` | Roda o electron-vite sem `ELECTRON_RUN_AS_NODE` (exportado pelo terminal do VS Code) e, com `FINANCE_ELECTRON_NO_SANDBOX=1`, sem o sandbox de processo do Chromium. |
| [writeThemeCss.ts](../../packages/tokens/scripts/writeThemeCss.ts) | `pnpm tokens:css` | Gera o CSS de tema e o preset do NativeWind a partir dos tokens. |

## 9. Devcontainer e CI

### 9.1 Devcontainer

[.devcontainer](../../.devcontainer): nada de Node, pnpm ou compiladores no host.

- [Dockerfile](../../.devcontainer/Dockerfile) multi-stage sobre `node:24-bookworm` (glibc, por causa dos binários do `better-sqlite3`), com bases fixadas por digest para o cache sobreviver às republicações da tag. Os stages do Android (JDK 17, SDK, NDK, CMake, emulador e imagem de sistema) são montados à parte e copiados com `COPY --link`, para trocar a base do Node sem reconstruir o SDK.
- [compose.yaml](../../.devcontainer/compose.yaml): rede do host (o Metro e a sincronização precisam da rede local), socket do Wayland e GPU para a janela do Electron, `/dev/kvm` para o emulador, volumes para o store do pnpm, Gradle e `~/.android`, e a pasta de chaves de assinatura montada somente leitura.
- [devcontainer.json](../../.devcontainer/devcontainer.json): `pnpm install` dentro do container (o `better-sqlite3` é nativo e precisa do Node da imagem) e extensões do VS Code que dependem do `node_modules` (ESLint, Vitest, EditorConfig).

### 9.2 CI

- [check.yml](../../.github/workflows/check.yml): `pnpm check` (com o Electron sob `xvfb-run`) numa matriz de fusos horários, `UTC` e `America/Sao_Paulo`, porque erro de data em finanças costuma aparecer só fora de UTC.
- [mobile.yml](../../.github/workflows/mobile.yml): gera os APKs de release do app e do app de contrato e roda, no emulador com KVM, o contrato e o teste de fumaça pelo Maestro.
