#!/bin/sh
# Entrypoint do deskcomm-scheduler: escreve o crontab e entrega o PID 1 ao crond.
#
# Por que gerar em runtime em vez de assar o arquivo na imagem: o INTERNAL_SECRET
# só existe no .env do cliente, e o busybox crond não expande variáveis dentro da
# linha do cron. Então a expansão acontece aqui, uma vez, no start.
#
# O que MUDOU em relação ao `command:` inline do compose: não há mais
# `apk add --no-cache curl tzdata` a cada start. curl e tzdata vêm na imagem. O
# cron do cliente deixa de depender de a VPS ter internet e de o mirror do Alpine
# estar de pé no momento de um restart — que é justamente o momento em que a
# máquina está se recuperando de alguma coisa.
set -eu

# ⚠️ A MESMA PRECEDÊNCIA DO APP, e não só "alguma chave".
#
# As rotas de cron conferem `INTERNAL_CRON_SECRET || INTERNAL_SECRET`: quando a
# primeira existe, é ELA que vale. Este entrypoint mandava `INTERNAL_SECRET`
# sempre — então numa instalação com as DUAS definidas e diferentes (que é o que
# o template de ambiente gera) todo cron respondia 401, em silêncio.
#
# Medido na instalação da Time Company em 17/09/2026: nenhum cron rodou desde a
# implantação. Caíram JUNTOS os follow-ups automáticos, a sincronização da
# agenda com o Google, a saúde dos canais, a recuperação de mensagem presa, a
# cotação do dólar e a fatura do provedor de IA. O sintoma era ZERO: nada de
# erro na tela, nada no log do app, só coisas que não aconteciam.
#
# A guarda abaixo já existia e não pegava: ela confere se a chave está VAZIA,
# não se é a CERTA — e chave errada passa por "não vazia".
SEGREDO_DO_CRON="${INTERNAL_CRON_SECRET:-${INTERNAL_SECRET:-}}"
if [ -z "$SEGREDO_DO_CRON" ]; then
  echo "scheduler: INTERNAL_CRON_SECRET e INTERNAL_SECRET vazios — os crons responderiam 401 em silêncio." >&2
  echo "scheduler: confira as chaves no .env e suba de novo." >&2
  exit 1
fi

# Constante, não configuração: `app` é o nome do serviço na rede interna do
# compose, e o scheduler não fala com mais nada. A primeira versão disto lia um
# `SCHEDULER_APP_ORIGIN` que o compose nunca repassava e nenhum template
# documentava — controle decorativo, que é pior que controle nenhum: quem o
# encontrasse no código o definiria no `.env` e não veria efeito.
APP_ORIGIN="http://app:3000"

# O crond executa cada linha por `/bin/sh -c`, então o segredo é REAVALIADO pelo
# shell na hora de disparar. Interpolá-lo cru dentro de aspas duplas fazia com
# que um `$` no valor virasse expansão de variável (o header sairia truncado, e
# todo cron responderia 401 em silêncio) e uma crase virasse substituição de
# comando — execução arbitrária a cada minuto. Medido com um segredo hostil: a
# versão com aspas duplas entregava `segrafaelmelgacoredo/Users/rafaelmelgaco…`,
# com o `whoami` EXECUTADO. Aqui o valor vai entre aspas SIMPLES, com as aspas
# simples internas escapadas — dentro delas o sh não interpreta nada.
SEGREDO_SEGURO="$(printf '%s' "$SEGREDO_DO_CRON" | sed "s/'/'\\\\''/g")"

