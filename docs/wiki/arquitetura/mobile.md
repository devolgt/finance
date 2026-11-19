# Mobile

Como o app do celular (`apps/mobile`) é montado: Expo com development build, o núcleo rodando no
Hermes sobre o `expo-sqlite` síncrono (`packages/sqlite-expo`), o custo de dividir a thread
JavaScript com a tela, o contrato igual ao do desktop, o estilo com NativeWind sobre os mesmos
tokens, a navegação com Expo Router, o ciclo de vida do app, o arquivo do banco no aparelho, a
distribuição sem custo, a paridade entre runtimes (`apps/mobile-contract`), a medição de
desempenho e o ambiente Android do devcontainer. A camada headless compartilhada
(`packages/client`), a fronteira UI ↔ núcleo e as convenções de interface estão na página do
[desktop](desktop.md) e valem aqui igual.

## 1. Papel do celular e o que ele roda

O celular é o dispositivo do **uso diário**: lançar transações, consultar saldos e faturas. Ele
escreve offline e é uma réplica completa, igual às outras ([Sincronização](sincronizacao.md)). Hoje
só existe para **Android**.

As telas cobrem o mesmo que o desktop no dia a dia — primeiro uso, Início, transações e lançamento
(com recorrências), contas e extrato da conta, cartões e fatura, metas, perfis, categorias, tags,
anotações, sócios, dispositivos e ajustes — **com as mesmas regras e os mesmos números**: nenhuma
regra de negócio nasce no celular. Se uma tela precisa de um dado que nenhuma rota dá, a rota nasce
no núcleo e serve aos dois apps. Ficam só no desktop os relatórios, o calendário, o extrato dia ×
mês e a importação de CSV.

### 1.1 O que é compartilhado e o que é do celular

A linha que separa as duas metades é **ter regra ou não ter**. Tudo que decide um número, uma data
ou o vencedor de um conflito existe uma vez; o celular escreve só adaptadores sem regra e as telas.

