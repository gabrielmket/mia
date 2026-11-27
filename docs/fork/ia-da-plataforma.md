# A IA de toda empresa segue a da plataforma

**Versão:** .117 (MIA-215; núcleo na MIA-217, superfície na MIA-218; desenho na MIA-216). O agente publicado segue a troca, a trava da visão e o teto de IA pelo MCP: MIA-309. As empresas de chave própria passam à plataforma: MIA-337 (seção 10).

## 1. A regra

A IA de toda empresa é a da plataforma, salvo escolha explícita. Quem escolhe o par
(provedor e modelo) da plataforma é o administrador da plataforma, em **Admin › Modelo de IA**
(`/admin/modelo-de-ia`, tabela `platform_ia`). Trocar ali troca, de uma vez, todas as empresas que
seguem a plataforma.

A escolha por empresa continua existindo, como exceção. É do administrador da plataforma, na tela
**IA › Provedores de IA** da empresa, que ele abre em modo suporte com "Edição permitida". Salvar o
cartão "Modelo padrão" ali é a escolha própria: a empresa deixa de seguir a plataforma.

A chave é da plataforma (`lib/ai/custo-e-da-plataforma.ts`): a empresa não cadastra nada. Uma chave
própria da empresa é opção avançada, só para o administrador da plataforma fora de suporte.

## 2. Por que existe

Em 24/11/2026, a maior parte das empresas estava no padrão do produto do upstream
(anthropic/claude-sonnet-5), gravado por `fn_seed_org_llm_defaults` quando cada uma nasceu. A
instalação não tem chave da Anthropic, e nenhuma delas tinha chave própria. Nenhuma fez uma chamada
de IA por semanas, e ninguém viu. A troca em `/admin/modelo-de-ia` não chegava a elas: valia só para
agente novo e para a primeira publicação.

Três coisas pioravam:

- o aviso do upstream na tela Provedores ("Você ainda não cadastrou a chave da sua IA principal")
  fez o próprio dono da instalação achar que precisava cadastrar chave;
- o administrador da plataforma, em modo suporte, não conseguia salvar o padrão da empresa
  (`escolheIa` recusava toda sessão de suporte);
- o MCP de plataforma não tinha como ver isso.

## 3. Como funciona

| Peça | Onde | O que faz |
|---|---|---|
| Quem segue | `organizations.ia_segue_a_plataforma` (migration 9172) | `true`: o par da empresa é o de `platform_ia`. `false`: escolha própria. |
| A invariante | gatilhos `trg_ia_segue_a_plataforma` (em `organizations`) e `fn_mia_platform_ia_propaga` (em `platform_ia`) | Mantêm `settings.llm` igual a `platform_ia` para quem segue. O tempo de execução continua lendo `settings.llm` e não mudou. |
| Empresa nova | o mesmo gatilho, antes do seed do upstream | Nasce seguindo, com o par da plataforma. Com molde de IA (9096), o molde vence e ela nasce com escolha própria. |
| A função única | `lib/ai/ia-da-empresa.ts` (`iaDaEmpresa`, `iaDasEmpresas`) | Por empresa: o par em vigor, a origem (`plataforma` ou `propria`) e a chave utilizável (`propria`, `instalacao` ou nenhuma). |
| A trava | PATCH e PUT de `/api/v1/ai/providers`, PUT de `/api/v1/admin/modelo-de-ia` | Recusa com 422 `ia_sem_chave` salvar um padrão num provedor sem chave utilizável. |
| Modo suporte | `escolheIa` (`lib/ai/trava-da-ia.ts`) | O administrador da plataforma em modo suporte com edição, aberto pela plataforma, escolhe a IA da empresa (seção 4). |
| O aviso da chave | `AvisoDaChave.tsx` (tela Provedores) | "Usando a chave da MIA. Nenhuma chave precisa ser cadastrada." A chave própria aparece como opção avançada, só para o administrador da plataforma. |
| O aviso da trava | a tela Provedores, a `/health` (`data.ia`), o relatório interno e o MCP | Avisam quando uma empresa fica com o padrão num provedor sem chave utilizável (seção 5). |
| O MCP | `plataforma_ver_ia_das_empresas` | Leitura, por empresa (seção 6). Trocar modelo não tem ferramenta. |
| O agente publicado | a carga da versão (`lib/agent-engine/agent/agent-config.ts`), regra em `lib/ai/agente-segue-a-plataforma.ts` (MIA-309) | Quem segue responde no par da plataforma, mesmo com a versão gravada noutro (abaixo). |
| A trava da visão | PUT de `/api/v1/admin/modelo-de-ia` (MIA-309) | Recusa com 422 `modelo_sem_visao` o modelo que não enxerga imagem enquanto um agente publicado de quem segue lê foto. |