# minuto|timeout|caminho — uma linha por cron. O caminho vai COMPLETO de
# propósito: o literal `api/v1/cron/<rota>` é o contrato que
# tests/unit/cron-routes-scheduled.test.ts (e mais dois) leem por grep — esse
# teste compara a lista com o diretório app/api/v1/cron, e rota criada sem
# agendamento reprova o CI.
# A agenda do Google entra com DUAS cadências, e elas são diferentes de propósito.
#
# RENOVAÇÃO a cada 10 min: o access_token do Google expira em cerca de 1h, e a
# rodada só renova quem está a menos de 15 min do vencimento. Dez minutos deixa
# pelo menos uma tentativa de folga dentro da janela — a 15 min, um tick atrasado
# já deixaria o token vencer. É barata: só toca conexão perto de expirar, e
# rodada vazia não audita.
#
# SYNC a cada 15 min, e NÃO na mesma cadência. Os custos são diferentes: renovar
# é uma requisição por conexão que está vencendo; sincronizar é uma por
# calendário, sempre. Colar as duas obrigaria a escolher entre renovar raro
# demais (e a agenda morre) ou sincronizar caro demais (e gasta cota do cliente).
#
# ⚠️ E o comentário fica AQUI, fora da string: dentro de CRONS= ele não seria
# comentário, seria DADO — e crase em prosa dentro de aspas duplas o shell
# EXECUTA. Foi o que quebrou o entrypoint na primeira tentativa desta linha.
CRONS="
* * * * *|25|api/v1/cron/agent-dispatcher
* * * * *|25|api/v1/cron/followup-flow-worker
* * * * *|45|api/v1/cron/event-log-drain
* * * * *|25|api/v1/cron/routing-worker
* * * * *|25|api/v1/cron/recover-stuck-messages
*/5 * * * *|25|api/v1/cron/storage-redaction?limit=50
*/5 * * * *|25|api/v1/cron/snooze-watcher
*/5 * * * *|25|api/v1/cron/attendant-heartbeat
# O MOTOR DO MIA BROADCAST. A cada minuto porque o estado mora todo no banco
# (uma linha por destinatário) e a rodada é curta de propósito: 50 mensagens e
# volta. Rodada longa seguraria o processo e atrasaria a reconferência de saldo,
# que é o que impede estourar o crédito do cliente.
* * * * *|60|api/v1/cron/broadcast-worker
*/5 * * * *|60|api/v1/cron/webhook-log-retention
*/5 * * * *|45|api/v1/cron/channel-health
*/10 * * * *|60|api/v1/cron/contact-avatars
*/10 * * * *|60|api/v1/cron/agenda-google-refresh
*/15 * * * *|90|api/v1/cron/agenda-google-sync
# A IDA. Cadência mais curta que a volta de propósito: quem marcou pela tela
# espera ver o compromisso no celular dele em minutos, e a ida é barata (só
# manda o que mudou). A volta é cara — varre calendário inteiro — e por isso
# roda a cada 15.
*/5 * * * *|60|api/v1/cron/agenda-google-push
# O LEMBRETE. A cada 5 minutos porque a antecedência é escolhida pelo dono no
# tipo de agendamento; uma varredura mais lenta transformaria avisar 30 minutos
# antes em avisar entre 30 e 45 minutos antes. Barato: só olha compromisso
# confirmado, futuro e ainda não avisado.
*/5 * * * *|45|api/v1/cron/agenda-reminder
# O REPORT DA PLATAFORMA, no grupo interno: crédito de IA acabando, número
# caído, resumo do dia. A cada 10 minutos, e não a cada minuto, porque as três
# perguntas são ESTADOS (o saldo continua baixo; o número continua fora) e a
# trava anti-ruído já limita cada aviso a um por dia — rodar mais rápido só
# gastaria varredura de llm_calls sem antecipar nada. A janela do resumo é a
# hora cheia, e 10 minutos cabem nela com folga.
*/10 * * * *|60|api/v1/cron/report-da-plataforma
# A VARREDURA DA CENTRAL: fecha o aviso que deixou de valer. De hora em hora
# porque as condições que ela repergunta (conversa assumida, job de volta à
# fila) mudam em minutos mas não são urgentes — um aviso que sobrevive 40
# minutos ao conserto não estraga a tela; um que sobrevive uma semana, sim.
0 * * * *|90|api/v1/cron/varredura-de-avisos
*/15 * * * *|60|api/v1/cron/risk-watcher
*/30 * * * *|60|api/v1/cron/contact-phones
17 * * * *|60|api/v1/cron/contact-proposals-watcher
0 12 * * *|60|api/v1/cron/lgpd-sla-watcher
30 3 * * *|120|api/v1/cron/kb-conversations-batch
15 4 * * *|60|api/v1/cron/sync-model-catalog
# A COTAÇÃO. Quatro vezes ao dia: o painel converte custo em dólar para real, e
# o dia de HOJE é convertido pela cotação mais recente. Uma vez ao dia bastaria
# para o histórico, mas deixaria a tela de hoje com a cotação de ontem até a
# madrugada seguinte. Dia sem captura não quebra nada — a conversão cai na
# cotação anterior e a tela diz de quando ela é.
5 */6 * * *|30|api/v1/cron/cotacao-do-dolar
# A FATURA da conta do provedor. Uma vez ao dia, depois da meia-noite UTC —
# antes disso o dia não existe na fatura. Reconcilia 35 dias a cada rodada
# porque dia fechado ainda muda (crédito, ajuste). Sem OPENAI_ADMIN_KEY ela
# responde 200 dizendo que não há chave, e nada acontece.
40 5 * * *|60|api/v1/cron/gasto-openai
40 4 * * *|120|api/v1/cron/data-retention
"

# CRONTAB_PATH é ponto de injeção do teste (tests/shell/scheduler-entrypoint.test.sh).
# Sem ele este script só seria exercitável dentro de um contêiner — e o único
# artefato executável novo desta entrega ficaria sem gate nenhum, que foi
# exatamente o achado da revisão adversarial.
DESTINO="${CRONTAB_PATH:-/etc/crontabs/root}"

umask 077
: > "$DESTINO"
echo "$CRONS" | while IFS='|' read -r quando timeout rota; do
  [ -n "$rota" ] || continue
  printf '%s curl -fsS -m%s -H '"'"'Authorization: Bearer %s'"'"' "%s/%s" >/dev/null 2>&1\n' \
    "$quando" "$timeout" "$SEGREDO_SEGURO" "$APP_ORIGIN" "$rota" >> "$DESTINO"
done

exec crond -f -l 2
