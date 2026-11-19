# Wiki técnica do Finanças

Documentação para desenvolvedores do Finanças, um sistema de finanças pessoais local-first:
núcleo TypeScript compartilhado, app desktop em Electron, app Android em Expo e sincronização
par a par na rede local. A wiki descreve o sistema **como ele está hoje no código**. Quando
código e wiki divergirem, vale o código, e a wiki deve ser corrigida na mesma entrega.

Para instalar e compilar, veja o [README da raiz](../../README.md).

## Por onde começar

1. [Visão geral](arquitetura/visao-geral.md): o que o sistema é, os pacotes e o modelo de domínio.
2. [Mapa do sistema](mapa-do-sistema.md): como os pacotes e módulos se relacionam e onde mexer
   para cada tipo de mudança.
3. [Núcleo](arquitetura/core.md): as camadas onde mora toda a regra de negócio.
4. A página de regras de negócio do domínio em que você vai trabalhar.

## Arquitetura

| Página | Assunto |
|---|---|
| [Visão geral](arquitetura/visao-geral.md) | objetivos, fora do escopo, pacotes do monorepo, camadas em alto nível, domínio resumido |
| [Núcleo](arquitetura/core.md) | `packages/core`: Request → Controller → Service → Repository → Model, rotas, portas, `createCore`, Value Objects |
| [Banco de dados](arquitetura/banco-de-dados.md) | SQLite, convenções, cada tabela, migrations, adaptadores `sqlite-better` e `sqlite-expo` |
| [Sincronização](arquitetura/sincronizacao.md) | replicação por célula com HLC, pareamento, Noise na rede local, peças por plataforma |
| [Desktop](arquitetura/desktop.md) | processos do Electron, segurança, `packages/client`, tokens, convenções de UI, empacotamento |
| [Mobile](arquitetura/mobile.md) | Expo, núcleo no Hermes, NativeWind, arquivo do banco no celular, distribuição por APK |
| [Testes](arquitetura/testes.md) | estratégia, SQLite real, propriedades, paridade entre runtimes, desempenho |

## Referência

| Página | Assunto |
|---|---|
| [Tecnologias](tecnologias.md) | stack e cada dependência por pacote: para que serve e por que ela |
| [Mapa do sistema](mapa-do-sistema.md) | grafo de pacotes, caminho de uma chamada, módulos do domínio, "quero mudar X → mexo em Y" |
| [Decisões](decisoes.md) | registros de decisão (ADRs): contexto, escolha, alternativas descartadas, consequências |
| [Glossário](glossario.md) | termos do domínio e da arquitetura, com o identificador no código |

## Regras de negócio

| Página | Assunto |
|---|---|
| [Perfis](regras-de-negocio/perfis.md) | perfil como tenant, moeda, conta e cartão padrão, primeiro uso, regras comuns aos cadastros |
| [Contas](regras-de-negocio/contas.md) | contas, extrato, saldos consolidado e previsto, transferências, desativar e excluir |
| [Cartões e faturas](regras-de-negocio/cartoes-e-faturas.md) | ciclo, fatura sugerida, pagamento total e parcial, limite usado, linha da fatura |
| [Transações](regras-de-negocio/transacoes.md) | tipos, pago e data de pagamento, vínculos, formulário, mover de perfil, exclusão, lista do mês |
| [Recorrências](regras-de-negocio/recorrencias.md) | parcelamentos e fixas, identidade das ocorrências, edição e exclusão com escopo |
| [Metas](regras-de-negocio/metas.md) | tipos de meta, vínculo e retirada, progresso e ritmo, arquivamento |
| [Categorias e tags](regras-de-negocio/categorias-e-tags.md) | árvore de categorias, tags, desativar × arquivar × excluir, colisões de nome |
| [Sócios](regras-de-negocio/socios.md) | participações que somam 100%, sócio nos aportes |
| [Anotações](regras-de-negocio/anotacoes.md) | anotações livres do perfil |
| [Visão do mês](regras-de-negocio/visao-do-mes.md) | Visão geral do desktop e Início do celular, saldos, gastos, atrasados, próximas faturas |
| [Relatórios](regras-de-negocio/relatorios.md) | mês de caixa, relatórios personalizados, distribuição por sócio, projeção de saldo |
| [Importação](regras-de-negocio/importacao.md) | leitura do arquivo, ligação de colunas, regras da importação, prévia e gravação |

## Convenções da wiki

- **Seções numeradas e estáveis.** O código cita a wiki como `<página> §N.N`, pelo nome do
  arquivo sem `.md` (ex.: `banco-de-dados §4.12`, `decisoes §42`). Ao reorganizar uma página,
  preserve a numeração citada ou atualize as citações no mesmo commit; para achá-las,
  `grep -rn "<página> §" packages apps`.
- **Regra de negócio no código cita a seção**, no formato do CLAUDE.md:
  `Regra de negócio (Relatórios, relatorios §2.1): ...`.
- **Estado atual, não histórico.** Nada de fases, planos ou "próximos passos"; o histórico fica
  no git. Pendências reais vão para "Limitações conhecidas" de cada página.
- **O porquê das escolhas** fica em [Decisões](decisoes.md). Uma decisão revista ganha um novo
  ADR, e a antiga recebe o status "substituída por §N" em vez de ser apagada ou renumerada.
- **Migrations** (`db/migrations/*.sql`) ainda citam os documentos de design antigos nos
  comentários. Elas são imutáveis (o `checksums.lock` cobre o arquivo inteiro), então essas
  citações ficam como registro histórico. A seção equivalente está na
  [página do banco](arquitetura/banco-de-dados.md).
- Diagramas em Mermaid; links para código relativos ao arquivo da página.