| Peça | Onde vive | O celular reimplementa? |
|---|---|---|
| Domínio, Requests, Controllers, Services, Repositories e SQL, migrations | `packages/core`, `db/migrations` | Não |
| Sincronização: HLC, captura, merge, protocolo, Noise e CPace | `packages/core` | Não |
| Contrato, `CoreClient`, hooks, view-models, formulários, formatadores, abertura | `packages/client` | Não |
| Adaptador `Database` e pasta de backups | [`packages/sqlite-expo`](../../../packages/sqlite-expo/src/index.ts) | Sim — fino, sem regra |
| `Clock`, `IdGenerator`, arquivos, compartilhamento, versões, log | [`apps/mobile/src/platform`](../../../apps/mobile/src/platform/) | Sim — fino, sem regra |
| Socket TCP, mDNS, chaveiro, aleatoriedade | [`syncAdapters.ts`](../../../apps/mobile/src/platform/syncAdapters.ts) | Sim — fino, sem regra |
| Câmera (QR), permissões, ciclo de vida | `apps/mobile` | Sim — da plataforma por natureza |
| Telas e navegação | `apps/mobile/app`, `apps/mobile/src` | Sim — por decisão (ver [decisões](../decisoes.md), [ADR 9](../decisoes.md#adr-9)) |

Contagem de referência (linhas de TypeScript em `src/`, sem testes, brancos nem comentários, antes
da sincronização): os adaptadores do celular (`sqlite-expo` e `platform`) somavam 335 linhas contra
24.286 de núcleo e `client` compartilhados — 1,4%. O que importa não é a porcentagem, e sim que
nenhuma regra de negócio nem de convergência exista duas vezes: uma regra de saldo escrita duas
vezes pode divergir, e a sincronização promete réplicas que convergem byte a byte (comparação de
HLC, UUID v5, arredondamento do `Money`). Com uma implementação só, a equivalência é por construção.
A escolha de React Native com Expo frente a nativo, Flutter, Kotlin Multiplatform, Capacitor e
NativeScript está em [decisões](../decisoes.md) ([ADR 10](../decisoes.md#adr-10)).

## 2. Expo com development build

[`app.config.ts`](../../../apps/mobile/app.config.ts) declara o app: Expo SDK 58 (React Native
0.88), em que a Nova Arquitetura, o Hermes e o *edge-to-edge* são o único modo; pacote Android
`br.com.finance.app` (identidade do app instalado — nunca muda); orientação retrato.

- **Expo, e não React Native sem framework**, porque os módulos de que o app precisa
  (`expo-sqlite`, `expo-file-system`, `expo-crypto`, `expo-secure-store`, `expo-camera`,
  `expo-sharing`, `expo-document-picker`, `expo-font`) são mantidos e versionados juntos no SDK:
  atualizar o React Native vira subir o SDK.
- **Projetos nativos gerados, não versionados:** `android/` sai do `expo prebuild` a cada build e
  está no `.gitignore`. O que é da plataforma fica em *config plugins* no `app.config.ts`:
  exclusão de backup ([§7.1](#71-fora-do-backup-em-nuvem)), permissões da sincronização
  ([`syncPermissions.ts`](../../../apps/mobile/config/syncPermissions.ts)), assinatura de release
  ([`releaseSigning.ts`](../../../apps/mobile/config/releaseSigning.ts)) e fontes.
- **O Expo Go não serve:** o socket TCP (`react-native-tcp-socket`) e o mDNS
  (`react-native-zeroconf`) são módulos nativos fora do SDK. O app roda como *development build*.
- **Nenhum serviço pago do Expo:** builds locais, sem EAS Update ([§7.4](#74-atualizações-sem-ota)).
- Permissões que o template traz e o app não usa ficam bloqueadas (armazenamento externo, janela
  sobre outros apps, vibração, microfone); a câmera só lê o QR do convite.

### 2.1 Metro no monorepo pnpm

[`metro.config.js`](../../../apps/mobile/metro.config.js) resolve todo pacote que o app declara
(mais `react-native` e `expo-modules-core`) **a partir do próprio app**, de onde quer que o import
venha. No modo isolado do pnpm, o `client` e o `sqlite-expo` levariam ao bundle outra variante de
`react-native` (mesma versão, contexto de dependência par diferente), e duas cópias registrariam os
módulos nativos duas vezes e quebrariam o contexto do React. É a alternativa ao
`node-linker=hoisted`, que mudaria a instalação do monorepo inteiro. O Metro também aceita imports
com extensão `.ts`, como o Node e o Vite. Pelo mesmo motivo, o app declara dependências que só o
Babel do NativeWind carrega pelo nome (`react-native-css-interop`, `babel-preset-expo`,
`@babel/plugin-transform-react-jsx`); sem elas, o bundle de release do Gradle falha.

### 2.2 Decisões do app em resumo

| Pergunta | Decisão | Onde |
|---|---|---|
| Plataforma | Só Android; iOS depende de uma decisão de custo | [§11](#11-distribuição-sem-custo) |
| Onde compila e roda | APK gerado no devcontainer; emulador no desenvolvimento e no CI; aparelho físico (Galaxy S23 FE) na medição | [§13](#13-ambiente-android-no-devcontainer) |
| Projetos nativos | `android/` gerado pelo `expo prebuild`, nunca versionado | [§2](#2-expo-com-development-build) |
| Navegação | Expo Router: abas, uma pilha por aba | [§5.1](#51-expo-router) |
| Mês de referência | Estado do shell nas preferências do aparelho (`lastPeriod`), não parâmetro de rota | [§5.2](#52-mês-de-referência-e-perfil) |
| Estilo | NativeWind 4 com o preset gerado de `packages/tokens` | [§6](#6-estilo-nativewind-e-tokens) |
| Folhas inferiores | `Sheet` próprio sobre o `Modal` do React Native | [§5.3](#53-componentes-base) |
| Dados na UI e formulários | TanStack Query e hooks do `client`; react-hook-form com os schemas do núcleo | [desktop §4](desktop.md#4-packagesclient--a-camada-headless-compartilhada) |
| Cliente do núcleo | `DirectCoreClient` com agendamento pós-frame | [§3.2](#32-agendamento-pós-frame) |
| Preferências do aparelho | `preferences.json` no diretório de documentos (tema, último perfil, último mês, data da última cópia), fora do banco porque seriam replicadas pela sincronização; leitura tolerante (arquivo corrompido volta aos padrões) e escrita por arquivo temporário | [§7](#7-o-arquivo-do-banco-no-celular) |
| Testes de tela | jest-expo + React Native Testing Library, núcleo real em memória | [§12.2](#122-testes) |
| Ponta a ponta | Maestro no emulador | [§12.2](#122-testes) |

## 3. O núcleo no Hermes

### 3.1 O mesmo mecanismo embarcado

O núcleo roda **no runtime JavaScript principal do app** e chama o SQLite pela **API síncrona do
`expo-sqlite`**, via JSI. Não há servidor local, processo separado nem ponte assíncrona: o motor é
o mesmo SQLite, o arquivo tem o mesmo schema, as migrations e o SQL são os mesmos bytes e o núcleo
é o mesmo pacote — só o *binding* muda, que é o que a porta `Database` existe para absorver. A
chamada síncrona é real, não emulada, e `transaction(fn)` é atômico por construção. As alternativas
(API HTTP local, `nodejs-mobile`, módulo nativo dono do banco, API assíncrona do `expo-sqlite`) e o
motivo de cada recusa estão em [decisões](../decisoes.md) ([ADR 11](../decisoes.md#adr-11)).

As migrations entram no bundle como código ([`embedded.generated.ts`](../../../packages/core/src/infrastructure/migrations/embedded.generated.ts)),
porque o Hermes não lê a pasta `db/migrations`: depois de criar ou alterar uma migration, rode
`pnpm embed:migrations` ([Banco de dados](banco-de-dados.md)).

A raiz de composição ([`openMobileCore.ts`](../../../apps/mobile/src/startup/openMobileCore.ts)) é
o único arquivo do app que conhece o núcleo e os adaptadores concretos: abre `finance.sqlite` pelo
`sqlite-expo`, roda a **mesma sequência de abertura do desktop** (`openCoreSequence` do `client`:
pragmas, backup, migrations, integridade, complemento das recorrências) com a pasta de backups, as
marcas e o log no diretório do app, monta `createCore` com `Clock` do sistema, `IdGenerator` sobre
o `expo-crypto` e as portas de rede da sincronização, e entrega às telas só um `CoreClient`. Os
bloqueios da abertura (banco mais novo que o app, migration que falhou com "restaurar backup",
falha do backup, arquivo que não abre) e as frases das telas de bloqueio são os mesmos do desktop,
vindos de `@finance/client/startup`; a restauração do backup segue os passos da troca de arquivo do
desktop sobre o `expo-file-system` ([`restoreBackup.ts`](../../../apps/mobile/src/startup/restoreBackup.ts)).
A configuração do app e o Metro estão na [§2](#2-expo-com-development-build).

### 3.2 Agendamento pós-frame

No desktop, o núcleo bloqueia o `utilityProcess` e a janela nem percebe. No celular, ele bloqueia
a **thread JavaScript**: a rolagem nativa e as animações no driver nativo continuam, mas toques que
dependem de JavaScript esperam a chamada terminar. Por isso o `DirectCoreClient` recebe o agendador
`afterFrame` (`requestAnimationFrame` seguido de `setTimeout(0)`): o retorno visual do toque (botão
pressionado, folha fechando) é desenhado antes de a thread parar no SQLite. As duas filas são FIFO,
então a ordem das chamadas é mantida — uma escrita seguida de uma leitura da mesma tela não inverte.
A abertura do banco também começa depois do primeiro frame (`StartupGate`), para "Abrindo…" já
estar na tela quando a thread parar nas migrations.

### 3.3 Orçamento e operações longas

O custo de dividir a thread com a tela é aceito porque as consultas desta escala levam
milissegundos (a agregação pesada roda no código C do SQLite), e é transformado em regra
verificável; o primeiro alívio é o agendamento pós-frame da [§3.2](#32-agendamento-pós-frame).

- **Chamadas interativas** (lançar, editar uma transação antiga — o pior caso, que recalcula a
  cadeia de saldos da conta —, consultar um mês, abrir uma fatura) têm orçamento de
  **p95 ≤ 50 ms** num aparelho de referência (Samsung Galaxy S23 FE) com um banco de dez anos
  (`INTERACTIVE_P95_BUDGET_MS` em [`interactiveBenchmark.ts`](../../../packages/core/src/benchmark/interactiveBenchmark.ts)).
- **Operações longas são telas, não chamadas escondidas**: migrations, troca do banco por uma
  cópia, entrada num grupo e exportação mostram estado próprio ("Abrindo…", "Exportando…").
- **Operações longas não são fatiadas em `await`s**: o lote da sincronização e a migration são uma
  transação só, e fatiar reintroduziria a intercalação que a porta síncrona evita.
- **Rota de escape:** se a medição estourar o orçamento, o núcleo muda para um runtime JavaScript
  secundário, com a conexão do banco dentro dele, atrás de um `WorkerCoreClient`. Como hooks e telas
  só conhecem `CoreClient`, a troca é na raiz de composição, não no código de tela.

## 4. Contrato igual ao desktop

O `DirectCoreClient` precisa se comportar como o `IpcCoreClient`; senão uma rota funciona num app e
quebra no outro ([desktop §3](desktop.md#3-fronteira-ui--núcleo)):

1. **A camada Request valida toda entrada também no celular.** Aqui a UI não é fronteira de
   segurança, mas a validação é o único lugar onde as regras de entrada vivem.
2. **DTOs são dados serializáveis por tipo** ([desktop §3.6](desktop.md#36-dtos-serializáveis)):
   um DTO com instância de classe funcionaria no celular, onde nada é serializado, e quebraria no
   desktop.
3. **Erros chegam como `CoreResult`**, com o mesmo conjunto fechado de códigos e as mesmas frases
   (`describeError`). Uma exceção inesperada no núcleo vira `INTERNAL` com log em `logs/core.log`.

**Fronteira verificada por lint** ([`eslint.config.js`](../../../eslint.config.js)): em
`apps/mobile/app` e `apps/mobile/src`, as telas só falam com o `client`; do `@finance/core` só
entram tipos (`import type`, os DTOs das respostas); `@finance/sqlite-expo` e `expo-sqlite` só na
raiz de composição e nos adaptadores; nada de Node nem `better-sqlite3`; nada de `Intl`. Uma tela
que chamasse o núcleo direto pularia o agendamento pós-frame e o cache de consultas.

## 5. Shell e navegação

### 5.1 Expo Router

Rotas em [`app/`](../../../apps/mobile/app/_layout.tsx), que só montam telas de `src/screens`:

- Abas `app/(tabs)/{home,transactions,accounts,cards,more}`, cada uma com a própria pilha
  ([`TabStack`](../../../apps/mobile/src/shell/TabStack.tsx)). Na raiz de uma aba, o "voltar" do
  Android leva ao Início (`backBehavior: firstRoute`); tocar na aba aberta volta ao topo da pilha.
- O lançamento (`app/new-transaction.tsx`) abre por cima das abas, na pilha raiz, sem a barra
  inferior.
- Os caminhos usados pelas telas ficam em [`src/shell/routes.ts`](../../../apps/mobile/src/shell/routes.ts),
  porque as rotas tipadas do Expo Router dependem de tipos que o servidor de desenvolvimento gera, e
  o `pnpm check` roda sem ele.
- Barra inferior própria ([`BottomBar`](../../../apps/mobile/src/shell/BottomBar.tsx)): Início,
  Transações, Contas, Cartões e Mais, emitindo o `tabPress` como a padrão. Ícones por
  `react-native-svg`, com a cor do token passada por propriedade (`useThemeColor`).
- **Mais** reúne Metas, Cadastros (Perfis, Categorias, Tags, Anotações e, no perfil empresarial,
  Sócios), Dispositivos e Ajustes.

A raiz ([`app/_layout.tsx`](../../../apps/mobile/app/_layout.tsx)) envolve tudo em gestos, área
segura, preferências do aparelho, tema, ciclo de vida e o portão da abertura
([`StartupGate`](../../../apps/mobile/src/startup/StartupGate.tsx)); com o banco aberto, o shell
decide entre o primeiro uso (sem perfil) e a navegação.

### 5.2 Mês de referência e perfil

- **O mês de referência é estado do shell, salvo nas preferências do aparelho (`lastPeriod`), e não
  parâmetro de rota** ([`useReferenceMonth.ts`](../../../apps/mobile/src/shell/useReferenceMonth.ts)).
  No desktop ele é *search param* para sobreviver à URL; no celular não há URL, e as pilhas por aba
  perderiam o parâmetro ao trocar de aba. A faixa ([`MonthStrip`](../../../apps/mobile/src/shell/MonthStrip.tsx))
  fica abaixo do cabeçalho nas telas com período; fora do mês corrente, o rótulo vira "Voltar ao mês
  atual" e o toque no centro volta a ele. As funções de período e de escolha do perfil são as do
  `client`, as mesmas do desktop.
- O seletor de perfil abre numa folha inferior ([`ProfileSheet`](../../../apps/mobile/src/shell/ProfileSheet.tsx)),
  grava `lastProfileId` e invalida todo o cache, como no desktop. Só existe no Início e no Mais, que
  não têm formulário, por isso não há guarda de alteração não salva.
- O botão de tema do cabeçalho abre uma folha com "Seguir o sistema", "Tema claro" e "Tema escuro"
  ([desktop §7.1](desktop.md#71-tema-claro-e-escuro)).

### 5.3 Componentes base

[`src/ui/`](../../../apps/mobile/src/ui/): `Sheet`, `Button`, `TextField`, seleção em folha,
estados (carregando, erro com "Tentar de novo" pelo `describeError`, vazio), todos com alvo de toque
de pelo menos 44 px.

- **Folhas inferiores sobre o `Modal` do React Native** ([`Sheet.tsx`](../../../apps/mobile/src/ui/Sheet.tsx)),
  e não sobre o `@gorhom/bottom-sheet`, cuja folha não chegava à árvore nativa no aparelho, sem
  erro. O `Modal` abre numa janela própria, por cima de tudo, fecha no véu, no "Fechar" e no
  "voltar" do Android, e, renderizado no lugar e não num portal, enxerga os contextos de quem o
  abriu (núcleo, perfil, tema). Perde só o arrastar para fechar. Com "remover animações" ligado no
  sistema, aparece sem animação.
- **Listas longas:** Transações usa `@shopify/flash-list`, que recicla células e mantém a rolagem
  fluida enquanto a thread JavaScript trabalha.
- Formulários com **react-hook-form** e os resolvers do `client` sobre os schemas do núcleo.

## 6. Estilo: NativeWind e tokens

### 6.1 NativeWind 4 sobre o preset dos tokens

O celular usa **NativeWind 4.2** (Tailwind 3), porque a v5, que leria o mesmo CSS do desktop, ainda
estava em RC. O `packages/tokens` gera, a partir dos mesmos dados do CSS do desktop, o preset
[`nativewind-preset.generated.cjs`](../../../packages/tokens/src/nativewind-preset.generated.cjs)
([`nativewindPreset.ts`](../../../packages/tokens/src/nativewindPreset.ts)), e o
[`tailwind.config.js`](../../../apps/mobile/tailwind.config.js) do app usa só ele: o tema padrão do
Tailwind é **substituído**, não estendido, para que uma classe fora dos tokens não tenha estilo. As
classes são as mesmas do desktop (`bg-surface`, `text-13`, `rounded-8`, `p-3`); os componentes são
do celular (`View`, `Text`), não os do shadcn/ui. A escolha frente a `StyleSheet` puro, Tamagui e
Restyle está em [decisões](../decisoes.md) ([ADR 12](../decisoes.md#adr-12)).

- **Fonte:** IBM Plex Sans embutida pelo plugin do `expo-font` como uma família com os pesos 400,
  500 e 600, para `font-medium` e `font-semibold` funcionarem como no desktop. O preset do NativeWind
  declara `fontFamily.sans` em `theme.extend`, que venceria o tema de qualquer preset e poria o app
  na Roboto; o preset dos tokens repete a família em `extend`, e
  [`tailwindTheme.test.ts`](../../../apps/mobile/test/tailwindTheme.test.ts) resolve o tema completo
  para pegar essa colisão.
- **Só tokens:** [`tokensOnly.test.ts`](../../../apps/mobile/test/tokensOnly.test.ts) acusa cor
  literal e classe fora da escala, como no desktop. A única cor literal do app é o fundo do ícone
  adaptativo, que precisa emendar com o desenho do ícone.

### 6.2 Tema

[`ThemeRoot`](../../../apps/mobile/src/theme/ThemeRoot.tsx) aplica na raiz as variáveis de cor do
tema efetivo (`vars(themeVariables(tema))` do NativeWind), e toda classe de cor lê a variável — o
mesmo mecanismo da classe `.dark` do desktop, com os mesmos tokens. As duas tabelas de variáveis são
montadas uma vez; trocar de tema é trocar o estilo da raiz. Em `system`, segue o `useColorScheme`
do sistema (claro quando ele não informa). A barra de status acompanha o tema.

As convenções de interface (mês de referência fixo, sinal `+`/`−` tipográfico, `⇄`, consolidado e
previsto juntos, listas em vez de abas) são as da [desktop §7](desktop.md#7-convenções-de-ui-vigentes).

## 7. O arquivo do banco no celular

O banco fica em `Paths.document/SQLite/finance.sqlite` (o `filesDir` do Android, fora do cache que o
sistema limpa), com `backups/` e as marcas da abertura (`restore-pending.json`,
`migration-failed.json`) na mesma pasta ([`openExpoDatabase.ts`](../../../packages/sqlite-expo/src/openExpoDatabase.ts),
[`databaseFiles.ts`](../../../apps/mobile/src/startup/databaseFiles.ts)), para que abertura, rotação
e restauração concordem sobre os caminhos. O log (`logs/core.log`) e as preferências
(`preferences.json`) ficam no diretório de documentos, **fora da pasta do banco**, para que
restaurar ou substituir o banco não leve o tema e o último mês junto.

### 7.1 Fora do backup em nuvem

O diretório do app é **excluído do backup automático** do Google e da transferência entre
aparelhos: `allowBackup` e `fullBackupContent` desligados (Android 11 e anteriores) e regras de
extração de dados que excluem todos os domínios em `cloud-backup` e `device-transfer` (Android 12+),
gravadas pelo plugin `withNoDataExtraction` do [`app.config.ts`](../../../apps/mobile/app.config.ts).
O `allowBackup="false"` sozinho não basta a partir do Android 12: a cópia de aparelho para aparelho
continuaria levando o banco.

**Por quê:** o backup automático enviaria o histórico financeiro inteiro a um terceiro, que é o que
a regra de produto "os dados não saem da rede do usuário" recusa — e em silêncio, configurado pelo
sistema e não pelo usuário. **Consequência:** um celular perdido se recupera pareando um aparelho
novo a partir de outro membro do grupo ([Sincronização](sincronizacao.md)); se o celular for o único
dispositivo, a recuperação depende de uma cópia exportada pelo usuário.

### 7.2 Cópia exportada, nunca o arquivo vivo

Em Ajustes ([`SettingsScreen`](../../../apps/mobile/src/screens/SettingsScreen.tsx)):

- **Exportar cópia do banco:** a raiz de composição grava a cópia com o `copyDatabaseTo` do núcleo
  (`VACUUM INTO`, a mesma operação do backup) em `cache/financas-{instante}.sqlite`, a folha de
  compartilhamento do sistema a entrega ao destino que o usuário escolher e o temporário é apagado;
  a data vai para `lastExportAt` nas preferências.
- **Importar cópia do banco:** depois de um aviso numa folha — a cópia substitui todos os dados do
  celular; não é sincronização —, o seletor de documentos traz o arquivo ao cache, o
  `inspectDatabaseCopy` do núcleo o confere (aberto por `openExpoDatabaseFile`), e só então o banco
  fecha e é trocado ([`databaseCopy.ts`](../../../apps/mobile/src/startup/databaseCopy.ts),
  `replaceWithCopy`): provisório `{banco}.importando`, marca `restore-pending.json` e o banco
  anterior em `backups/antes-da-importacao-{instante}.sqlite`. O `StartupGate` reabre o núcleo
  (migrations e verificação, como em toda abertura) e mostra o resultado numa folha.
- **Relatar problema:** o `core.log` pela folha de compartilhamento.
- **Sobre:** versão do app, do núcleo embarcado (pelo `extra` do `app.config.ts`) e do banco.

O arquivo vivo **não** é exposto a outros apps: outro programa abrindo o banco enquanto o app
escreve em WAL arrisca corrupção, e uma edição externa contornaria a captura da sincronização.
`expo-sharing` e `expo-document-picker` ficam num adaptador só
([`sharing.ts`](../../../apps/mobile/src/platform/sharing.ts)).

### 7.3 Criptografia em repouso

1. **O banco não é cifrado pelo app.** O Android já cifra o armazenamento do app com chave atrelada
   ao desbloqueio do aparelho; um SQLCipher protegeria contra o mesmo ataque e tornaria o arquivo
   ilegível para as ferramentas SQLite comuns, quebrando a propriedade literal dos dados.
2. **A chave privada do aparelho** fica no `expo-secure-store` com
   `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: não migra para outro aparelho por backup ou restauração.
   Remover um membro do grupo só tem sentido se a chave dele não puder reaparecer em outro.

### 7.4 Atualizações sem OTA

O app não usa atualização pelo ar (EAS Update nem servidor próprio): seria um serviço hospedado, ou
um servidor a manter, para um único usuário. Atualizar é instalar um APK novo. Como sessões de
sincronização entre versões de schema diferentes são recusadas, um build com migration precisa
chegar a todos os aparelhos antes de eles voltarem a sincronizar; a mensagem de recusa diz qual
aparelho atualizar.

## 8. Paridade entre runtimes

A suíte do núcleo roda no Node com Vitest; no celular, o mesmo código roda no Hermes, com outra
implementação de `Intl`, de ordenação de strings e de dados de localidade. Mesmo código não garante
mesmo resultado, e os pontos em que isso morde são tratados por regra:

1. **Dinheiro não é formatado com `Intl.NumberFormat`**: o formatador do `client` monta a string a
   partir do valor já arredondado ([desktop §4.6](desktop.md#46-formatadores)).
2. **Ordenação de nomes** acontece no SQL ou com o comparador explícito do domínio (`compareNames`
   em [`textOrder.ts`](../../../packages/core/src/domain/shared/textOrder.ts)), que dobra acento e
   caixa por tabela própria, sem ICU; nunca com `localeCompare`.
3. **Datas** vêm da porta `Clock`; `new Date()` é proibido no núcleo.

O lint proíbe `Intl`, `localeCompare` e `toLocale*` no núcleo, e `Intl` no `client` e nas telas do
celular.

### 8.1 Vetores de ouro

Arredondamento do `Money`, divisão de parcelas, UUID v5, ordenação do comparador, saídas dos
formatadores do `client` e o parser de valor digitado são gerados no Node e versionados em JSON
([`core`](../../../packages/core/src/golden/goldenVectors.ts),
[`client`](../../../packages/client/src/golden/goldenVectors.ts)). Um teste do Vitest confere que o
JSON está em dia com o código; `pnpm golden:generate` regenera depois de uma mudança intencional.

### 8.2 `apps/mobile-contract`

[`apps/mobile-contract`](../../../apps/mobile-contract/README.md) é um app Expo mínimo (sem router
nem NativeWind, para cada dependência a menos ser uma causa a menos de falha) que, ao abrir, roda no
Hermes e com o `expo-sqlite` real:

1. a suíte de contrato da porta `Database` (`@finance/core/contract`) contra o `ExpoSqliteDatabase`,
   incluindo a versão mínima do SQLite e o `STRICT`; cada caso num arquivo próprio no cache, em WAL
   como o app (abrir `:memory:` de novo devolvia o mesmo banco no emulador);
2. os vetores de ouro do núcleo e do `client`, recalculados no aparelho
   ([`deviceContract.ts`](../../../apps/mobile-contract/src/deviceContract.ts));
3. a medição da criptografia da sincronização: vazão da ChaCha20-Poly1305 e tempo de um handshake
   Noise KK ([`cryptoBenchmark.ts`](../../../apps/mobile-contract/src/cryptoBenchmark.ts)).

Mostra e registra no log um resultado único ("Contrato: passou" ou a lista do que divergiu). É APK
de release, com o bundle dentro, para rodar o bytecode do Hermes como o app instalado. Quando um
vetor diverge, a correção é no código, para não depender do runtime — nunca regenerar o arquivo para
aceitar a saída do Hermes. `pnpm --filter @finance/mobile-contract test` roda o mesmo contrato no
Node, sobre o `better-sqlite3`.

### 8.3 No CI

O workflow [`mobile.yml`](../../../.github/workflows/mobile.yml) gera os APKs de release do contrato
e do app e, no mesmo emulador Android (KVM do runner, imagem `android-36` x86_64), roda pelo Maestro
o fluxo do contrato e depois o teste de fumaça do app (abre num banco vazio e chega ao primeiro
uso). Só roda quando muda algo que entra no bundle do celular (`packages/core`, `client`,
`sqlite-expo`, `tokens`, `apps/mobile*`, `db/migrations`, lockfile), porque o build nativo leva
minutos.

## 9. `packages/sqlite-expo`

[`ExpoSqliteDatabase`](../../../packages/sqlite-expo/src/ExpoSqliteDatabase.ts) implementa a porta
`Database` sobre a API síncrona do `expo-sqlite`, fino e sem regra, como o `BetterSqliteDatabase`
do desktop:

- Usa `prepareSync` + `executeSync` com **cache por instrução preparada** e `resetSync` depois de
  cada leitura (sem ele, o cursor fica aberto), e não o `runSync`/`getFirstSync` da conexão, que
  preparam e finalizam a instrução a cada chamada e anulariam o cache.
- O SQL do núcleo usa parâmetros `:nome`, e o `expo-sqlite` espera o prefixo na chave do objeto:
  `prefixParams` traduz `{ nome }` em `{ ':nome' }` (uma chave sem `:` seria ignorada em silêncio).
- A instrução que falhou sai do cache e é finalizada na hora: o `finalizeSync` do `expo-sqlite`
  relança o erro da última execução, e com ela no cache o `close` do banco lançava.
- Recebe a conexão já aberta por interfaces próprias (`ExpoConnection`), conferidas na compilação
  contra os tipos do SDK; só `@finance/sqlite-expo/open` carrega código nativo. Assim o Vitest roda o
  adaptador inteiro sobre um dublê fiel ao driver (`FakeExpoConnection`).
- Na abertura, [`assertSqliteCapabilities`](../../../packages/sqlite-expo/src/sqliteCapabilities.ts)
  exige SQLite ≥ 3.38.0, tabelas `STRICT` e `json_valid`, com erro explícito
  (`UnsupportedSqliteError`). O `expo-sqlite` 58 embarca o 3.53.3.
- [`ExpoBackupDirectory`](../../../packages/sqlite-expo/src/ExpoBackupDirectory.ts) implementa a
  pasta `backups/` sobre o `expo-file-system`.

Lint de fronteira: o pacote só importa as portas do núcleo (`@finance/core`) e a suíte de contrato;
nada de Node, React ou React Native.

## 10. Ciclo de vida do app

[`AppLifecycle`](../../../apps/mobile/src/startup/AppLifecycle.tsx) é o **único ponto** do app que
escuta o `AppState`; um ponto só evita que cada tela assine o `AppState` por conta própria e uma
esqueça de desligar. `inactive` (gaveta de notificações, troca de apps em andamento) conta como
primeiro plano, porque o app ainda está visível.

Regra de negócio (Sincronização): a sincronização só roda com a tela **Dispositivos aberta e o app
em primeiro plano**; não há sincronização em segundo plano, e telas e editores abertos não recebem
alterações remotas ([Sincronização](sincronizacao.md)). A tela liga a sessão
(`useSyncScreen(focused && foreground)`, em [`DevicesScreen`](../../../apps/mobile/src/screens/DevicesScreen.tsx)),
e `useAppForeground` é o interruptor dentro dela:

- **Ao abrir Dispositivos, ou voltar ao primeiro plano com ela aberta:** abre o listener, anuncia
  via mDNS e procura os membros.
- **Ao sair da tela ou do primeiro plano:** encerra a sessão, fecha o listener e para o anúncio, sem
  esperar o sistema cortar os sockets — um lote pela metade seria descartado de qualquer jeito, e um
  listener aberto em segundo plano aceitaria conexões que o app não consegue atender.

A porta síncrona dá uma garantia de graça: **nenhuma transação de banco atravessa um `await`**,
então o sistema nunca suspende o app no meio de uma escrita do núcleo. Um lote recebido foi
aplicado inteiro ou não foi.

### 10.1 Adaptadores da sincronização

| Porta | Implementação ([`syncAdapters.ts`](../../../apps/mobile/src/platform/syncAdapters.ts)) |
|---|---|
| `Transport` | `react-native-tcp-socket` |
| `Discovery` | `react-native-zeroconf`, implementação `NSD` (o mDNS roda no serviço do sistema, sem *multicast lock*) |
| `KeyStore` | `expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` |
| `RandomSource` | `getRandomBytes` do `expo-crypto` (o Hermes não oferece `crypto.getRandomValues` sozinho) |
| Leitura do QR | `expo-camera` |

A regra de endereços locais é do núcleo e entra pela raiz de composição (`isLocalAddress`), porque
os adaptadores não importam código do núcleo. Permissões Android declaradas por plugin
([`syncPermissions.ts`](../../../apps/mobile/config/syncPermissions.ts)): `INTERNET`,
`ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE` e
`ACCESS_LOCAL_NETWORK` (exigida só a partir da API 37 e conferida em tempo de execução, para que
subir o `targetSdk` não quebre a sincronização em silêncio).

## 11. Distribuição sem custo

O app é distribuído por **instalação direta do APK** no Android, sem Play Store: gratuito e sem prazo
de validade.

- **`pnpm dist:mobile`** ([`scripts/android-dist.sh`](../../../scripts/android-dist.sh)) gera o APK
  de release assinado com a chave do usuário, que fica **fora do repositório** (caminho e senhas por
  `FINANCE_ANDROID_KEYSTORE`, `FINANCE_ANDROID_KEYSTORE_PASSWORD`, `FINANCE_ANDROID_KEY_ALIAS`,
  `FINANCE_ANDROID_KEY_PASSWORD`). Antes do build, recusa variável faltando, keystore dentro do
  repositório e senha ou alias que não abrem a chave; gera para `arm64-v8a` e `x86_64`; confere pelo
  `apksigner` que o certificado não é o de depuração; e copia para
  `apps/mobile/dist/finance-<versão>.apk`, com o SHA-256 do certificado e do arquivo.
- O plugin `withReleaseSigning` troca, no `build.gradle` gerado, a chave de depuração do release
  pela configuração das variáveis. **Sem elas, o release continua com a chave de depuração**, de que
  o CI e a medição dependem; se o template do Expo mudar e a âncora sumir, o `prebuild` falha em vez
  de assinar em silêncio com a chave errada.
- O `versionCode` deriva da versão do app (`maior × 1.000.000 + menor × 1.000 + correção`), para o
  Android recusar instalar um APK mais antigo por cima.
- **O APK distribuído e o development build não convivem** no mesmo aparelho: os dois usam o pacote
  `br.com.finance.app` com chaves diferentes (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). Trocar exige
  desinstalar, o que apaga o banco: exporte a cópia antes. Pela mesma razão, a chave de release
  precisa de backup — sem ela, a única forma de atualizar é desinstalar.

O iOS não é suportado. Compilar exige macOS, e instalar num iPhone exige reassinar a cada 7 dias
(Apple ID gratuito) ou o programa pago da Apple; a escolha continua em aberto
([§14](#14-limitações-conhecidas)).

## 12. Medição e testes

### 12.1 Medição das chamadas interativas

- **Banco de referência:** `pnpm db:history <arquivo.sqlite>` gera, de forma determinística e pelas
  rotas do núcleo, um banco de dez anos (dois perfis, ~10 mil lançamentos) que passa em
  `integrity.verifyBalances` ([`generate-history-database.ts`](../../../packages/core/scripts/generate-history-database.ts)).
- **Roteiro único** no núcleo, `runInteractiveBenchmark` (`@finance/core/benchmark`): 40 rodadas de
  lançar, editar uma despesa antiga (o recálculo da cadeia inteira da conta), listar as transações do
  mês e abrir uma fatura, chamando o núcleo como as telas chamam. Roda no Node
  (`pnpm bench:core <banco>`, linha de base do desktop) e no Hermes, com o mesmo banco e o mesmo
  código, e deixa as transações como encontrou.
- **No aparelho:** `pnpm --filter @finance/mobile build:benchmark` gera o development build e o APK
  de release com `EXPO_PUBLIC_BENCHMARK=1`; `pnpm bench:android <banco> [--replace]`
  ([`android-benchmark.sh`](../../../scripts/android-benchmark.sh)) instala o development build,
  copia o banco pelo `run-as`, instala por cima o release (a mesma chave de depuração mantém os
  dados), mede seis aberturas e espera a medição das chamadas no logcat. Sem `--replace`, recusa
  rodar com o app já instalado, para não apagar dado real.
- **Abertura até a primeira tela interativa:** toda abertura registra `[abertura] primeira-tela …`
  quando a primeira consulta da tela inicial responde ([`startupTiming.ts`](../../../apps/mobile/src/startup/startupTiming.ts));
  o script subtrai o instante do `am start`. A primeira abertura depois de instalar paga a
  compilação do ART e fica fora da mediana.

Ensaio registrado com o banco de dez anos (120 meses, 2 perfis, 9.827 lançamentos):

| Onde | Abertura | Lançar p95 | Editar antiga p95 | Consultar mês p95 | Abrir fatura p95 |
|---|---|---|---|---|---|
| Node 24 (container) | — | 2,1 ms | 5,9 ms | 0,4 ms | 0,2 ms |
| Emulador x86_64 (KVM), Android 16 | ~510 ms, ~255 ms no núcleo | 4,2 ms | 12,4 ms | 1,8 ms | 0,6 ms |

O emulador roda sobre a CPU do computador e não vale como referência; os números que decidem o
orçamento saem do aparelho de referência.

### 12.2 Testes

| Camada | Ferramenta | Onde |
|---|---|---|
| Regras e view-models | Vitest, no `core` e no `client` | [Testes](testes.md) |
| Adaptador do banco | Vitest sobre o dublê `FakeExpoConnection` | [`packages/sqlite-expo/test`](../../../packages/sqlite-expo/test/) |
| Telas | jest-expo + React Native Testing Library, com o núcleo real em `better-sqlite3` em memória atrás do `DirectCoreClient`; `renderApp` monta as rotas de verdade de `app/` pelo `renderRouter` do Expo Router, trocando só a raiz pelo núcleo em memória | [`apps/mobile/test`](../../../apps/mobile/test/) |
| Paridade no Hermes | `apps/mobile-contract` no emulador | [§8.2](#82-appsmobile-contract) |
| Ponta a ponta no aparelho | Maestro (`.maestro/smoke.yaml`, `.maestro/first-use.yaml`) com o APK de release | [`apps/mobile/.maestro`](../../../apps/mobile/.maestro/smoke.yaml) |

## 13. Ambiente Android no devcontainer

O APK é gerado **dentro do devcontainer**, mantendo a regra de nada de compiladores no host:

- O [`Dockerfile`](../../../.devcontainer/Dockerfile) monta o toolchain em *stages* próprios sobre o
  Debian (JDK 17, `cmdline-tools`, `platform-tools`/`adb`, `platforms` e `build-tools` do SDK, o NDK
  e o CMake que o Expo fixa, o emulador e a imagem `android-36/google_apis/x86_64`), com licenças
  aceitas na construção. As versões seguem o Expo SDK 58.
- O [`compose.yaml`](../../../.devcontainer/compose.yaml) mantém `~/.gradle` e `~/.android` em
  volumes (o primeiro build leva ~6 min; os seguintes usam o cache) e repassa `/dev/kvm` com o grupo
  dono, para o emulador rodar acelerado.
- `pnpm emulator:android` ([`android-emulator.sh`](../../../scripts/android-emulator.sh)) cria o AVD
  `finance` (perfil Pixel 7, o mais próximo do aparelho de referência) no volume e o abre.
- **Ciclo de desenvolvimento** ([README do app](../../../apps/mobile/README.md)): `pnpm build:mobile`
  gera o development build, `adb install`, `adb reverse tcp:8081 tcp:8081`, `pnpm dev:mobile` sobe o
  Metro e o app abre pelo link `exp+finance://expo-development-client/?url=...`. O Metro não pode
  subir com `CI=1`, que desliga o *watch mode* e o *fast refresh*. Num celular físico, o mesmo
  caminho por `adb pair` + `adb connect` sem fio. O túnel do Expo passaria o bundle por um terceiro,
  e fica só como último recurso.

## 14. Limitações conhecidas

- **Medição no aparelho de referência pendente:** o p95 das chamadas interativas e o tempo de
  abertura ainda não foram medidos no Galaxy S23 FE; só há o ensaio no emulador.
- **Fluxos Maestro no CI:** o contrato e o teste de fumaça estão escritos e foram validados no
  emulador do devcontainer por `adb`, mas o Maestro não está na imagem do devcontainer e os fluxos
  de lançamento, fatura e exportação não foram escritos.
- **Teste de paridade com o banco real** (importar a cópia do desktop e conferir saldos, faturas e
  metas centavo a centavo) depende do aparelho e não foi feito.
- **Sem iOS:** a distribuição depende de uma decisão de custo (Apple ID gratuito com reassinatura
  semanal ou programa pago).
- **Sem bloqueio por biometria**, widgets ou extensões. Se vierem, a regra é que extensões nunca
  escrevem no banco: leem um arquivo de resumo gravado pelo app ou deixam pedidos que o app processa
  ao abrir, pelos Services de sempre — dois processos escrevendo no mesmo arquivo quebrariam a
  premissa de uma única conexão escritora.
- **Sem lembrete de exportar a cópia**; a recuperação de um celular que é o único dispositivo ainda
  não tem funcionalidade própria.
- **Falha `INTERNAL` não é fatal no celular:** o desktop troca o app pela tela de erro
  ([desktop §3.4](desktop.md#34-falha-fatal)); o celular mostra o erro no estado da consulta, com
  "Tentar de novo".
