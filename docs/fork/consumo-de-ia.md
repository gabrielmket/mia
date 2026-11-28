# O consumo de IA por mês e por agente (MIA-44)

> FORK MIA. Pedido do Gabriel em 17/11/2026: saber, pelo painel, quanto cada cliente gastou de IA
> no mês passado e neste mês, em tokens e em dinheiro, com cada agente separado. Exemplos aqui com
> dado fictício (Academia Alfa, com os agentes Recepção e Vendas).

Esta página cobre a **leitura** (a função, a rota da aba Uso e a ferramenta do MCP, MIA-45) e as
**telas** ("Este mês" e "Mês passado" nas duas telas de uso, a quebra por agente na aba Uso, MIA-46,
seção 7).

## 1. O caso

A aba Uso do cliente (`/admin/tenants/[id]/usage`) só cortava por 7, 30 ou 90 dias corridos, somava
o cliente numa linha só e mostrava só dólar. Não dava para responder "quanto a Academia Alfa gastou
em outubro", nem "quanto disso foi o agente de vendas", nem "quanto foi o sistema" (o resumo depois
de cada conversa, os classificadores, a transcrição), que é custo que não acompanha o número de
agentes.

## 2. As regras

1. **Uma régua só para o custo.** Custo é a soma de `coalesce(llm_calls.cost_cents, 0)`, a mesma
   definição de `fn_gasto_de_ia_do_mes` (migration 0159), que é a régua do teto do orçamento. A soma
   é feita no código, linha a linha: não existe uma segunda soma escrita em SQL (a cerca
   `tests/unit/orcamento-uma-regua-de-gasto.test.ts` impede). Chamada sem preço (`cost_cents` nulo)
   entra como zero, como na função, e é contada à parte em `sem_preco`.
2. **O mês é o de Brasília.** `mes=AAAA-MM` vai de 00:00 do dia 1º a 00:00 do dia 1º do mês seguinte
   no fuso `America/Sao_Paulo` (`janelaDoMes`, `lib/crm/metas/fuso.ts`). Uma chamada às 22h do
   último dia é do mês que termina, embora em UTC já seja o dia 1º do seguinte.
3. **Agente e Sistema.** Chamada com `agent_id` é do agente; sem `agent_id` é da linha **Sistema**.
   Todo agente ativo da empresa aparece, mesmo sem chamada (com zero). O agente arquivado aparece se
   gastou no período. Chamada de agente que não existe mais aparece com `nome: null`.
4. **Tokens.** `tokens_entrada` é `input_tokens` inteiro; `tokens_do_cache` é `cache_read_tokens`,
   que é PARTE da entrada (o preço cobra 10% da tarifa por ele), e não um terceiro tipo a somar.
5. **R$ pela cotação de cada dia.** Cada chamada é convertida pela cotação do dia dela (em Brasília)
   da tabela `platform_fx_rates` (migration 0241), pela regra de `lib/ai/custo/cotacao.ts`: a do dia
   ou a mais recente anterior, nunca uma posterior. Dia com custo e sem cotação nenhuma fica fora do
   real e é listado em `reais.dias_sem_cotacao`. Nada é inventado.
6. **Paginado, e o corte é dito.** A leitura é a de `lib/leitura/todas-as-paginas.ts`, da chamada
   mais nova para a mais antiga, até 100 páginas de 1000. Acima disso sai `truncado: true` (o começo
   do período ficou de fora).
7. **"N dias" são N dias do calendário em Brasília, terminados hoje (MIA-78).** `dias=30` vai de
   00:00 de 29 dias atrás a 00:00 de amanhã, no fuso `America/Sao_Paulo` (`periodoDoPedido`,
   `inicioDoDiaEmBrasilia`). É a régua única de 7, 30 e 90 dias na tela geral (`/admin/usage`), na
   aba Uso do cliente e em `plataforma_ver_consumo_de_ia` (seção 8).

### 2.1 O mês do teto não é o mesmo

O teto do orçamento (`fn_gasto_de_ia_do_mes`) corta o mês pelo `now()` no fuso do banco, que é UTC.
O mês do teto começa às 21h do último dia do mês anterior, no horário de Brasília. Para o mesmo
mês, o número desta leitura e o do teto podem diferir pelas chamadas dessas três horas, nas duas
pontas. **Não foi mudado**: mudar a régua do teto muda o que o cliente recebe, e é decisão do
Gabriel.

## 3. Onde mora

- `lib/ai/usage/consumo-do-periodo.ts`: `periodoDoPedido` (o período de `mes` ou `dias`),
  `lerConsumoDoPeriodo` (a leitura e as somas), `mesAtualEAnterior` (os dois atalhos das telas).
- `lib/ai/usage/contatos-pessoais.ts`: `lerContatosPessoais` e `listaDosPessoais`, a lista dos
  contatos pessoais que as duas rotas tiram das mensagens (MIA-78, seção 8).
- `app/api/v1/admin/tenants/[id]/usage/route.ts`: aceita `mes=AAAA-MM` além de `dias` (`mes` vence;
  fora do formato é 400). Com `mes`, **todos** os números da resposta são do mês (conversas,
  mensagens, IA e mensagens cobradas). Os campos de antes continuam (`dias`, `conversas`,
  `mensagens`, `ia`, `mensagens_cobradas`); entram `mes`, `periodo` e `consumo` (`total`,
  `por_agente`, `sistema`, `por_finalidade`, `reais`, `truncado`, `chamadas_no_banco`).
