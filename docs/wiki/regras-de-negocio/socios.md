# Sócios

Regras de negócio dos sócios de um perfil empresarial: o cadastro (participações que somam 100%, gravação da lista inteira, remoção), o vínculo do sócio com os lançamentos — os **aportes** — e de onde o relatório por sócio tira os números. A divisão dos aportes pela participação e o acerto entre sócios (o "equilíbrio") são regras do relatório e estão em [Relatórios](relatorios.md); aqui só o que elas pressupõem.

## 1. Cadastro de sócios

### 1.1 Só no perfil empresarial

Regra 1. Só perfis **empresariais** têm sócios. `partners.list` e `partners.save` recusam o perfil pessoal com `partner-requires-business-profile`. O banco não expressa a restrição, porque ela relaciona duas tabelas (`profiles.type` e `partners`); quem a garante é o `PartnerService.requireBusiness` (via `Profile.acceptsPartners`).

Regra 2. Nas telas, o item Sócios só aparece no perfil empresarial (menu lateral do desktop, linha própria em Cadastros no celular). Aberta pela URL no perfil pessoal, a tela **explica** em vez de chamar a rota que o núcleo recusa. Ver [Perfis](perfis.md).

### 1.2 Nome e participação

Regra 3. O nome tem de **1 a 100 caracteres**, aparado (`PARTNER_NAME_MAX_LENGTH`) — maior que o dos outros cadastros porque é o nome de uma pessoa. Nomes **podem repetir**: duas pessoas podem ter o mesmo nome.

Regra 4. A participação vai de **0 a 100**, com **até duas casas decimais**. Duas casas bastam para dividir em três (33,33 + 33,33 + 33,34) e permitem conferir a soma em centésimos inteiros (`Partner.hundredths`), sem depender da precisão do `REAL` nem do ponto flutuante. O banco só garante a faixa (`CHECK`); as casas decimais são da aplicação.

Regra 5. A participação **atual** vale para todo o histórico: não há participação por período.

Onde mora: [`Partner.ts`](../../../packages/core/src/domain/partner/Partner.ts). Teste: [`partners.test.ts`](../../../packages/core/test/services/partners.test.ts) ("recusa participação fora de 0 a 100 ou com mais de duas casas decimais, e nome vazio ou com mais de 100 caracteres", "nomes repetidos são permitidos").

### 1.3 Soma de 100%

Regra 6. Com pelo menos um sócio, as participações precisam somar **exatamente 100%** para salvar (`partner-shares-not-100`, com o total no detalhe do erro para a tela dizer quanto falta). Com menos, parte dos aportes não teria dono na divisão; com mais, alguém responderia pela parte de outro.

Regra 7. A **lista vazia** é aceita: é o estado de todo perfil empresarial recém-criado, e remover todos os sócios precisa ter volta.

Regra 8. Quando a soma não fecha, **nada é gravado**: a conferência acontece antes de qualquer escrita, na mesma unidade de trabalho.

Onde mora: `assertSharesComplete` em [`PartnerShares.ts`](../../../packages/core/src/domain/partner/PartnerShares.ts). Testes: [`partners.test.ts`](../../../packages/core/test/services/partners.test.ts) ("a soma das participações precisa dar 100%, e nada é gravado quando não dá", "confere a soma em centésimos", "remover todos os sócios é permitido").

### 1.4 Gravação da lista inteira (`partners.save`)

