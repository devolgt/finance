# Finanças

Sistema de finanças pessoais local-first: desktop (Electron) e celular (Android, Expo),
com o mesmo núcleo TypeScript e sincronização direta entre os dispositivos na rede local.

**Documentação técnica:** [docs/wiki](docs/wiki/README.md) — arquitetura, tecnologias,
mapa do sistema, regras de negócio e decisões.

## Instalação

O ambiente roda em Docker, sem Node nem pnpm na máquina. No VS Code, com a extensão
Dev Containers, use **Reopen in Container**: a imagem é construída e o `pnpm install`
roda sozinho. Fora do editor:

```sh
docker compose -f .devcontainer/compose.yaml run --rm dev pnpm install
docker compose -f .devcontainer/compose.yaml run --rm dev pnpm check
```

O container usa a rede do host (Metro/Expo e a sincronização precisam da rede local) e
recebe o socket do Wayland e a GPU, para a janela do Electron abrir no desktop. Fora do
Docker, o requisito é Node 24 e pnpm 12.

Comandos da raiz:

| Comando | Para quê |
|---|---|
| `pnpm check` | lint, tipos e testes; rodar antes de concluir uma entrega |
| `pnpm embed:migrations` | regenerar as migrations embutidas depois de alterar `db/migrations` |
| `pnpm dev:desktop` | desktop com recarga automática |
| `pnpm dev:mobile` | Metro para o development build do celular |

## Desktop

| Comando | Gera |
|---|---|
| `pnpm build:desktop` | build do Electron em `apps/desktop/out` |
| `pnpm --filter @finance/desktop dist:linux` | instalador `.deb` em `apps/desktop/release` |
| `pnpm --filter @finance/desktop dist:win` | instalador `.exe` em `apps/desktop/release` (no Linux exige o Wine) |
| `pnpm dist:desktop` | os dois instaladores |

As linhas `ERROR:dbus` e `amdgpu: unknown` no terminal do container são avisos do
Chromium sem D-Bus e do driver de vídeo, não erros do app.

Para abrir no host o build feito no container, sem instalar:

```sh
# no container
pnpm build:desktop
node apps/desktop/node_modules/electron/install.js

# no host, na raiz do repositório
env -u ELECTRON_RUN_AS_NODE ./apps/desktop/node_modules/electron/dist/electron --no-sandbox apps/desktop
```

O `install.js` baixa o binário do Electron para `node_modules/electron/dist/`. O `env -u`
evita que o app suba como Node puro no terminal do VS Code, e o `--no-sandbox` é
necessário porque o `chrome-sandbox` instalado pelo pnpm não pertence a root (o renderer
continua isolado por `contextIsolation`, `sandbox: true` e CSP). No host, os dados ficam
em `~/.config/@finance/desktop/`.

## Android

O SDK do Android, o `adb` e o emulador vêm na imagem do devcontainer. Há três APKs do
mesmo app (`br.com.finance.app`):

| APK | Comando | Assinatura | Para quê |
|---|---|---|---|
| Development build | `pnpm build:mobile` | chave de depuração | desenvolver com o Metro e *fast refresh* |
| Release de teste | `prebuild` + `assembleRelease` (abaixo) | chave de depuração | testar sem o Metro, como no aparelho |
| Release distribuído | `pnpm dist:mobile` | a sua chave | instalar no celular para usar |

Os dois primeiros se instalam um por cima do outro mantendo os dados. O distribuído não:
trocar entre ele e os outros exige `adb uninstall br.com.finance.app`, **que apaga o banco
do aparelho** — antes, exporte a cópia em **Mais → Ajustes → Exportar cópia do banco**.

### Emulador com development build

```sh
pnpm emulator:android # num terminal próprio; cria o AVD na primeira vez
pnpm build:mobile
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
pnpm dev:mobile # sem CI=1, que desliga o fast refresh
```

### Release de teste

```sh
cd apps/mobile
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=x86_64
adb install -r app/build/outputs/apk/release/app-release.apk
```

### Release distribuído

Gere a chave uma vez, **no host e fora do repositório** (o devcontainer monta `~/chaves`
em `/home/node/chaves`, somente leitura), e guarde-a com backup: sem ela, o app instalado
não pode ser atualizado sem desinstalar.

```sh
mkdir -p ~/chaves && chmod 700 ~/chaves
keytool -genkeypair -v -keystore ~/chaves/finance-release.jks -alias finance \
    -keyalg RSA -keysize 4096 -validity 10000
```

No devcontainer:

```sh
export FINANCE_ANDROID_KEYSTORE=/home/node/chaves/finance-release.jks
export FINANCE_ANDROID_KEYSTORE_PASSWORD='…'
export FINANCE_ANDROID_KEY_ALIAS=finance
export FINANCE_ANDROID_KEY_PASSWORD='…'
pnpm dist:mobile # apps/mobile/dist/finance-<versão>.apk
```

Para instalar no celular: **Opções do desenvolvedor → Depuração por Wi-Fi → Parear
dispositivo com código**; no container, `adb pair <ip>:<porta-de-pareamento>`,
`adb connect <ip>:<porta>` e `adb install -r apps/mobile/dist/finance-<versão>.apk`. Ou
copie o APK para o celular e abra-o pelo gerenciador de arquivos.

### Problemas comuns

- `INSTALL_FAILED_UPDATE_INCOMPATIBLE`: há um APK assinado com outra chave; desinstale antes.
- `A snapshot operation … is pending` no emulador: confira que nenhum emulador está
  rodando e apague `~/.android/avd/finance.avd/*.lock`.

## Licença

[LICENSE](LICENSE)
