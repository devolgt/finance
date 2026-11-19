# Plano da Sincronização — desktop e celular na mesma rede

**Status:** Em andamento — Fases 1 a 8 entregues no código (o Android compila e passa nos testes, mas ainda não rodou num aparelho; a vazão da cifra no Hermes está medida pelo app de contrato, falta rodá-la); Fase 9 (validação em aparelhos reais) pendente. Primeira entrega da sincronização: o
[design de sincronização](sync-design.md) posto em código, entre o desktop (Linux e
Windows) e o celular (Android), na mesma rede local, com a sessão aberta pela tela de
Dispositivos.
**Relacionado:** [sync-design.md](sync-design.md) — as regras que este plano implementa;
[mobile-shell-design.md §5](mobile-shell-design.md#5-a-sincronização-no-celular) — protocolo
no núcleo e adaptadores do celular; [database-design.md](database-design.md) — o schema
replicado; [backend-design.md §4.9](backend-design.md#49-migrations-e-sincronização) —
versões de schema entre aparelhos; [mobile-mvp-plan.md §3](mobile-mvp-plan.md#3-relação-com-a-sincronização)
— o que o celular deixou pronto; [mockups](../design/mockups/README.md) — `DesktopDispositivos`,
`MobileDispositivos`, `MobileParear` e os dois primeiros usos.

A [§2](#2-decisões-em-resumo) é o resumo; a [§5](#5-lista-de-tarefas) é a lista de
tarefas, em ordem de execução.

---

## 1. Objetivo e escopo

**Pergunta que esta entrega responde:** consigo lançar uma despesa no celular, longe do
computador, e vê-la no desktop quando os dois se encontram na rede de casa — e o
contrário — sem perder nenhuma edição e sem que os dados saiam da minha rede?

### Dentro do escopo

- Núcleo de replicação ([sync-design §5](sync-design.md#5-modelo-de-replicação)): HLC,
  tabelas de sincronização, captura, aplicação com as regras de merge e os testes de
  convergência.
- Protocolo e criptografia no `core` (Noise sobre `@noble`), sessão da
  [sync-design §7.4](sync-design.md#74-uma-sessão) e regra de endereços locais.
- Grupo, convite por **QR code**, entrada de um aparelho vazio por snapshot e remoção
  ([sync-design §6](sync-design.md#6-membros-e-pareamento)).
- Adaptadores e telas de Dispositivos no desktop e no Android; "Entrar num grupo" nos dois
  primeiros usos.

### Fora do escopo (próximas entregas)

- **Modo remoto** ([sync-design §7.7](sync-design.md#77-modo-remoto-o-celular-usa-o-banco-do-desktop)).
- **Anexos** ([sync-design §7.6](sync-design.md#76-anexos)) — ainda não existem nas telas.
- **Convite por código digitado** (CPace). O handshake de pareamento já nasce com a PSK
  como entrada, então o código entra depois só como uma segunda fonte de segredo.
- iOS, como no MVP mobile.

---

## 2. Decisões em resumo

| Pergunta | Decisão | Por quê |
|---|---|---|
| Como as mudanças são capturadas? | **Triggers `TEMP`** gerados do schema marcam as células sujas numa tabela temporária; um decorator da porta `Database` carimba sequência e HLC antes do commit | Substitui a captura na fronteira do Repository ([sync-design §5.4](sync-design.md#54-a-captura-acontece-na-conexão-do-app-e-o-carimbo-na-porta-de-banco), atualizada). São ~70 pontos de escrita em 14 repositórios, vários em upsert `ON CONFLICT DO UPDATE`, que não sabem quais colunas mudaram; instrumentar um a um é grande e uma escrita esquecida vira divergência silenciosa |
| Quando a sessão acontece? | **Só com a tela de Dispositivos aberta** nos dois aparelhos; o modo ao vivo dura enquanto ela estiver aberta | Nenhum dado muda por baixo de outra tela, como um editor aberto. Ajusta a [sync-design §7.1 e §7.4](sync-design.md#74-uma-sessão) |
| O recálculo de saldos carimba `updated_at`? | **Não** mais | Recalcular um cache não é uma revisão do usuário. Com a captura por trigger, cada recálculo viraria uma mudança sincronizada, e o receptor — que recalcula com a captura desligada — ficaria com outro `updated_at`, quebrando a convergência |
| Onde a sessão roda no desktop? | No `utilityProcess`, dono da única conexão escritora | A aplicação de um lote é uma transação de banco como qualquer rota |
| Padrão Noise do pareamento | A fixar na Fase 5 entre os que aceitam PSK com a chave do anfitrião conhecida pelo QR (ex.: `IKpsk2`); sessões normais em `KK` | O novo aparelho só conhece a chave do anfitrião; o anfitrião só aprende a do novo no handshake |
| Chave privada no desktop | `safeStorage` do Electron, cifrando um arquivo em `userData` | É o chaveiro do sistema operacional exposto pelo Electron, sem módulo nativo novo |

---

## 3. Notas de implementação

### 3.1 A captura

- Ao abrir um núcleo com a sincronização ativada, a raiz de composição cria, **só nesta
  conexão**, a tabela `TEMP` de células sujas e um trigger `TEMP` por tabela sincronizada:
  `AFTER INSERT` marca a linha; `AFTER UPDATE` marca cada coluna sincronizada com
  `OLD.c IS NOT NEW.c`; `BEFORE DELETE` aborta, porque um hard delete não deixa nada para
  replicar ([sync-design §9](sync-design.md#9-impacto-no-design-do-banco-de-dados)).
- Os triggers são **gerados do `PRAGMA table_info`** a cada abertura, menos as colunas da
  [sync-design §5.5](sync-design.md#55-colunas-que-nunca-sincronizam). Uma coluna nova de
  migration entra sozinha; uma tabela nova precisa ser classificada (sincronizada ou local)
  num catálogo do núcleo, e um teste falha se alguma ficar sem classificação.
- Os triggers são criados **depois das migrations**, para que elas continuem fora da
  captura ([backend-design §4.9](backend-design.md#49-migrations-e-sincronização)).
- Triggers `TEMP` não ficam gravados no arquivo: uma edição manual num navegador de banco
  continua invisível para a sincronização, como a
  [sync-design §5.4](sync-design.md#54-a-captura-acontece-na-conexão-do-app-e-o-carimbo-na-porta-de-banco) já
  aceitava.
- O decorator da porta, em `transaction()`, roda o trabalho e, se houver células sujas,
  toma a próxima sequência e o HLC, grava `sync_rows`/`sync_cells` e limpa a tabela
  temporária — tudo antes do commit. Uma escrita fora de transação é embrulhada numa.
- Durante a aplicação de um lote, uma flag na tabela `TEMP` desliga os triggers; ela volta
  a valer para as escritas locais da passada pós-aplicação (reviver um pai, resolver uma
  colisão), que precisam se propagar.

### 3.2 Ativação em quem já tem dados

Vale a [sync-design §10](sync-design.md#10-até-a-sincronização-ser-entregue): ao criar o
grupo, toda linha existente ganha uma entrada em `sync_rows` com origem neste aparelho. O
aparelho que entra chega vazio e recebe o snapshot — no uso real, o desktop cria o grupo e
o banco de teste do celular é descartado.

### 3.3 Decisões tomadas na implementação

- **Relógio de parede como porta própria (`WallClock`).** O HLC precisa de milissegundos e a
  porta `Clock` entrega o instante no formato do schema; a sincronização usa uma porta separada
  para não obrigar todo adaptador de `Clock` a mudar.
- **Colisão por chave natural, além dos nomes.** O catálogo (`SyncCatalog`) lista as chaves dos
  índices únicos parciais. Vocabulário, extratos, faturas e vínculos de tag colidem com
  estratégia `merge` (perdedora com soft delete e filhos redirecionados); a ocorrência de
  recorrência colide com `unlink` (a perdedora perde `recurrence_id`/`occurrence` e continua
  viva), porque é dado financeiro. A resolução acontece **antes** da escrita, porque o índice
  único não é adiável; o ajuste de uma linha recebida perdedora é marcado como escrita local.
- **Pais donos** são as chaves `CASCADE` e `NO ACTION` (vocabulário obrigatório). Um pai morto
  com gêmea viva por chave natural recebe o filho na gêmea, em vez de reviver o perdedor.
- **Pareamento.** Padrão `IKpsk2` com PSK = BLAKE2s(prefixo, segredo de 128 bits, id do grupo).
  O anfitrião só registra o membro depois que a primeira mensagem cifrada do convidado decifra
  — é ali que a PSK fica provada. Sessões normais em `KK`; a primeira mensagem, em claro, diz
  quem liga e entra no prólogo.
- **Membro removido também recebe a ligação.** Quem disca usa a lista de membros conhecidos,
  não só os ativos: a troca de membros vem primeiro, e é por ela que o removido aprende a
  remoção antes de a sessão ser recusada.
- **Loopback aceito** na regra de endereços locais: é o próprio aparelho, e é o que permite o
  teste de fumaça com dois apps no mesmo computador.
- **Estado da tela por consulta.** A tela de Dispositivos consulta `sync.status` a cada segundo
  enquanto está aberta (`useSyncScreen`, no `client`) e invalida todas as consultas quando um
  lote chega; o modo ao vivo é disparado pelo commit que carimba (decorator da porta).
- **Entrada por lote completo nos apps.** O snapshot está no protocolo e no núcleo
  (`SnapshotPort`, `SyncService.adoptSnapshot`, testado), mas os dois apps entram pelo lote
  completo (`snapshots: null`): no uso real o desktop cria o grupo e o celular entra vazio, e
  o lote evita trocar o arquivo do banco no meio da sessão. Ligar o snapshot é trocar a porta.
- **Chave do aparelho no desktop.** `safeStorage` no processo principal (o `utilityProcess` pede
  por mensagem). Num Linux sem chaveiro (backend `basic_text`), usa o modo de texto simples do
  Electron com o arquivo em 0600 — a chave continua fora do banco e dos backups.
- **Convite compacto no QR.** O texto é binário em base32 com o prefixo `FINANCAS1:` (~160
  caracteres, modo alfanumérico do QR), e não JSON: o JSON dava um QR de ~69×69 módulos, denso
  demais para ler com folga na tela do computador; o compacto fica em ~45×45. O QR tem a margem
  de 4 módulos da norma. "Copiar convite" no desktop passa pelo processo principal, porque o
  renderer não tem permissão de área de transferência.
- **`expo-camera` ≥ 58.0.13.** Até a 58.0.12, o R8 do build de release apagava os construtores
  dos registradores do ML Kit (criados por reflexão): o leitor falhava ao iniciar, o
  `expo-camera` só registrava no log e a câmera mostrava a imagem sem nunca ler o QR — no build
  de depuração, sem R8, funcionava. A 58.0.13 traz a regra de `-keep` que faltava.
- **QR com tokens próprios** (`qr-ink`, `qr-bg`): escuro sobre claro nos dois temas, porque nem
  todo leitor lê o código invertido do tema escuro.

### 3.4 Divergências aprovadas dos mockups

Aprovadas pelo usuário em 2026-11-18, antes das telas:

- Só QR code e endereço digitado — sem o código de 8 caracteres nem "3 tentativas", que dependem
  do convite por código (fora desta entrega).
- Sem "último sync": cada aparelho mostra o estado da sessão agora (aguardando, sincronizando,
  sincronizado), e "versão diferente"/"relógio divergente" vêm da última recusa.
- Ao entrar num grupo, "Recebendo dados…" sem porcentagem: a entrada é um lote só.
- No desktop, que não tem câmera, o primeiro uso entra colando o convite ("Copiar convite" no
  outro aparelho). No celular, o mesmo campo aparece abaixo da câmera, para quando ela é negada.
- O celular não cria grupo nem convida: nenhuma biblioteca instalada informa o IP do Wi-Fi para
  ir no QR, e no uso real o grupo nasce no computador. Entrar com dados locais move o banco para
  `backups/antes-de-entrar-no-grupo-*.sqlite`, com confirmação, e o app reabre vazio.

---

## 4. Ordem e dependências

O risco técnico cai antes da rede: as Fases 1–4 rodam inteiras em testes com réplicas em
memória, sem transporte. A Fase 5 só começa com a convergência verde. As Fases 7 e 8
podem andar em paralelo depois da 6.

---

## 5. Lista de tarefas

Todo item segue o padrão do `CLAUDE.md`: contratos explícitos, docblock com motivação e
testes no mesmo commit.

### Fase 0 — Plano e ajustes no design

- [x] Este plano
- [x] [sync-design §5.4](sync-design.md#54-a-captura-acontece-na-conexão-do-app-e-o-carimbo-na-porta-de-banco): captura por triggers `TEMP` + carimbo no decorator da porta
- [x] [sync-design §7.1 e §7.4](sync-design.md#74-uma-sessão): a sessão abre e o modo ao vivo dura só com a tela de Dispositivos aberta

### Fase 1 — Relógio e tabelas

- [x] `HybridLogicalClock` no domínio: formato de largura fixa da [sync-design §5.2](sync-design.md#52-o-relógio-é-um-relógio-lógico-híbrido), `tick` local, `receive` de um relógio remoto, comparação por string; testes de propriedade (monotonicidade com o relógio de parede parado e voltando; causalidade)
- [x] Migration `0009` com `sync_rows`, `sync_cells`, `sync_members`, `sync_vector`, `sync_state` e os índices em `(origin, seq)`; `pnpm embed:migrations`; tabelas no diagrama e na [database-design](database-design.md)
- [x] Repository do estado de sincronização (identidade do aparelho, grupo, HLC, próxima sequência, vetor)

### Fase 2 — Captura

- [x] Recálculo de saldos deixa de carimbar `updated_at` (`accounts`, `bank_statements`, `invoices`); conferir os testes que dependiam disso
- [x] Catálogo de tabelas e colunas sincronizadas, com teste que falha para tabela não classificada
- [x] Gerador dos triggers `TEMP` e decorator da porta que carimba sequência e HLC antes do commit ([§3.1](#31-a-captura))
- [x] Ativação: criar o grupo e preencher `sync_rows` das linhas existentes ([§3.2](#32-ativação-em-quem-já-tem-dados))
- [x] Testes: cada operação do `TestWorld` que altera uma célula deixa nela um relógio efetivo novo; uma transação = uma sequência; recálculo não gera entrada; hard delete é recusado

### Fase 3 — Extração e aplicação

- [x] Extração: "o que falta a um vetor", em ordem de sequência, agrupado por transação de origem, com os valores atuais das células — o formato do lote como DTO validado por zod
- [x] Aplicação numa transação com `defer_foreign_keys`: last-writer-wins por célula contra o relógio efetivo; `materialized_count` como máximo; caches gravados com `0`; `created_at` da origem ([sync-design §5.5](sync-design.md#55-colunas-que-nunca-sincronizam))
- [x] Pós-aplicação ([sync-design §5.9](sync-design.md#59-após-a-aplicação)): colisões de nome pelo menor id com redirecionamento dos filhos (§5.7), pai dono revivido com aviso (§5.8), ocorrências além do término da regra encerrada excluídas (a pendência da §5.6 e da Fase 9.2 do desktop), recálculo de saldos dos contêineres antigo e novo, verificação de integridade, vetor avançado
- [x] Testes de idempotência: reaplicar um lote não muda nada

### Fase 4 — Convergência

- [x] Réplicas em memória (`better-sqlite3`) dirigidas pelas rotas do núcleo, com operações e trocas aleatórias (`fast-check`) em partições aleatórias: todas terminam idênticas byte a byte nas tabelas de domínio
- [x] Testes direcionados da [sync-design §11.4](sync-design.md#11-próximos-passos): divergência de relógio, colisões de nomes, filhos órfãos, mesma ocorrência gerada em dois aparelhos (com o dia da série trocado em um deles), série recomeçada com a regra antiga completada offline, soft delete que continua excluído, transferência entre perfis

### Fase 5 — Protocolo e criptografia no núcleo

- [x] Portas `Transport`, `Discovery`, `KeyStore`, `RandomSource` ([mobile-shell §5.1](mobile-shell-design.md#51-protocolo-e-criptografia-ficam-no-núcleo)) e a regra de endereços locais no `core` ([sync-design §7.1](sync-design.md#71-somente-a-mesma-rede-local))
- [x] Noise sobre `@noble` (X25519, ChaCha20-Poly1305, BLAKE2s ou SHA-256): `KK` para sessões e o padrão com PSK do pareamento; validado contra os vetores de teste públicos do Noise
- [x] Enquadramento das mensagens e máquina de estados da sessão ([sync-design §7.4](sync-design.md#74-uma-sessão)): handshake, relógio (2 min), `user_version`, membros primeiro, vetores, lotes, confirmação e modo ao vivo — testada sobre um `Transport` em memória, com queda de conexão em cada passo
- [x] Medir a vazão da cifra no Hermes pelo `apps/mobile-contract` ([mobile-shell §5.1](mobile-shell-design.md#51-protocolo-e-criptografia-ficam-no-núcleo), risco aceito)

### Fase 6 — Membros, convite e snapshot

- [x] Criar o grupo; `sync_members` replicada; recusar sessão com membro removido
- [x] Convite por QR: payload (grupo, id e chave do anfitrião, endereço, segredo de 128 bits), validade de 5 minutos, uso único
- [x] Entrada de um aparelho vazio: snapshot por `VACUUM INTO`, troca do banco e reinício de `sync_state`/`sync_vector` com a identidade própria ([sync-design §6.4](sync-design.md#64-entrando-no-grupo-um-novo-dispositivo-começa-vazio)); recusa quando o aparelho tem dados
- [x] Remoção, inclusive "sair do grupo"

### Fase 7 — Desktop

Antes das telas: `DesktopDispositivos` e `DesktopPrimeiroUso` nos mockups.

- [x] Adaptadores no `utilityProcess`: `net` (TCP), mDNS, `KeyStore` sobre `safeStorage`, `RandomSource` sobre `crypto`
- [x] Mensagens entre renderer e `utilityProcess` para estado da sessão, convite e membros; consultas invalidadas quando um lote é aplicado
- [x] Tela Dispositivos: membros, convite com QR, remover, estado da sessão e os erros de relógio e versão dizendo qual aparelho corrigir; indicador da barra lateral deixa de dizer "Dados só neste aparelho"
- [x] Primeiro uso: "Entrar num grupo" habilitado
- [x] Teste de fumaça (Playwright): dois apps desktop no mesmo host pareando e trocando um lançamento

### Fase 8 — Mobile (Android)

Antes das telas: `MobileDispositivos`, `MobileParear` e `MobilePrimeiroUso` nos mockups.

- [x] Adaptadores ([mobile-shell §5.2](mobile-shell-design.md#52-os-adaptadores-do-mobile)): `react-native-tcp-socket`, mDNS com suporte à Nova Arquitetura (ou módulo Expo próprio sobre o `NsdManager`), `expo-secure-store`, `expo-crypto`; permissões por *config plugin* (multicast lock, rede local do `targetSdk` vigente)
- [x] Tela Dispositivos e leitura do QR pelo `expo-camera`; "Entrar num grupo" no primeiro uso, descartando o banco local com confirmação
- [x] Ciclo de vida: sair da tela ou do primeiro plano encerra a sessão, fecha o listener e para o anúncio ([mobile-shell §5.3](mobile-shell-design.md#53-ciclo-de-vida-do-app))

### Fase 9 — Validação ponta a ponta

- [ ] Desktop real e Android real no mesmo Wi-Fi: o desktop cria o grupo com o banco real, o celular entra vazio, edições offline dos dois lados, edição concorrente de colunas diferentes da mesma transação, remoção, recusa por relógio e por versão
- [ ] Atualizar status: este plano, [sync-design](sync-design.md), a pendência da Fase 9.2 do [desktop-mvp-plan](desktop-mvp-plan.md) e a [mobile-mvp-plan §3](mobile-mvp-plan.md#3-relação-com-a-sincronização)

---

## 6. Critério de pronto

Uma despesa lançada no celular offline aparece no desktop na próxima vez que os dois abrem
Dispositivos na mesma rede, e o contrário; edições concorrentes em colunas diferentes
sobrevivem as duas; a verificação de integridade passa nos dois bancos depois de cada
sessão; e `pnpm check` está verde.

---

## 7. Riscos

| Risco | Mitigação |
|---|---|
| Uma escrita que escapa da captura | Captura por trigger, sem depender de cada repositório; teste de cobertura sobre o `TestWorld` |
| Divergência que só aparece com o uso | Fase 4 antes de qualquer rede; verificação de integridade ao fim de cada aplicação |
| Cifra lenta no Hermes | Medida na Fase 5; se não bastar, a primitiva vem de um módulo nativo por trás de uma porta |
| mDNS bloqueado na rede de casa | Endereço digitado à mão e último endereço lembrado ([sync-design §7.2](sync-design.md#72-descoberta)) |
| Biblioteca de mDNS sem Nova Arquitetura | Módulo Expo próprio sobre o `NsdManager` |