- `lib/mcp-plataforma/ferramentas/consumo-de-ia.ts`: `plataforma_ver_consumo_de_ia` e, desde a MIA-136,
  `plataforma_ver_ranking_de_consumo_de_ia` (seção 10).
- `lerRankingDoConsumo` e `fecharPeloTotal`, no mesmo `consumo-do-periodo.ts`: a plataforma inteira em
  ordem de custo e a soma que fecha com o total (MIA-136, seção 10).

O bloco `ia` da rota passou a sair da mesma leitura. Antes ele pedia `total_tokens` a `llm_calls`,
coluna que essa tabela não tem (é de `ai_invocations`); `tokens` agora é entrada + saída.

## 4. O MCP de plataforma

`plataforma_ver_consumo_de_ia` (só lê, sem operação): recebe `organization_id`, `mes` (AAAA-MM) e
`dias` (1 a 180, os N dias do calendário em Brasília terminados hoje, MIA-78). `mes` vence `dias`;
sem nenhum dos dois, o mês corrente em Brasília. Devolve a empresa, o mês (`null` em `dias`), os
`dias`, o período (`tipo`, `inicio`, `fim`, `fuso`) e os mesmos blocos de `consumo` da rota, saídos
da mesma função. Cliente que não existe é recusado com o caminho para achar o id
(`plataforma_listar_clientes`). Desde a MIA-99 devolve também `mensagens_cobradas`, o mesmo bloco da aba
Uso (seção 9). Desde a MIA-136, a plataforma inteira está em `plataforma_ver_ranking_de_consumo_de_ia`
(seção 10), e a soma dos agentes com o Sistema fecha com o total.

Exemplo (fictício):

```json
{ "organization_id": "00000000-0000-4000-8000-000000000001", "mes": "2026-10" }
```

## 5. Testes

`tests/unit/consumo-de-ia-por-mes-e-por-agente.test.ts`: mais de 1000 chamadas (paginação) e o
corte acima do teto, agente x Sistema (com agente sem chamada, arquivado e removido), cache, chamada
sem preço, a virada do mês em Brasília com o processo em `TZ=America/Sao_Paulo` e em `TZ=UTC`, a
conversão para R$ (cotação do dia, a anterior, dia sem cotação), a rota com `mes` e o MCP devolvendo
os mesmos números. `tests/unit/painel-de-custo-nao-para-na-linha-1000.test.ts` segue cobrindo a rota
sem `mes`.

## 6. Pontos de ligação no código do upstream

- `app/api/v1/admin/tenants/[id]/usage/route.ts` é do fork (a aba Uso nasceu aqui), e a chamada a
  `lerConsumoDoPeriodo` está marcada `FORK MIA (MIA-44)`.
- `lib/mcp-plataforma/ferramentas.ts`: o import e a linha `...FERRAMENTAS_DE_CONSUMO_DE_IA`.
- Depende de colunas do upstream em `llm_calls`: `agent_id` (0130), `purpose`, `input_tokens`,
  `output_tokens`, `cache_read_tokens`, `cost_cents`. Se o upstream renomear alguma, a leitura falha
  com erro (não vira zero) e o teste da rota fica vermelho.

## 7. As telas (MIA-46)

O custo em dinheiro só aparece no painel da plataforma. A tela de uso do cliente (`/app/ai/usage`)
não mudou.

### 7.1 O seletor de período

As duas telas (`/admin/usage` e a aba Uso do cliente) oferecem 7, 30 e 90 dias, **Este mês** e
**Mês passado**. Os atalhos moram em `lib/ai/usage/atalhos-de-periodo.ts` (`ATALHOS_DE_PERIODO`,
`pedidoDoAtalho`), que só traduz o botão em `dias` ou `mes=AAAA-MM`. Qual é o mês atual e o anterior
sai de `mesAtualEAnterior`; o início e o fim saem de `periodoDoPedido`, na rota. Nenhuma das duas
telas calcula a janela.

### 7.2 `/api/v1/admin/usage?mes=AAAA-MM`

- `mes` vence `range`. Fora do formato é 400, e nada é lido. A resposta ganha `mes` (`null` nas
  janelas de dias).
- A janela é a do mês em Brasília (`periodoDoPedido`). O dia de cada linha, nas séries e na conversão
  para R$, passa a ser o de Brasília (`diaEmBrasilia`), e a série vai do dia 1 ao último dia do mês,
  inclusive os dias que ainda não chegaram em "Este mês" (com zero).
- A fatura do provedor (`platform_openai_spend`) e as cotações (`platform_fx_rates`) passam a ter
  também o limite de cima (o último dia do período): sem isso, a fatura do mês passado somava os
  dias deste mês.
- Sem `mes`, as janelas de 7, 30 e 90 dias também saem de `periodoDoPedido`, em dias de Brasília
  (MIA-78, seção 8). Até a MIA-78 eram dias de calendário UTC.
- O nome do CSV leva o mês (`usage-2026-10.csv`).

### 7.3 A aba Uso do cliente

`components/admin/tenants/UsoDoTenant.tsx`, com o mesmo `Card` e o mesmo estilo de tabela da
`UsageTable` (não é layout novo, decisão do Chefe na MIA-46):

