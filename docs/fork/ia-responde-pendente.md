# A IA responde a mensagem pendente do cliente (.107)

Fork MIA, versão .107. Sem migration: usa só colunas e eventos que já existem.

## 1. Os dois casos (produção, 09/11/2026)

**Caso 1, o silêncio de 5 minutos.** Uma pessoa da equipe abriu a conversa e mandou
"ola" pela tela. O envio pela tela silencia a IA naquela conversa por 5 minutos
(`extendBotSilence`, em `app/api/v1/messages/_handler.ts`, grava
`conversations.bot_silenced_until`). O cliente respondeu 21 s depois, dentro do
silêncio. O pedido de turno daquela mensagem (`ai_agent.dispatch_requested`, emitido
por `lib/channels/pos-entrada.ts`) chegou ao drain e a elegibilidade o descartou
(`lib/ai/elegibilidade/gate.ts`, motivo `conversa_silenciada`): o evento vira `done`
sem job. Quando o silêncio acabou, não chegou mensagem nova e nada pediu o turno de
novo. A conversa ficou em "Automático", com o cliente esperando e ninguém
respondendo.

O mesmo buraco aparece quando vence o silêncio do atendimento manual pelo celular
(`lib/escalacao/atendimento-manual.ts`, padrão de 60 min) e quando alguém devolve a
conversa para a IA depois de o cliente já ter escrito.

**Caso 2, a mensagem 28 minutos depois.** Uma segunda mensagem do cliente chegou sem
silêncio na conversa, sem pessoa atribuída, com o gate do número aberto e o agente
no ar, e a IA também não respondeu. Três estados chamavam atenção:

| Estado | Faz a IA pular? |
| --- | --- |
| A conversa em `status='ai_handling'` e `assignee_kind='ai'` (as outras do número ficam `open` e `null`) | Não. É o que `devolverAtendimentoAoAgente` grava (`lib/escalacao/retomada.ts`, passo 2) e prova que alguém clicou em "Devolver ao automático". Nenhum ponto do drain, do gate, da resolução do agente (`resolve-turn-agent.ts`) ou do turno lê esses dois valores para pular. |
| O contato com OUTRA conversa, noutro número da empresa, `status='claimed'` por uma pessoa | **Sim. É a causa.** Ver abaixo. |
| O contato criado à mão | Não. Nada no caminho do turno lê a origem do contato, e a criação à mão não liga `force_human`, `ai_opt_out` nem `is_personal`. |

