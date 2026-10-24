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
# SYNC a cada minuto. Uma página incompleta deixa o próximo passo imediatamente
# elegível no banco; esse cron frequente drena a paginação sem esperar 15 min por
# página. Calendários sem trabalho continuam espaçados pela própria RPC, que
# agenda a próxima leitura em 15 min após concluir. A renovação permanece a cada
# 10 min: ela tem outro custo e outro prazo.
#
# ⚠️ E o comentário fica AQUI, fora da string: dentro de CRONS= ele não seria
# comentário, seria DADO — e crase em prosa dentro de aspas duplas o shell
# EXECUTA. Foi o que quebrou o entrypoint na primeira tentativa desta linha.
#
# (MIA) O attendant-heartbeat saiu da lista de propósito, e não por descuido da
# fusão: a rota foi removida no upstream junto com o conserto do plantão que se
# desligava sozinho (o cron marcava offline quem não pingasse em 15 min).
# Agendar o que não existe mais é curl 404 a cada 5 minutos, e o
# cron-routes-scheduled confere esta lista contra o diretório das rotas.
#
# Esta nota morou DENTRO de CRONS= na fusão de 23/09, com crase e aspas duplas.
# A aspa fechou a string no meio, o resto virou comando, e o entrypoint saía 127
# no boot: o scheduler morria, e com ele todos os crons da plataforma. Por isso,
# nas linhas de comentário que ficam dentro de CRONS=, nada de crase, aspas,
# cifrão, barra invertida nem barra vertical; e em comentário nenhum deste
# arquivo o caminho completo de uma rota que não existe (o teste lê por grep).
# A DEVOLUÇÃO AO RODÍZIO (issue #2985) entra na MESMA cadência do irmão
# `handoff-devolucao`, 5 em 5 minutos, pelo mesmo motivo: o piso do prazo é
# 5 min e uma varredura por minuto seriam 60 varreduras/h em toda instalação
# para um prazo que a maioria deixa em dezenas de minutos.
CRONS="
* * * * *|240|api/v1/cron/prospecting
* * * * *|25|api/v1/cron/agent-dispatcher
* * * * *|25|api/v1/cron/followup-flow-worker
* * * * *|45|api/v1/cron/event-log-drain
* * * * *|25|api/v1/cron/routing-worker
*/5 * * * *|25|api/v1/cron/recover-stuck-messages
* * * * *|25|api/v1/cron/proposta-travada
* * * * *|45|api/v1/cron/webhook-replay
*/5 * * * *|25|api/v1/cron/storage-redaction?limit=50
*/5 * * * *|25|api/v1/cron/snooze-watcher
*/5 * * * *|60|api/v1/cron/handoff-devolucao
*/5 * * * *|60|api/v1/cron/rodizio-devolucao
# A CAMPANHA. Minuto a minuto, e a rodada manda no máximo uma mensagem por
# número: é o cron que dá a cadência base, e o ritmo da campanha e do canal
# (channel_knobs + pacing_ledger) só sabem torná-la mais lenta.
* * * * *|45|api/v1/cron/campaign-worker
# O MOTOR DO MIA BROADCAST. A cada minuto porque o estado mora todo no banco
# (uma linha por destinatário) e a rodada é curta de propósito: 50 mensagens e
# volta. Rodada longa seguraria o processo e atrasaria a reconferência de saldo,
# que é o que impede estourar o crédito do cliente.
* * * * *|60|api/v1/cron/broadcast-worker
# OS LEADS DOS FORMULARIOS DA META (fork MIA). A cada 5 minutos: e o atraso
# maximo entre o cadastro no anuncio e o card no funil. Cada rodada le so o que
# chegou desde a ultima marca, entao ela e curta; o teto de 240s e para a
# primeira leitura de um formulario, que pode voltar ate 90 dias.
*/5 * * * *|240|api/v1/cron/leads-da-meta
*/5 * * * *|60|api/v1/cron/webhook-log-retention
*/5 * * * *|45|api/v1/cron/channel-health
# A JANELA DE MANUTENÇÃO (#2388). Minuto a minuto porque o que ela decide é a
# borda de um horário ESCOLHIDO POR UMA PESSOA: perder a abertura ou a retomada
# por causa de uma varredura a cada 5 minutos seria o defeito inteiro. Barata:
# só lê as duas linhas vivas da agenda, e quem não tem janela não é escrito.
# Quando escreve, escreve pela MESMA peça da pausa manual — não existe estado
# paralelo.
* * * * *|25|api/v1/cron/channel-pause-scheduler
*/10 * * * *|60|api/v1/cron/contact-avatars
*/10 * * * *|60|api/v1/cron/agenda-google-refresh
* * * * *|90|api/v1/cron/agenda-google-sync
# A IDA. Cadência mais curta que a volta de propósito: quem marcou pela tela
# espera ver o compromisso no celular dele em minutos, e a ida é barata (só
# manda o que mudou). A volta é cara — varre calendário inteiro — e por isso
# roda a cada 15.
*/5 * * * *|60|api/v1/cron/agenda-google-push
# A AGENDA DO OUTLOOK (fork MIA, docs/fork/agenda-microsoft.md). A renovação na
# cadência da do Google. A volta roda a cada minuto, mas só lê o calendário
# VENCIDO (15 min depois da última leitura, ou na hora quando a Microsoft avisa
# pela notificação): rodada sem nada vencido é uma consulta e nenhuma chamada à
# Graph. As assinaturas das notificações duram menos de 7 dias; de hora em hora
# basta para renovar com folga.
*/10 * * * *|60|api/v1/cron/agenda-microsoft-refresh
* * * * *|55|api/v1/cron/agenda-microsoft-sync
*/5 * * * *|60|api/v1/cron/agenda-microsoft-push
0 * * * *|120|api/v1/cron/agenda-microsoft-assinaturas
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
# O LEMBRETE DE TAREFA. A cada 5 minutos porque a antecedência é escolhida
# pela PESSOA (15 min, 1 h que é o padrão, ou 1 dia): uma varredura mais lenta
# transformaria avisar 15 minutos antes em avisar até 20. Barato: só tarefa
# com prazo na janela, com responsável, e que ainda não virou item da Central.
*/5 * * * *|45|api/v1/cron/task-reminder
*/15 * * * *|45|api/v1/cron/agenda-expira-pendentes
*/15 * * * *|60|api/v1/cron/risk-watcher
# O CASO PARADO. De hora em hora, e não a cada 5 minutos: o prazo é de 24h, e
# uma varredura mais frequente só gastaria consulta para descobrir o mesmo nada.
7 * * * *|60|api/v1/cron/case-stale-watcher
*/30 * * * *|60|api/v1/cron/contact-phones
# O NOME DA AGENDA. O webhook não traz o nome salvo no celular; esta varredura
# pergunta ao canal e preenche a ficha. Dez em dez minutos porque quem acabou
# de conectar o número está olhando a inbox agora. Lote de 5 e prazo de 45 s
# dentro da rota: o pior caso cabe nos 60 s com folga.
*/10 * * * *|60|api/v1/cron/contact-names
17 * * * *|60|api/v1/cron/contact-proposals-watcher
23 * * * *|60|api/v1/cron/followup-sem-agente
# O ANIVERSÁRIO. De hora em hora, e não uma vez ao dia, porque quem decide o
# momento é o relógio de parede de CADA organização: a rodada só age naquela
# cujo fuso marca a hora de parabenizar. Uma varredura diária em UTC felicitaria
# no dia errado metade do mundo e de madrugada boa parte do resto. Barato: quem
# não configurou a automação não chega a ser varrido.
7 * * * *|60|api/v1/cron/contact-birthdays
# O RESUMO DAS 7H DO AVISO DE AGENDAMENTO (0707). De dez em dez minutos pelo
# mesmo motivo do aniversário — a hora é a do relógio de CADA organização —, e
# mais curto porque a janela é 7h–10h: se o número estiver parado às 7h, o
# resumo sai assim que ele voltar. Quem não ligou o aviso não chega a ser varrido.
*/10 * * * *|60|api/v1/cron/agenda-resumo-do-dia
# A DATA DO FUNIL (#989). Mesma cadência e mesmo motivo do aniversário: de hora
# em hora, e quem decide o momento é o relógio de parede de CADA organização —
# a rodada só age naquela que marca a hora da varredura. Minuto diferente do
# aniversário para as duas não disputarem a mesma batida num self-host pequeno.
23 * * * *|60|api/v1/cron/lead-date-field-due
# #1540 — silêncio e etapa parada: gatilhos por TEMPO (ausência de evento), então
# rodam de hora em hora e a trava no event_log (regra:negócio:âncora) segura a
# repetição enquanto a âncora não mudar. Minuto 37, e não o 23 da data do funil:
# as duas varrem crm_leads e não devem disputar a mesma batida num self-host pequeno.
37 * * * *|60|api/v1/cron/lead-time-triggers
# OS DOCUMENTOS E AS OBRIGACOES (fork MIA, docs/fork/obrigacoes.md): documento
# vencendo, vencido, pedido sem resposta e atividade recorrente chegando. De hora
# em hora, como a data do funil: quem decide o momento e o relogio de parede de
# CADA empresa (a rodada so age na que marca 9h). Minuto 43, longe do 23 e do 37
# das outras duas varreduras de data. Barato: empresa sem regra desses gatilhos
# nao e varrida.
43 * * * *|90|api/v1/cron/obrigacoes-avisos
# O ASSISTENTE DA MIA (fork MIA, docs/fork/assistente.md): o resumo da manha de
# quem ligou o seu, em dia util, as 8h no fuso de CADA empresa (a rodada so age
# na que marca 8h), sem gastar IA; e a retencao do historico do assistente (90
# dias) e dos chamados resolvidos (um ano). De hora em hora, no minuto 2, longe
# das outras varreduras horarias. Empresa parada nao recebe resumo.
2 * * * *|120|api/v1/cron/assistente-resumo-da-manha
# A COBRANCA DOS SEUS CLIENTES. De hora em hora: a reativacao chega pelo aviso
# do provedor, em segundos, e a hora so pesa na regua, que conta em dias. Minuto
# 43, longe das outras varreduras horarias. Chave desligada: sai na hora.
43 * * * *|120|api/v1/cron/cobranca
# O canal mudo (doc 11, decisão B): varredura de banco, sem rede, com régua em
# DIAS. Diária e de madrugada porque o estado que ela lê muda em dias — de 5 em
# 5 minutos seriam 288 varreduras para nada, e o aviso chegaria na mesma hora.
50 5 * * *|60|api/v1/cron/canal-mudo-watcher
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
0 8 * * *|60|api/v1/cron/proposal-expiry
30 8 * * *|60|api/v1/cron/proposal-promised-not-created
0 6 * * 0|60|api/v1/cron/proposal-acceptance-rate
20 5 * * *|120|api/v1/cron/media-retention
# AS RECORRÊNCIAS. Uma vez ao dia é o bastante: o que ela gera é uma conta a
# pagar, e a diferença entre nascer às 5h ou às 17h não muda nada para quem paga.
# Barato: uma consulta por instalação, e quem não tem molde nenhum sai na hora.
50 5 * * *|60|api/v1/cron/recurring-entries
"