- O card **Custo de IA** mostra o real ao lado do dólar (`consumo.total.custo_brl`). Dia com custo e
  sem cotação: "O valor em R$ é parcial: dias sem cotação: N".
- **Custo de IA por agente**: uma linha por agente (agente removido aparece como "Agente removido";
  arquivado leva o selo), a linha **Sistema** e o **Total**. Colunas: chamadas, tokens (entrada +
  saída), do cache (parte da entrada), US$ e R$. Chamada sem preço é dita abaixo do US$.
- **Custo de IA por finalidade**: o código de `llm_calls.purpose` (`agent_turn`, `checkpoint`...),
  com as mesmas colunas.

Os textos novos em espanhol moram em `lib/i18n/dicionario-mia-consumo-de-ia.ts`; em inglês, turco e
chinês, em `lib/i18n/traducoes/*.json`.

### 7.4 Testes e prova pela tela

- `tests/unit/consumo-de-ia-telas-este-mes-e-mes-passado.test.tsx`: os atalhos (o mês de Brasília
  na virada, dezembro do ano anterior em janeiro), a rota geral com `mes` (janela, série de 31 dias,
  fatura sem os dias do mês seguinte, R$ pela cotação de cada dia, 400 no formato errado, as janelas
  de dias sem mudança) e a aba Uso (o botão do mês pede `mes`, R$ no card, as linhas de cada agente,
  do Sistema e das finalidades).
- `tests/e2e/admin-consumo-de-ia-por-mes-e-por-agente.spec.ts`: a Academia Alfa (fictícia) com 2
  agentes e chamadas de sistema neste mês e no mês passado, vista nas duas telas, em "Este mês" e
  "Mês passado". As capturas saem no artefato de evidência da CI.

## 8. As duas telas dão o mesmo número (MIA-78)

Para o mesmo cliente e o mesmo período, a tela geral (`/admin/usage`, `GET /api/v1/admin/usage`) e a
aba Uso do cliente (`GET /api/v1/admin/tenants/[id]/usage`) davam números diferentes, e a aba Uso
mostrava zero quando uma leitura falhava. Três correções, achadas no levantamento da MIA-70 (mapa
da MIA-54, seção 2.1):

### 8.1 A régua dos "N dias"

**N dias são os N dias do calendário em Brasília terminados hoje, hoje incluído**: de 00:00 de
(hoje − N + 1) a 00:00 de amanhã, no fuso `America/Sao_Paulo`. Exemplo: em 18/11/2026, às 9h de
Brasília, "30 dias" vai de 20/10 00:00 a 19/11 00:00 de Brasília (`2026-10-20T03:00Z` a
`2026-11-19T03:00Z`).

Antes eram duas réguas: a tela geral lia N dias de calendário UTC até o fim de hoje; a aba Uso e o
MCP liam N×24 h corridas até agora. Uma chamada às 22h de Brasília do primeiro dia entrava numa e não
na outra. A régua mora em `periodoDoPedido` (`lib/ai/usage/consumo-do-periodo.ts`), e as três
leituras a chamam; nenhuma calcula a janela.

Por que o dia de Brasília, e não as N×24 h que a aba Uso usava:

- o mês desta leitura já é o de Brasília (regra 2): o mês passa a ser exatamente a soma dos dias
  dele, na mesma régua;
- a série diária da tela geral fica com N barras inteiras, cada uma um dia de Brasília (com N×24 h,
  a primeira e a última barra seriam pedaços de dia, e seriam N+1);
- o número de um dia que já passou não muda conforme a hora em que se abre a tela.

O que muda para quem lê: a tela geral, nos 7/30/90 dias, conta e rotula os dias por Brasília, e
não mais por UTC (a diferença são as chamadas das 21h à meia-noite de Brasília nas duas pontas); a
aba Uso e o MCP, em `dias`, passam a começar à meia-noite de Brasília do primeiro dia, em vez de
N×24 h antes de agora. O desenho das telas não mudou.

### 8.2 Contato pessoal fica fora nas duas

Pessoal não soma (spec 21, caminho 10). A tela geral já tirava as mensagens dos contatos pessoais
(`contacts.is_personal`); a aba Uso não, e a Academia Alfa com a Ana Exemplo marcada pessoal dava N
mensagens numa e N + as da Ana na outra. As duas leem a lista em `lerContatosPessoais`
(`lib/ai/usage/contatos-pessoais.ts`) e aplicam o mesmo filtro (`contact_id not in (...)`).

Só a contagem de mensagens tira os pessoais, como na tela geral. As conversas e as mensagens
**cobradas** pela Meta não: a cobrança da Meta acontece com ou sem pessoal.

A lista vai na URL do PostgREST e por isso tem teto: 2 páginas de 1000 (o `limit(2000)` de antes
nunca trazia mais de 1000, porque o PostgREST corta toda resposta em 1000 sem avisar). Passou do teto,
as duas rotas respondem `pessoais_truncado: true`: há pessoais fora da lista, e as mensagens deles
estão contadas. As telas ainda não mostram esse aviso (mostrar seria mudar o desenho, fora da
MIA-78); o MCP e quem lê a resposta veem.

### 8.3 Leitura que falha é erro

