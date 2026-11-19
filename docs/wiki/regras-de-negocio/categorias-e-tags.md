# Categorias e tags

Regras de negócio dos cadastros de classificação: as regras comuns a todo cadastro (nome, unicidade sem diferenciar maiúsculas, desativar × arquivar × excluir, validação compartilhada), a árvore de categorias e subcategorias, as tags e as telas que as listam. Contas, cartões e perfis têm páginas próprias ([Contas](contas.md), [Cartões e faturas](cartoes-e-faturas.md), [Perfis](perfis.md)); as tabelas estão em [Banco de dados](../arquitetura/banco-de-dados.md).

## 1. Regras comuns aos cadastros

### 1.1 Nome de cadastro

Regra 1. O nome de perfil, conta, cartão, categoria, subcategoria, tag e meta tem de **1 a 45 caracteres**, **aparado** antes de medir (`REGISTRY_NAME_MAX_LENGTH`, `requireName` em [`names.ts`](../../../packages/core/src/domain/shared/names.ts)). Um nome só de espaços apareceria vazio em toda lista, e espaços nas pontas fariam "Mercado" e "Mercado " parecerem cadastros diferentes. O limite é o mesmo `CHECK (length(name) <= 45)` do schema; o domínio recusa antes de o banco recusar com erro de SQL. O nome de sócio tem limite próprio de 100 ([Sócios §1.2](socios.md#12-nome-e-participação)).

Regra 2. Nas rotas, o mesmo limite é o `registryNameField` de [`fields.ts`](../../../packages/core/src/requests/fields.ts), que o formulário reaproveita (`readNameForm` em [`nameForm.ts`](../../../packages/client/src/forms/nameForm.ts)) para nunca repetir o número.

Teste: [`domain/registry.test.ts`](../../../packages/core/test/domain/registry.test.ts) ("nomes de cadastro").

### 1.2 Unicidade sem diferenciar maiúsculas

Regra 3. Categorias e tags têm nome **único no perfil**; subcategorias, **único dentro da categoria** ("Outros" pode existir em Moradia e em Transporte). A comparação **não diferencia maiúsculas**, inclusive com acento: "Saúde" e "SAÚDE" são o mesmo nome. Renomear para o próprio nome em outra caixa não conflita consigo mesmo.

Regra 4. A unicidade é conferida no **service** com `sameName` (NFC + minúsculas), e não só pelo índice `name COLLATE NOCASE`: o `NOCASE` do SQLite só dobra ASCII, deixaria passar "Saúde"/"SAÚDE" e, quando pegasse, falharia com erro de SQL em vez de um `CONFLICT` (`NameConflictError`) que aponta o campo. Os índices únicos parciais continuam como rede de segurança. Ver [decisões](../decisoes.md) ([ADR 79](../decisoes.md#adr-79)).

Regra 5. A tela **não** confere a unicidade: só o núcleo vê todos os nomes, e o conflito volta como `CONFLICT` com o campo, mostrado abaixo dele (§1.4).

Testes: [`categories.test.ts`](../../../packages/core/test/services/categories.test.ts) e [`tags.test.ts`](../../../packages/core/test/services/tags.test.ts) ("nome duplicado sem diferenciar maiúsculas, inclusive com acento, é CONFLICT e não erro de SQL").

### 1.3 Desativar, arquivar e excluir

Cada cadastro tem um jeito de sair de vista, escolhido pelo que ele carrega:

| Cadastro | Sai de vista por | Efeito |
|---|---|---|
| Conta, cartão | Desativar (`disabled_at`, migration `0002_disabled_registries`) | Some das escolhas de lançamentos novos; continua em extratos, faturas, saldos e relatórios |
| Meta | Arquivar (`archived_at`, migration `0006`) | Some da lista padrão e das escolhas de lançamentos novos; progresso e vínculos intactos ([Metas §5](metas.md#51-arquivar)) |
| Categoria, subcategoria | Excluir, movendo os lançamentos (§2.3) | Lançamentos passam para outra subcategoria |
| Tag | Excluir (§3.3) | Lançamentos perdem a tag e continuam |
| Sócio | Remover (`partners.save`) | Lançamentos ficam sem sócio ([Sócios §2.3](socios.md#23-remover-sócio)) |
| Anotação | Excluir | Nada depende dela |

Regra 6. Desativar é a ação padrão no lugar de excluir para **contas e cartões**, porque excluí-los apaga em cadeia lançamentos e muda saldos ([Contas](contas.md)). Desativar e reativar não pedem confirmação: se desfazem e não mudam saldo.

Regra 7. Desativação e arquivamento são **colunas novas**, e não reaproveitamento de `deleted_at`: `deleted_at` significa "não existe mais" para toda leitura e para a sincronização, e um cadastro desativado ou arquivado continua existindo. Nulo = ativo; preenchido = instante UTC do primeiro desativar/arquivar. Ver [decisões](../decisoes.md) ([ADR 75](../decisoes.md#adr-75)).

Regra 8. Categorias, subcategorias e tags **não têm** estado desativado: não há rota nem coluna. Uma categoria pouco usada continua oferecida no lançamento até ser excluída.

Regra 9. Toda exclusão de cadastro é **soft delete** (`deleted_at`), para que a sincronização propague a lápide ([Sincronização](../arquitetura/sincronizacao.md)).

### 1.4 Validação compartilhada entre tela e núcleo

Regra 10. Os formulários validam com os **mesmos schemas zod** das rotas (`goalContentShape`, `registryNameField`, `noteTextField`, `accountContentShape`, `creditCardContentShape`...), e as frases dos erros saem de [`formIssues.ts`](../../../packages/client/src/forms/formIssues.ts). Assim a tela e o núcleo nunca discordam sobre o que é válido.

Regra 11. Quando o núcleo recusa apontando um campo (nome repetido, moeda travada, conta pagadora desativada, conta de meta que não pode mudar de tipo), a mensagem aparece **abaixo do campo**, e não num aviso geral (`placeCoreError`/`reportRejection` em [`coreErrorField.ts`](../../../packages/client/src/forms/coreErrorField.ts)). Erro que não é recusa do núcleo é relançado, para não esconder falha de transporte ou bug num aviso de formulário.

Testes: [`coreErrorField.test.ts`](../../../packages/client/test/coreErrorField.test.ts), [`accountForm.test.ts`](../../../packages/client/test/accountForm.test.ts), [`creditCardForm.test.ts`](../../../packages/client/test/creditCardForm.test.ts), [`goalForm.test.ts`](../../../packages/client/test/goalForm.test.ts).

### 1.5 Escopo e mês de referência

Regra 12. Categorias, subcategorias, tags, sócios, anotações e metas **pertencem a um perfil**: o pessoal e o empresarial mantêm vocabulários separados, e nenhuma referência de lançamento atravessa perfis (`reference-outside-profile`). Ver [Perfis](perfis.md).

Regra 13. As telas de cadastro (Categorias, Tags, Sócios, Anotações, Perfis) **não dependem do mês de referência**: as contagens e totais são de todo o período. O mês continua na URL, escondido nessas telas, para não se perder ao voltar a uma tela que o usa.

## 2. Categorias e subcategorias

### 2.1 Classificação em dois níveis

Regra 14. A classificação tem dois níveis: **categoria** (nível superior, do perfil) e **subcategoria** (de uma categoria). Toda transação aponta para **uma subcategoria viva**; a categoria não classifica transações diretamente. Não há subcategoria de sistema: o pagamento parcial de fatura e as transferências também pedem uma (as transferências ficam fora do relatório por categoria; ver [Relatórios](relatorios.md)).

Regra 15. O núcleo **não guarda ordem** de categorias (a árvore sai por nome) e **não move** subcategoria entre categorias. Para mudar uma subcategoria de categoria, cria-se outra e exclui-se a antiga movendo os lançamentos.

Onde mora: [`Category.ts`](../../../packages/core/src/domain/category/Category.ts), [`SubCategory.ts`](../../../packages/core/src/domain/category/SubCategory.ts), [`CategoryService.ts`](../../../packages/core/src/services/category/CategoryService.ts).

### 2.2 Árvore e categorias sugeridas

`categories.tree` devolve as categorias do perfil por nome, cada uma com as subcategorias por nome e a contagem de lançamentos vivos de cada subcategoria ([`CategoryTree.ts`](../../../packages/core/src/services/category/CategoryTree.ts)).

Regra 16. No primeiro uso, o perfil recebe **categorias sugeridas** (Moradia, Alimentação, Transporte, Assinaturas, Compras, Saúde, Renda, Investimentos, com subcategorias) por `CategoryService.seedSuggested` ([`suggestedCategories.ts`](../../../packages/core/src/domain/category/suggestedCategories.ts)). Sem nenhuma subcategoria o perfil não consegue lançar nada, e o primeiro uso terminaria num formulário que não salva. São só sugestões; a criação pula as que já existem pelo nome, para que repetir a chamada não esbarre no índice único.

### 2.3 Excluir com mover

Regra 17. Excluir uma subcategoria **em uso** exige escolher para onde **mover** os lançamentos (`moveTo`); sem destino, a rota recusa com `sub-category-in-use` e informa quantos lançamentos há (`transactions` no detalhe do erro). Apagar os lançamentos junto mudaria saldos por uma ação de cadastro, e toda transação precisa de uma subcategoria viva. Subcategoria sem lançamento é excluída sem destino.

Regra 18. Excluir uma **categoria** exclui todas as subcategorias dela, pela mesma regra: os lançamentos de todas vão para `moveTo`.

Regra 19. O destino precisa ser do mesmo perfil (`reference-outside-profile`) e **não pode** ser uma das subcategorias excluídas — a própria, ou qualquer uma da categoria excluída (`move-target-deleted`). A tela já oferece só os destinos válidos (`moveTargets` em [`categoryView.ts`](../../../packages/client/src/viewModels/categoryView.ts)), para que o núcleo nunca precise recusar a escolha; a frase do diálogo diz o que some junto e que os lançamentos são movidos, não apagados (`describeCategoryDeletion`).

Regra 20. Mover e excluir acontecem numa **unidade de trabalho só**, para que nenhum lançamento fique apontando para uma subcategoria excluída.

Testes: [`categories.test.ts`](../../../packages/core/test/services/categories.test.ts) ("excluir subcategoria em uso"), [`categoryView.test.ts`](../../../packages/client/test/categoryView.test.ts). Ver [decisões](../decisoes.md) ([ADR 80](../decisoes.md#adr-80)).

### 2.4 Rotas

`categories.tree`, `categories.create`, `categories.update` (renomear), `categories.delete`, `subCategories.create`, `subCategories.update` (renomear) e `subCategories.delete`, todas em [`CategoryController.ts`](../../../packages/core/src/controllers/CategoryController.ts).

## 3. Tags

### 3.1 O que é uma tag

Regra 21. A tag é uma etiqueta livre do perfil, aplicada a vários lançamentos, e um lançamento pode ter várias. Diferente da categoria, não classifica: cruza categorias ("viagem-floripa" junta hotel, restaurante e combustível). É **opcional** no lançamento.

Regra 22. O vínculo é a tabela `transactions_tags`, com id **derivado do par** (transação, tag), para que dois aparelhos que marcam a mesma tag gerem o mesmo vínculo. A mesma tag duas vezes no lançamento é descartada (o índice único do par recusaria). A tag que volta a um lançamento revive o mesmo vínculo em vez de duplicar. Os modelos de recorrência têm o equivalente `recurrences_tags` ([Recorrências](recorrencias.md)).

Regra 23. `tagIds` é opcional ao **criar** o lançamento e **obrigatório** na edição completa, para que omiti-lo não apague em silêncio as tags gravadas. Marcar como pago mantém as tags. Ver [Transações](transacoes.md).

Onde mora: [`Tag.ts`](../../../packages/core/src/domain/tag/Tag.ts), [`TagService.ts`](../../../packages/core/src/services/tag/TagService.ts).

### 3.2 Uso de cada tag

`tags.list` traz, para cada tag, o uso em **todo o período** ([`TagViews.ts`](../../../packages/core/src/services/tag/TagViews.ts)):

Regra 24. **Total** = soma dos valores **em módulo** dos lançamentos marcados, de qualquer tipo, **sem encargos**: a tag cruza tipos, e o total mede quanto dinheiro passou por ela, não um saldo.
Regra 25. **Último uso** = o maior **vencimento** entre os lançamentos marcados; `null` sem lançamento. Tag sem lançamento vem com contagem e total zerados. Transação excluída deixa de pesar.

Onde mora: `usage` em [`SqliteTagRepository.ts`](../../../packages/core/src/infrastructure/sqlite/SqliteTagRepository.ts). Teste: [`tags.test.ts`](../../../packages/core/test/services/tags.test.ts) ("o total soma os valores em módulo de qualquer tipo, sem encargos; o último uso é o maior vencimento").

### 3.3 Excluir tag

Regra 26. Excluir a tag a **tira dos lançamentos**, que continuam existindo com as outras tags. Diferente da subcategoria, nada precisa ser movido. A tela avisa quantos lançamentos perdem a tag. O relatório por tag está em [Relatórios](relatorios.md).

Teste: [`tags.test.ts`](../../../packages/core/test/services/tags.test.ts) ("excluir tira a tag dos lançamentos").

### 3.4 Rotas

`tags.list`, `tags.create`, `tags.update` (renomear) e `tags.delete`, em [`TagController.ts`](../../../packages/core/src/controllers/TagController.ts).

## 4. Colisões de nome na sincronização

Regra 27. Dois aparelhos que criam "Mercado" offline geram dois ids e uma colisão na chave natural (`profile_id`, `name` sem caixa) de categorias e tags, ou (`category_id`, `name`) de subcategorias. Ao aplicar o lote, **sobrevive a linha de menor id**; a outra é gravada com soft delete e os filhos dela (subcategorias, lançamentos, vínculos de tag) são redirecionados para a sobrevivente. Como a escolha depende só dos ids, todo aparelho chega à mesma sobrevivente sozinho. Renomeações que colidem seguem a mesma regra.

Onde mora: `naturalKeys` em [`SyncCatalog.ts`](../../../packages/core/src/domain/sync/SyncCatalog.ts) e `resolveCollisions` em [`BatchApplier.ts`](../../../packages/core/src/services/sync/BatchApplier.ts). O mecanismo completo está em [Sincronização](../arquitetura/sincronizacao.md).

## 5. Telas

### 5.1 Desktop

Cada cadastro tem item próprio no menu lateral (não há tela "Cadastros" agrupando os tipos):

- **Categorias** (`/categories`, [`CategoriesScreen.tsx`](../../../apps/desktop/src/renderer/src/categories/CategoriesScreen.tsx)): lista lateral com "+ Nova", busca por categoria **ou** subcategoria (sem diferenciar maiúsculas nem acentos), resumo "N categorias · M subcategorias" da lista mostrada e, em cada item, quantas subcategorias e lançamentos tem. A categoria aberta é o *search param* `category` ([`categoriesSearch.ts`](../../../apps/desktop/src/renderer/src/categories/categoriesSearch.ts)); sem ele, ou com uma que não existe mais, abre a primeira; a da URL continua aberta mesmo quando a busca a esconde. O detalhe tem renomear e excluir, a tabela de subcategorias com renomear e excluir por linha, a criação na última linha e o atalho para o relatório por categoria.
- **Tags** (`/tags`, [`TagsScreen.tsx`](../../../apps/desktop/src/renderer/src/tags/TagsScreen.tsx)): lista com lançamentos, total e último uso; criar no cabeçalho; painel para renomear e excluir, com os atalhos para Transações e para o relatório por tag.

Testes: [`apps/desktop/test/entities.test.ts`](../../../apps/desktop/test/entities.test.ts), [`e2e/entities.spec.ts`](../../../apps/desktop/e2e/entities.spec.ts).

### 5.2 Celular

O índice de Cadastros (`/more/registries`) lista os tipos com as contagens; Contas e Cartões levam às abas deles.

- **Categorias** (`/more/categories` → `/more/category/[id]`): a mesma busca, resumo e contagens do desktop; no detalhe, as subcategorias com a contagem, "Adicionar subcategoria" no fim (sem folha, para cadastrar várias seguidas), renomear e excluir a categoria no "⋯" e a subcategoria ao tocar na linha; a exclusão com lançamentos pede o destino (`moveTargets`).
- **Tags** (`/more/tags`): "Nova tag" no topo, sem folha; a lista com quantos lançamentos usam cada uma; "Editar tag" numa folha com o nome, os números do painel do desktop, salvar e excluir com o aviso.

As funções puras de busca, contagens, destinos e frases ([`categoryView.ts`](../../../packages/client/src/viewModels/categoryView.ts)) e o `nameForm` moram no `client`, compartilhadas. Testes: [`apps/mobile/test/registries.test.tsx`](../../../apps/mobile/test/registries.test.tsx), [`apps/mobile/test/tagsAndNotes.test.tsx`](../../../apps/mobile/test/tagsAndNotes.test.tsx).

## 6. Limitações conhecidas

- Não há ordenação manual de categorias nem mover subcategoria entre categorias (§2.1).
- A tela de Tags do celular não tem o atalho "Ver lançamentos em Transações" do desktop: os filtros de Transações do celular não se abrem por link.