# CRONTAB_PATH é ponto de injeção do teste (tests/shell/scheduler-entrypoint.test.sh).
# Sem ele este script só seria exercitável dentro de um contêiner — e o único
# artefato executável novo desta entrega ficaria sem gate nenhum, que foi
# exatamente o achado da revisão adversarial.
DESTINO="${CRONTAB_PATH:-/etc/crontabs/root}"

umask 077
# O segredo vai num ARQUIVO, nunca na linha do crontab. Cada linha vira o
# argumento de um `/bin/sh -c`, e argumento de processo aparece no `ps` do host
# para qualquer usuário local enquanto o job roda — e o curl vive até o `-m`.
# O curl lê o header com `-H @arquivo` (curl ≥ 7.55), o mesmo padrão do
# `.env.cron-drain` do kit. De brinde, o valor deixa de passar pelo sh do crond:
# `$`, crase e aspas no segredo não precisam mais de escape nenhum.
# CRON_AUTH_DIR é ponto de injeção do teste, como o CRONTAB_PATH abaixo.
AUTH_DIR="${CRON_AUTH_DIR:-/run/deskcomm-cron}"
AUTH_FILE="$AUTH_DIR/header"
mkdir -p "$AUTH_DIR"
chmod 700 "$AUTH_DIR"
# Com o umask 077 o arquivo nasce 600 desde o primeiro byte; o chmod cobre um
# arquivo que já existisse de um start anterior.
# (MIA) `SEGREDO_DO_CRON`, e não `INTERNAL_SECRET`: a mesma precedência do app
# (ver o topo deste arquivo).
printf 'Authorization: Bearer %s\n' "$SEGREDO_DO_CRON" > "$AUTH_FILE"
chmod 600 "$AUTH_FILE"

