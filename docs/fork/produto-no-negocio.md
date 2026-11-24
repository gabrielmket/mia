# O produto ou serviço no negócio (.109)

> FORK MIA. Especificação: o protótipo aprovado "Tratamento no negócio" (6 telas), fora do
> repositório. Exemplos aqui com dado fictício (Clínica Sorriso Exemplo).

## 1. O caso

O negócio não dizia o que foi vendido. O valor era um número digitado, o cartão do quadro
mostrava só esse número, e o relatório de vendas não respondia "o que vendemos este mês" nem
"quanto tempo cada coisa leva para fechar". Os relatórios montados já tinham "Produto" para
agrupar negócios, mas só enxergavam o que tinha vindo de uma Proposta.

Agora cada negócio tem a sua lista de itens, escolhidos no catálogo de Produtos que a empresa
já cadastra (o mesmo que a Proposta usa), com quantidade e desconto, e o valor do negócio nasce
da soma.

## 2. As regras (tela 6 do protótipo)

1. **O preço entra congelado** no dia em que o item é adicionado: o item guarda o preço, o nome e
   o código do catálogo daquele dia (`mia_itens_do_negocio`). Mudar o catálogo depois não mexe em
   negócio nenhum, aberto ou fechado. Apagar o produto solta a referência e o item fica com o que
   tinha.
2. **O valor do negócio é a soma dos itens**, a não ser que alguém digite o valor à mão. Aí ele
   para de somar até alguém clicar "Usar a soma" (ou "Voltar a somar", sem item).
3. **Negócios antigos não são tocados nem adivinhados.** `crm_leads.valor_a_mao` nasce NULO em
   todo negócio que já existia; a tela lê esse nulo como "negócio de antes dos itens" e mostra o
   valor que ele tinha, à mão, com a frase própria. Só abrir e salvar sem mexer no bloco não grava
   nada.
4. **Os itens da Proposta** aparecem no mesmo bloco, com o número da proposta, e só mudam pela
   própria proposta (o link leva a ela). São os da proposta mais recente que saiu (enviada,
   aceita, recusada ou vencida; rascunho não saiu, cancelada e substituída deixaram de valer).
   Eles entram na soma.
5. **Funis existentes nascem com "pedir" desligado e "valor recorrente" ligado**: as duas chaves
   ficam ausentes do `settings` e a ausência é o comportamento de antes.
6. **A comanda do ganho**, onde está ligada, abre com uma linha por item.
7. **Os relatórios montados** agrupam por produto também o negócio sem proposta.

### 2.1 Quando o valor é "à mão"

`estadoDoValor` (`lib/produto-no-negocio/regras.ts`): é à mão quando `valor_a_mao` é verdadeiro
**ou** quando o valor gravado não é a soma dos itens. A segunda metade cobre todo caminho que grava
`value_cents` sem passar pelo bloco (o painel do negócio no Inbox, a REST, o `crm_update_lead` do
MCP, a importação): para o negócio isso é "alguém digitou o valor". A marca sozinha não bastaria
por isso; a divergência sozinha falharia quando alguém digita, à mão, exatamente a soma e depois
muda um item.

### 2.2 Quem grava o valor

Só a rota dos itens (`PUT /api/v1/leads/[id]/itens`), na mesma escrita da lista: a soma (com os
itens da proposta) no modo soma, o digitado no modo à mão. O formulário do negócio grava os itens
ANTES do PATCH de sempre e tira `value_cents` do PATCH.

Depois que a proposta é enviada (a rota do upstream troca o valor pelo total dela),
`recalcularValorDoNegocio` devolve o valor à soma (os do bloco e os da proposta) e desliga a marca
de "à mão": a proposta enviada troca o valor do negócio, como sempre trocou, e o bloco entra na
conta. O negócio de antes dos itens (marca nula) não é tocado.

### 2.3 As vendas registradas do upstream (fusão v1.124)