Na aba Uso, a contagem de conversas, a de mensagens e os preços da Meta (`platform_precos_meta`; desde a
MIA-99, o histórico `mia_precos_meta_vigencias`, seção 9) não eram conferidos: a contagem que falhava saía 0, e o preço que não vinha saía custo de mensagem
R$ 0,00. Agora qualquer uma delas que falha responde 500 `db_error`, como a leitura do consumo de IA
e a das mensagens cobradas já faziam. A lista dos pessoais também: na aba Uso e na tela geral, falha
nela é 500, e não "nenhum pessoal" contando as mensagens deles.

### 8.4 Testes

`tests/unit/consumo-de-ia-as-duas-telas-dao-o-mesmo-numero.test.ts`, com a Academia Alfa e a Ana
Exemplo (fictícias): o mesmo número de mensagens nas duas telas com e sem pessoal, os 30 dias com o
mesmo início, fim e chamadas na tela geral, na aba Uso e no MCP (com as pontas de Brasília), cada
leitura que falha virando 500, e o `pessoais_truncado` acima de 2000. O caso "limites" de
`app/api/v1/admin/usage/route.test.ts` passou para os dias de Brasília.

## 9. O preço da Meta tem vigência, e o mês fechado não muda (MIA-99)

Defeito 4 da seção 2.1 do mapa (MIA-54, levantamento da MIA-70). `platform_precos_meta` (0259) guardava
só o preço atual de cada categoria, e a aba Uso e a tela do custo da Meta multiplicavam as mensagens do
mês pedido por ele. A Academia Alfa (fictícia) com 100 mensagens de marketing cobradas em outubro a
R$ 0,35 dava R$ 35,00; o preço ia a R$ 0,50 em novembro e outubro passava a R$ 50,00.

### 9.1 A regra

**Cada mensagem cobrada custa o preço que valia no instante dela**: o da vigência com
`vigente_desde <= created_at < vigente_ate`. O período continua o de Brasília (seção 2, regra 2, e
MIA-78): ele decide QUAIS mensagens entram; a vigência decide QUANTO cada uma custa. Com o exemplo acima,
outubro fica R$ 35,00 depois do reajuste, e novembro cobra R$ 0,35 até o instante do reajuste e R$ 0,50
dali em diante.

- **O primeiro preço de uma categoria vale desde sempre** (`vigente_desde = -infinity`). Não há
  histórico para reconstruir: o preço que existia quando a 9165 rodou virou a primeira vigência de cada
  categoria, desde sempre, e o custo do passado ficou exatamente como estava. A mesma regra vale para a
  categoria que ganha o primeiro preço depois: ele cobre o passado. Só do segundo preço em diante a
  vigência começa no instante em que foi gravado.
- **O preço novo vale a partir de agora.** Não existe preço retroativo: gravar fecha a vigência atual em
  `now()` e abre a nova no mesmo instante, sem buraco nem sobreposição.
- **O mesmo preço gravado de novo não abre vigência** (a tela manda a tabela inteira no PUT).
- **Apagar o preço** (só por SQL: nenhuma tela nem ferramenta apaga) fecha a vigência aberta; daí em diante
  as mensagens da categoria ficam "sem preço" (nunca zero), e o preço que voltar recomeça agora.
- **Duas mudanças na mesma transação** dão uma vigência só, com o último valor.

### 9.2 Onde mora

- Migration `9165_preco_da_meta_com_vigencia` (`supabase/migrations-mia/`, espelhada no fim do
  `baseline-mia.sql`). Tabela nossa `mia_precos_meta_vigencias` (`categoria`, `centavos_brl`,
  `vigente_desde`, `vigente_ate` nulo no preço atual, `criado_em`, `criado_por`), uma vigência aberta por
  categoria (`uq_mia_precos_meta_vigencias_aberta`). Plataforma: zero policies, só o `service_role`.
- **Quem fecha e abre a vigência é um gatilho** em `platform_precos_meta`
  (`trg_mia_precos_meta_vigencia`, função `fn_mia_preco_da_meta_abre_vigencia`, `security invoker`).
  Por isso ele vale para todo caminho que grava preço: o PUT de `/api/v1/admin/custo-da-meta`, o MCP
  (`plataforma_definir_precos_da_meta`), um `update` à mão e a imagem de antes da 9165 (num rollback de
  imagem o banco fica). Nenhuma coluna mudou: `platform_precos_meta` continua sendo o preço atual, e a
  leitura de antes da migration continua funcionando.
- A conta: `calcularCustoPorVigencia` (`lib/channels/meta/custo-da-conversa.ts`), que devolve o mesmo
  formato de antes (uma linha por categoria, `totalCentavos`, `semPreco`) e, em cada linha, a quebra por
  preço em `precos`. `centavosUnitarios` passa a ser o preço da mensagem mais recente do período que tinha
  preço; as telas não o mostram.
- As leituras: `lib/channels/meta/custo-do-periodo.ts`. `lerVigenciasDoPreco` (o histórico; leitura que
  falha é erro) e `lerCustoDeMensagemDoPeriodo` (as mensagens cobradas de uma empresa no período, já com o
  custo). A aba Uso e o MCP chamam a segunda; a tela do custo da Meta, que lê todas as empresas, chama a
  primeira e faz a conta.

### 9.3 Quem usa