A causa: "Assumir" passa por `fn_conversation_assign`, que grava
`bot_silenced_until = 'infinity'` na conversa assumida (migration 9054, linha 259). O
veto do turno, `isLeadInHandoff` (`lib/agent-engine/agent/human-handoff.ts`, linha
336), contava o silêncio de QUALQUER conversa do contato (`or exists (select 1 from
conversations v where v.contact_id = c.id and v.bot_silenced_until > now())`). Com a
conversa do outro número assumida, o contato inteiro ficava "em handoff" e o turno
voltava em `lib/agent-engine/agent/inbound-turn.ts` (o handler do job, linha 6742, e
`runAgentTurn`, linha 2395) com uma linha de log ("turno pulado, lead em handoff
humano") e mais nada: nenhum registro em `agent_turn_traces`, nenhum aviso. O drain
não barrava (o gate é por conversa) e a tela dizia "Automático" (`comandoDaConversa`
também é por conversa). O assistente respondia "não achei o motivo".

A regra veio da fusão (Fase 0), quando `bot_silenced_until` era um espelho do
`force_human` do contato. Hoje a coluna também guarda silêncios de uma conversa só:
"Assumir", os 5 min da tela, o celular, "Pausar o automático" e o `#off`.

**A decisão (dono do produto, 10/11/2026): "calada em todos, mas avisando".** A regra
fica: se uma pessoa assumiu QUALQUER conversa do contato, a IA se cala em todos os
números dele. Isso protege o cliente que fala com dois números da empresa
(pré-atendimento com IA e comercial com gente): ele não recebe a IA num número enquanto
negocia com o vendedor no outro. O defeito era a pausa não aparecer em lugar nenhum, e é
isso que a .107 conserta (seção 2.4). Uma primeira versão desta branch fez o veto do
turno contar só a conversa dele; ela foi revertida (commit `323e2097f`) e o upstream
voltou a ser exatamente o que era.

## 2. O conserto

### 2.1 A função única: `lib/escalacao/mensagem-pendente.ts`

`pedirTurnoDaMensagemPendente(db, { organizationId, conversationId, origem, requestId })`
pede o turno da IA para a ÚLTIMA mensagem do cliente quando ela está sem resposta.
Pede só quando tudo isto vale:

- a conversa não é grupo, não está encerrada (`closed`, `archived`, `resolved`) e tem
  contato e canal;
- não está com uma pessoa (`assignee_kind <> 'user'`);
- o contato não está bloqueado, não é pessoal e não está com `force_human`;
- a conversa não está silenciada AGORA (qualquer silêncio em vigor, o `infinity` do
  handoff inclusive);
- a última mensagem do cliente (a mesma ordem do anti-backlog do drain) é fala (não é
  reação, linha de sistema nem histórico importado) e não há saída nenhuma depois dela
  (pessoa, IA, automação ou celular; reação da equipe não conta), pelo relógio do banco
  (`created_at`) dos dois lados;
- ela chegou há até 30 minutos (`JANELA_DA_MENSAGEM_PENDENTE_MS`), medido pelo instante
  mais antigo entre `sent_at` e `created_at`;
- ninguém pediu ainda o turno dela por este caminho, e o pedido original não está mais
  `pending` nem `processing` (se estiver, é o drain que decide).

O pedido é o MESMO evento de uma mensagem normal: `emit_event` com
`ai_agent.dispatch_requested`, `p_entity_kind: "message"`, o id da mensagem do cliente
e o payload de `pos-entrada.ts` campo a campo. O precedente é `reenfileirarTurno`, em
`lib/escalacao/handoff-tecnico.ts`. `metadata.source` diz a origem: `retomada_da_ia` ou
`fim_do_silencio`.

O resto continua com o drain (`lib/agent-engine/edge/crm/drain.ts`) e o turno
(`inbound-turn.ts`), como em qualquer mensagem: organização parada, canal desativado,
agente publicado, anti-backlog, gate do número (modo de teste, allowlist), `ai_opt_out`,
contato interno, horário da IA, janela de resposta do número, debounce e "uma resposta
por mensagem" (`turno-ja-respondido.ts`). Nenhuma dessas regras foi copiada.

**Nunca duas vezes.** Antes de emitir, a função lê os pedidos de turno daquela mensagem
no `event_log` (índice `event_log_entity_idx`). Se já existe um com origem
`retomada_da_ia` ou `fim_do_silencio`, não pede. A corrida residual (dois chamadores
no mesmo instante) cai na coalescência do drain e na guarda "uma resposta por mensagem"
do turno.

A função nunca lança: quem chama acabou de devolver o atendimento ou de varrer, e isso
não pode ser desfeito porque o pedido do turno falhou.

### 2.2 As portas que devolvem para a IA

- `devolverAtendimentoAoAgente` (`lib/escalacao/retomada.ts`) chama a função depois de
  devolver com sucesso, quando havia o que soltar (silêncio, dono, `force_human`). É o
  caminho do botão "Devolver ao automático" (`reactivate-bot`, um e em lote), da tool
  `crm_resume_ai_attendance`, do cron `handoff-devolucao` e do `#on` do celular.
- A devolução já gravava `bot_silenced_until = null`, e isso zera também os 5 min do
  envio pela tela: devolver vale na hora. O silêncio que deve continuar é o que outra
  regra impõe de propósito, e nenhuma delas mora nessa coluna: `ai_opt_out` (a devolução
  recusa antes de escrever), canal desligado ou em manutenção, horário da IA, gate do
  número e organização parada.
- "Liberar" (`app/api/v1/conversations/[id]/release`) é a outra porta da tela que
  devolve ao automático: `fn_conversation_assign` com dono nulo deixa `assignee_kind`
  nulo e zera o silêncio quando não houve handoff formal. A rota agora chama a função;
  com o silêncio mantido (houve handoff), ela recusa por `silenciada_agora`. Não há
  seletor "Automático" separado: o cabeçalho da conversa tem "Assumir", "Liberar",
  "Devolver ao automático", "Pausar o automático" e "Transferir" (para uma pessoa).
- Ficam de fora por `responderPendente: false`: o fechamento com "devolver ao
  automático" (`close`; fechar encerra o assunto e a IA responde a PRÓXIMA mensagem) e o
  `handoff-tecnico.ts` (ele pede o turno da mensagem cuja transcrição chegou).

### 2.3 O fim do silêncio: o cron `ia-pendente`

`app/api/v1/cron/ia-pendente/route.ts`, de minuto em minuto no agendador
(`* * * * *|60|api/v1/cron/ia-pendente`, em `docker/scheduler/entrypoint.sh`), com a
autenticação de todo cron (`autorizaCron`) e auditoria só quando pediu turno ou falhou
(`conversation.pending_reply_requested_run`).

A varredura (`varrerFimDoSilencio`) lê as conversas cujo `bot_silenced_until` venceu
nos últimos 15 min (índice parcial `conversations_bot_silenced_idx`), não grupo, em
estado atendido, com mensagem do cliente nos últimos 30 min; em memória, fica a que
recebeu a mensagem até o fim do silêncio e sem saída depois. São no máximo 50 pedidos
por rodada (200 linhas lidas), do silêncio que venceu primeiro. Cada uma passa pela
mesma função, com `chegouAte` igual ao fim do silêncio: mensagem que chegou depois do
silêncio já passou pelo drain sem veto e não é pedida de novo.

**O infinito nunca entra.** Handoff formal, "Assumir", "Pausar o automático" e `#off`
gravam `'infinity'`, que nunca é `<= now()`.

**Por que ela não acorda conversa antiga em massa.** As três cercas de tempo valem
juntas: silêncio vencido nos últimos 15 min, mensagem dos últimos 30 min e chegada antes
do fim do silêncio, sem saída depois. Na primeira rodada depois da implantação o
alcance é o de qualquer rodada: só o que venceu no último quarto de hora. Conversa
parada há horas não passa.

### 2.4 Calada em todos, mas avisando (caso 2)

O veto do turno é o do upstream, sem mudança: `isLeadInHandoff` conta toda conversa do
contato. O que muda é que a pausa aparece em três lugares, e que a função A não pede
turno que o motor pula.

- **A função A** (`pedirTurnoDaMensagemPendente`) chama o próprio `isLeadInHandoff`
  (pelo pool do processo, `getRequestPool`, com import dinâmico para não fechar o ciclo
  `human-handoff`, `handoff-tecnico`, `retomada`, `mensagem-pendente`). Com o
  contato calado, recusa por `contato_em_handoff`: a devolução e o cron não pedem um
  turno que o motor jogaria fora. A regra é a mesma função, não uma cópia.
- **O registro.** Quando o turno de mensagem pula no handler (`inbound-turn.ts`, logo
  depois de `isLeadInHandoff`) e a causa é OUTRA conversa do contato (com pessoa ou
  calada; esta sem silêncio próprio; o contato sem `force_human`, `ai_opt_out` nem
  etiqueta de contato interno), `registrarPausaPorOutraConversa` grava a linha em
  `agent_turn_traces` com `status = 'aborted'` e `abort_reason =
  'contato_com_pessoa_em_outra_conversa'`, e um log estruturado com a outra conversa.
  A tabela já aceitava `aborted` com motivo: sem migration. A tela de Execuções
  (`/api/v1/ai/turn-traces`) e o assistente leem essa linha.
- **O assistente** diz "Outra conversa deste contato está com (pessoa) no número
  (número) desde (hora)", explica a decisão e o conserto: devolver aquela conversa
  para a IA, ou fechá-la. A ação "Abrir aquela conversa" vai junto.
- **A tela.** Com a conversa em "Automático" e o contato com alguém noutra conversa, o
  cabeçalho mostra a faixa "IA pausada: (Pessoa) está atendendo este contato no número
  (Número)." com o botão "Abrir aquela conversa"
  (`components/inbox/FaixaDaPausaPorOutraConversa.tsx`). O dado vem da consulta que o
  selo do horário da conversa já faz (`/api/v1/ai/horario-da-ia?conversa=`), com o
  campo novo `pausa_por_outra_conversa`: nenhuma requisição a mais. Frases em pt e es
  (`lib/i18n/dicionario-mia-ia-pendente.ts`).

`lib/escalacao/pausa-por-outra-conversa.ts` só NOMEIA a outra conversa (quem, que número,
desde quando); nada ali decide se a IA fala. O assistente e a faixa leem pela SESSÃO:
quem não veria aquela conversa no Inbox (modo "Só os seus") não vê a faixa nem o nome.

### 2.5 O assistente

`lib/assistente/leituras/por-que-a-ia-nao-respondeu.ts`:

- silêncio que já acabou sem turno nenhum depois da mensagem: motivo
  `silencio_acabou_sem_resposta`, a frase diz que o silêncio acabou e a IA não
  respondeu, e que a partir da .107 ela responde sozinha quando o silêncio acaba (e na
  hora, quando alguém devolve a conversa);
- silêncio em vigor continua `ia_silenciada`; `infinity` vira "pausada até alguém
  devolver" (antes virava data inválida e caía em "não achei o motivo");
- número em modo de teste com o contato fora da lista: `numero_em_teste`, com onde se
  muda (Conexões › o número › Configurar acesso da IA);
- número com allowlist e contato sem autorização válida: `contato_sem_autorizacao`.

O gate do número vem antes do silêncio: com o número fechado, a IA não responderia nem
depois de o silêncio acabar.

## 3. Limites (o que ficou de fora)

- **Mensagem com mais de 30 min no fim do silêncio.** No silêncio do celular (padrão de
  60 min), a mensagem que chegou na primeira metade dele já está velha quando o silêncio
  acaba e não é respondida sozinha. É de propósito: responder mais de meia hora depois,
  sobre uma conversa em que a pessoa atendeu pelo celular, tem mais risco do que
  ganho. A janela é uma constante (`JANELA_DA_MENSAGEM_PENDENTE_MS`).
- **O `#on` do celular.** A linha do comando fica gravada como saída do celular, depois
  da mensagem do cliente, e a função lê isso como "já respondida". A IA volta a falar na
  próxima mensagem, como antes.
- **A conversa do caso real de 09/11.** O silêncio dela venceu há muito mais de 15 min e
  a mensagem tem mais de 30: a varredura não a acorda. Precisa de resposta da equipe.
- **Rastro só para a outra conversa.** O turno que volta no início por outro motivo
  (`force_human`, `ai_opt_out`, contato interno, gate do número) continua sem linha em
  `agent_turn_traces`; só o log do worker diz.
- **A faixa e o atendente do modo "Só os seus".** A outra conversa é lida pela sessão; se
  ela é de outro atendente e o modo esconde, a faixa não aparece para ele (gestor e
  administrador veem). A faixa acompanha o selo do horário, que guarda o dado por 60 s:
  depois de devolver a outra conversa, ela pode levar até um minuto para sumir.
- **Corrida de dois chamadores no mesmo instante.** Os dois leem "nenhum pedido" e
  emitem; o drain coalesce e o turno não responde duas vezes a mesma mensagem.

## 4. Testes

`tests/unit/ia-responde-pendente.test.ts` (banco em memória, dados fictícios):

- a função pede o turno com o evento e o payload de `pos-entrada.ts`, e NÃO pede em cada
  recusa: grupo, pessoa atribuída, silêncio em vigor, infinito, conversa encerrada,
  contato bloqueado, pessoal e com `force_human`, mensagem velha, reação, histórico
  importado, já respondida e pedido original na fila;
- reação da equipe não conta como resposta; nunca pede duas vezes; erro não lança;
- a devolução zera o silêncio da tela e pede o turno; com `responderPendente: false`
  não pede; Liberar chama, fechar e `handoff-tecnico` pedem `false`;
- a varredura pega só o que venceu nos últimos 15 min, ignora o infinito, respeita os
  50 e não pede de novo na rodada seguinte; o cron está no agendador;
- o assistente explica o silêncio vencido, o silêncio em vigor, o infinito e o modo de
  teste;
- a função recusa (`contato_em_handoff`) quando o motor cala o contato, pelo
  `isLeadInHandoff` de verdade sobre um pool de mentira; a devolução e a varredura não
  pedem nesse caso;
- o veto do turno segue contando toda conversa do contato, e o turno que pula por outra
  conversa grava o rastro `aborted` com `contato_com_pessoa_em_outra_conversa` (e não
  grava quando a causa é outra);
- o assistente diz quem, em que número, desde quando, e o conserto.

`tests/unit/ia-responde-pendente-faixa.test.tsx`: a faixa em pt e es, só em
"Automático", com e sem dono na outra conversa, com o link para ela; e o cabeçalho a
monta com o comando da conversa.

## 5. Pontos de ligação no código do upstream

Todos com o comentário `FORK MIA (.107)`:

- `lib/escalacao/retomada.ts`: a opção `responderPendente`, a nota no `bot_silenced_until
  = null` e a chamada da função depois da auditoria;
- `app/api/v1/conversations/[id]/release/route.ts`: a chamada da função;
- `app/api/v1/conversations/[id]/close/route.ts`: `responderPendente: false`;
- `lib/escalacao/handoff-tecnico.ts`: `responderPendente: false`;
- `lib/agent-engine/agent/inbound-turn.ts`: uma chamada a `registrarPausaPorOutraConversa`
  no pulo do handler, e o import;
- `components/inbox/ConversationHeader.tsx`: a faixa, e o import;
- `lib/i18n/dicionario.ts`: o espalhamento do dicionário nosso;
- `lib/audit/actions.ts`: a ação `conversation.pending_reply_requested_run`;
- `docker/scheduler/entrypoint.sh`: a linha do cron.

`human-handoff.ts`, o resto de `inbound-turn.ts`, `roteiro-no-turno.test.ts` e o
invariante `comando-da-conversa-espelha-o-ts` estão como no upstream.

Arquivos nossos: `lib/escalacao/mensagem-pendente.ts`, `lib/escalacao/pausa-por-outra-conversa.ts`,
`app/api/v1/cron/ia-pendente/route.ts`, `components/inbox/FaixaDaPausaPorOutraConversa.tsx`,
`lib/i18n/dicionario-mia-ia-pendente.ts`, a rota e o hook do horário da IA
(`app/api/v1/ai/horario-da-ia/route.ts`, `hooks/ai/useHorarioDaIa.ts`, do fork desde a .85),
`tests/unit/ia-responde-pendente.test.ts`, `tests/unit/ia-responde-pendente-faixa.test.tsx` e o
assistente (`lib/assistente/leituras/por-que-a-ia-nao-respondeu.ts` e a descrição da
ferramenta em `lib/assistente/ferramentas.ts`, do fork desde a .88).
