# O assistente da MIA (.88, .91 nos primeiros passos e .93 o assistente ensina)

O chat que a equipe de cada cliente usa dentro do sistema: a rotina do dia ("como
está minha rotina hoje?", "por onde eu começo?"), os números ("como estão meus
leads?", "minha performance no mês") e o uso do sistema ("como configuro o horário
da IA?"). Quando não sabe, diz que não sabe e manda a pergunta ao suporte da Time
Company; erro e pedido viram **chamado**.

Protótipo aprovado em 24/10/2026 (8 telas, 18 regras). É a **fase 1** da spec do
upstream (#2860, "agente interno de configuração e rotina", fechada sem código): o
chat de leitura. Na .91 (jornada de assinatura, protótipo aprovado em 25/10/2026) ele
ganhou a parte da **fase 2** (propostas com aprovação, só três peças) e da **fase 3**
(a auditoria da empresa, "o que falta", com retrato guardado) que serve à entrada de um
cliente novo: veja a seção 9 e [`primeiros-passos.md`](primeiros-passos.md). O laço de
retorno (fase 4) fica para depois.

## 1. A regra que não se dobra

**O assistente não tem acesso próprio.** O turno lê o CRM com o cliente da SESSÃO de
quem perguntou, e a RLS e o papel filtram como nas telas: o atendente vê os próprios
números, o gestor e o administrador veem a equipe. O cliente de serviço é proibido
dentro do turno:

- `lib/assistente/turno.ts` recusa o cliente montado com a chave de serviço (ou com a
  marca do `createAdminClient`) antes de qualquer leitura (`exigirClienteDeSessao`);
- o turno, as ferramentas e as leituras não importam o cliente de serviço nem o pool;
- `tests/unit/assistente-turno-usa-a-sessao.test.ts` prova as três coisas, com a
  sabotagem (tirar a guarda deixa 1 vermelho de 14).

Duas preparações usam o cliente de serviço FORA do turno, e as duas são as mesmas que
o produto já fazia: o diretório de nomes da equipe (`lib/assistente/diretorio.ts`, o
mesmo de `/api/v1/team/assignable`, que qualquer atendente já recebe) e o pool do seam
de modelo (telemetria e orçamento em `llm_calls`, `lib/assistente/modelo.ts`).

## 2. As peças

| peça | onde |
|---|---|
| botão "Assistente" no topo, ao lado do sino; abre o painel ao lado de qualquer tela e sabe em que tela a pessoa está | `components/assistente/BotaoDoAssistente.tsx` (em `components/shell/TopBar.tsx`) |
| o painel (conversa, sugestões, "de onde veio", botões) | `components/assistente/PainelDoAssistente.tsx`, `MensagemDoAssistente.tsx`, `CartaoDoChamado.tsx` |
| a página: histórico, resumo da manhã, chamados; para o administrador, "como trabalhamos aqui", quem usa e as perguntas sem resposta | `app/app/assistente/` (porta no `NAV_CATALOG`, hub do CRM, "O dia a dia da venda") |
| o turno e as ferramentas de leitura | `lib/assistente/turno.ts`, `ferramentas.ts`, `leituras/*.ts` |
| o ponto de IA `assistente` | `lib/ai/pontos/registro.ts` (papel "entender", natureza "sistema") |
| as rotas | `app/api/v1/assistente/{chat,chamados,chamados/[id]/print,pedir,preferencias,empresa}` |
| os chamados do lado da Time | `/admin/chamados` e `app/api/v1/admin/chamados/*` |
| o resumo da manhã e a retenção | `lib/assistente/resumo-da-manha.ts`, cron `assistente-resumo-da-manha` |
| o MCP de plataforma | `lib/mcp-plataforma/ferramentas/assistente.ts` ([`mcp-de-implantacao.md`](mcp-de-implantacao.md)) |
| o schema | 9050 (tabelas, RLS, bucket, gatilhos), 9051 (LGPD e retenção) e 9052 (o índice dos contatos citados) |

## 3. O que o assistente lê (ferramentas só de leitura)

| ferramenta | de onde vem o número |
|---|---|
| `ver_minha_rotina` | `crm_tasks`, `calendar_appointments`, `conversations` (a aba Minhas e a Fila do Inbox), `channel_sessions` (só o administrador) |
| `ver_prioridades` | as mesmas, mais o Radar e a meta, na ordem do protótipo: algo parado na empresa, cliente esperando, compromisso do dia, atraso, meta |
| `ver_meus_leads` | `crm_leads` abertos por dono e o Radar (`carregaRadarDeRisco`, a mesma função da tela) |
| `ver_minha_performance` / `ver_numeros_da_equipe` | o motor de relatórios do fork (`fn_mia_relatorio`, `security invoker`) e a meta (`lerMetasDoMes`, a MESMA leitura do `GET /api/v1/metas`) |
| `ver_por_que_a_ia_nao_respondeu` | a conversa pela sessão (o atendente só acha as suas), o opt-out, quem está com a conversa, o número, o agente no ar, o horário da IA (.85) e `agent_turn_traces` (v1.88) |
| `buscar_ajuda` | os manuais e roteiros do fork, o guia de operação do upstream, o catálogo de navegação e a base própria da empresa (seção 9) |
| `ver_contato` | o nome; telefone e e-mail só quando a pessoa pediu |

Desde a .91, mais quatro (seção 9): `ver_o_que_falta` (leitura) e as três propostas,
`propor_agente_do_modelo`, `propor_funil_do_pacote` e `propor_followup_do_modelo`, que
PREPARAM a peça sem gravar nada no turno.

E quatro que só põem botão na resposta: `mostrar_me_leva_la` (só tela que a pessoa
abre), `oferecer_pedir_a_pessoa`, `registrar_que_nao_sei` (vira "Mandar ao suporte" e
entra na lista do administrador) e `preparar_chamado` (antes de um Erro, confere se é
só um campo faltando, pela última recusa que a tela viu, `lib/assistente/ultima-recusa.ts`).
Nenhuma escreve: pedir, mandar e abrir chamado são cliques da pessoa.

O "de onde veio" de cada resposta sai do que as ferramentas DE FATO leram, não do que
o modelo diz ter lido. Nenhuma ferramenta lê texto de conversa.

## 4. Os chamados

Erro, Dúvida ou Pedido. O contexto (tela, hora, versão, navegador, mensagem do sistema)
é montado no servidor; o print é opcional, no bucket privado `mia-assistente`. O
gatilho `fn_mia_chamado_nasce` faz o chamado nascer da própria pessoa, "novo", sem
resposta, com o número da sequência, e a marca de demonstração vem da EMPRESA. Na
demonstração ele fica no assistente e não sai: não aparece no admin, não vai recado ao
grupo interno. Fora dela, o grupo interno da Time recebe o número e a empresa (nunca o
texto). A resposta chega a quem abriu no assistente, no sino e no e-mail.

## 5. O limite e o custo

A IA é da plataforma: 50 perguntas por pessoa por dia (padrão), ajustável por empresa
pelo MCP, contadas no banco pela sessão (a pessoa não apaga as próprias perguntas). O
gasto entra no consumo de IA da empresa (`llm_calls`, ponto `assistente`). O custo em
dinheiro segue a doutrina do fork (`lib/ai/custo-e-da-plataforma.ts`): só a plataforma
o vê, no `plataforma_ver_assistente`; o cliente não.

## 6. Histórico, resumo da manhã e LGPD

- Cada pessoa vê só o seu histórico; o administrador vê só as PERGUNTAS sem resposta.
- Retenção de 90 dias (`fn_mia_expurgar_assistente_vencido`, piso de 30), e os chamados
  resolvidos há mais de um ano; o print sai pela fila de remoção do upstream.
- A mensagem guarda os contatos que cita (`contatos`): anonimizar o contato apaga o
  texto dela (bloco 6 de `fn_redigir_o_que_sobrou_do_contato_anonimizado`, 9051), e o
  acesso do titular a coleta (`assistente_da_mia`, seção da equipe: vai no relatório e
  não no arquivo dele, como a conversa com a IA sobre o caso).
- O acesso do titular procura por IGUALDADE, como toda outra seção do coletor: a lista
  vira o índice `mia_assistente_citacoes` (9052, mantido por gatilho, só do servidor), e
  o coletor lê as citações pelo `contact_id` e depois as mensagens. A primeira versão
  usava "contém" (`cs`) e reprovou no CI: nenhum dublê do coletor nem ponte SQL dos
  invariantes responde esse operador.
- O resumo da manhã nasce desligado; cada pessoa liga o seu. Em dia útil (sem sábado,
  domingo e feriado nacional), às 8h no fuso da empresa, o cron escreve o plano do dia
  sem IA nenhuma (as mesmas leituras e a mesma ordem) e avisa no sino.

## 7. Os pontos de ligação no código do upstream (lista fechada)

| arquivo do upstream | o que entrou (marcado FORK MIA) |
|---|---|
| `components/shell/TopBar.tsx` | o botão do assistente |
| `lib/navigation/catalogo.ts`, `registry.ts` | a porta e o ícone |
| `lib/ai/pontos/registro.ts`, `lib/ai/custo/natureza.ts` | o ponto de IA e a natureza do gasto |
| `lib/ai/inbox-destino.ts` | as referências `mia_chamado` e `mia_assistente_resumo` |
| `lib/api/client.ts` | a anotação da última recusa do servidor |
| `lib/audit/actions.ts` | os códigos `assistente.*` |
| `lib/lgpd/export-collector.ts`, `copia-do-titular.ts` | a seção `assistente_da_mia` |
| `lib/i18n/dicionario.ts` | o dicionário do assistente |
| `components/admin/AdminSidebar.tsx` | a porta dos chamados |
| `docker/scheduler/entrypoint.sh` | o cron |
| `lib/ai/agents/publish.ts` (.91) | o follow-up proposto sai junto com o agente publicado (import dinâmico de `lib/assistente/propostas/sai-com-o-agente.ts`) |
| `components/admin/AdminSidebar.tsx` (.93) | a porta "Assistente nos clientes" (`/admin/assistente`) |
| as telas do upstream das trilhas (.93) | um `data-testid` por elemento que a trilha destaca, onde faltava (seção 11) |

## 8. Para voltar ao upstream

O desenho e os nomes seguem a spec #2860 (o turno sem `send_message`, as ferramentas de
leitura, o ponto próprio no registro, a porta no topo junto do sino). As tabelas levam
o prefixo `mia_` para não colidir com as `config_threads`/`config_messages` que a spec
propõe: no dia em que o upstream construir a fase 1, a troca é de nome, não de forma.

## 9. Os primeiros passos (.91): "o que falta" e as propostas

O assistente aparece como painel ao lado nos primeiros passos (o `/onboarding` do
upstream e o Início, `/app/inicio`), o MESMO `PainelDoAssistente` desta página, com as
sugestões e a saudação do contexto. Quem vê, e por quê, está em
[`primeiros-passos.md`](primeiros-passos.md).

**`ver_o_que_falta`.** O "o que falta" é o checklist do MCP
(`plataforma_ver_implantacao`), avaliado com o cliente da SESSÃO
(`lib/assistente/leituras/o-que-falta.ts` → `avaliarAreas`) e lido no rótulo do cliente
(`lib/mcp-plataforma/checklist/rotulo-do-cliente.ts`): preenchido, posso completar,
preciso confirmar e não se aplica, com a dependência de cada item. Não existe segunda
régua. A área que o papel não lê fica "não medida" e o item dela sai do rótulo, em vez
de virar uma pendência que não é verdade. A única coisa da instalação que a sessão não
lê, a chave da cobrança, a rota lê fora do turno (como o layout de `/app`) e passa pronta.

**As três propostas.** Uma proposta é UMA peça (`lib/assistente/propostas/`):

| ferramenta | a peça | nasce como |
|---|---|---|
| `propor_agente_do_modelo` | o agente de exemplo da demonstração do segmento (`lib/onboarding/modelos-de-agente-da-mia.ts`), com o nome e o texto do modelo | RASCUNHO; vira o agente padrão se a empresa não tem um |
| `propor_funil_do_pacote` | o quadro pronto do segmento, no lugar do quadro de e-commerce que veio com a empresa | o funil padrão da empresa |
| `propor_followup_do_modelo` | o follow-up do modelo do segmento, armado no rascunho do agente, só em horário comercial (8h às 19h, dia útil) | rascunho; SAI JUNTO com o agente publicado |

- **Propor não cria nada.** O turno só LÊ (com a sessão) e junta a proposta no coletor;
  a rota do chat grava a linha PENDENTE em `mia_assistente_propostas` (9080), pela
  sessão, e põe o cartão na resposta (`AcaoDoAssistente` do tipo `proposta`). Pedir de
  novo a mesma peça devolve a mesma pendente (uma por peça e empresa).
- **Quem pede:** gestor e administrador. O atendente recebe a recusa com quem pode.
- **Quem aplica:** só o administrador, no cartão ("Aprovar e aplicar", desabilitado
  para os outros, com o porquê ao lado). `POST /api/v1/assistente/propostas/[id]`
  exige o papel de administrador para `aplicar` (gestor para `rejeitar`), passa pela
  guarda do suporte e grava o registro (`assistente.proposta_aplicada`,
  `_rejeitada`, `_falhou`). A peça nasce pelo caminho da implantação
  (`garantirAgente`, `garantirFunil`, `garantirFollowup`), o mesmo do MCP.
- **A ordem é do banco:** pendente → aprovada → aplicada (ou rejeitada, expirada). O
  gatilho `fn_mia_proposta_segue_a_ordem` recusa aplicar sem aprovar, mesmo pelo
  servidor (a sabotagem que o desenho do upstream pede, provada em
  `tests/invariants/primeiros-passos-do-assistente.test.ts`).
- **Nada crítico é proposto.** Canal, número, cobrança, usuários, convite, chave e
  exclusão não têm ferramenta, e o banco recusa o risco `critico`: no "o que falta"
  eles são "preciso confirmar", com o botão da tela.
- **O follow-up sai junto com o agente publicado.** Publicar o agente (pela tela, pelo
  passo a passo ou pelo MCP) passa por `publishAgentVersion`; o gancho
  `publicarFollowupsQueSaemComOAgente` publica o fluxo proposto que a versão publicada
  carrega armado, e anota `saiu_com_o_agente_em`. Sem quem publicou, não sai.

**O retrato** (`mia_assistente_retratos`, 9081): a cada rodada do "o que falta" de quem
administra, o servidor guarda as contas e a coluna de cada item, só quando algo mudou.
É o "ao entrar faltavam N, agora faltam M" e o "zerou" que tira o bloco do Início.

**No MCP** (seção .91 de [`mcp-de-implantacao.md`](mcp-de-implantacao.md)):
`plataforma_ver_implantacao` devolve o rótulo do cliente; a Time vê as propostas de uma
empresa com `plataforma_ver_propostas_do_assistente` e decide com
`plataforma_decidir_proposta_do_assistente`.

## 10. A ajuda de uso cobre todas as telas (.92)

Em 26/10/2026 o Gabriel perguntou, na tela "Servidor MCP externo", "como eu uso o mcp
aqui", e o assistente respondeu que não sabia: os manuais tinham 19 assuntos e nenhum
falava da tela. A causa era cobertura. Desde então o `buscar_ajuda` lê quatro fontes,
todas pela mesma régua (`lib/assistente/busca-da-ajuda.ts`):

| fonte | onde | "de onde veio" |
|---|---|---|
| manuais das telas e do dia a dia | `lib/assistente/manuais.ts`, `manuais-das-telas.ts` | Manual do sistema |
| roteiros (tarefas que cruzam telas: começar a atender, campanha, a IA está vendendo, ligar o Claude) | `lib/assistente/roteiros.ts` | Manual do sistema |
| o guia de operação do upstream, tela a tela | `lib/assistente/guia-de-operacao.gen.ts` (gerado) e `guia-de-operacao.ts` | Guia de operação |
| o mapa das telas e a base da empresa | `NAV_CATALOG` e `mia_assistente_conhecimento` | Mapa das telas, Como trabalhamos aqui |

- **A busca:** sem acento e sem maiúscula; um radical leve que não junta "conversa" com
  "conversão"; sinônimos do jeito que a equipe fala (MCP, token e chave, número e
  WhatsApp, follow-up e retomada); palavra rara pesa mais. A tela em que a pessoa está
  pesa: "como uso isso aqui" traz a ajuda dela primeiro. Volta no máximo 3 manuais, 3
  trechos curtos do guia e 3 telas.
- **MCP é duas coisas.** O Servidor MCP externo (a IA da empresa consulta um sistema de
  fora; tela do dono da instalação) e o MCP da MIA (`/api/mcp`, token criado em API
  Tokens pelo administrador, com `mcp:read` e `mcp:write`). Cada manual traz o outro em
  `veja_tambem`, e o assistente responde pela tela em que a pessoa está.
- **O guia do upstream** mora em `.claude/skills/deskcomm-operacao/`, que a imagem não
  leva. `scripts/gerar-guia-de-operacao.ts` gera o módulo; a cerca
  `assistente-guia-de-operacao` fica vermelha quando a fusão trouxer o guia novo. Onde o
  código da MIA desmente o guia (o MCP externo tem tela; modelo, chave e marca são da
  plataforma), a correção é `SUPERADOS_PELO_CODIGO`, nunca o guia nem o gerado.
- **As cercas:** `assistente-ajuda-cobre-todas-as-telas` (toda tela principal do app,
  inclusive cada subpágina de Configurações, tem ajuda própria; toda subpágina é
  alcançada) e `assistente-perguntas-reais` (uma pergunta por tela e por roteiro, com a
  tela de onde veio; o trecho certo entre os 3 primeiros, sem IA).
- **Tela nova:** escreva o manual em `manuais-das-telas.ts` lendo o código da tela e
  acrescente a pergunta em `assistente-perguntas-reais`. Sem isso o CI reprova.

## 11. O assistente ensina (.93): "Me mostra como", as trilhas e onde os clientes travam

Protótipo aprovado em 26/10/2026, sem mudanças (`Prototipo-assistente-ensina-e-faz-2026-10-26.html`,
telas 1, 2, 6 e 7 e as decisões 8 a 13). Esta entrega é a parte ENSINAR; a parte "fazer com
aprovação" (telas 3 a 5) é da .94.

**A regra que não se dobra continua: ele nunca clica pela pessoa.** O "Me mostra como" destaca o
elemento de cada passo na tela de verdade, espera a pessoa fazer e confere no sistema, com o login de
quem usa. A única coisa que a guia faz sozinha é levar até a tela do passo ("Me leva até lá").
`tests/unit/assistente-trilhas-marcadores.test.ts` reprova se a guia passar a clicar ou disparar evento.

| peça | onde |
|---|---|
| o catálogo: 12 trilhas e o guia curto do negócio perdido, cada passo com a tela, o marcador, o que confere e de onde retoma | `lib/assistente/trilhas/catalogo.ts` (módulo puro) |
| as leituras que conferem (o número conectado, o funil salvo, a versão publicada...), pela SESSÃO | `lib/assistente/trilhas/leituras.ts` |
| o progresso por pessoa, "feita" só depois de o sistema conferir, o "já fiz", a contagem por passo | `lib/assistente/trilhas/progresso.ts`, `estado.ts` |
| a rota da sessão (`GET` a situação de cada trilha; `POST` começar, retomar, avançar, pausar, conferir, já fiz, pergunta) | `app/api/v1/assistente/trilhas/route.ts` |
| a guia na tela (o recorte e o balão, por cima da janela aberta, sem roubar o foco dela) | `components/assistente/trilhas/GuiaNaTela.tsx`, montada ao lado do botão do topo (`BotaoDoAssistente`) |
| a aba Trilhas (tela 2), o botão "Me mostra como", a abertura do painel, a recomendada no Início | `TrilhasDoAssistente.tsx`, `BotaoMeMostraComo.tsx`, `MeMostraComoNoPainel.tsx`, `TrilhaRecomendada.tsx` |
| o "Me mostra como" na resposta de "como faço" | `lib/assistente/trilhas/da-ajuda.ts`, chamado por `buscar_ajuda` (ação `me_mostra_como`) |
| o lembrete da pausa no resumo da manhã e a retenção | `lib/assistente/trilhas/lembrete.ts`, chamado por `resumo-da-manha.ts` |
| onde os clientes travam (tela 6) e a lista de melhorias | `lib/assistente/trilhas/onde-travam.ts`, `melhorias.ts`, `/admin/assistente`, `app/api/v1/admin/assistente/*` |
| o MCP de plataforma | `lib/mcp-plataforma/ferramentas/trilhas-do-assistente.ts` (seção .93 de [`mcp-de-implantacao.md`](mcp-de-implantacao.md)) |
| o schema | 9090 (`mia_assistente_trilhas`, `mia_assistente_trilhas_config`, a retenção) e 9091 (`mia_melhorias_do_produto`) |

**As trilhas.** Pôr de pé: ligar o primeiro número, montar o agente, criar um funil, configurar o
follow-up, o horário da IA e convidar a equipe. Vender mais: montar um relatório, campanha de
Broadcast, campanha de e-mail e importar contatos. Dia a dia (decisão 8): criar uma resposta rápida e
assumir e devolver uma conversa para a IA. E o guia curto "Marcar um negócio como perdido". O papel
mínimo de cada uma é o MESMO da tela: quem não faz lê os passos e pede a quem pode.

**Como confere.** Os passos que abrem uma tela ou uma janela conferem o que está na tela (a rota, o
marcador apareceu, o campo preenchido, a opção escolhida). Os que gravam conferem no banco, pela rota
das trilhas, com a sessão: a guia pergunta de 4 em 4 segundos enquanto a aba está à vista, e "Pronto,
confere" pergunta na hora. As trilhas da empresa (número, agente, horário da IA, convite) olham o
estado de agora; as de cada pessoa contam o que apareceu DEPOIS que ela começou (`comecou_em`, que é
o banco que grava). "Já fiz por outro caminho" confere o objetivo inteiro; se não confere, conta no
passo (a Time vê). Não existe botão de concluir: o último passo de toda trilha é uma leitura do sistema
(a cerca cobra).

**Pausar e retomar.** O passo fica no banco, por pessoa (o "onde parei" de uma pessoa não muda o de
ninguém). Retomar volta ao passo que abre o que se perdeu (`retomaEm`: a janela que estava aberta) e
leva até a tela. Dentro da mesma aba, a guia sobrevive à navegação (`sessionStorage`).

**Onde o destaque se prende.** Nos `data-testid` que o sistema-base usa nos testes; onde faltava,
entrou um marcador nosso, de uma linha, com o comentário `FORK MIA (.93)` (lista abaixo).
`tests/unit/assistente-trilhas-marcadores.test.ts` reprova a versão quando um passo aponta para um
marcador que sumiu do código ou para uma tela que não existe mais, com a sabotagem que prova o dente.

**O guia curto de qualquer manual.** Toda resposta de "como faço" que tem tela ganha o "Me mostra
como": se o manual que responde tem trilha, o botão começa a trilha; se não, começa o guia curto do
manual (abrir a tela, conferida, e os passos do manual, um a um). O guia curto do manual não grava
progresso.

**As decisões adotadas.**

- 8: as duas trilhas do dia a dia entraram.
- 9: todas as empresas e todos os papéis veem as trilhas, cada um as suas; o "o que falta" continua só
  da empresa nova, e cada item "preciso confirmar" dele ganhou o botão da trilha que ensina.
- 10: funciona na demonstração; `plataforma_reaplicar_demonstracao` (a semente,
  `lib/demonstracao/semente/aplicar.ts`) apaga o progresso das trilhas e as propostas da empresa de
  demonstração.
- 11: a trilha pausada é lembrada UMA vez, no resumo da manhã seguinte, só para quem tem o resumo
  ligado (a pausa é de antes do dia e de até 4 dias atrás, por causa do fim de semana); o resumo mora
  no assistente e no sino, nunca no WhatsApp. O gatilho da 9090 zera a marca a cada pausa nova, e a
  sessão não a escreve.
- 12: a Time vê números juntados por tema, trilha, passo e proposta, e o texto só das perguntas sem
  resposta, sem quem perguntou (e-mail, telefone e documento mascarados). O tema de cada pergunta é o
  manual que a MESMA busca do "como faço" traria, sem IA. As empresas de demonstração não entram.
- 13: a lista de melhorias mora em `/admin/assistente` (9091), com o MCP lendo e escrevendo; o título
  é a chave.

**Não gasta IA.** Começar, andar, conferir e terminar uma trilha não passa pelo modelo e não conta no
limite de perguntas do dia. Só a conversa livre conta. Durante um passo, a pergunta feita ao
assistente soma 1 no passo (só o número).

**Os marcadores novos no código do upstream** (uma linha cada, `FORK MIA (.93)`): Conexões
(`ConnectionsClient`, `PairingOptions`, `RenomearConexao`), Agentes (`AgentsList`, `AgentCard`,
`AgentForm`, `AgentTabs`), Follow-ups (`FlowsList`), Equipe (`team/page`, `InviteForm`), Contatos
(`contacts/_client`, `ImportContactsDialog`), Respostas rápidas (`TemplatesClient`,
`TemplateFormDialog`), Inbox (`InboxFilters`, `ConversationListItem`, `ConversationHeader`,
`Composer`), funil (`KanbanCard`, `CartaoAberto`, `LoseLeadDialog`) e Broadcast (`ListaDoBroadcast`,
`NovoDisparo`, `FormularioDoOficial`). Nos arquivos do fork: `HorarioDaIaEditor`, o montador de
relatórios e o cartão do e-mail. E, na lista fechada da seção 7: `components/admin/AdminSidebar.tsx`
(a porta "Assistente nos clientes"), `lib/audit/actions.ts` (`assistente.trilhas_configuradas` e
`assistente.melhoria_anotada`) e `lib/i18n/dicionario.ts` (`dicionario-mia-trilhas.ts`).

**O que fica para depois, de propósito** (do protótipo): aprovar em lote, trilha escrita pela própria
empresa, vídeo curto em cada passo e o laço de retorno por empresa em Evolução da IA.
