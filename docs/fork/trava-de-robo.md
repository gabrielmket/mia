# A trava de robô (.108)

Fork MIA, versão .108. Migrations 9153 e 9154 (carimbo `20261112120100_9154_registros_da_trava_de_robo`).
O sinal D, o ritmo de máquina (MIA-210), entrou depois, com a migration 9171 (seção 2.6).

## 1. O caso

Uma empresa recebe no WhatsApp as mensagens do ROBÔ de outra empresa. No formato do caso real, com dado
fictício: a cada mensagem nossa chega "Olá." e um menu longo terminado em
"_Mensagem enviada pela inteligência artificial da Operadora Exemplo_"; de vez em quando chega também
"Eu entendo melhor frases mais curtas...". A IA da MIA responde a cada ~30 s, e o robô responde de novo.
No caso real foram 80 minutos e uns 150 turnos gastando token.

O que existia: `ehRespostaDeRobo` e `MARCAS_DE_ROBO` (`lib/agent-engine/agent/human-handoff.ts`, issue 3106
do upstream) só impedem que o menu do robô abra uma passagem para humano. Depois disso o turno ia para o
modelo, que reconhecia o robô mas não tinha como parar. Não havia teto de respostas por conversa: o
`tool-breaker.ts` é só de ferramentas dentro do turno. O upstream não tem nada além disso.

**O pedido do dono:** quando o outro lado for robô ou IA, a IA para, o lead é marcado como PERDIDO e a
conversa é ENCERRADA. Vale para todas as empresas, ligado por padrão.

## 2. As regras

A decisão é determinística, sem LLM, e mora em `lib/trava-de-robo/deteccao.ts` (pura).

### 2.1 Mensagem "de robô"

É a mensagem RECEBIDA (fala: não é reação, linha de sistema nem histórico importado) com pelo menos um
destes sinais:

| sinal | o que é |
|---|---|
| A · autodeclaração | a mensagem fala de SI como automação: "mensagem enviada pela/por (a) inteligência artificial / IA / assistente virtual / robô / bot" no começo da linha, "esta é uma mensagem automática", "esta mensagem foi enviada automaticamente", o título "Mensagem automática" ou "Atendimento automático" sozinho no começo da linha, "sou a assistente virtual", "sou a Sofia, assistente virtual da ...", "sou a inteligência artificial da ...", "aqui é a assistente virtual", "este é o nosso atendimento automático", "você está sendo atendido pelo nosso assistente virtual". Mais as duas marcas do upstream (`ehMensagemDeRobo`). |
| B · repetição | o texto normalizado (sem acento, caixa, formatação do WhatsApp ou espaço extra) já chegou 2 vezes ou mais nesta conversa nas últimas 2 horas: a 3ª ocorrência conta. Só para texto de 20 caracteres ou mais (`MINIMO_DE_CARACTERES_DA_REPETICAO`). |
| C · velocidade impossível | texto de 80 caracteres ou mais que chega depois de uma mensagem nossa a mais de 15 caracteres por segundo. Os dois relógios são o do banco (`created_at`). |

A disciplina de A é a de `MARCAS_DE_ROBO`: só autodeclaração. Gente reclamando do NOSSO robô não casa:
"cansei de mensagem automática de vocês", "aqui é o bot de novo?", "não sou um robô", "esse atendimento
automático de vocês é péssimo", "a mensagem enviada pelo robô de vocês não ajudou". Linha com "?" é
pergunta e fica de fora das frases da trava, e "de vocês" depois de "mensagem/atendimento automático"
desliga a frase.

### 2.2 O giro e o disparo

Um GIRO é uma resposta da IA (`messages.sent_via = 'ai'`; vários balões seguidos são uma resposta só)
seguida de mensagem de robô. Várias mensagens do robô depois da MESMA resposta da IA ("Olá." e o menu)
contam um giro.

**A trava dispara** quando, numa janela de 15 minutos, há 3 giros. Até disparar, o comportamento não
muda em nada.