| leitura | antes | agora |
|---|---|---|
| aba Uso (`GET /api/v1/admin/tenants/[id]/usage`, `mensagens_cobradas`) | preço de hoje | preço do instante de cada mensagem |
| `/admin/custo-da-meta` (`GET /api/v1/admin/custo-da-meta`, `clientes`) | preço de hoje | preço do instante de cada mensagem; `precos` (a tabela que a tela edita) continua o de hoje |
| `plataforma_ver_consumo_de_ia` | não trazia mensagem cobrada | `mensagens_cobradas`, o mesmo bloco da aba Uso |
| `/admin/usage` (tela geral) | não tem custo de mensagem da Meta | não mudou |

O desenho das telas não mudou: muda só o número. A tela do cliente (`/app/ai/usage`) não foi tocada.

⚠️ O mês de `/admin/custo-da-meta` ainda é o mês em UTC (`?mes=` corta de 00:00 UTC do dia 1º), e não o de
Brasília: o defeito é anterior e outro, e corrigi-lo muda quais mensagens a tela conta. Fica para outra
tarefa.

### 9.4 O MCP

- `plataforma_ver_precos_da_meta` (só lê): `atuais` (o preço de hoje de cada categoria), `sem_preco` (as
  categorias conhecidas sem preço) e `historico` (cada vigência; `vigente_desde: null` = desde sempre,
  `vigente_ate: null` = é o preço atual).
- `plataforma_definir_precos_da_meta` (operação `definir_custo_da_meta`, chave própria: `definir_preco`
  muda o que UM cliente paga, esta o custo de TODOS). Recebe `precos: [{ categoria, centavos_brl }]` só
  das categorias que a Meta usa hoje. Grava em `platform_precos_meta` como o PUT da tela, e o gatilho faz o
  resto. Cada categoria volta com `antes` e `resultado`: `mudou` (vale a partir de agora),
  `primeiro_preco` (nunca teve preço, vale desde sempre) ou `ja_estava` (nada foi escrito). A mesma
  categoria duas vezes no pedido é recusada.

Exemplo (fictício):

```json
{ "precos": [{ "categoria": "marketing", "centavos_brl": 50 }] }
```

### 9.5 Testes

- `tests/unit/preco-da-meta-com-vigencia.test.ts`: a Academia Alfa com 100 mensagens de marketing em
  outubro e o reajuste em 10/11. Outubro igual antes e depois na aba Uso, na tela do custo da Meta e no
  MCP; novembro com os dois preços; o controle (a conta de antes dava R$ 50,00); a virada de Brasília
  (23h30 de 31/10 é outubro, ao preço de outubro); o histórico que falha virando 500; o fim exclusivo da
  vigência; a categoria apagada; e as duas ferramentas do MCP (só o que mudou é gravado, `ja_estava`,
  `primeiro_preco`, a recusa).
- `tests/invariants/preco-da-meta-com-vigencia.test.ts`, no Postgres de verdade: o gatilho fechando e
  abrindo vigência pelo mesmo upsert da tela e do MCP, o mês passado igual e este mês com os dois preços
  pela mesma leitura da aba Uso, preço igual sem vigência nova, duas mudanças numa transação, apagar e
  voltar, a migration aplicada de novo sem mexer no histórico, o `service_role` gravando e a sessão sem
  ler.

## 10. A plataforma inteira no MCP, e a soma em R$ que fecha (MIA-136)

Dois itens do "Falta" do mapa (MIA-54, seção 2.1): `plataforma_ver_consumo_de_ia` só lia um cliente,
enquanto a tela geral (`/admin/usage`) já mostrava a plataforma inteira; e, na aba Uso e no MCP, a soma
dos agentes com o Sistema podia diferir do total em centavos.

### 10.1 A soma fecha com o total

Cada linha era arredondada sozinha: R$ a 2 casas, US$ a 4 casas de centavo. A Academia Alfa (fictícia) com
três agentes e o Sistema, cada um com 6,68 centavos de dólar a R$ 5, tem R$ 0,334 em cada linha: o total
exato é R$ 1,336 (R$ 1,34), e as quatro linhas arredondadas davam 4 × R$ 0,33 = R$ 1,32.

**O total manda, e as linhas se ajustam.** O total é o valor exato do período arredondado, como antes.
As linhas saem dele pelo maior resto (`fecharPeloTotal`): cada uma começa no seu valor exato para baixo, e
os centavos que faltam para o total vão para as de maior fração (no empate, para a maior). No exemplo, uma
linha fica R$ 0,34 e as outras três R$ 0,33, e a soma é R$ 1,34.

- Cada linha fica no seu valor para baixo ou para cima: nunca mais de um centavo longe do exato.
- Vale nas duas partições da leitura: agentes + Sistema, e as finalidades. Em R$ (2 casas) e em US$
  (4 casas de centavo).
- O total não mudou. O que muda é, no máximo, um centavo em algumas linhas.
- Vale para a aba Uso do cliente e para `plataforma_ver_consumo_de_ia`, que leem a mesma função. A
  tela do próprio cliente (`/app/ai/usage`) não mostra dinheiro e não foi tocada.

### 10.2 O ranking da plataforma

`plataforma_ver_ranking_de_consumo_de_ia` (só lê, sem operação) é a visão da tela geral, no MCP, com uma
diferença no desempate (abaixo):

- **As mesmas empresas:** todas, menos as de demonstração (`SEM_DEMONSTRACAO`, como a tela geral). As que
  não gastaram aparecem com zero, no fim.
- **O mesmo período:** `mes` (AAAA-MM, o mês de Brasília) ou `dias` (os N dias do calendário em Brasília
  terminados hoje), por `periodoDoPedido`. Sem nenhum dos dois, o mês corrente.