A v1.124 trouxe "Registrar venda" (o "+" ao lado do Valor e no cartão do funil, tabela
`vendas_registradas`, 9449) e o painel Análise › Vendas. A 9450 dele grava
`crm_leads.value_cents` = soma das vendas a cada venda, guarda o valor anterior em
`valor_digitado_cents` e liga `valor_pelas_vendas`; a tela dele trava o campo Valor quando há
venda. Sem nada, o gatilho dele e a rota dos itens escreveriam a mesma coluna e venceria o último.

A regra da fusão (MIA-127) é **nada muda para quem já usa itens**:

- **Negócio com item do bloco:** o Valor continua sendo a soma dos itens (ou o digitado à mão). A
  venda registrada entra e conta no painel de vendas dele, mas não troca o Valor. O "+" continua
  ao lado do Valor.
- **Negócio sem item do bloco:** vale o upstream inteiro (o Valor é a soma das vendas, em leitura).
  Item de proposta não conta como item do bloco: o valor da proposta é do upstream, como antes.

Como (9167, só objetos nossos): a invariante é "negócio com item do bloco nunca fica com
`valor_pelas_vendas` ligado".

1. `trg_mia_valor_do_negocio_segue_os_itens` (`before update of value_cents, valor_pelas_vendas`
   em `crm_leads`): com item do bloco, a escrita que liga a marca das vendas é desfeita (o valor
   volta, a marca desliga, o digitado zera). Pega o gatilho da 9450 e a auto-cura dela, que roda de
   novo a cada reaplicação do `baseline.sql`.
2. `trg_mia_item_do_negocio_tira_a_marca_das_vendas` (`after insert` em `mia_itens_do_negocio`): o
   primeiro item num negócio que já tinha venda desliga a marca; a rota grava o valor dos itens logo
   depois.
3. `fn_mia_valor_do_negocio_volta_as_vendas`: a rota dos itens chama quando o negócio fica sem
   item, inclusive quando o último item sai e o valor e a marca não mudam (Valor à mão igual ao de
   antes); com venda, regrava as vendas com o mesmo valor e o gatilho dele soma de novo.

Cerca no Postgres de verdade: `tests/invariants/valor-do-negocio-segue-os-itens.test.ts` (item e
depois venda, venda e depois item, item de proposta, último item sai, a cura e a auto-cura da 9450
reaplicada).

Na tela, `valorSegueAsVendas` (`lib/produto-no-negocio/regras.ts`) é a mesma régua: o
`LeadFieldsForm` e o painel do Inbox só mostram "Soma de N venda(s) registrada(s)" em negócio sem
item. **Decisão para o Gabriel** (PR da fusão v1.123 a v1.124): manter assim (recomendado), ou
fazer a venda registrada mandar no Valor também com item.

## 3. As telas

| tela do protótipo | onde | arquivo |
|---|---|---|
| 1 · cartão no quadro | a linha do item acima do valor; "Sem <produto>" apagado; a etiqueta "proposta"; o nome inteiro no `title` e no cabeçalho do cartão aberto | `components/produto-no-negocio/LinhaDoProduto.tsx` |
| 2 · Editar negócio | o bloco (busca no catálogo, quantidade, desconto, subtotal, soma), o campo Valor que soma, o aviso do valor recorrente | `BlocoDeItens.tsx`, `CampoDoValor.tsx`, no `LeadFieldsForm` (Editar e o cartão aberto) |
| 3 · Marcar como ganho | a janela nova, no menu e ao arrastar até a etapa de ganho | `JanelaDoGanho.tsx` |
| 4 · Editar funil | o campo "Produto ou serviço" do vocabulário e o quadro "O que o negócio vendeu" | `OpcoesDoFunil.tsx`, no editor de `settings/tenant/pipelines` |
| 5 · Relatório de vendas | "<Produtos> vendidos no mês", "Tempo até fechar por <produto>" e o cartão "<Produtos> vendidos" | `QuadrosDoRelatorio.tsx`, em `components/metas/RelatorioDeVendas.tsx` |

### 3.1 A janela de ganho