### O agente publicado segue a troca (MIA-309)

O turno do agente não lê `settings.llm`: lê o par gravado na versão publicada (`provider`, `model`,
`credential_id`), e a versão publicada é imutável no banco. Sem mais nada, a troca em
`/admin/modelo-de-ia` chegava a `settings.llm` e não aos agentes já publicados. Desenho na
[MIA-285](/MIA/issues/MIA-285#document-desenho), seção 3 (opção A; a B, republicar, foi descartada).

A carga da versão traz, numa coluna a mais no fim de `SELECT_AGENT_CONFIG_COLUMNS`, o `settings.llm` da
empresa quando ela segue a plataforma **e** `platform_ia` tem um par (sem par, o gatilho não mexe em
`settings.llm` e a versão é a melhor informação). No fim de `mapAgentConfigRow`,
`agenteSegueAPlataforma` troca:

- `provider` e `model` pelos de `settings.llm`;
- `credentialId` por `null`: o resolvedor desce a escada de sempre (credencial ativa da empresa naquele
  provedor, senão a chave da instalação);
- com o provedor da plataforma diferente do da versão, também `operatorModel` e a reserva de modelo
  (9368): os dois foram escolhidos ao lado do par antigo. Sem eles, o operador usa o modelo da conversa
  e não há degrau de reserva.

O resto da versão fica, inclusive o teto por versão (`cost_budget_cents`, `token_budget`). Empresa com
escolha própria fica com a versão intacta. `settings.llm` sem provedor ou sem modelo não muda nada.

Vale para todo carregador da lista (o do número, o por id do roteador, o da versão exata do teste no
editor e o da conversa): o teste no editor usa o mesmo modelo do atendimento.

**A trava da visão.** O modelo da plataforma passa a atender agente com foto e ferramentas. O PUT de
`/admin/modelo-de-ia` já recusava modelo fora do catálogo ou sem ferramentas (`supports_tools`). Desde a
MIA-309 recusa também, com 422 `modelo_sem_visao`, o modelo que não enxerga imagem (`enxergaImagem`, a
mesma régua do motor) enquanto houver agente publicado de empresa que segue e opera com
`multimodal_input` ligado e `image_vision_enabled` não desligado. A leitura dos agentes que falhou
recusa (500): a ação falha fechada.

**Em 27/11/2026, quando o PR foi aberto:** as 3 versões publicadas das empresas que seguem já estavam no par da
plataforma, então nada muda para o cliente. A diferença aparece na próxima troca em
`/admin/modelo-de-ia`.

A migration 9172 também consertou as empresas que existiam: passou a seguir a plataforma quem estava
no padrão semeado sem chave própria da Anthropic, ou já no par da plataforma sem chave própria
daquele provedor. Cada empresa alterada tem uma linha de auditoria
(`ai.padrao_passou_a_seguir_a_plataforma`). Quem tinha escolhido outro par de propósito ficou como
estava.

## 4. Modo suporte

O administrador da plataforma não é membro das empresas. A única porta dele para a tela Provedores
de IA de uma empresa é o modo suporte. `escolheIa` deixa passar quem é, ao mesmo tempo:

- administrador da plataforma com `scope = full` (o `support_readonly` só lê);
- numa sessão de suporte **ativa**, em modo **"Edição permitida"** (`access_mode = full`);
- aberta pela **plataforma**, e não por uma agência (`agency_id` vazio).

A empresa é a da sessão: em suporte, a organização ativa é sempre a do acompanhamento. A abertura da
sessão já exigiu MFA.

A **chave** fica de fora, mesmo com edição: as portas da chave (`credentials/[id]`, a chave do
onboarding e o link da chave própria na tela) usam `podeConfigurarChaveDeIa`, que continua sem
suporte. Acompanhar não é ver a nossa chave nem o nosso custo.

## 5. O aviso da trava

A trava recusa o caminho comum. O aviso pega o que sobra: a chave da instalação saiu do ambiente,
uma chave própria foi desativada, ou `platform_ia` ficou vazio numa instalação sem chave da
Anthropic. A regra é pura e mora em `lib/ai/aviso-da-ia-das-empresas.ts`. Conta só empresa operante
(`ehOperante`). A demonstração conta, porque é usada em venda.

Todos leem a mesma régua, `iaDasEmpresas` ou `iaDaEmpresa` (`lib/ai/ia-da-empresa.ts`), e por isso
dizem o mesmo número.

`iaDasEmpresas` lê `organizations` e `ai_provider_credentials` em páginas de 1000, ordenadas por
`id`, até o fim (`lerTodasAsPaginas`, `lib/leitura/todas-as-paginas.ts`, MIA-235): o PostgREST corta
cada resposta em 1000 linhas sem avisar, e a conta parava na empresa 1000. Página que falhou, ou o
teto de 100 páginas sem chegar ao fim, devolve `null` ("não sei"), nunca a conta de um recorte.

- **`/health`**: `data.ia.empresas_sem_chave`, só a contagem, sem id nem nome, igual com e sem o
  segredo. A leitura tem o mesmo teto de tempo das outras da saúde; `null` quer dizer que ela falhou
  (diferente de zero). **Não muda o `status`**: o passo 1 do trem de implantação lê o `status`, e
  uma empresa mal configurada não pode travar a implantação.
- **Relatório interno** (`cron/report-da-plataforma`, seção 3b): o cron roda de minuto em minuto, e
  esta parte lê as empresas só a cada 15 minutos. Enquanto houver empresa sem chave, sai um recado
  por dia (chave `ia_das_empresas_sem_chave`), com a contagem, onde ver quais e onde corrigir. Sem
  nome de empresa. Leitura que falhou não avisa.
- **Tela Provedores** (`AvisoDaChave`, sobre `ia.chave` do GET):
  - `instalacao`: "Usando a chave da MIA. Nenhuma chave precisa ser cadastrada.";
  - `null`: quem escolhe a IA (a plataforma em suporte) lê "A IA principal desta empresa (provedor)
    está sem chave e não responde aos clientes. Escolha no padrão abaixo um provedor com chave."; a
    empresa lê que é com o suporte, sem link;
  - `propria`, ou `ia` nulo (leitura falhou): nada.
- **Admin › Modelo de IA** (`ContagemDasEmpresas`, sobre `empresas` do GET): o cartão diz "Vale para
  todas as empresas que não escolheram outro." e mostra quantas seguem, quantas têm escolha própria
  e quantas estão sem chave. Com alguma sem chave, diz o efeito e aponta o MCP. `null`: nada.

## 6. MCP

| Ferramenta | O que faz | Tipo |
|---|---|---|
| `plataforma_ver_ia_das_empresas` | por empresa: se segue a plataforma ou tem escolha própria, o provedor e o modelo em vigor, se há chave utilizável (`propria`, `instalacao` ou `null`) e, desde a MIA-262, `jev_sem_chave` (o Jev ligado sem chave validada da origem dele). Desde a MIA-309, `agentes_publicados` e `agentes_fora_do_par` (com a regra da carga: para quem segue, tem de dar zero) e, em `agentes`, a soma das operantes com `fora_do_par_de_quem_segue`; `null` = a leitura dos agentes falhou. Traz também a `contagem` (`contarEmpresas`: só as operantes), os mesmos números do cartão do admin, da `/health` e do relatório interno; a suspensa aparece com `operante: false` e não conta. Nada da chave em si sai. Filtros: `organization_id` (uma empresa) e `so_sem_chave`; as sem chave vêm primeiro | leitura |

**Não há ferramenta de troca.** Trocar modelo é ato de pessoa, com MFA, no painel: em
`/admin/modelo-de-ia` (todas as que seguem) ou na tela Provedores da empresa, em modo suporte (uma).
É a mesma doutrina do MCP de agentes.

## 7. O que o cliente vê (MIA-262)

Pedido de 25/11/2026: o cliente deixa de ver e de mexer em provedor, modelo, chave, consumo e custo
de IA. Tudo isso fica com a plataforma. O levantamento item por item (L01 a L44) é o documento
`ia-do-cliente` da [MIA-261](/MIA/issues/MIA-261). A regra sai **na resposta da API e na tela**, não
só no componente, como em `lib/ai/custo-e-da-plataforma.ts`.

**Três portões**, todos em arquivos do fork:

| Portão | Quem passa | Vale para |
|---|---|---|
| `podeVerCusto` | admin da plataforma fora de suporte | custo, preço do catálogo, tokens, provedor e modelo de cada execução, erro cru do provedor |
| `escolheIa` | `podeConfigurarChaveDeIa` ou a plataforma em suporte com edição (não a agência) | Provedores de IA, Jev, modelo do agente, freios de gasto, classificador do roteador, embedding, voz (`model_id`), mapas pela sessão |
| `podeConfigurarChaveDeIa` | admin da plataforma fora de suporte, sem `support_readonly` | a lista de chaves, o login por assinatura, o retrato da IA em `/system/instalacao` |

**As funções que limpam a resposta** (`lib/ai/custo-e-da-plataforma.ts`): `semIaDaPlataforma`
(provedor, modelo, tokens, custo e erro cru viram `null`), `semCampos`, `CAMPOS_DO_PRECO`,
`semCustoNaAuditoria` (as chaves de dólar da IA saem do `metadata` do Audit Log da empresa) e
`credenciaisSemChave` (a lista vai sem rótulo, final e modelos, para o editor ainda saber se a
chave da versão vale). Ao lado: `estadoDaChaveAoCliente` (conhecimento), `retratoAoCliente`
(instalação), `avisoDeOrcamentoAoCliente` (a Central reescreve o aviso de orçamento na leitura,
inclusive o já gravado), `motivoDeIaAoCliente` (Propostas) e `agentesSemIa` (lista de agentes).

**Tokens também saem.** A regra de 15/09 deixava os tokens visíveis como medidor do pacote. Desde
a MIA-262 o medidor do cliente é o uso do plano (Configurações › Plano e cobrança), e não tokens.

**O que a empresa vê no lugar** (só frases que já existiam, salvo as marcadas *nova*):
"Inteligência artificial pronta" (*nova*); "A inteligência dos agentes desta conta é configurada
pela nossa equipe e ainda não está pronta. Fale com o suporte."; "A IA desta conta está sem chave
para funcionar. Fale com o suporte."; "O uso de IA do plano acabou" e o corpo do teto do plano;
"A IA continua respondendo normalmente — isto é o aviso, não a parada." (*nova*, recorte de uma que
existia); "Não enviei: o uso de IA do plano acabou" (*nova*); "o uso de IA do plano acabou"
(*nova*); "ou quando a IA para" nos sons (*nova*); o erro do `ai_decide` sem `custo_de_token` (*nova*).

**As empresas com chave própria seguem respondendo.** Nada muda no resolvedor nem nas chaves
gravadas. `tests/unit/as-empresas-com-chave-propria-seguem-respondendo.test.ts` fixa: o turno usa a
credencial da empresa; a versão nova salva pelo cliente herda a chave e os freios da publicada; o
patch do cliente não troca a chave; a lista sem rótulo ainda libera o "Publicar". O Jev delas
segue ligado. Quando a chave do Jev perde a validação, quem fica sabendo é a plataforma: uma linha
no relatório interno (`recadoDoJevSemChave`, seção 3b do `cron/report-da-plataforma`) e o
`jev_sem_chave` do MCP.

**O MCP do CRM e a prospecção (MIA-304).** As três leituras de agente do MCP do CRM
(`crm_list_ai_agents`, `crm_get_ai_agent_version`, `crm_get_ai_agent_turn`) não pedem nem devolvem
provedor e modelo. O MCP do CRM é sempre da empresa (token ou conexão do ChatGPT, nunca a plataforma,
como `TOKEN_NAO_ESCOLHE_IA`), então isso vale para todo papel; o modelo de cada empresa está em
`plataforma_ver_ia_das_empresas`. As quatro rotas de `/api/v1/prospecting/agents*` respondem por
`semModeloAoCliente` (`lib/prospecting/sem-modelo-ao-cliente.ts`): o `model_label` sai do resultado,
da sessão e do `prepared`/`completed`, e continua gravado como o upstream grava. Cercas:
`tests/unit/mcp-do-crm-sem-modelo-ao-cliente.test.ts` e `tests/unit/prospeccao-sem-modelo-ao-cliente.test.ts`
(esta também reprova rota nova de `prospecting/agents/` que responda sem o limpador).

**Fora da MIA-262, de propósito:**

- A leitura direta do banco (PostgREST e Realtime) de `llm_calls`, `agent_turn_traces`,
  `ai_agent_runs` e `ai_agent_versions` com a sessão do navegador: é a L44, com o Arquiteto na
  [MIA-285](/MIA/issues/MIA-285). Até lá, provedor e modelo das versões continuam no payload do
  editor do agente (o formulário do upstream precisa deles para salvar e publicar), escondidos na tela.
- A geração paga do onboarding (`?provar=1` de `/system/instalacao`, `setup-ai`): [MIA-284](/MIA/issues/MIA-284).
- O token de integração em `/api/v1/ai/mapas`: a porta está declarada na tabela de portas de token
  (Spec 33). Pela sessão, mapas pede `escolheIa`.
- O texto de tokens na tela de Memória (L26): é a unidade do limite que o próprio cliente escolhe.
- O "uso do plano" com números: protótipo na [MIA-259](/MIA/issues/MIA-259).

## 8. O que fica fora

- Um botão "Voltar a seguir a plataforma" no cartão do padrão. Sem ele, a empresa que virou escolha
  própria só volta a seguir por migration. Se o Gabriel quiser, vira proposta, porque muda a tela.

## 9. Como conferir depois de uma fusão

1. `git grep -n "FORK MIA" -- lib/agent-engine/edge/llm/credentials.ts app/api/v1/ai/providers/route.ts app/api/v1/admin/modelo-de-ia/route.ts`: os pontos do núcleo vivos.
2. `git grep -n "plataformaEditaEmSuporte" -- lib/ai/trava-da-ia.ts`: o modo suporte continua no `escolheIa`.
3. O upstream mexeu em `fn_seed_org_llm_defaults` ou criou um "padrão da instalação"? Confira que o
   gatilho `trg_ia_segue_a_plataforma` continua rodando antes do seed (ordem alfabética dos BEFORE).
4. Rode `lib/ai/trava-da-ia.test.ts`, `app/api/v1/ai/providers/modo-suporte-escolhe-a-ia.test.ts`,
   `app/app/ai/providers/_components/AvisoDaChave.test.tsx`,
   `components/admin/modelo-de-ia/ContagemDasEmpresas.test.tsx`,
   `app/api/v1/health/health-diz-se-ha-empresa-sem-ia.test.ts`,
   `tests/unit/report-da-plataforma-ia-sem-chave.test.ts`, `lib/ai/aviso-da-ia-das-empresas.test.ts`
   e `tests/unit/mcp-de-implantacao-ia-das-empresas.test.ts`.
5. O upstream mexeu na `/health` ou no relatório interno? Confira com
   `git grep -n "MIA-218" -- app/api/v1/health/route.ts app/api/v1/cron/report-da-plataforma/route.ts`.
6. A IA só no admin (MIA-262): `git grep -n "FORK MIA (MIA-262)"` lista cada ponto de encaixe. O
   upstream criou rota nova em `app/api/v1/ai/` ou campo novo de custo, tokens, provedor ou modelo
   numa resposta? Ela precisa passar por `semIaDaPlataforma` (ou recusar sem `escolheIa`). Rode
   `tests/unit/ia-so-no-admin.test.ts`, `tests/unit/as-empresas-com-chave-propria-seguem-respondendo.test.ts`
   e `app/app/ai/providers/page.test.tsx`.
7. O MCP do CRM e a prospecção (MIA-304): rode as duas cercas da seção 7. Ferramenta nova de
   agente no MCP do CRM, ou rota nova em `app/api/v1/prospecting/agents/`, sai sem provedor e modelo.
8. O agente publicado segue a plataforma (MIA-309): `git grep -n "FORK MIA (MIA-309)" -- lib/agent-engine/agent/agent-config.ts`
   mostra os pontos (o import, a coluna `ia_da_plataforma` no `Row`, a coluna no fim de
   `SELECT_AGENT_CONFIG_COLUMNS` e o `agenteSegueAPlataforma` em volta do `return` de `mapAgentConfigRow`).
   O upstream é quem mais mexe nesse arquivo; na fusão, confira que a coluna continua a ÚLTIMA da lista,
   que todo carregador novo da lista usa o alias `a` para `ai_agents` e que campo novo de par
   (provedor, modelo, chave ou outro modelo por papel) entrou também em `ParDaVersao` e na regra.
9. O teto de IA pelo MCP (MIA-309): o upstream mudou o PATCH de `/api/v1/ai/budget`? A regra mora em
   `lib/ai/budget/mudanca-do-teto.ts` (`git grep -n "FORK MIA (MIA-309)" -- app/api/v1/ai/budget/route.ts`):
   leve a mudança para lá, senão a tela e o MCP divergem.
10. Rode `tests/unit/agente-publicado-segue-a-plataforma.test.ts`,
   `app/api/v1/admin/modelo-de-ia/trava-da-visao.test.ts`, `tests/unit/api-orcamento-de-ia.test.ts`,
   `tests/unit/mcp-de-implantacao-teto-de-ia.test.ts` e `tests/unit/mcp-de-implantacao-ia-das-empresas.test.ts`.

## 10. As empresas de chave própria passam à plataforma (migration 9176, MIA-337)

Desenho na [MIA-285](/MIA/issues/MIA-285#document-desenho), ponto 1, opção A. As decisões são do
Gabriel, na [MIA-335](/MIA/issues/MIA-335). A migration só entra numa versão depois da resposta dele, e
na virada do mês: `fn_gasto_de_ia_do_mes` soma o mês inteiro, inclusive o que elas pagaram na chave delas.

**Quem passa.** O critério é por dado, sem id nem nome: empresa fora da demonstração, com
`ia_segue_a_plataforma = false` e credencial `openai` ativa e validada. Em 27/11/2026, só leitura: 4 empresas.

**O que muda em cada uma** (`fn_mia_chave_propria_passa_a_plataforma`):

| Peça | Antes | Depois |
|---|---|---|
| Credenciais `openai` | ativas | `is_active = false`, sem apagar e com `validated_at` gravado. Na chamada seguinte, o resolvedor desce para a chave da instalação. |
| `ia_segue_a_plataforma` | `false` | `true`. O gatilho da 9172 grava o par de `platform_ia` em `settings.llm`, e a carga da versão (MIA-309) leva os agentes publicados ao mesmo par, inclusive os que estavam noutro modelo. |
| Teto de `ai_budgets` | o da empresa | 3000 centavos de dólar (US$ 30) no mês, modo `avisar`, limiar mantido. Saindo de `bloquear`, a carência zera. Nunca `bloquear`. |
| Typesafe (o Jev) | ativa | ativa. O Jev delas segue na chave delas até o Jev nativo. |
| Versão publicada | | nada muda. O gatilho do upstream recusa, e a carga da versão já resolve. |

Cada empresa ganha uma linha `ai.chave_propria_passou_a_plataforma` em `api_audit_log`, com o par de
antes (`antes`, inclusive `enabled_models`), o par de depois, o teto de antes (`teto_antes`, `null` se não
havia linha), o teto novo e os ids das credenciais desativadas. É dela que sai a volta.

**Uma vez só.** O baseline roda a cada implantação. A marca é `platform_ia.chaves_proprias_passaram_em`,
gravada no mesmo bloco da passagem: preenchida, a passagem não roda de novo e não puxa quem escolher
chave própria depois. Se a passagem falhar, a marca também não fica, e a implantação seguinte tenta de
novo. A marca não mora na auditoria porque a sessão de um membro consegue gravar em `api_audit_log`.

**Cada decisão num trecho.** Na migration, os trechos marcados com `DECISÃO`: quem passa (o `select` do
critério), as chaves que saem (`c_provedores_que_saem`) e o teto (`c_teto_cents`, `c_modo`). "Uma a uma",
"outro teto", "Jev desligado" ou "alguma de fora" mudam só aquele trecho. Desligar o Jev pede também
desligar a config dele em `settings.jev`: só a lista de provedores não basta.

**Como conferir depois da implantação.**

1. `plataforma_ver_ia_das_empresas` mostra as 4 em "segue", com chave `instalacao`, e
   `agentes_fora_do_par` em zero.
2. `select count(*) from api_audit_log where action = 'ai.chave_propria_passou_a_plataforma'` dá 4.
3. As chamadas delas em `llm_calls` seguem com status ok na manhã seguinte.

### A volta

Não é migration agora. É SQL à mão na produção, então só com o ok do Gabriel, guardando antes as linhas
que vão mudar (`mia-implantacao`), ou uma migration de volta. Vale na chamada seguinte.

A sessão de um membro consegue inserir linha em `api_audit_log` da própria empresa. Por isso a volta
lê só a primeira linha de cada empresa gravada pelo banco (sem autor e sem token), religa só credencial
`openai` daquela empresa, e o passo 0 confere que são 4 antes de mudar qualquer coisa.

```sql
begin;

-- 0. As linhas da 9176. Confira: 4 empresas, e as credenciais de cada uma.
create temporary table volta_9176 on commit drop as
select distinct on (l.organization_id)
       l.organization_id as org, l.metadata as m
  from public.api_audit_log l
 where l.action = 'ai.chave_propria_passou_a_plataforma'
   and l.metadata ->> 'migration' = '9176'
   and l.actor_user_id is null
   and l.actor_api_token_id is null
   and l.bypassed_rls
 order by l.organization_id, l.created_at;

select count(*) as empresas,
       sum(jsonb_array_length(m -> 'credenciais_desativadas')) as credenciais
  from volta_9176;

-- 1. Religa as credenciais desativadas (a validação continua gravada).
update public.ai_provider_credentials c
   set is_active = true, updated_at = now()
  from volta_9176 v
 where c.organization_id = v.org
   and c.provider = 'openai'
   and c.id in (select x::uuid from jsonb_array_elements_text(v.m -> 'credenciais_desativadas') x);

-- 2. Deixa de seguir a plataforma e volta ao par de antes, na MESMA escrita
--    (o gatilho da 9172 respeita a escolha quando as duas vêm juntas).
update public.organizations o
   set ia_segue_a_plataforma = false,
       settings = case
         when v.m -> 'antes' ->> 'provider' is null or v.m -> 'antes' ->> 'default_model' is null
           then o.settings
         when jsonb_typeof(v.m -> 'antes' -> 'enabled_models') = 'array'
           then jsonb_set(public.fn_mia_llm_com_o_par(o.settings, v.m -> 'antes' ->> 'provider', v.m -> 'antes' ->> 'default_model'),
                          '{llm,enabled_models}', v.m -> 'antes' -> 'enabled_models')
         else public.fn_mia_llm_com_o_par(o.settings, v.m -> 'antes' ->> 'provider', v.m -> 'antes' ->> 'default_model')
       end
  from volta_9176 v
 where o.id = v.org;

-- 3. O teto de antes. Sem linha antes, a linha que a 9176 criou sai.
update public.ai_budgets b
   set monthly_limit_cents = (v.m -> 'teto_antes' ->> 'monthly_limit_cents')::integer,
       enforcement_mode = v.m -> 'teto_antes' ->> 'enforcement_mode',
       alarm_threshold_pct = (v.m -> 'teto_antes' ->> 'alarm_threshold_pct')::integer,
       enforcement_effective_at = (v.m -> 'teto_antes' ->> 'enforcement_effective_at')::timestamptz,
       updated_at = now()
  from volta_9176 v
 where b.organization_id = v.org
   and jsonb_typeof(v.m -> 'teto_antes') = 'object';

delete from public.ai_budgets b
 using volta_9176 v
 where b.organization_id = v.org
   and jsonb_typeof(v.m -> 'teto_antes') is distinct from 'object';

-- 4. Confira antes do commit: 4 empresas fora da plataforma, com a chave openai ativa.
select count(*) filter (where not o.ia_segue_a_plataforma) as fora_da_plataforma,
       count(*) filter (where exists (select 1 from public.ai_provider_credentials c
                                       where c.organization_id = o.id and c.provider = 'openai'
                                         and c.is_active and c.validated_at is not null)) as com_chave_openai
  from public.organizations o
  join volta_9176 v on v.org = o.id;

commit;
```

A marca `platform_ia.chaves_proprias_passaram_em` fica: a 9176 não roda de novo depois da volta. Para
passar alguma delas de novo, o caminho é outra migration ou o botão "voltar a seguir a plataforma"
(seção 8). Se alguma tinha `bloquear` antes, a volta religa a parada com a data de antes; em 27/11/2026,
nenhuma das 4 estava em `bloquear`.