- **A mesma conta:** cada empresa é lida por `lerConsumoDoPeriodo`, a leitura da aba Uso (uma conta só; as
  cotações são lidas uma vez para todas). O custo em US$ e as chamadas de cada empresa são os da tabela da
  tela geral, e o R$ da plataforma é o da tela geral arredondado ao centavo.
- **A ordem:** custo em dólar (a régua do teto), a mesma ordem por custo da tela geral. **O desempate é
  outro:** aqui, chamadas de IA, depois o nome (e o id, para nada ficar na ordem do banco); na tela geral
  (`app/api/v1/admin/usage/route.ts`), mensagens do período, sem terceiro critério. No custo igual (as que
  não gastaram, por exemplo), as duas listas podem sair em ordem diferente. Mensagens não são consumo de IA,
  e lê-las no ranking seria uma segunda leitura (com os contatos pessoais fora) só para desempatar.
- **A soma fecha:** `total` é a plataforma, e as empresas fecham com ele pela mesma regra da seção 10.1. Por
  isso uma empresa pode ficar um centavo longe do total da aba Uso dela; o detalhe de uma empresa (agentes,
  Sistema, finalidades) continua em `plataforma_ver_consumo_de_ia`.
- **`limite`** (1 a 500) corta a lista de empresas, não o total; `empresas_no_total` diz quantas há.
- Cada empresa traz `posicao`, `organization_id`, `empresa`, `slug`, os números da linha (chamadas, tokens,
  cache, `custo_usd_cents`, `custo_brl`, `sem_preco`), `dias_sem_cotacao` e `truncado`. A resposta traz
  ainda `reais` (dias sem cotação da plataforma e a última cotação), `truncado` (alguma empresa passou do
  teto) e `chamadas_no_banco`.
- Leitura que falha é erro, nunca zero.

As empresas são lidas de cinco em cinco. O mês do teto continua o do banco (UTC, seção 2.1): não foi mudado.

Exemplo (fictício):

```json
{ "mes": "2026-10", "limite": 10 }
```

### 10.3 Testes

`tests/unit/consumo-de-ia-ranking-e-soma-que-fecha.test.ts`, com a Academia Alfa, a Academia Beta, a Academia
Gama e uma empresa de demonstração (fictícias):

- `fecharPeloTotal`: os três terços de R$ 1,00 (o controle de antes dava R$ 0,99), o centavo para a maior
  fração, o resíduo de ponto flutuante, parte zero, US$ a 4 casas, e uma varredura de 500 partições
  aleatórias em que a soma é sempre o total e cada parte fica a menos de um centavo do exato;
- a aba Uso e o MCP: os agentes com o Sistema, e as finalidades, somando o total em R$ e em US$;
- o ranking: a demonstração de fora (ela é a que mais gasta), a ordem por custo, quem não gastou com zero no
  fim, o mês de Brasília (22h de 31/10 entra; 23h59 de 30/09 e 00:00 de 01/11 ficam de fora, e passariam a
  ordem se entrassem), cada empresa com os números da aba Uso dela, a soma das empresas fechando com a
  plataforma, o dia sem cotação e a leitura que falha;
- o MCP contra a tela geral (`/api/v1/admin/usage?mes=2026-10`): as mesmas empresas, na mesma ordem, com o
  mesmo custo e as mesmas chamadas, e o mesmo R$; o desempate, com duas empresas de custo igual e duas sem
  gasto, em que a ordem de cada lista fica fixada (a do MCP por chamadas e nome, a da tela por mensagens) e
  a ordem por custo é a mesma nas duas; o `limite`; e o mês fora do formato recusado.

O dublê do PostgREST (`tests/helpers/postgrest-com-teto.ts`) passou a entender `not … is true`, o filtro
da demonstração, com a regra do Postgres (o falso e o nulo passam).

## 11. Só o servidor grava o custo (MIA-251 D, migration 9173)

`llm_calls.cost_cents` é a régua do teto do plano (`fn_gasto_de_ia_do_mes`, `orcamento.ts`) e do "IA do
mês" da cobrança. Até a 9173, `authenticated` tinha INSERT e UPDATE em `llm_calls` e em `ai_agent_runs`
(o `GRANT ALL` do corpo do baseline do upstream e a política `tenant_isolation_<tabela>_all` do laço genérico
dele), e um membro qualquer zerava o gasto do mês da empresa com um `update llm_calls set cost_cents = 0`
pelo PostgREST.

### 11.1 A regra

- A sessão (`anon` e `authenticated`) não grava, não reescreve e não apaga nada em `llm_calls` nem em
  `ai_agent_runs`: INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES e TRIGGER saem (TRUNCATE passa por cima da RLS).
- A única exceção é `update (tool_calls)` em `ai_agent_runs`: a anonimização LGPD
  (`app/api/v1/lgpd/anonymize/route.ts` → `lib/lgpd/cascata.ts`, passo 6) redige essa coluna com a sessão de
  quem pediu.
- Quem grava o custo é o servidor: o motor pelo pool (`run-model-call.ts`, `lib/ai/decisao/*`) e as rotas e
  workers pelo cliente admin (`lib/ai/usage/registrar-chamada.ts`, `lib/ai/log-invocation.ts`,
  `lib/ai/runtime/*`, `lib/ai/agents/teste-da-versao.ts`, `send-voice.ts`, `workers/media-derive-worker.ts`).
  As funções SQL que gravam nessas tabelas são `security definer`.