O botão "Marcar como ganho" fechava direto; o arrasto até a etapa de ganho também. Os dois
(e o "Mover para…" e a barra de etapas do cartão aberto, que vão pelo mesmo caminho do arrasto,
e o botão "Ganho" do cabeçalho do cartão aberto) abrem a janela, com os itens do negócio já preenchidos, o valor e o motivo do ganho (lista do
funil, ou texto livre sem lista; "(opcional)" sai quando o funil exige o motivo). Confirmar grava
os itens e o valor e só então faz o ganho pelo caminho de sempre (`/win` no menu, `/move` no
arrasto, este com o `updated_at` novo do negócio, para a conferência de concorrência do move não
recusar).

Com "Pedir o <produto> ao marcar como ganho" ligado, a janela só confirma com pelo menos um item
(do bloco ou da proposta). No servidor, `/win` e `/move` (até a etapa de ganho) recusam com 422
`produto_exigido_no_ganho` o negócio sem item: é o que segura quem chega por fora da janela (a
REST, o mover em lote). A IA e as automações fecham por `encerraDemanda` direto e **não** passam
por esta regra.

### 3.2 A palavra

`vocabulary.produto` do funil ("Tratamento", "Produto", "Serviço"). Em branco, vale o padrão do
sistema, "Produto ou serviço" (que se traduz; a palavra do cliente não). O plural segue a régua do
protótipo (`pluralDaPalavra`): palavra terminada em "el", "il" ou "ol" sai errada ("Imóvels"), a
mesma limitação aprovada. A frase não flexiona gênero ("Nenhum peça").

## 4. As três decisões aprovadas

1. **Vocabulário:** o padrão é "Produto ou serviço" e cada funil troca a palavra. A implantação
   preenche pelo segmento (`plataforma_garantir_palavra_do_segmento`): clínica, Tratamento; loja,
   Produto; escritório, Serviço. Na clínica, o funil cujo negócio já se chama "Tratamento" passa a
   chamá-lo "Plano de tratamento".
2. **Tipo de receita:** "Mostrar valor recorrente" desligado esconde também o Tipo de receita, e o
   funil conta como avulso nas metas e no relatório de vendas (`contarComoAvulso`,
   `lib/produto-no-negocio/metas.ts`): o valor único vai inteiro para o avulso e o que tiver ficado
   no recorrente não entra (o negócio que tem valor ali mostra o aviso para corrigir). Nada é
   regravado.
3. **Só do catálogo:** no negócio não há item digitado à mão; produto novo se cadastra em Produtos.
   A busca do bloco mostra só o que está ativo e na moeda do negócio, e a rota recusa o resto.

## 5. O relatório

As vendas dos dois quadros são as da Receita do mês (ganhas no mês, nos funis em que vencer é
receita). O quadro dos vendidos fecha com a receita: além das linhas dos produtos, "Sem <produto>"
(negócio sem item), "Ajuste do valor digitado à mão" (o que o negócio fechou acima ou abaixo da
soma) e "Valor recorrente (mensal)" (a mensalidade, que a receita soma e não é item). O item de
proposta digitado à mão (a Proposta aceita) agrupa pelo texto; o do catálogo, pelo nome de hoje.

O tempo até fechar é a conta do Ciclo de venda (do nascimento ao fechamento), com mediana e média;
com menos de 3 vendas no mês a linha avisa que é pouco para tirar conclusão.

## 6. A comanda do ganho

`linhasDaComanda` (`lib/produto-no-negocio/comanda.ts`): uma linha por item (nome, quantidade,
preço congelado, desconto). O total continua sendo o valor do negócio: valor à mão acima da soma
ganha uma linha "Ajuste do valor digitado à mão"; abaixo, o que falta vira desconto nas linhas, da
última para a primeira, sem nenhuma ficar negativa (`sale_items` não aceita preço negativo). Sem
item, ou se a leitura falhar, a linha única de sempre. As linhas entram num INSERT só, o que mantém
a regra da repetição do upstream (comanda com algum item já está completa).

## 7. O MCP de plataforma

- `plataforma_configurar_produto_no_negocio` (`implantar_configuracao`): a palavra de um funil e as
  duas opções, pela mesma porta da tela (`gravarConfiguracaoDoFunil`).
