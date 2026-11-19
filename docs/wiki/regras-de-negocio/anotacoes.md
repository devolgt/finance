# Anotações

Regras de negócio das anotações: observações e lembretes livres de um perfil, sem ligação com lançamento ou conta. Cobre o domínio, a ordem e a busca da lista, o título derivado do texto e o editor com proteção contra perder alterações. A tabela `notes` está em [Banco de dados](../arquitetura/banco-de-dados.md).

## 1. O que é uma anotação

### 1.1 Lista simples do perfil

Regra 1. A anotação é **texto livre** de um perfil, deliberadamente uma lista simples: não se liga a lançamento, conta, meta ou mês. Por isso o `NoteService` não tem regra entre linhas — só confere que o perfil existe e passa a escrita pela unidade de trabalho, como toda escrita do núcleo.

Regra 2. Cada perfil vê só as próprias anotações.

Onde mora: [`Note.ts`](../../../packages/core/src/domain/note/Note.ts), [`NoteService.ts`](../../../packages/core/src/services/note/NoteService.ts). Teste: [`notes.test.ts`](../../../packages/core/test/services/notes.test.ts) ("cada perfil vê só as próprias anotações").

### 1.2 Texto

Regra 3. O texto é **aparado nas pontas** e **não pode ficar vazio** (`InvalidValueError` no campo `text`). Linhas em branco no começo empurrariam o título para uma linha vazia na lista; um texto só de espaços seria uma anotação invisível.

Regra 4. **Não há limite de tamanho** (a coluna `note` não tem `CHECK` de comprimento).

Regra 5. A edição troca o **texto inteiro** (`notes.update` → `Note.rewrite`); não há edição parcial. Depois de salvar, o editor mostra o texto como o núcleo o gravou (aparado).

Regra 6. O formulário valida com o mesmo `noteTextField` das rotas (`readNoteForm` em [`noteForm.ts`](../../../packages/client/src/forms/noteForm.ts)), para que tela e núcleo nunca discordem.

Testes: [`notes.test.ts`](../../../packages/core/test/services/notes.test.ts) ("apara as pontas e recusa texto vazio"), [`noteForm.test.ts`](../../../packages/client/test/noteForm.test.ts).

### 1.3 Título é a primeira linha

Regra 7. Não existe campo de título: a **primeira linha não vazia** do texto é o título nas listas, e o resto, juntado numa linha só, é a prévia (`summarizeNote` em [`note.ts`](../../../packages/client/src/format/note.ts); `noteTitle` em [`noteForm.ts`](../../../packages/client/src/forms/noteForm.ts) para rótulos e confirmações). Um título à parte poderia discordar do texto. A função fica no `client` para desktop e celular mostrarem a mesma lista. Ver [decisões](../decisoes.md) ([ADR 81](../decisoes.md#adr-81)).

## 2. Lista e busca

Regra 8. `notes.list` devolve as anotações da **editada mais recentemente** para a mais antiga (`updated_at` decrescente, depois `created_at` e id, em [`SqliteNoteRepository.ts`](../../../packages/core/src/infrastructure/sqlite/SqliteNoteRepository.ts)).

Regra 9. A busca procura no **texto inteiro**, e não só no título, sem diferenciar **maiúsculas nem acentos** ("iptu" acha "IPTU", "reembolsavel" acha "reembolsável"): o que se lembra de uma anotação costuma estar no corpo. A busca roda na tela (`filterNotes`), e não numa rota, porque a lista de um perfil é curta e já está em cache.

Regra 10. A Visão geral do desktop mostra os títulos das **4 mais recentes** (`overviewNotes`, `OVERVIEW_NOTES_LIMIT`) e quantas ficaram de fora; cada título leva ao editor. Ver [Visão do mês](visao-do-mes.md).

Testes: [`notes.test.ts`](../../../packages/core/test/services/notes.test.ts) ("cria, lista da editada mais recentemente para a mais antiga e reescreve"), [`noteForm.test.ts`](../../../packages/client/test/noteForm.test.ts), [`overviewView.test.ts`](../../../packages/client/test/overviewView.test.ts).

## 3. Editor e exclusão

### 3.1 Alteração não salva

Regra 11. Sair de uma anotação com alteração **não salva** — para outra anotação, outra tela, troca de perfil, ou o "voltar" do cabeçalho ou do Android no celular — abre um diálogo que pede **salvar ou descartar** antes de sair. O texto de uma anotação não está em nenhum outro lugar, e descartá-lo em silêncio o perderia.

Onde mora: desktop em [`NotesScreen.tsx`](../../../apps/desktop/src/renderer/src/notes/NotesScreen.tsx) (anotação aberta no *search param* `note` de `/notes`, [`notesSearch.ts`](../../../apps/desktop/src/renderer/src/notes/notesSearch.ts)); celular em [`NoteEditorScreen.tsx`](../../../apps/mobile/src/screens/NoteEditorScreen.tsx) (`usePreventRemove`).

### 3.2 Excluir

Regra 12. Excluir é **soft delete** com confirmação; a anotação excluída some da lista e não pode mais ser editada (`NotFoundError`). Nada depende dela, então não há cascata.

Teste: [`notes.test.ts`](../../../packages/core/test/services/notes.test.ts) ("excluída some da lista e não pode mais ser editada").

### 3.3 Rotas

`notes.list`, `notes.create`, `notes.update` e `notes.delete`, em [`NoteController.ts`](../../../packages/core/src/controllers/NoteController.ts). As escritas invalidam só `notes.list`.

## 4. Telas

- **Desktop** (`/notes`): lista com busca e editor ao lado, com salvar, descartar e excluir.
- **Celular** (`/more/notes` → `/more/note/[id]`, `new` para uma nova; [`NotesScreen.tsx`](../../../apps/mobile/src/screens/NotesScreen.tsx), [`NoteEditorScreen.tsx`](../../../apps/mobile/src/screens/NoteEditorScreen.tsx)): a busca no texto inteiro e os cartões com título e prévia; o editor com "Salvar" no cabeçalho, que grava e volta, e "Excluir" com confirmação.

Testes: [`apps/desktop/test/entities.test.ts`](../../../apps/desktop/test/entities.test.ts), [`e2e/entities.spec.ts`](../../../apps/desktop/e2e/entities.spec.ts), [`apps/mobile/test/tagsAndNotes.test.tsx`](../../../apps/mobile/test/tagsAndNotes.test.tsx).

## 5. Limitações conhecidas

- O texto é uma coluna só: duas edições concorrentes da mesma anotação em aparelhos diferentes não se misturam na sincronização, e vence a mais recente inteira ([Sincronização](../arquitetura/sincronizacao.md)).
- Um editor aberto não recebe alterações remotas: a sincronização roda só na tela de sincronização, e o texto que estava no editor é o que será gravado se o usuário salvar.