- A **leitura** não mudou aqui: fechou na 9175 (seção 12).
- `agent_turn_traces` já está fechada para escrita desde a 0721 do upstream e não é tocada.
- O suporte em modo somente leitura segue travado no `tool_calls`. As `support_write_*` do upstream só ficam em
  tabela que `authenticated` grava inteira (`fn_aplicar_travas_de_suporte`, 0274): sem o update da tabela, a
  função dele as tira de `ai_agent_runs`. No lugar entra a restritiva nossa
  `mia_suporte_somente_leitura_tool_calls` (update, `fn_support_write_allowed`), e a 9173 chama a função dele
  no fim para o catálogo convergir na hora. Sem isso, a primeira provisionadora de módulo mudava o núcleo.

### 11.2 Onde mora

`fn_mia_colunas_de_ia_fechadas()` (nossa, invoker, sem EXECUTE para a sessão), criada pela 9173 e chamada no
fim do `baseline-mia.sql`, antes da varredura anon. O baseline roda a cada implantação e o `GRANT ALL` do
upstream volta junto: a função fecha de novo, inclusive concessão feita por outro concedente e concessão
solta de coluna, e devolve quantas sobraram (0 = fechado; acima disso, `warning` no log do bootstrap).

### 11.3 Testes

- `tests/unit/custo-de-ia-fora-da-escrita-da-sessao.test.ts` (cerca): reprova `insert`, `update`, `upsert` e
  `delete` em `llm_calls` ou `ai_agent_runs` por cliente que não é o admin provado pela origem ou pelo tipo
  (o resolvedor de `tests/unit/helpers/cliente-admin.ts`), fora o `update` que só toca `tool_calls`. Dois
  arquivos recebem o cliente por `SupabaseClient` genérico e estão liberados com o chamador escrito.
- `tests/invariants/custo-de-ia-a-sessao-nao-grava.test.ts`: com a sessão do admin da empresa, `update`,
  `insert` e `delete` dão 42501; o `tool_calls` continua gravando; `service_role` e o dono gravam; o
  `GRANT ALL` reaberto e a concessão solta de coluna são fechados de novo; a função é idempotente.
- `scripts/ensaio-de-banco.sh`: a conferência "custo de IA (9173)" roda as mesmas tentativas no banco da
  versão no ar atualizado, com um membro das demonstrações, e desfaz cada uma.

### 11.4 Na fusão

Escritor novo do upstream em `llm_calls` ou `ai_agent_runs` vai pelo **cliente admin, depois do portão de
papel**, filtrando `organization_id`, com a linha `FORK MIA`. Pela sessão ele daria 42501 em produção. A cerca
acima acusa no PR da fusão. Se o upstream criar coluna que a anonimização precise redigir pela sessão em
`ai_agent_runs`, ela entra no `grant update (...)` da função, por migration nova.

## 12. A sessão não lê custo, tokens, provedor nem modelo (MIA-251 G, migration 9175)

Depois da 9173 a sessão já não gravava o custo, mas ainda o lia: qualquer membro da empresa, pelo PostgREST,
pedia `cost_cents`, os tokens, o provedor e o modelo de cada chamada. A resposta da API já tirava esses campos
desde a MIA-262 (`semIaDaPlataforma`); a 9175 tira no banco também.

### 12.1 A regra

- Em `llm_calls`, `agent_turn_traces` e `ai_agent_runs`, `authenticated` não tem SELECT da tabela: tem SELECT
  coluna por coluna, de todas menos as fechadas. `anon` não lê nada das três.