- `plataforma_garantir_palavra_do_segmento` (`implantar_configuracao`): a palavra do segmento nos
  funis ativos, sem atropelar palavra já escolhida (a não ser com `sobrescrever`).
- `plataforma_ver_funis` passa a trazer `produto_no_negocio` em cada funil, e
  `plataforma_garantir_funil` aceita `vocabulario.produto`, `pedir_produto_no_ganho` e
  `mostrar_valor_recorrente`.

A lista vai de 115 para 117 ferramentas.

## 8. O banco

- **9160** `mia_itens_do_negocio` (preço, nome e código congelados; quantidade de 1 a 99; desconto
  que não passa do item; um produto por negócio; a empresa do item é a do negócio e a do produto,
  pelo gatilho `fn_mia_item_do_negocio_coerente`, nosso). RLS: toda a equipe da empresa lê, só o
  servidor escreve. E `crm_leads.valor_a_mao` (acrescentada sem default, depois com default falso:
  os que existiam ficam nulos).
- **9161** `fn_mia_relatorio_linhas` (nossa, 9030/9041/9046) redefinida com o corpo da 9046: a
  dimensão `produto` da fonte `negocios` junta os itens da proposta e os do próprio negócio.
- **9167** (fusão v1.124) as vendas registradas do upstream não trocam o valor do negócio com item
  (seção 2.3): dois gatilhos e uma função, todos nossos.
- Carimbo: o da migration mais nova do fork (`lib/schema/carimbo.ts`).

**LGPD.** `mia_itens_do_negocio` não tem `contact_id` nem texto da pessoa: guarda nome e preço de
produto do catálogo, quantidades e ids (o mesmo molde de `crm_proposal_items`, que fica fora da
cascata e do pacote do titular). A pessoa chega pelo negócio, que a cascata já anonimiza; depois
dela, o item não aponta para ninguém. Decisão: **manter**, sem entrar na cascata nem no relatório
de acesso. Se o catálogo de FKs para `contacts`
(`lgpd-redact-unificado-alcanca-pelo-catalogo`) passar a cobrar também as tabelas que chegam pelo
negócio, a razão é esta.

## 9. Testes

- `tests/unit/produto-no-negocio-regras.test.ts`: a soma, o valor à mão, o preço congelado no
  rascunho, a regra do ganho com "pedir" ligado e desligado, o arrasto até a etapa de ganho, a
  linha do cartão, a palavra do funil e do segmento, e o funil sem recorrente nas metas.
- `tests/unit/produto-no-negocio-relatorio.test.ts`: os dois quadros (mediana, média e o aviso com
  menos de 3 vendas; o total igual à receita) e as linhas da comanda.
- `tests/unit/produto-no-negocio-servidor.test.ts`: a gravação (preço do catálogo congelado, a soma,
  o valor à mão, as recusas), os itens da proposta no bloco, o recálculo depois do envio, a recusa
  do ganho sem item e as linhas da comanda, num banco em memória.
- `tests/unit/mcp-de-implantacao-produto-no-negocio.test.ts`: as duas ferramentas e a leitura dos
  funis; as contagens dos outros testes do MCP vão a 117.
- `tests/invariants/produto-no-negocio.test.ts` e a tabela em `rls-tabelas-da-mia.test.ts` e
  `rls-completude-varredura.test.ts`.
- `tests/e2e/itens-do-negocio.spec.ts` (parte 3 do e2e), pela tela e conferindo no banco:
  em Editar negócio, a busca no catálogo, a quantidade, o desconto e a soma que vira o valor;
  o preço congelado quando o catálogo muda; o valor digitado à mão que para de somar; tirar
  um item e "Usar a soma". Na janela de ganho, com "pedir" ligado, o `/win` sem item
  recusado com 422 e a janela que só confirma com item (e grava item, valor e motivo); com
  "pedir" desligado (a chave ausente), o fechamento sem item e o negócio de antes dos itens
  fechado sem nada regravado. Ficam de fora o mover em lote e o Novo negócio (seção 11).

## 10. Pontos de ligação no código do upstream

Todos com o comentário `FORK MIA (.109)`:

