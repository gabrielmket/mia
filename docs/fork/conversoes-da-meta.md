# Conversões da Meta por etapa do funil (9017, revista na 9019)

Quanto mais cedo o sinal chega, mais rápido o anúncio aprende quem vira cliente.
Uma clínica que só avisa a venda dá à Meta um punhado de sinais por mês; a mesma
clínica avisando "qualificou" e "agendou" dá dezenas.

## O que aconteceu

Na **.70** (01/10/2026) a MIA pôs no ar a régua da Meta por etapa, em tabelas nossas
(migration 9017). Dois dias depois o upstream lançou a dele (**1.70.0**, migration
**0524**, PR #2087): a mesma régua, na tabela `meta_ads_conversion_rules`, com o
consumidor `lib/conversoes/etapa-meta.handler.ts` e o cartão "O que cada etapa do
funil informa à Meta" em Configurações › Conversões. No mesmo lançamento veio a
venda de quem chegou pela página com UTM da Meta (PR #2076) e, depois, a correção da
identidade da Página/WABA na compra (#2098, #2197).

Pela doutrina do fork ("nunca dois caminhos para a mesma coisa", `docs/FORK-MIA.md`),
a régua do upstream virou a principal na **.72**. Em produção a nossa estava vazia
(0 regras, 0 configurações de formulário, 0 envios de etapa, medido em 05/10), então
nada foi migrado.

## O que é do upstream e o que continua nosso

| peça | de quem | onde |
|---|---|---|
| Regras por etapa (qual evento padrão cada etapa aberta manda) | **upstream** (0524) | `meta_ads_conversion_rules`, `lib/conversoes/regras-meta.ts`, cartão `_regrasMeta.tsx` |
| Envio do evento de etapa e da venda para quem tem atribuição (clique para WhatsApp, ou página com UTM da Meta) | **upstream** | `lib/conversoes/etapa-meta.handler.ts`, `envio.handler.ts`, `plataformas-de-anuncio/meta/conversions.ts` |
| Histórico de envios das duas plataformas, pendências e reenvio | **upstream** | aba Histórico (`_historico.tsx`, `lib/conversoes/historico.ts`), `fn_solicitar_reenvio_conversao` |
| Gravação das regras, chamada pela tela E pelo MCP | **upstream**, com o miolo tirado para uma função | `lib/conversoes/gravar-regras-meta.ts` (FORK MIA, o par de `gravar-regras-google.ts`) |
| **A volta dos leads de formulário** | **nosso** | consumidor `lib/conversoes-meta/formulario.handler.ts`, chave `mia_conversoes_meta_config` |
| **Diagnóstico da Meta** ("Testar conexão") | **nosso** | aba Diagnóstico, `lib/conversoes-meta/diagnostico.ts` |
| **Seção Origem do cartão aberto** (o que cada plataforma ficou sabendo) | **nosso** | `components/cartoes/aberto/ConversoesDaOrigem.tsx` |
| **Seis ferramentas no MCP de plataforma** | **nosso**, gravando na tabela do upstream | `lib/mcp-plataforma/ferramentas/conversoes.ts`, `lib/implantacao/conversoes.ts` |
| O link do negócio na lista de pendências (`/app/leads/<id>`; `/app/kanban?lead=` parava na lista de funis) | **nosso**, uma linha | `app/app/settings/conversoes/page.tsx` |

### O que foi apagado na .72

- o nosso consumidor de etapa (`conversoes.meta_etapa`), que saiu do registro;
- a régua própria (`lib/conversoes-meta/regras.ts`), o vocabulário de eventos
  (`eventos.ts`), o histórico próprio (`historico.ts`), as sete situações
  (`situacao.ts`) e o livro-razão próprio (`livro.ts`);
- as telas `_historicoDeEnvios.tsx` e `_reenviarEnvio.tsx`, e as ações de salvar
  regras e de reenviar evento de etapa.

### O que ficou obsoleto (e não foi apagado)

Migration **9019**: `mia_conversoes_meta_regras`, o gatilho que carimbava a régua e
`fn_mia_solicitar_reenvio_conversao_meta` ficam de pé, com comentário `OBSOLETA` na
tabela e nas funções e a nota no MANIFEST. A função do reenvio devolve `false` e não
emite mais `conversao_meta.retry_requested`, que perdeu o consumidor. **Podem sair
numa fusão futura**, depois de a .72 ficar um ciclo no ar.

### O que se perdeu ao adotar a régua do upstream

- **Valor por etapa** (sem valor, valor fixo, valor do negócio): a régua do upstream
  manda o evento de etapa SEM valor, de propósito ("o negócio ainda não foi
  vendido"). A venda continua com o valor.
- **Canal de entrada** por regra (todos, só WhatsApp, só fora do WhatsApp).
- **A chave por evento** (o mesmo evento em duas etapas saía só na primeira): na do
  upstream a chave é a ETAPA (`MetaEtapa:<uuid>`), então o negócio que passa por duas
  etapas com o mesmo evento manda o evento duas vezes. O MCP avisa quando isso é
  montado.

Os três são candidatos a pull request no upstream, se fizerem falta.

## ⭐ A regra da casa: uma ida só à Meta por evento

**Um negócio que muda de etapa gera no máximo UM envio daquele evento para a Meta.**

Ficam três consumidores que escutam `lead.stage_changed` e podem falar com a Meta: os
dois do upstream (`conversoes.etapa_meta` e `conversoes.venda`) e o nosso
(`conversoes.meta_formulario`). Eles não se sobrepõem porque a pergunta que os
separa é a MESMA função (`lerAtribuicao`, do upstream):

| origem do negócio | `lerAtribuicao` | quem envia | porta |
|---|---|---|---|
| clique em anúncio para o WhatsApp (`ad_source_id`) | tem atribuição | upstream | mensagens de negócio (`business_messaging`, `ctwa_clid`) |
| página com UTM da Meta (`ad_platform: site`) | tem atribuição | upstream | `system_generated`, pelo telefone |
| formulário da Meta (`meta_lead_id` no negócio) | **sem atribuição** | **nosso**, se a chave estiver ligada | API de conversões para CRM (`lead_id`) |
| formulário **e** clique | tem atribuição | upstream (o nosso sai de cena) | mensagens de negócio |
| orgânico | sem atribuição e sem formulário | ninguém | — |

E, de reforço: os três escrevem no MESMO livro-razão (`ad_conversion_dispatches`,
único por organização + negócio + evento), com a MESMA chave (`MetaEtapa:<uuid>` e
`Purchase`) e o MESMO `event_id` (`<leadId>:<evento>`); `sent` nunca é rebaixado.

Provado em:

- `tests/unit/conversoes-da-meta-consumidor.test.ts`, bloco "um movimento de etapa
  gera no máximo UM envio": os três consumidores rodam juntos sobre o mesmo banco
  em memória, para cada origem, e o movimento é entregue duas vezes;
- `tests/invariants/conversoes-da-meta-por-etapa.test.ts`, bloco "A REGRA DA CASA":
  o mesmo, no Postgres de verdade, com os consumidores tirados do REGISTRO
  (`ensureHandlersRegistered`), e a prova de que `conversoes.meta_etapa` não está
  mais registrado.

## Os eventos

A lista é a do upstream (`EVENTOS_DA_META`, `lib/conversoes/regras-meta.ts`), com o
CHECK da tabela repetindo:

| evento | rótulo | está na lista da Meta para anúncio de WhatsApp? |
|---|---|---|
| `LeadSubmitted` | Lead enviado | sim |
| `QualifiedLead` | Lead qualificado | sim |
| `InitiateCheckout` | Início de compra (orçamento) | sim |
| `AddToCart` | Adicionou ao carrinho | sim |
| `ViewContent` | Viu o conteúdo | sim |
| `Purchase` (o negócio ganho) | Compra | sim |

**O aviso que a nossa tela dava some, porque o motivo dele sumiu.** Na 9017 a casa
oferecia "Agendou" (`Schedule`) e "Pediu orçamento" (`SubmitApplication`), que NÃO
estão na lista fechada da API de conversões para mensagens de negócio (conferido na
documentação da Meta em 01/10/2026:
<https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/>).
O upstream resolveu de outro jeito: só oferece eventos da lista, e o "Usar o
recomendado" leva a etapa de agendamento para `LeadSubmitted` e a de orçamento para
`InitiateCheckout` (`eventoRecomendadoParaMeta`). A MIA adota o dele.

## A volta dos leads de formulário

O id do lead do formulário é guardado na origem do negócio desde a 9003
(`crm_leads.source_metadata.meta_lead_id`); o contato do formulário fica com
`ad_platform: meta_ads` e SEM clique, e por isso o upstream não o informa. A chave
mora em `mia_conversoes_meta_config`:

- **desligada por padrão** (sem linha é desligada);
- **ligada**, os eventos das regras de etapa LIGADAS (as do upstream) e a venda vão
  para o lead de formulário pela API de conversões para CRM (`action_source:
  system_generated`, `custom_data.event_source: crm`, `lead_event_source` com o nome
  do CRM, `user_data.lead_id` em TEXTO, telefone e e-mail com hash);
- **ligar não envia o passado**: a trava da regra (`configured_at`, do upstream) e a
  da chave (`leads_de_formulario_desde`), comparadas com a precisão de microssegundos
  do banco (`lib/conversoes-meta/instante.ts`);
- **contato anonimizado** não volta para a Meta pelo id de um formulário antigo;
- decisão de não enviar (sem regra, chave desligada, anterior à regra ou à chave)
  **não vira linha** no livro-razão, como o upstream faz com o orgânico;
- o **reenvio** é o do upstream (`fn_solicitar_reenvio_conversao`, aceita
  `MetaEtapa:<uuid>` exigindo o retrato), e quem reenvia o lead de formulário é o
  nosso consumidor, com o retrato do primeiro envio.

Fonte da porta do CRM:
<https://developers.facebook.com/docs/marketing-api/conversions-api/conversion-leads-integration/payload-specification>.

### A venda pela página (#2076) e o formulário

A venda de quem chegou pela página com UTM da Meta é do consumidor de venda do
upstream (pelo telefone). A do formulário é nossa (pelo `lead_id`). Como a escolha é
pela MESMA leitura de atribuição e o primeiro toque do contato não é sobrescrito
(`fn_estampar_atribuicao_de_anuncio`), a mesma venda nunca vai pelas duas: quem tem
atribuição de página vai pelo upstream e o nosso sai de cena. Provado nos dois
testes da regra da casa.

## O diagnóstico

"A Meta está recebendo?", em seis conferências, pelo botão "Testar conexão" (aba
Diagnóstico, antes do diagnóstico do Google). Três perguntam à própria Meta (token,
destino, permissões; só LEITURA), duas leem o livro-razão (último envio aceito,
recusas em 7 dias, que agora levam ao histórico do upstream já filtrado por
`situacao=falha`) e uma lê a conexão (modo de teste). O token nunca aparece.

A permissão de envio é inferência: um envio aceito nos últimos 7 dias conta mais que
a lista de permissões do token.

## O MCP de plataforma

As seis ferramentas continuam, com o mesmo nome:

| ferramenta | o que faz desde a .72 |
|---|---|
| `plataforma_ver_conversoes` | as conexões sem segredo, as regras do upstream por funil (evento, ligada) e as do Google, o recomendado do upstream, a lista de eventos dele, os últimos envios com a situação do histórico dele |
| `plataforma_garantir_conversoes_da_meta` | grava na `meta_ads_conversion_rules` pela gravação da tela do upstream (`gravar-regras-meta.ts`); regra nova nasce DESLIGADA com a chave `MetaEtapa:<uuid>`; os eventos aceitos são os do upstream (`Schedule`, `SubmitApplication`, canal e valor são recusados) |
| `plataforma_garantir_conversoes_do_google` | sem mudança |
| `plataforma_ligar_conversoes` | liga ou desliga pela mesma gravação (a lista inteira, para nenhuma outra regra ser desligada); o gatilho do upstream carimba `configured_at` |
| `plataforma_ligar_leads_de_formulario_da_meta` | sem mudança |
| `plataforma_diagnosticar_conversoes_da_meta` | sem mudança |

## Conversões do site

MIA-169, parte B da MIA-164 (desenho do Arquiteto na MIA-163, seções 4.4 a 4.6). O
cadastro e a assinatura da MIA viram negócio no funil da Time (parte A,
`mia_cadastro_na_time`, 9169), e cada etapa da conta tem de chegar à **Meta como
evento de SITE** (no dataset do site) e ao **Google Ads como importação de clique**.

### A escolha: regras nossas, no motor dele

O CHECK da 0524 (os 5 eventos do upstream) e a tela do cliente **não mudam**: abrir a
lista seria redefinir objeto do upstream, mudaria a tela de todo cliente, e os eventos
de site não servem para lead de WhatsApp. As regras do site moram AO LADO, na tabela
nossa `mia_regras_de_conversao_do_site` (9170), e o envio passa pelo MESMO
`processarConversao`, o mesmo livro-razão (`ad_conversion_dispatches`) e o mesmo reenvio.
Não há motor novo.

| coluna | o que é |
|---|---|
| `stage_id` | a etapa ABERTA (FK composta para `crm_stages`) |
| `plataforma` | `meta_ads` ou `google_ads` |
| `evento_meta` | CHECK nosso: `CompleteRegistration`, `StartTrial`, `Subscribe`, `Purchase` |
| `google_acao_id` | a ação de conversão do Google (só dígitos) |
| `leva_valor` | manda o valor do negócio (Purchase e Subscribe sempre: CHECK) |
| `enabled` | nasce falso |
| `configured_at` | a trava de retroatividade, pelo gatilho nosso (mesmo contrato da 0524) |

Várias regras por etapa: a "Assinante" leva Subscribe, Purchase e a ação de compra do
Google. A chave no livro-razão é `MetaEtapa:<id da REGRA>` ou `Etapa:<id da REGRA>`: o
reenvio do upstream (`fn_solicitar_reenvio_conversao`) e os consumidores dele já aceitam,
e o uuid da regra não colide com o das regras dele (que é o da etapa).

### O caminho

1. O negócio entra na etapa (`lead.stage_changed`, pela porta do kanban que a parte A usa).
2. O consumidor `conversoes.etapa_site` (`lib/conversoes/etapa-site.handler.ts`) lê as
   regras LIGADAS da etapa, com as travas dos dois do upstream: o que foi enviado não sai
   de novo, movimento anterior à regra não envia, a etapa é desta empresa e está aberta.
   Para cada regra, chama `processarConversao`.
3. O ramo FORK MIA de `envio.handler.ts` pergunta a `lib/conversoes/site.ts` se a chave é
   de uma regra do site. Se é, ele decide tudo:
   - **atribuição** pela `mia_cadastro_na_time` (o negócio sem linha lá não veio do
     /signup: `sem_cadastro_do_site`, sem linha no livro-razão). Meta sempre; Google só
     com `gclid`, `gbraid` ou `wbraid` (`sem_clique_do_google`);
   - **valor** do negócio quando `leva_valor` (sem valor: `sem_valor`, pendente);
   - **credencial da Meta** pelas variáveis `MIA_META_DATASET_DO_SITE` e
     `MIA_META_TOKEN_DO_SITE`, **só quando a empresa da regra é a dona da fonte
     `CADASTRO_FONTE_DO_CRM`**. Outra empresa: `site_fora_da_empresa_da_fonte`, sem ler o
     token. Sem as variáveis: `site_sem_credencial`. A conexão da Meta da tela NÃO é
     usada (a da Time aponta para outro dataset, e trocá-la levaria as conversões de
     WhatsApp para o dataset do site);
   - **Google** pela conexão da própria empresa (a tela de Conversões), com a ação da regra.
4. O reenvio (`ad_conversion.retry_requested`) é dos consumidores do UPSTREAM: eles leem o
   retrato e chamam `processarConversao`, que volta a `site.ts`. O nosso consumidor não
   escuta o reenvio (mandaria duas vezes). Regra apagada com retrato de evento de site:
   `regra_do_site_removida`, nunca o transporte do upstream.

**A guarda `venda_pelo_site`:** o negócio que tem linha na `mia_cadastro_na_time` não
manda o `Purchase` do caminho da venda (`lead.won`, a etapa de ganho do funil da Time):
a compra do site já sai pela etapa "Assinante" e contaria duas vezes.

### O fio da Meta (`meta/evento-do-site.ts`)

- `action_source: "website"`, `event_source_url` (a página do cadastro, sem a query),
  `client_ip_address` e `client_user_agent` em claro;
- `em`, `ph`, `fn`, `ln` e `external_id` (o id da empresa cliente) em SHA-256 do valor
  normalizado (minúsculo; telefone só dígitos);
- `fbp` e `fbc` **só com `consentimento = medicao`** (conferido de novo no transporte);
- `value`, `currency: "BRL"` e `order_id` (o id da cobrança paga) em Purchase e Subscribe;
- `event_id` = `<negócio>:<chave da regra>`;
- `test_event_code` com `META_TEST_EVENT_CODE` (o livro-razão marca `evento_de_teste`);
- sem navegador ou sem página guardados (o prazo de guarda passou, ou o cadastro foi
  pelo Google): sai `system_generated`, nunca com navegador inventado;
- o teto de 7 dias e o endereço da Graph (`graph-base.ts`) são os de sempre.

No Google, o transporte já manda `conversionValue` e `orderId`; ganhou o `validateOnly`,
desligado por padrão e ligado só pela ferramenta de teste.

### As variáveis

| variável | o que é |
|---|---|
| `CADASTRO_FONTE_DO_CRM` | o id da fonte "App · cadastro" (parte A); a empresa dona dela é a única que usa as de baixo |
| `MIA_META_DATASET_DO_SITE` | o id do dataset do site na Meta |
| `MIA_META_TOKEN_DO_SITE` | o token dele. Nunca em log, teste ou PR |
| `META_TEST_EVENT_CODE` | opcional: com ele, os eventos do site vão para "Testar eventos". Tire depois do aceite |

### O MCP

| ferramenta | o que faz |
|---|---|
| `plataforma_ver_conversoes` | ganhou a seção `site`: as regras, as variáveis configuradas (sim ou não), o modo de teste e os últimos envios do site, sem dado de pessoa |
| `plataforma_garantir_conversoes_do_site` | montagem: grava as regras DESLIGADAS, só na empresa dona da fonte; recusa evento fora dos 4, etapa de ganho ou perda, Google sem ação e Purchase/Subscribe sem valor |
| `plataforma_ligar_conversoes` | `plataforma: "site"` liga as regras do site das etapas (`colocar_no_ar`), com aviso se falta variável ou se o código de teste ainda está lá |
| `plataforma_testar_conversoes_do_site` | um evento com a Ana Exemplo à Meta (recusa sem o código de teste) e ao Google com `validateOnly`. Não grava no livro-razão |

O checklist (`plataforma_ver_implantacao`, área `conversoes`) ganha o item das regras do
site na empresa dona da fonte.

### Os pontos de ligação no código do upstream

| arquivo | o que o ponto FORK MIA faz |
|---|---|
| `lib/conversoes/envio.handler.ts` | delega a `site.ts` a chave de regra do site, e a guarda `venda_pelo_site` |
| `lib/plataformas-de-anuncio/meta/conversions.ts` | a conversão com `site` vai para `evento-do-site.ts` |
| `lib/plataformas-de-anuncio/google/conversions.ts` e `google/data-manager.ts` | `validateOnly` quando `site.somenteValidar` |
| `lib/plataformas-de-anuncio/types.ts` | o campo `site` da `ConversaoOffline` |
| `lib/event-log/register-handlers.ts` | registra `conversoes.etapa_site` |
| `lib/audit/actions.ts` | `mia_regras_do_site.updated` e `mia_regras_do_site.testado` |

### O aceite na produção (depois do merge)

1. As variáveis no servidor (o Gabriel), com o `META_TEST_EVENT_CODE`.
2. As regras pelo MCP, desligadas.
3. `plataforma_testar_conversoes_do_site`: o evento em "Testar eventos" da Meta e a
   validação do Google (`validateOnly`).
4. Tirar o código de teste e ligar, com o ok do Gabriel.

**Risco conhecido:** o PR #5187 do upstream (a conta do clique nas conversões de etapa do
Google) mexe no ramo do Google; na fusão que o trouxer, conferir as regras do site.

## A empresa de demonstração

Regra e chave podem ser gravadas e ligadas; nada sai, porque a conexão de conversões
ligada não existe nela (9010) e os consumidores param em `sem_conexao`.

## O que só uma conta real da Meta prova

Nenhum teste fala com a Meta. Com o **código de teste** preenchido na conexão:

1. **O evento de lead de formulário chega?** Ligue a chave, mova um lead de
   formulário e confira no gerenciador de eventos (o destino precisa ser o mesmo que
   a campanha de formulário usa). A documentação descreve o `lead_id` como número de
   15 a 17 dígitos e nós o mandamos como texto (para não perder dígito).
2. **O diagnóstico lê o destino com o token do cliente?** Um token gerado dentro do
   destino de conversões pode não responder à leitura de permissões; nesse caso o
   item fica em atenção, como previsto.
3. A compra de clique para WhatsApp exige `page_id` ou `whatsapp_business_account_id`
   (#2098): o upstream os lê da tela de Conversões ("Identidade da conversão"), e é
   lá que se preenche.

## Testes

| arquivo | o que mede |
|---|---|
| `tests/unit/conversoes-da-meta-consumidor.test.ts` | o consumidor dos formulários e ⭐ a regra da casa com os três consumidores juntos |
| `tests/unit/conversoes-da-meta-transporte.test.ts` | o corpo que sai pela porta do CRM, o teto de 7 dias, o diagnóstico na Meta (com dublê) |
| `tests/unit/conversoes-da-meta-regras-e-diagnostico.test.ts` | a gravação das regras (miolo compartilhado), a chave, o diagnóstico e o rótulo do envio |
| `tests/unit/conversoes-da-meta-acoes.test.ts` | o portão das ações que continuam nossas |
| `tests/unit/conversoes-da-meta-tela.test.tsx` | a chave e o diagnóstico, pelo que a pessoa vê e clica |
| `tests/unit/mcp-de-implantacao-conversoes.test.ts` | as seis ferramentas do MCP sobre a tabela do upstream |
| `tests/invariants/conversoes-da-meta-por-etapa.test.ts` | o Postgres de verdade: a 9019, ⭐ a regra da casa com o registro, os formulários, o reenvio do upstream, a demonstração e o MCP |
| `tests/invariants/rls-tabelas-da-mia.test.ts` | as duas tabelas da 9017 continuam com a RLS delas |
| `tests/unit/conversoes-do-site-meta.test.ts` | (MIA-169) o corpo do evento de site: `website`, os hashes, fbp e fbc só com `medicao`, valor e pedido no Purchase e no Subscribe, `test_event_code` e `system_generated` sem navegador |
| `tests/unit/conversoes-do-site-motor.test.ts` | (MIA-169) o consumidor e as travas, o reenvio pelos consumidores do upstream, ⭐ outra empresa nunca usa a variável, a guarda `venda_pelo_site` e o Google com valor e `validateOnly` |
| `tests/unit/mcp-de-implantacao-conversoes-do-site.test.ts` | (MIA-169) as ferramentas do site no MCP |
| `tests/invariants/regras-de-conversao-do-site.test.ts` | (MIA-169) o Postgres de verdade: os CHECKs, as unicidades, a FK da etapa, o gatilho de `configured_at` e a RLS da 9170 |