- Fechadas: `cost_cents`, `provider`, `model`, `entrada_do_primeiro_passo` (tokens do 1º passo) e **toda coluna
  com `tokens` no nome** (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`,
  `tokens_in`, `tokens_out`). A regra é uma só, em `lib/ai/colunas-de-ia-fechadas.ts` e na função do banco, e a
  cerca confere que as duas batem.
- Pedir coluna fechada pela sessão dá 42501 (`permission denied for table …`), e `select *` também. Filtrar ou
  ordenar por ela também: o banco pede SELECT da coluna do WHERE e do ORDER BY. `count(*)` e as colunas
  abertas (status, erro, tempo, ids, ferramentas) continuam.
- A anonimização LGPD continua: o `update (tool_calls)` da 9173 fica, e o PostgREST grava com `RETURNING 1`,
  filtrando por `id` e `organization_id`, que seguem abertos.
- `fn_uso_de_ia` (do upstream, `security invoker`, EXECUTE para `authenticated`) soma custo e tokens: pela
  sessão dá 42501. As outras invoker que leem custo (`fn_gasto_de_ia_do_mes`, `fn_previa_historico_analise`,
  `fn_resumo_historico_analise`) já eram só do `service_role`.

### 12.2 Quem lê o quê

Quem precisa de coluna fechada é rota da plataforma (`podeVerCusto`): lê pelo **cliente admin, depois do
portão**, filtrando `organization_id`. Quem não é da plataforma (o gerente da empresa, a plataforma em suporte,
o token de integração) lê pela sessão com `colunasDaSessao(colunas)`, e `semIaDaPlataforma` continua trocando
o que falta por `null` na resposta.

| Leitor | Antes | Agora |
|---|---|---|
| `app/api/v1/ai/runs/route.ts` (Execuções) | sessão, todas as colunas, filtro por provedor | portão: admin com todas para a plataforma, sessão sem as fechadas para os outros; o filtro por provedor só no admin |
| `app/api/v1/ai/agents/[id]/runs/route.ts` (aba Execuções do agente) | sessão, tokens e custo | o mesmo portão; o texto do teste (`ai_agent_runs`) segue pela sessão |
| `app/api/v1/ai/turn-traces/route.ts` (traço do turno) | sessão, provedor, modelo, tokens e custo | o mesmo portão |
| `app/app/ai/usage/page.tsx` (aviso de contexto caro) | sessão, filtro por `input_tokens` | admin (a página só abre para a plataforma) |
| `app/api/v1/ai/jev/route.ts` (semana do Jev) | sessão, provedor e custo | admin (o portão é `escolheIa`, só da plataforma) |
| `app/api/v1/ai/usage/route.ts` (`fn_uso_de_ia`) | sessão | admin (o portão é `podeVerCusto`) |
| `app/api/v1/ai/evolution/route.ts` (`fn_uso_de_ia`) | sessão | admin para a plataforma; para os outros o custo nem é somado (o card já vinha nulo) |
| `lib/mcp/tools/agentes.ts` (MCP do cliente) | já sem provedor e modelo (MIA-304) | igual |
| `hooks/ai/useAgentRuns.ts` (Realtime) | a linha inteira | a linha sem `tokens_in`, `tokens_out` e `cost_cents` |

### 12.3 O Realtime de `ai_agent_runs`

Ficou na publicação, e a assinatura não cai. O Postgres Changes do Supabase (`realtime.apply_rls`) monta o
registro só com as colunas em que o papel tem `has_column_privilege(…, 'SELECT')` e só responde 401 quando a
chave primária fica sem SELECT. `id` segue aberto, então a linha chega, sem custo e sem tokens. O hook só usa
`status` e `is_dry_run` para os avisos. Provado no invariante e no ensaio pelo mesmo critério (chave primária
legível e o registro montado como o membro o lê); um servidor de Realtime de verdade não sobe no ensaio.

### 12.4 Onde mora

A mesma `fn_mia_colunas_de_ia_fechadas()` da 9173, refeita pela 9175 com o passo 2 e chamada no fim do
`baseline-mia.sql`. A lista de colunas sai de `information_schema.columns` a cada chamada: coluna nova do
upstream ganha SELECT na implantação seguinte, e só as fechadas ficam de fora. O `GRANT ALL` do corpo do
baseline do upstream reabre a tabela a cada passada e a função fecha de novo, inclusive SELECT de outro
concedente e de coluna fechada solta. Devolve quantas concessões sobraram (0 = fechado).

### 12.5 Testes

- `tests/unit/colunas-de-custo-fora-da-sessao.test.ts` (cerca): reprova `select` com coluna fechada ou `*`,
  filtro ou ordem por coluna fechada, recurso embutido com coluna fechada e `.rpc("fn_uso_de_ia")` por cliente
  que não é o admin provado. Aceita o portão (`veIa ? createAdminClient() : sessao` com
  `select(veIa ? colunas : colunasDaSessao(colunas))`, filtro fechado só dentro de `if (veIa && …)`). Confere
  que a regra das colunas é a mesma na 9175, que o `baseline-mia.sql` espelha a função e que o schema não
  ganhou função invoker nova lendo custo. Três arquivos de leitura da plataforma recebem o cliente por tipo
  genérico e estão liberados com o chamador escrito.
- `tests/invariants/custo-de-ia-a-sessao-nao-le.test.ts`: com a sessão do admin da empresa, cada coluna
  fechada das três tabelas dá 42501, `select *` e filtro também; status e erro respondem; a anonimização grava
  na forma do PostgREST; `fn_uso_de_ia` dá 42501 pela sessão e soma pelo admin; o Realtime entrega a linha sem
  as fechadas; coluna nova ganha SELECT e a de tokens não; o `GRANT ALL` reaberto fecha de novo.
- `scripts/ensaio-de-banco.sh`: a conferência "leitura de IA (9175)" com um membro das demonstrações.
- Três invariantes do upstream que medem a `fn_uso_de_ia` pela RLS de quem chama
  (`uso-de-ia-agregado-no-banco`, `uso-de-ia-turno-e-regua-unica`, `execucoes-de-ia-leem-a-organizacao`)
  devolvem o SELECT da tabela à sessão no banco descartável deles, com a linha `FORK MIA`: medem a função como
  o upstream a desenhou.

### 12.6 Na fusão

**Leitor novo de custo pela sessão vai para o cliente admin depois do portão.** Rota do upstream que lê
`cost_cents`, tokens, provedor ou modelo dessas três tabelas pela sessão (ou chama `fn_uso_de_ia`) responde
500 em produção (42501). Se for tela da plataforma, troque o cliente pelo admin depois do portão, filtrando
`organization_id`; se for tela do cliente, use `colunasDaSessao(...)`. Marque com `FORK MIA`. A cerca acima
acusa no PR da fusão. Coluna nova do upstream com custo ou tokens sem `tokens` no nome entra na lista de
`lib/ai/colunas-de-ia-fechadas.ts` e na função, por migration nova.