### 2.3 O teto

A última proteção: no máximo 30 respostas (turnos) da IA por conversa em 60 minutos. Uma resposta é a
sequência de balões da IA sem nada no meio. A ordem é o laço com robô, depois o ritmo de máquina (2.6),
depois o teto: o teto só vale quando os outros dois não dispararam.

### 2.4 A conta recomeça depois de cada registro

As contas só olham o que chegou DEPOIS do último registro da trava naquela conversa
(`mia_travas_de_robo`). Quem devolve a conversa para a IA não a vê travar de novo no giro seguinte por
causa dos giros que já foram contados: são precisos 3 giros novos (6 giros de ritmo novos, ou 30
respostas novas).

### 2.5 Por que a saudação automática única não dispara

A empresa abordada costuma ter uma saudação automática ("Olá! Esta é uma mensagem automática. Obrigado
pelo contato, em breve respondemos."). Ela casa o sinal A, mas é UM giro: depois dela responde uma
pessoa, e as falas dessa pessoa não têm sinal nenhum. Três giros só acontecem quando há um laço, isto é,
quando cada resposta da IA é devolvida por automação. É também por isso que a trava conta giros, e não
mensagens: o "Olá." e o menu depois da mesma resposta são uma volta só.

### 2.6 O ritmo de máquina (sinal D, MIA-210)

**O buraco.** O robô que varia o texto, responde curto e devagar passa por baixo de A, B e C: não se
declara, a 3ª cópia do mesmo texto quase nunca chega, e 40 caracteres em 15 s dão 3 caracteres por
segundo. O caso medido (desenho da MIA-211) foi um laço de despedida, um por dia, com 8 a 13
agradecimentos variados por episódio e a IA respondendo a todos. A marca que sobra é o relógio: o outro
lado respondeu entre 13 e 22 s em todos os giros. Gente não faz isso.

**O giro de ritmo** é a última resposta da IA (o último balão) seguida da PRIMEIRA mensagem recebida
depois dela. Essa mensagem tem de ser de TEXTO com corpo, sem saída da equipe (ou da automação) no
meio. A latência é a diferença dos `created_at` (o relógio do banco). O 2º balão do outro lado depois
da mesma resposta não conta nem quebra.

**Dispara** quando os últimos 6 giros SEGUIDOS (`ritmo_giros`):

- cabem na janela de 15 minutos (`janela_minutos`, a mesma do laço), a contar da resposta da IA do 1º;
- têm cada latência em até 60 s (`ritmo_latencia_maxima_segundos`);
- e a maior latência menos a menor fica em até 8 s (`ritmo_variacao_segundos`).

**Quebram a sequência:** a recebida que não é texto (áudio, imagem, figurinha), a latência acima do
máximo, a mensagem da equipe e o registro anterior da trava (`desde`). Reação e linha de sistema não
entram na conta, como nos outros sinais.

**A ação é a do TETO (3.2), não a do laço.** O ritmo é indício, não autodeclaração: errar no laço marca
o negócio como perdido, encerra a conversa e cala o contato em todos os números (`force_human`), e isso
custa um lead de verdade. A pausa do teto não perde nada e se desfaz com "Devolver ao automático". O
registro tem `motivo = 'teto'`, `mensagens_de_robo` igual ao número de giros e, em `sinais`, cada
recebida dos giros com o sinal `ritmo` (somado ao que ela já tinha de A, B ou C). Nenhuma CHECK da 9154
muda, o rastro continua `teto_de_respostas_da_ia` e o assistente responde como no teto. O texto da nota
e do aviso é o do teto; o número e a duração passam a ser os da sequência ("a IA respondeu 6 vezes em
4 min"), e não as respostas da hora. No teto comum os dois são o mesmo número.

**A margem é de um passo** (replay do desenho, 90 dias de clientes e 120 dias da Time): com 6 giros e
8 s, zero conversas de gente disparam e os 4 robôs conhecidos disparam. Com 5 giros, ou 15 s de
variação, 2 conversas de gente disparariam em 90 dias; com 4 giros, 5. Por isso o padrão não fica
abaixo de 6 giros e 8 s. `ritmo_ligado: false` desliga só este sinal numa empresa, sem desligar o laço
e o teto.

## 3. Quando dispara

No turno que dispara, o modelo NÃO é chamado e nada é enviado ao contato. A trava fica no handler do
`inbound_turn` (`createInboundTurnHandler`, `lib/agent-engine/agent/inbound-turn.ts`), depois das travas
de sempre (handoff e elegibilidade) e ANTES de escolher o agente: nem o roteador nem o Jev são chamados.

### 3.1 O laço com robô (`aplicarTravaDeRobo`, `lib/trava-de-robo/aplicar.ts`)

1. **A IA fica calada para o contato, de forma durável:** `contacts.force_human = true`, a mesma trava
   do handoff. Ela vale em todo número da empresa e em conversa nova, sobrevive ao encerramento (que
   zera o silêncio da conversa quando não houve passagem) e é lida pelos três guardas do motor
   (`isLeadInHandoff`, o worker nativo e o `before-send`). Assim, uma nova mensagem do robô não reabre o
   laço. É o primeiro passo e o único que derruba o turno se falhar: o job é refeito e a avaliação roda
   de novo.
2. **A etiqueta "robô"** vai no contato, com o evento `contact.tag_added` (o mesmo da tela).
3. **Os follow-ups e as réguas** do contato são cancelados: os `cron_jobs` ligados (follow-ups agendados
   e retornos prometidos) ficam `enabled = false` com `cancelled_at` e `cancel_reason`, e as inscrições
   vivas de régua (`followup_enrollments`) viram `cancelled`, com o evento `trava_de_robo_cancelou`.
4. **Cada negócio ABERTO vira PERDIDO**, pelo `encerraDemanda` (a regra do botão "Marcar como perdido"),
   com o motivo "Robô ou atendimento automático". Se não houver negócio aberto, nenhum é criado.
5. **A nota do sistema na conversa** (`conversation_notes`, autor "Sistema"): "IA pausada: o outro lado
   é um robô (3 mensagens automáticas em 2 min). Negócio marcado como perdido e conversa encerrada." Sem
   negócio: "... Conversa encerrada; não havia negócio aberto.". **Na linha do tempo do negócio**, a
   perda ("Perdido: robô ou atendimento automático") e a nota "IA pausada: o outro lado é um robô.
   Negócio marcado como perdido e conversa encerrada." (`conversation_ai_paused`).
6. **A conversa é encerrada** pela mesma função do botão Encerrar (`fn_service_status`, a da rota
   `conversations/[id]/close`), com a auditoria `conversation.closed`.
7. **O registro** em `mia_travas_de_robo` e a auditoria `ai.trava_de_robo_disparada`, mais o rastro do
   turno em `agent_turn_traces` (`aborted`, `abort_reason = 'trava_de_robo'`), que a tela de Execuções lê.
   E o assistente ("por que a IA não respondeu?") passa a dizer o motivo `trava_de_robo`, com o conserto
   (Devolver ao automático), em vez de "a conversa está com alguém da equipe".

Do passo 2 em diante cada um é independente: falha vira código em `falhas` (no registro e no log) e o
resto segue.

**O motivo de perda.** Os motivos canônicos são do gatilho `fn_validate_lost_reason_required`, do
upstream; acrescentar um canônico seria redefinir o gatilho, o que a regra 3 do fork proíbe. O motivo da
trava segue o padrão de FUNIL: entra em `crm_pipelines.settings.lost_reasons` como
`{ "label": "Robô ou atendimento automático", "categoria": "Ausência" }`, na primeira vez que a trava
perde um negócio daquele funil, com trava otimista em `updated_at` para não apagar um ajuste
simultâneo da tela. Se o funil já tem o motivo (em português ou no idioma da empresa), o rótulo gravado
é usado como está. Funil com 50 motivos (o teto da tela) recebe "other".

**O negócio novo.** Enquanto a trava está de pé (etiqueta "robô" E `force_human`), uma mensagem que o
robô ainda mande não abre negócio novo: `garantirLeadDaConversa` recusa com o motivo `contato_robo`.
Sem isso, o robô que manda duas mensagens seguidas recriaria no funil o negócio que acabou de ser
perdido.

### 3.2 O teto e o ritmo de máquina (`aplicarTetoDeRespostas`)

A IA pausa SÓ naquela conversa, sem perder o negócio e sem encerrar: `bot_silenced_until = 'infinity'`
com `last_handoff_at` (o mesmo silêncio do handoff e do "Pausar o automático"; com `last_handoff_at` ele
sobrevive a um encerramento) e a conversa vai para `pending` (a fila da equipe), salvo se já estiver
encerrada ou com alguém. O contato não é tocado.

O aviso para a equipe vai na Central (`agent_inbox_items`, `kind = 'handoff'`, `severity = 'warn'`, na
conversa): "IA pausada nesta conversa: limite de respostas atingido". A varredura de avisos fecha o aviso
quando a conversa sai da fila. Fica também a nota na conversa, a linha do tempo dos negócios abertos, o
registro com motivo `teto`, a auditoria `ai.trava_de_robo_teto` (com `gatilho`: `teto` ou `ritmo`) e o
rastro `teto_de_respostas_da_ia`. A nota e o aviso dizem `respostas_da_ia` vezes em `duracao_segundos`:
no teto, as respostas da janela de 60 min; no ritmo, os giros da sequência.

⚠️ A regra do upstream que a .107 manteve ("calada em todos, mas avisando"): `isLeadInHandoff` conta o
silêncio de QUALQUER conversa do contato. Enquanto a pausa do teto vale, o motor também não responde
esse contato nos outros números da empresa, e a faixa da .107 mostra isso no cabeçalho delas.

## 4. Fora da trava

- **A prévia e o sandbox** ("Testar" do agente e "Sugerir resposta"): passam por `runAgentPreview`, que
  não é o handler do turno de mensagem. Um teste confere que a chamada existe uma vez só, dentro de
  `createInboundTurnHandler`.
- **Grupos:** conversa `is_group` volta "segue" antes de qualquer leitura de mensagem.
- **Mensagens da equipe:** não são resposta da IA, e a mensagem do contato que vem depois delas não conta
  como giro.
- **O turno de follow-up** (`followup_turn`) não avalia a trava; as respostas dele contam no teto. O
  follow-up para um contato que a trava já pegou está na dívida (desenho da MIA-211, seção 9.3).
- **Nunca cala por dúvida:** erro ao ler a conversa ou as mensagens devolve "segue" (com log). A
  configuração ilegível vale o padrão, que é ligada.

## 5. A configuração

`mia_trava_de_robo_config` (9153, e os campos do ritmo na 9171), uma linha por empresa. Empresa sem linha usa o padrão, e o padrão é
LIGADA. Sem tela: quem ajusta é a Time, pelo MCP.

| campo | padrão | faixa |
|---|---|---|
| `ligada` (todas as proteções: laço, ritmo e teto) | `true` | |
| `janela_minutos` | 15 | 1 a 240 |
| `mensagens_para_disparar` | 3 | 2 a 20 |
| `repeticao_janela_minutos` | 120 | 10 a 1440 |
| `repeticoes_anteriores` | 2 | 1 a 10 |
| `velocidade_minimo_de_caracteres` | 80 | 20 a 2000 |
| `velocidade_caracteres_por_segundo` | 15 | 3 a 200 |
| `teto_respostas` | 30 | 5 a 500 |
| `teto_janela_minutos` | 60 | 5 a 1440 |
| `ritmo_ligado` (só o ritmo de máquina) | `true` | |
| `ritmo_giros` | 6 | 4 a 30 |
| `ritmo_latencia_maxima_segundos` | 60 | 10 a 300 |
| `ritmo_variacao_segundos` | 8 | 2 a 60 |

O padrão e as faixas moram em `lib/trava-de-robo/config.ts`, iguais às CHECKs da 9153 e da 9171; um
teste confere os dois. A linha gravada antes da 9171 ganha o padrão do ritmo na migration. Valor fora da faixa numa linha gravada à mão cai no padrão daquele campo.

## 6. Como desfazer

- **Pela tela:** "Devolver ao automático" no cabeçalho da conversa (`devolverAtendimentoAoAgente`,
  `lib/escalacao/retomada.ts`), a mesma devolução de qualquer handoff. Ela solta o `force_human` do
  contato e o silêncio da conversa. A IA responde a próxima mensagem do contato, e a trava só volta a
  disparar com 3 giros NOVOS. Pela tool do agente, `crm_resume_ai_attendance`, é o mesmo caminho.
- **Pelo MCP:** `plataforma_desfazer_trava_de_robo` faz a mesma devolução, tira a etiqueta "robô" e
  marca o registro como desfeito (`desfeita_em`, `desfeita_por_user_id`).
- **O que não volta sozinho:** o negócio continua PERDIDO (reabrir é pela tela, no negócio) e a conversa
  continua encerrada. A etiqueta "robô" fica como histórico quando a devolução é pela tela; sem o
  `force_human`, ela não segura mais o nascimento de negócio.

## 7. O MCP de plataforma

Três ferramentas (`lib/mcp-plataforma/ferramentas/trava-de-robo.ts`); a lista vai de 112 a 115.

| ferramenta | o que faz | operação |
|---|---|---|
| `plataforma_ver_travas_de_robo` | cliente (opcional) e período: a configuração e os registros, com a conversa e o link do Inbox, os 4 últimos dígitos do telefone, os sinais (só o nome e o id da mensagem), as respostas da IA, os negócios perdidos, as falhas e se foi desfeito | leitura |
| `plataforma_configurar_trava_de_robo` | liga, desliga e ajusta os limites, inclusive os quatro do ritmo (`ritmo_ligado`, `ritmo_giros`, `ritmo_latencia_maxima_segundos`, `ritmo_variacao_segundos`); só o que vier muda; `ja_estava` no pedido repetido; fora da faixa, a recusa diz o campo | `implantar_configuracao` |
| `plataforma_desfazer_trava_de_robo` | cliente e conversa: retoma a IA do contato e tira a etiqueta, sem reabrir o negócio | `colocar_no_ar` |

## 8. O banco

- **9153** `mia_trava_de_robo_config`: a configuração por empresa.
- **9171** os quatro campos do ritmo em `mia_trava_de_robo_config`, só aditiva, com CHECKs nomeadas.
- **9154** `mia_travas_de_robo`: um registro por disparo, com empresa, contato, conversa e job, o motivo
  (`robo` | `teto`), os sinais que casaram, quantas mensagens de robô e quantas respostas da IA na janela,
  a duração, os negócios afetados, se encerrou, se etiquetou, quantos follow-ups cancelou, as falhas e o
  desfazer. A CHECK `mia_travas_de_robo_teto_nao_perde` garante que o teto não perde negócio, não encerra
  e não etiqueta.

As duas: RLS como as vizinhas do fork (as da conversão da Meta, 9017): gerente lê a própria empresa, o
administrador de plataforma lê todas, só o servidor escreve. Nenhuma função criada, nenhum objeto do
upstream tocado. O registro só tem ids, contagens e códigos (nunca texto de mensagem); está declarado em
`NAO_SE_REDIGE` (`tests/unit/lgpd-exporta-o-que-redige.test.ts`) e como `manter` no catálogo de FKs para
`contacts` (`tests/invariants/lgpd-redact-unificado-alcanca-pelo-catalogo.test.ts`), e o `contact_id` vira
nulo se a ficha for apagada.

## 9. Testes

- `tests/unit/trava-de-robo.test.ts`: a régua (o laço da Operadora Exemplo dispara no 3º giro, a saudação
  única não dispara, gente reclamando do nosso robô não dispara, "ok" e "sim" rápidos não disparam, a
  mensagem da equipe não conta, os três sinais, o teto de 30 em 60 minutos, a conta depois do registro, a
  configuração contra a 9153 e a 9171); o ritmo de máquina (o laço de despedida da Academia Beta
  dispara no 6º giro; Ana Exemplo, que varia, e Bruno Teste, regular por só 5 giros, não; o áudio e a
  equipe no meio quebram; o robô lento só com o máximo maior; `ritmo_ligado` false; a autodeclaração
  junto continua `robo`; o ritmo antes do teto de 30; `desde`) e o efeito dele pelo turno (pausa como o
  teto, registro `teto` com o sinal `ritmo`, a nota com 6 vezes); o efeito num banco em memória (com e sem negócio aberto, o motivo no funil,
  o idioma da empresa, a falha que derruba o turno, o teto); o turno (o rastro, o grupo, a empresa que
  desligou, o erro de leitura); o "Devolver ao automático" depois da trava; o sandbox fora (pelo fonte do
  handler); o nascimento do negócio; os textos; o assistente.
- `tests/unit/mcp-de-implantacao-trava-de-robo.test.ts`: as três ferramentas, as operações, configurar
  (inclusive os quatro campos do ritmo, `ja_estava` e a recusa fora da faixa), ver (o registro do ritmo)
  e desfazer.
- `tests/invariants/trava-de-robo.test.ts` (Postgres de verdade): quem lê e quem escreve, as faixas, o
  motivo, o teto que não perde, o registro que fica quando o contato some. Da 9171: o padrão do ritmo,
  as pontas da faixa e o registro do ritmo cabendo nas CHECKs da 9154. E as duas tabelas entram em
  `tests/invariants/rls-tabelas-da-mia.test.ts` (isolamento entre empresas).

## 10. Pontos de ligação no código do upstream

Todos com o comentário `FORK MIA (.108)`:

- `lib/agent-engine/agent/inbound-turn.ts`: o import e uma chamada a `travaDeRoboNoTurno` no handler do
  `inbound_turn`;
- `lib/leads/nascimento-do-lead.ts`: o motivo `contato_robo`, a coluna `force_human` no `select` e a
  recusa;
- `lib/i18n/dicionario.ts`: o espalhamento do dicionário nosso;
- `lib/audit/actions.ts`: as ações `ai.trava_de_robo_disparada`, `ai.trava_de_robo_teto`,
  `ai.trava_de_robo_configurada` e `ai.trava_de_robo_desfeita`;
- `lib/mcp-plataforma/ferramentas.ts` e `lib/mcp-plataforma/operacoes.ts` (do fork): o registro das
  ferramentas e o raio das duas operações;
- `tests/unit/lgpd-exporta-o-que-redige.test.ts`, `tests/invariants/lgpd-redact-unificado-alcanca-pelo-catalogo.test.ts`,
  `tests/invariants/rls-tabelas-da-mia.test.ts` e `tests/invariants/rls-completude-varredura.test.ts`: as duas tabelas.

O assistente da MIA (do fork desde a .88): `lib/assistente/leituras/por-que-a-ia-nao-respondeu.ts` (o motivo
`trava_de_robo`) e a descrição da ferramenta em `lib/assistente/ferramentas.ts`.

Arquivos nossos: `lib/trava-de-robo/` (`deteccao.ts`, `config.ts`, `aplicar.ts`, `no-turno.ts`,
`registros.ts`, `etiqueta.ts`, `textos.ts`), `lib/mcp-plataforma/ferramentas/trava-de-robo.ts`,
`lib/i18n/dicionario-mia-trava-de-robo.ts`, as migrations 9153, 9154 e 9171 e os testes acima. O ritmo
de máquina não acrescentou nenhum ponto de ligação no código do upstream.
