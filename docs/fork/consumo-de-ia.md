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

### 2.1 O mês do teto não é o mesmo

O teto do orçamento (`fn_gasto_de_ia_do_mes`) corta o mês pelo `now()` no fuso do banco, que é UTC.
O mês do teto começa às 21h do último dia do mês anterior, no horário de Brasília. Para o mesmo
mês, o número desta leitura e o do teto podem diferir pelas chamadas dessas três horas, nas duas
pontas. **Não foi mudado**: mudar a régua do teto muda o que o cliente recebe, e é decisão do
Gabriel.

## 3. Onde mora

- `lib/ai/usage/consumo-do-periodo.ts`: `periodoDoPedido` (o período de `mes` ou `dias`),
  `lerConsumoDoPeriodo` (a leitura e as somas), `mesAtualEAnterior` (os dois atalhos das telas).
- `app/api/v1/admin/tenants/[id]/usage/route.ts`: aceita `mes=AAAA-MM` além de `dias` (`mes` vence;
  fora do formato é 400). Com `mes`, **todos** os números da resposta são do mês (conversas,
  mensagens, IA e mensagens cobradas). Os campos de antes continuam (`dias`, `conversas`,
  `mensagens`, `ia`, `mensagens_cobradas`); entram `mes`, `periodo` e `consumo` (`total`,
  `por_agente`, `sistema`, `por_finalidade`, `reais`, `truncado`, `chamadas_no_banco`).
- `lib/mcp-plataforma/ferramentas/consumo-de-ia.ts`: `plataforma_ver_consumo_de_ia`.

O bloco `ia` da rota passou a sair da mesma leitura. Antes ele pedia `total_tokens` a `llm_calls`,
coluna que essa tabela não tem (é de `ai_invocations`); `tokens` agora é entrada + saída.

## 4. O MCP de plataforma

`plataforma_ver_consumo_de_ia` (só lê, sem operação): recebe `organization_id` e `mes` (AAAA-MM;
ausente, o mês corrente em Brasília) e devolve a empresa, o período e os mesmos blocos de `consumo`
da rota, saídos da mesma função. Cliente que não existe é recusado com o caminho para achar o id
(`plataforma_listar_clientes`).

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
- **Sem `mes`, nada muda**: as janelas de 7, 30 e 90 dias continuam em dias de calendário UTC, como
  eram. O mês em Brasília e a janela em UTC podem por isso diferir nas três horas da virada.
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