- `components/kanban/LeadFieldsForm.tsx`: o bloco, o campo Valor, o Tipo de receita e o par do
  recorrente conforme a opção, o aviso do recorrente, e a gravação dos itens antes do PATCH;
- `components/kanban/NewLeadDialog.tsx`: o par do recorrente conforme a opção;
- `components/kanban/KanbanCard.tsx`: a linha do item e o recorrente conforme a opção;
- `components/kanban/KanbanCardActions.tsx`: "Marcar como ganho" abre a janela;
- `components/kanban/KanbanBoard.tsx`: a janela no arrasto até a etapa de ganho e o funil no
  contexto do cartão;
- `hooks/kanban/useUpdateLead.ts`: o motivo do ganho no `useWinLead`;
- `app/app/settings/tenant/pipelines/_client.tsx`: a palavra, o quadro das duas opções e a frase da
  comanda;
- `lib/schemas/settings.ts`: `vocabulary.produto`, `pedir_produto_no_ganho` e
  `mostrar_valor_recorrente`;
- `app/api/v1/leads/[id]/win/route.ts` e `app/api/v1/leads/[id]/move/route.ts`: a recusa do ganho
  sem item com a opção ligada;
- `app/api/v1/proposals/[id]/send/route.ts`: o recálculo do valor depois do envio;
- `lib/financeiro/comanda-do-ganho.ts` e `comanda-do-ganho.handler.ts`: as linhas por item;
- `lib/i18n/dicionario.ts` e `lib/audit/actions.ts`: o dicionário nosso e as três ações;
- `FORK MIA (fusão v1.124)`: `components/kanban/LeadFieldsForm.tsx` (o Valor só segue as vendas sem
  item, e o "+" de registrar venda ao lado do nosso campo) e `components/inbox/CRMSidePanel.tsx` (a
  mesma régua no Valor do Inbox).

Do fork: `lib/pipelines/pipeline-config.ts`, `lib/cartoes/` (`tipos.ts`, `sinais-do-quadro.ts`),
`components/cartoes/` (`ContextoDoCartao.tsx`; `aberto/CartaoAberto.tsx`: os itens por extenso no cabeçalho e o botão "Ganho" abrindo a janela),
`app/api/v1/relatorio-de-vendas/route.ts`, `hooks/useRelatorioDeVendas.ts`,
`components/metas/RelatorioDeVendas.tsx`, `lib/crm/metas/ler-do-mes.ts`, `lib/implantacao/funil.ts`
e `lib/mcp-plataforma/` (`ferramentas.ts`, `operacoes.ts`, `ferramentas/funil.ts`,
`ferramentas/leituras.ts`).

Arquivos nossos: `lib/produto-no-negocio/` (`regras.ts`, `funil.ts`, `rascunho.ts`, `relatorio.ts`,
`comanda.ts`, `metas.ts`, `quadro.ts`, `servidor.ts`), `components/produto-no-negocio/`,
`hooks/produto-no-negocio/`, `app/api/v1/leads/[id]/itens/`,
`app/api/v1/pipelines/[id]/produto-no-negocio/`, `lib/mcp-plataforma/ferramentas/produto-no-negocio.ts`,
`lib/i18n/dicionario-mia-produto-no-negocio.ts`, as migrations 9160 e 9161 e os testes acima.

## 11. O que ficou de fora

- O mover em lote até a etapa de ganho não abre a janela: com "pedir" ligado, o servidor recusa o
  negócio sem item e a barra mostra o erro.
- A IA e as automações que fecham negócio como ganho não passam pela regra de "pedir".
- Novo negócio não tem o bloco (o protótipo não o mostra): os itens entram em Editar negócio ou na
  janela de ganho.
- Copiar os itens na retomada ou ao levar o negócio para outro funil.
- Os itens do negócio no relatório de acesso do titular (ver a decisão de LGPD acima).
- Os segmentos além de clínica, loja e escritório. Das demonstrações, só a da clínica odontológica
  ganhou a palavra ("Tratamento", com o negócio "Plano de tratamento", `lib/demonstracao/semente/segmentos/clinica-odonto.ts`);
  as outras seguem com o padrão do sistema até alguém escolher.