: > "$DESTINO"
echo "$CRONS" | while IFS='|' read -r quando timeout rota; do
  [ -n "$rota" ] || continue
  # `>/dev/null` só no STDOUT: o corpo da resposta é grande e não interessa aqui.
  # O STDERR era o que a redireção antiga (`>/dev/null 2>&1`) engolia junto — e
  # foi ali que a issue #1109 ficou seis versões invisível: o `sync-model-catalog`
  # tomava 401 do scheduler todo dia, o `curl -f` saía diferente de zero e o
  # crontab descartava saída E erro, então o catálogo ficava vazio sem que
  # ninguém visse um sintoma. Agora o status continua no STDERR do `curl -fsS`
  # (é o `-S` que o imprime) e, quando o comando falha, a linha acrescenta uma
  # frase dizendo qual rota falhou e o que conferir — os dois no STDERR, que o
  # `crond -f` entrega ao `docker logs` do scheduler. Em rodada saudável não há
  # uma linha a mais: o `||` só dispara em falha.
  # % é proibido aqui (crontab de vixie trata como início de stdin) e `$`/crase
  # seriam reavaliados pelo sh do crond — nenhum dos dois aparece na mensagem.
  printf '%s curl -fsS -m%s -H '"'"'@%s'"'"' "%s/%s" >/dev/null || echo "deskcomm-cron: FALHOU %s — veja o erro do curl logo acima; se for 401 ou 403, o segredo que este scheduler manda não é o que o app enxerga: confira INTERNAL_SECRET/INTERNAL_CRON_SECRET no .env e rode docker compose up -d --force-recreate app scheduler" >&2\n' \
    "$quando" "$timeout" "$AUTH_FILE" "$APP_ORIGIN" "$rota" "$rota" >> "$DESTINO"
done

exec crond -f -l 2