Regra 9. O cadastro grava a **lista inteira** de uma vez: cria os novos (sem id), regrava os editados e remove os vivos que não vieram, tudo numa transação. Gravar sócio a sócio passaria por estados intermediários que a soma de 100% recusa — redividir 60/40 em 50/50 seria impossível. Ver [decisões](../decisoes.md) ([ADR 76](../decisoes.md#adr-76)).

Regra 10. Um id enviado precisa ser de um sócio **vivo do mesmo perfil**; o sócio removido não volta pelo id (`NotFoundError`), e o mesmo id duas vezes é recusado.

Regra 11. Só o sócio que **mudou** é regravado, para que o `updated_at` do intocado continue dizendo quando ele mudou de fato (o que também evita tráfego inútil na sincronização).

Regra 12. A lista sai pela **maior participação primeiro**, desempate pelo nome (`byLargestShare`) — a mesma ordem do relatório por sócio —, cada sócio com quantos lançamentos estão vinculados a ele (para o aviso de remoção).

Onde mora: [`PartnerService.ts`](../../../packages/core/src/services/partner/PartnerService.ts), [`PartnerCommands.ts`](../../../packages/core/src/services/partner/PartnerCommands.ts). Testes: [`partners.test.ts`](../../../packages/core/test/services/partners.test.ts) ("edita nome e participação e cria um sócio novo na mesma gravação", "o sócio removido não volta pelo id", "não regrava o sócio que não mudou").

## 2. Sócio nos lançamentos: aportes

### 2.1 O sócio aparece no dinheiro que entra

Regra 13. Toda despesa de um perfil empresarial é paga com o dinheiro da **empresa**. O sócio aparece no dinheiro que **entra** nela — o **aporte**:

- a **receita** do perfil empresarial;
- a **transferência** que chega a um perfil empresarial **vinda de outro perfil** (o Pix da conta pessoal para a da empresa).

Regra 14. Na transferência, a linha é do perfil de **origem**, mas o sócio é do perfil de **destino** — é lá que o aporte conta. A transferência entre contas do mesmo perfil não traz dinheiro novo e não é aporte.

Regra 15. Qualquer outro lançamento recusa sócio **novo** com `partner-requires-contribution`; a entrada num perfil pessoal recusa com `partner-requires-business-profile`; sócio de outro perfil, com `reference-outside-profile`. Vale para criar, editar, séries e `transactions.setPartner`.

Regra 16. A **despesa com sócio já gravada** (de antes de o modelo ser de aportes) fica como está: não conta como aporte e **mantém o sócio na edição** enquanto perfil, sócio e conta de destino não mudam. Editar o valor não pode exigir apagar o histórico; mas levar a transferência para outro perfil de destino muda de quem é o sócio, e aí a regra 15 volta a valer.

Regra 17. Entradas **sem sócio** são legítimas: a receita de serviço é lucro, não aporte, e fica fora da divisão do relatório.

Onde mora: `assertPartner` e `contributionProfile` em [`TransactionComposer.ts`](../../../packages/core/src/services/transaction/TransactionComposer.ts); no formulário, `contributionProfileId` e `partnerOf` em [`transactionForm.ts`](../../../packages/client/src/forms/transactionForm.ts), pela mesma regra, para que o campo "Sócio que aportou" só apareça onde a gravação o aceita — com os sócios do perfil de destino ("Sócio que aportou em Estúdio GO"). Testes: [`reports.partner.test.ts`](../../../packages/core/test/services/reports.partner.test.ts) ("despesa, investimento e transferência interna recusam sócio novo"), [`transactionForm.test.ts`](../../../packages/client/test/transactionForm.test.ts). Ver [decisões](../decisoes.md) ([ADR 78](../decisoes.md#adr-78)).

### 2.2 Atribuir só o sócio (`transactions.setPartner`)

Regra 18. `transactions.setPartner` troca **só** o sócio de um lançamento (ou o tira, com `null`), sem reconferir o resto — como `setPaid`. Numa série, as outras ocorrências continuam como estavam: quem aportou é um fato de cada mês. O sócio não muda saldo, então não há recálculo. É o que a tela do relatório por sócio usa para atribuir as entradas sem sócio.

Onde mora: `TransactionService.setPartner` em [`TransactionService.ts`](../../../packages/core/src/services/transaction/TransactionService.ts).

### 2.3 Remover sócio

Regra 19. Remover um sócio (soft delete, por ausência na lista do `partners.save`) deixa os lançamentos e os modelos de recorrência vinculados a ele **sem sócio atribuído**, e eles continuam existindo. O vínculo é **apagado** (`partner_id = NULL`), e não só ignorado pelo relatório, para que editar um desses lançamentos não esbarre num sócio que não existe mais, e para que as próximas ocorrências da série não nasçam com ele. Ver [decisões](../decisoes.md) ([ADR 77](../decisoes.md#adr-77)).

Regra 20. A tela avisa, antes de salvar, quantos lançamentos ficam sem sócio (a partir do `transactionCount` de `partners.list`).

Onde mora: `softDelete` em [`SqlitePartnerRepository.ts`](../../../packages/core/src/infrastructure/sqlite/SqlitePartnerRepository.ts). Teste: [`partners.test.ts`](../../../packages/core/test/services/partners.test.ts) ("remover o sócio deixa os aportes e a série dele sem sócio, e eles continuam existindo").

## 3. Distribuição e equilíbrio

O relatório por sócio divide o **total de aportes de todos os períodos** pela participação e mostra, para cada sócio, quanto aportou, quanto deveria ter aportado e a diferença, além do acerto que zera as diferenças e da cobertura do saldo previsto negativo. Tudo isso é regra de [Relatórios](relatorios.md). O que ele pressupõe deste cadastro:

- as participações somam 100% (regra 6); se não somarem — possível depois de uma sincronização, ver §5 —, o relatório mostra o aviso e não monta o acerto;
- só aportes têm sócio (regra 13), e as entradas sem sócio ficam fora da divisão (regra 17);
- a ordem dos sócios é `byLargestShare` (regra 12).

A tela de cadastro não mostra valores: "Aportou" e "Deveria ter aportado" ficam só no relatório por sócio (`reports.byPartner`), que tem o link "Editar sócios e participações" para o cadastro.

## 4. Telas

### 4.1 Desktop

`/partners` ([`PartnersScreen.tsx`](../../../apps/desktop/src/renderer/src/partners/PartnersScreen.tsx)), também aberta por "Editar sócios e participações" no relatório por sócio: a divisão com a soma ao vivo e a barra, as linhas com nome, participação e remover, o aviso da soma, o aviso dos lançamentos que ficam sem sócio, e "Salvar" só com 100%.

### 4.2 Celular

`/more/partners` ([`PartnersScreen.tsx`](../../../apps/mobile/src/screens/PartnersScreen.tsx)), na linha própria de Cadastros só no perfil empresarial: as mesmas peças, "Nome do novo sócio" com "Adicionar" (o sócio entra com 0%), "Salvar" só com 100% e "Descartar alterações".

### 4.3 View-model compartilhado

Toda a regra da tela e as frases são do `client` (`buildPartnerRosterView` em [`partnerRoster.ts`](../../../packages/client/src/viewModels/partnerRoster.ts)), as mesmas no desktop e no celular: a soma ao vivo, a barra, os erros por linha, `canSave` (alterado, válido e com 100% ou lista vazia) e as cores. A cor de cada sócio (quatro, dos tokens) **não muda** quando outro sai. O `client` reexporta o `PARTNER_NAME_MAX_LENGTH` do núcleo, porque as telas do celular não importam valores do núcleo. Testes: [`partnerRoster.test.ts`](../../../packages/client/test/partnerRoster.test.ts), [`apps/mobile/test/partners.test.tsx`](../../../apps/mobile/test/partners.test.tsx), [`e2e/partners.spec.ts`](../../../apps/desktop/e2e/partners.spec.ts).

## 5. Limitações conhecidas

- A soma de 100% é conferida só na gravação local. A sincronização mescla `partners` linha a linha, sem essa regra entre linhas: edições concorrentes em dois aparelhos podem deixar as participações fora de 100% até alguém salvar o cadastro de novo. O relatório tolera (mostra o aviso), mas nenhuma verificação de integridade aponta o caso. Ver [Sincronização](../arquitetura/sincronizacao.md).
- A participação não tem histórico: mudar a participação muda a divisão de todos os períodos (regra 5).
