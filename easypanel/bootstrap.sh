#!/bin/sh
# Bootstrap do banco na instalação via EasyPanel.
#
# Faz, dentro da VPS e sem terminal, o que o hostgator-setup-kit/install.sh faz
# nas etapas 7, 8 e 11:
#   1. extensões que o schema usa (vector, citext, pg_trgm)
#   2. o schema, em DOIS arquivos e nesta ordem: supabase/baseline.sql (o do
#      upstream, intacto) e supabase/baseline-mia.sql (o da MIA, por cima).
#      Banco novo com ON_ERROR_STOP; banco que já tem schema em modo update,
#      ignorando os "já existe" esperados
#   3. a chave de cifra dos segredos em private.app_secrets
#   4. o dono: cria no Auth e promove a admin da organização e da plataforma
#      (só quando OWNER_EMAIL e OWNER_PASSWORD estão preenchidos)
#
# Roda a cada deploy e é idempotente, o mesmo contrato do update.sh.
# Nunca imprime chave, senha nem connection string.

set -eu

log() { printf '[bootstrap] %s\n' "$*"; }
falha() { printf '[bootstrap] ERRO: %s\n' "$*" >&2; exit 1; }

BASELINE=/deskcomm/baseline.sql
# O schema da MIA mora num arquivo PRÓPRIO, aplicado depois do do upstream.
#
# Até 25/09/2026 os dois eram um arquivo só, e cada sincronização com o upstream
# virava conflito dentro dele (11 blocos, 15 mil linhas na de 23/09). Separados,
# o `baseline.sql` entra da sincronização exatamente como o upstream o escreveu,
# e o nosso nunca é tocado por ela. A ordem importa: o nosso estende tabelas que
# o dele cria, e a varredura `anon` no fim do nosso cura as funções dos dois.
BASELINE_MIA=/deskcomm/baseline-mia.sql
# ⚠️ `is already member of publication` NÃO tem o "a". A linha antiga escrevia
# `is already a member`, que é o português do erro e não o inglês do Postgres
# (`errmsg("relation \"%s\" is already member of publication \"%s\"")`). Nenhum
# `alter publication ... add table` do baseline está desguardado hoje, então o
# padrão nunca casou nada — e no dia em que um entrasse sem guarda, ele viraria
# alarme permanente. Os dois ficam: o certo, e o antigo por compatibilidade com
# instalação que já tenha o log de ontem.
BENIGNOS='already exists|multiple primary keys|multiple default values|is already a member|is already member of publication|already a partition'

for var in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL NUVEMSHOP_OAUTH_ENCRYPTION_KEY; do
  eval "valor=\${$var:-}"
  [ -n "$valor" ] || falha "falta $var no Environment do EasyPanel"
done
[ -s "$BASELINE" ] || falha "supabase/baseline.sql não chegou ao contêiner (Build Path precisa ser /)"
# Sem o nosso, o banco sobe como DeskcommCRM puro: sem empresas, sem token de
# plataforma, sem o carimbo — e a saúde diria "em dia" sobre um schema pela
# metade. Faltar este arquivo é defeito de deploy, nunca estado aceitável.
[ -s "$BASELINE_MIA" ] || falha "supabase/baseline-mia.sql não chegou ao contêiner (confira o volume no docker-compose.easypanel.yml)"

# Supabase próprio: a string do app pode ser uma role menor; o schema exige o dono.
DB="${SUPABASE_DB_ADMIN_URL:-$SUPABASE_DB_URL}"
case "$DB" in
  *'[YOUR-PASSWORD]'*) falha "SUPABASE_DB_URL ainda tem [YOUR-PASSWORD] no meio: troque pela senha do banco" ;;
  *@db.*.supabase.co*) falha "SUPABASE_DB_URL é a Direct connection (só IPv6, não conecta daqui). Use a do Session pooler" ;;
esac
SB_URL="${NEXT_PUBLIC_SUPABASE_URL%/}"
# Algumas telas do Supabase mostram a URL já com /rest/v1. Com caminho no fim o
# app quebra (o supabase-js acrescenta os caminhos sozinho) e a criação do dono
# cai no PostgREST: medido na 1ª instalação, HTTP 404 PGRST125 "Invalid path".
case "$SB_URL" in
  http://*/*|https://*/*)
    falha "NEXT_PUBLIC_SUPABASE_URL tem um caminho no fim ($(printf '%s' "$SB_URL" | sed -E 's#^https?://[^/]+##')). Use só o endereço do projeto, ex.: https://abcdefgh.supabase.co" ;;
esac

# ── 0. Conexão ──────────────────────────────────────────────────────────────
log "testando a conexão com o banco"
if ! saida="$(psql "$DB" -tAc 'select 1' 2>&1)"; then
  printf '%s\n' "$saida" | head -3 >&2
  case "$saida" in
    *"could not translate host name"*) log "dica: senha com caractere especial precisa ser codificada na URL (@ = %40, : = %3A, / = %2F, # = %23)" ;;
    *"password authentication failed"*) log "dica: é a senha do PROJETO Supabase, não a da conta" ;;
    *"Network is unreachable"*) log "dica: use a connection string do Session pooler" ;;
  esac
  falha "não conectei no banco"
fi

# ── 1. Extensões ────────────────────────────────────────────────────────────
psql "$DB" -v ON_ERROR_STOP=1 -q <<'SQL' || falha "não consegui habilitar as extensões (Supabase próprio? declare SUPABASE_DB_ADMIN_URL com o dono do banco)"
set client_min_messages = warning;
create extension if not exists vector with schema public;
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;
SQL
log "extensões ok (vector, citext, pg_trgm)"

# ── 2. Schema ───────────────────────────────────────────────────────────────
# Quantas tabelas o `public` já tem. A leitura NÃO pode esconder falha: com
# `psql | tr` o `sh` só vê o status do `tr`, e uma queda do pooler aqui virava
# "banco novo" — o baseline rodava com ON_ERROR_STOP por cima de um banco
# existente, morria no primeiro "already exists" e o app nunca subia.
# Qualquer tabela no `public` (e não só `organizations`) conta como banco
# existente: uma primeira instalação que caiu no meio do baseline precisa do
# modo update para terminar, não de outra tentativa que para no mesmo lugar.
if ! existentes="$(psql "$DB" -tAc "select count(*) from information_schema.tables where table_schema='public'" 2>&1)"; then
  printf '%s\n' "$existentes" | head -3 >&2
  falha "não consegui ler o estado do banco (a conexão caiu?). Nada foi alterado; reimplante."
fi
existentes="$(printf '%s' "$existentes" | tr -d '[:space:]')"
# FORK MIA (fusão v1.118, migration 9163): o que o NOSSO schema precisa fazer
# ANTES do do upstream. Hoje é um só: a nossa `organization_modules` (0245) sai do
# caminho da `organization_modules` que a 9416 do upstream cria, com outro
# formato. Se o `baseline.sql` chegasse primeiro, a 9416 cairia na nossa tabela
# (comentário em coluna que não existe, `revoke` de `authenticated` e um gatilho
# que grava `updated_at`, coluna que a nossa não tem). O trecho mora no próprio
# `baseline-mia.sql`, entre `-- >>> ANTES DO BASELINE DO UPSTREAM` e `-- <<< ...`
# (sem arquivo novo para montar no contêiner), e roda de novo, no lugar, sem
# fazer nada. Banco novo não precisa: lá a nossa ainda não existe. Ele entra em
# cada passada do modo update, pela `aplicar_passada`.
# Prova: scripts/ensaio-de-banco.sh faz o mesmo antes de cada passada; e a cerca
# tests/unit/schema-mia-antes-do-upstream.test.ts.
antes_do_upstream() {
  rc=0
  sed -n '/^-- >>> ANTES DO BASELINE DO UPSTREAM/,/^-- <<< ANTES DO BASELINE DO UPSTREAM/p' "$BASELINE_MIA" \
    | psql "$DB" -q -c "$ESPERA_CURTA" -f - > /tmp/baseline-arquivo.log 2>&1 || rc=$?
  anotar_saida "$rc"
}

# aplicar_arquivo <arquivo>: uma aplicação do modo update, com a espera curta
# (MIA-348, no bloco do modo update abaixo).
aplicar_arquivo() {
  rc=0
  psql "$DB" -q -c "$ESPERA_CURTA" -f "$1" > /tmp/baseline-arquivo.log 2>&1 || rc=$?
  anotar_saida "$rc"
}

# anotar_saida <código do psql>: a saída vai para o log da passada, e o psql que
# não chegou ao fim do arquivo vira uma linha no arquivo de quedas. A causa
# citada é a última linha que não é continuação indentada (a última de todas
# costuma ser a dica "Is the server running…", e não o motivo).
anotar_saida() {
  cat /tmp/baseline-arquivo.log >> "$LOG_PASSADA"
  if [ "$1" -ne 0 ]; then
    causa="$(grep -v '^[[:space:]]' /tmp/baseline-arquivo.log | grep . | tail -1 || true)"
    printf 'a aplicação não chegou ao fim do arquivo (o psql saiu com código %s): %s\n' "$1" "$causa" >> /tmp/baseline-quedas.log
  fi
}

# aplicar_passada <n>: o trecho "antes do upstream", o baseline.sql (pela cópia
# com espera curta) e o baseline-mia.sql, no MESMO log (o contador tem de ver os
# erros dos três, senão uma migration nossa que falhe fica fora da saúde).
# Deixa em `inesperados` os erros que não são benignos, mais as quedas.
aplicar_passada() {
  LOG_PASSADA="/tmp/baseline-passada-$1.log"
  : > "$LOG_PASSADA"
  : > /tmp/baseline-quedas.log
  antes_do_upstream
  aplicar_arquivo "$ARQUIVO_DO_UPSTREAM"
  aplicar_arquivo "$BASELINE_MIA"
  inesperados="$( { grep -iE 'ERROR|FATAL' "$LOG_PASSADA" | grep -viE "$BENIGNOS"; cat /tmp/baseline-quedas.log; } | grep . || true)"
}

if [ "${existentes:-0}" -gt 0 ]; then
  log "banco já tem ${existentes} tabelas: re-aplicando o schema em modo update"

  # FORK MIA (dívida 5, MIA-348): espera curta por lock e até 3 passadas.
  #
  # A implantação reaplica o schema com o app ANTIGO ainda atendendo. Um `drop`
  # ou `create policy` que pede lock exclusivo entra na fila atrás de uma
  # transação do app, forma ciclo e perde por `deadlock detected`; e, enquanto
  # espera, toda consulta do app àquela tabela fica presa atrás dele. Até a .119
  # havia uma segunda passada só quando TODOS os erros eram deadlock, e a disputa
  # que se repetia nela parava o trem com `erros > 0`.
  #
  # 1. Espera curta: cada comando do schema desiste do lock em
  #    least(500ms, deadlock_timeout/2), lido do próprio banco. Desiste antes do
  #    `deadlock_timeout` do app, então quem perde é o schema (que repete), e não
  #    a tela de alguém; e nenhuma consulta fica na fila por mais que isso.
  # 2. O `baseline.sql` abre com `SET lock_timeout = 0;` (linha 5), que apagaria
  #    o `-c`. Ele é aplicado por uma CÓPIA em /tmp com só essa linha trocada (o
  #    resto byte a byte, a mesma contagem de linhas, o mesmo número de linha no
  #    erro). O arquivo do upstream não muda. Cerca:
  #    tests/unit/baseline-do-upstream-zera-o-lock-timeout.test.ts.
  # 3. Até 3 passadas inteiras (o `reaplicar_baseline` do kit do upstream, em
  #    hostgator-setup-kit/_common.sh), esperando 10 s e depois 20 s, quando há
  #    ALGUM erro de disputa ou de conexão. Com erro de verdade junto, repetir
  #    limpa a disputa e a amostra fica só com o que precisa de conserto. O
  #    veredito é o da última passada, que é o que ficou no banco.
  # 4. O `psql` que sai com código diferente de 0 não chegou ao fim do arquivo:
  #    conta como erro (antes, o `|| true` engolia e o carimbo podia dizer 0 com
  #    metade do arquivo aplicada).
  # Banco novo (o `else` lá embaixo) não muda: sem app, sem espera curta e com
  # ON_ERROR_STOP. A escrita do carimbo também fica fora da espera curta.
  # Prova: tests/unit/bootstrap-reaplica-no-deadlock.test.ts e a etapa 3b do
  # scripts/ensaio-de-banco.sh (disputa provocada). docs/fork/area-de-cobranca.md, seção 8.
  DISPUTA='deadlock detected|could not serialize access|lock timeout|could not obtain lock|terminating connection|server closed the connection|connection to server was lost|SSL connection has been closed unexpectedly|SSL SYSCALL error|remaining connection slots|too many clients|max client(s| connections) reached|the database system is (starting up|shutting down|in recovery mode|not yet accepting connections)|Temporary failure in name resolution|Connection refused|Connection timed out|timeout expired|Network (is )?unreachable'
  # As duas existem para o teste não esperar de verdade (os mesmos nomes do kit).
  TENTATIVAS="${BASELINE_TENTATIVAS:-3}"
  ESPERA_S="${BASELINE_ESPERA_S:-10}"
  case "$TENTATIVAS" in ''|*[!0-9]*|0) TENTATIVAS=3 ;; esac
  case "$ESPERA_S" in ''|*[!0-9]*) ESPERA_S=10 ;; esac

  LOCK_MS="$(psql "$DB" -tAc "select greatest(1, least(500, setting::int / 2)) from pg_settings where name = 'deadlock_timeout'" 2>/dev/null | tr -d '[:space:]' || true)"
  case "$LOCK_MS" in
    ''|*[!0-9]*) LOCK_MS=500; log "AVISO: não li o deadlock_timeout do banco; espera curta por lock de ${LOCK_MS} ms" ;;
    *) log "espera curta por lock: ${LOCK_MS} ms (metade do deadlock_timeout, no máximo 500)" ;;
  esac
  ESPERA_CURTA="set lock_timeout = '${LOCK_MS}ms'"

  BASELINE_COPIA=/tmp/deskcomm/baseline.sql
  ARQUIVO_DO_UPSTREAM="$BASELINE"
  linha_do_zero="$(head -20 "$BASELINE" | grep -n -x 'SET lock_timeout = 0;' | head -1 | cut -d: -f1 || true)"
  if [ -n "$linha_do_zero" ] && mkdir -p "${BASELINE_COPIA%/*}" \
     && sed "${linha_do_zero}s/.*/SET lock_timeout = '${LOCK_MS}ms';/" "$BASELINE" > "$BASELINE_COPIA" \
     && [ "$(($(wc -l < "$BASELINE")))" = "$(($(wc -l < "$BASELINE_COPIA")))" ]; then
    ARQUIVO_DO_UPSTREAM="$BASELINE_COPIA"
  else
    log "AVISO: o baseline.sql não tem 'SET lock_timeout = 0;' nas 20 primeiras linhas (ou a cópia falhou): aplico o original, sem espera curta nele"
  fi

  passada=1
  while :; do
    aplicar_passada "$passada"
    n_inesperados="$(printf '%s' "$inesperados" | grep -c . || true)"
    n_disputa="$(printf '%s' "$inesperados" | grep -ciE "$DISPUTA" || true)"
    if [ "${n_inesperados:-0}" -eq 0 ]; then
      log "passada ${passada} de ${TENTATIVAS}: sem erro"
      break
    fi
    if [ "${n_disputa:-0}" -eq 0 ]; then
      log "passada ${passada} de ${TENTATIVAS}: ${n_inesperados} erro(s), nenhum de disputa (repetir não cura)"
      break
    fi
    if [ "$passada" -ge "$TENTATIVAS" ]; then
      log "passada ${passada} de ${TENTATIVAS}: ${n_disputa} comando(s) perderam a disputa, e acabaram as passadas"
      break
    fi
    espera=$((ESPERA_S * passada))
    log "passada ${passada} de ${TENTATIVAS}: ${n_disputa} comando(s) perderam a disputa com o app no ar (lock ou conexão): aplicando de novo em ${espera} s (é seguro)"
    printf '%s\n' "$inesperados" | grep -iE "$DISPUTA" | head -5 || true
    sleep "$espera"
    passada=$((passada + 1))
  done
  cp "$LOG_PASSADA" /tmp/baseline.log 2>/dev/null || true
  if [ -n "$inesperados" ]; then
    log "AVISO: erros que não são os esperados (o app sobe mesmo assim):"
    printf '%s\n' "$inesperados" | head -20
  else
    log "schema atualizado"
  fi

  # ── O contador vai para o BANCO, e não só para este log (migration 0269) ──
  #
  # Aqui o psql roda SEM ON_ERROR_STOP: um comando que falha vira uma linha de
  # ERROR e a execução continua até o fim — inclusive até o bloco que carimba
  # `schema_baseline`. Sem esta escrita, a saúde responderia `em_dia: true`
  # sobre um banco em que a migration nova falhou, porque o carimbo prova que o
  # arquivo chegou ao fim e não que cada comando passou.
  #
  # Este valor já era calculado e morria neste stdout, num contêiner efêmero,
  # com a agregação de logs da VPS desligada.
  #
  # Roda DEPOIS do baseline de propósito: é ele que cria a tabela e as colunas.
  # `|| true` porque nenhuma instalação pode deixar de subir por causa do
  # relatório sobre ela mesma — e um banco antigo, antes da 0269, não tem as
  # colunas. O sintoma nesse caso é o valor ficar velho, nunca o app parar.
  #
  # A amostra começa pelo que NÃO é disputa: é o que precisa de conserto, e
  # numa lista de disputas ficaria fora do corte de 3.
  n_erros="$(printf '%s' "$inesperados" | grep -c . || true)"
  amostra="$( { printf '%s\n' "$inesperados" | grep -viE "$DISPUTA"; printf '%s\n' "$inesperados" | grep -iE "$DISPUTA"; } | grep . | head -3 | cut -c1-500 || true)"
  psql "$DB" -q -v ON_ERROR_STOP=1 -v n="${n_erros:-0}" -v amostra="$amostra" <<'SQL' >/dev/null 2>&1 || true
update public.schema_baseline
   set erros_inesperados = :'n'::integer,
       erros_amostra     = nullif(:'amostra', '')
 where id = 1;
SQL
else
  log "banco novo: aplicando o schema completo (leva alguns minutos)"
  if ! psql "$DB" -v ON_ERROR_STOP=1 -q -f "$BASELINE" > /tmp/baseline.log 2>&1; then
    tail -15 /tmp/baseline.log >&2
    falha "o schema falhou num banco novo (ficaria sem RLS)"
  fi
  if ! psql "$DB" -v ON_ERROR_STOP=1 -q -f "$BASELINE_MIA" >> /tmp/baseline.log 2>&1; then
    tail -15 /tmp/baseline.log >&2
    falha "o schema da MIA falhou num banco novo (o do upstream passou; o nosso, não)"
  fi
  log "schema aplicado"
fi

n_tabelas="$(psql "$DB" -tAc "select count(*) from information_schema.tables where table_schema='public'" | tr -d '[:space:]')"
[ "${n_tabelas:-0}" -ge 30 ] || falha "só ${n_tabelas:-0} tabelas no schema public depois do baseline"
log "verificação: ${n_tabelas} tabelas no schema public"

# ── 3. Chave de cifra dos segredos ──────────────────────────────────────────
psql "$DB" -v ON_ERROR_STOP=1 -q -v chave="$NUVEMSHOP_OAUTH_ENCRYPTION_KEY" <<'SQL' >/dev/null || falha "não consegui gravar a chave de cifra em private.app_secrets"
insert into private.app_secrets (name, value) values ('nuvemshop_oauth_key', :'chave')
on conflict (name) do update set value = excluded.value, updated_at = now();
SQL
log "chave de cifra ativa no banco"

# ── 3b. Chave do CPF (upstream v1.78, migration 0597, #2522) ────────────────
# `encrypt_cpf`/`decrypt_cpf` leem `private.app_secrets` na linha `cpf_key`
# (mínimo de 32 caracteres). Sem a linha, todo contato COM CPF é salvo SEM o
# CPF (lib/contacts/cpf.ts degrada em silêncio) e a busca por CPF não acha
# ninguém. O kit do upstream semeia no update.sh a partir de
# CPF_ENCRYPTION_KEY, que o app já exige (lib/env.ts).
#
# Diferença DELIBERADA do kit: aqui é `on conflict do nothing`. O kit regrava
# a linha a cada atualização; se a variável do Environment mudasse depois de
# haver CPF cifrado, o que foi gravado não abriria mais. A chave do banco, uma
# vez semeada, só muda por decisão de alguém (com re-cifra), nunca num deploy.
if [ -n "${CPF_ENCRYPTION_KEY:-}" ] && [ "${#CPF_ENCRYPTION_KEY}" -ge 32 ]; then
  cpf_estado="$(psql "$DB" -v ON_ERROR_STOP=1 -tA -q -v chave="$CPF_ENCRYPTION_KEY" <<'SQL'
insert into private.app_secrets (name, value) values ('cpf_key', :'chave')
on conflict (name) do nothing;
select case when value = :'chave' then 'igual' else 'outra' end
  from private.app_secrets where name = 'cpf_key';
SQL
)" || falha "não consegui gravar a chave do CPF em private.app_secrets"
  case "$cpf_estado" in
    *outra*) log "AVISO: a chave do CPF no banco é outra que a do Environment; mantive a do banco (o CPF já cifrado continua legível)" ;;
    *) log "chave do CPF ativa no banco" ;;
  esac
else
  log "AVISO: CPF_ENCRYPTION_KEY ausente ou com menos de 32 caracteres; contato com CPF será salvo sem o CPF"
fi

# ── 4. Dono ─────────────────────────────────────────────────────────────────
if [ -z "${OWNER_EMAIL:-}" ] || [ -z "${OWNER_PASSWORD:-}" ]; then
  log "OWNER_EMAIL/OWNER_PASSWORD vazios: pulei a criação do dono"
  log "pronto"
  exit 0
fi

# Dono já configurado (tem vínculo com alguma organização, ativo OU revogado):
# não re-promove. Sem esta trava, todo deploy com OWNER_EMAIL/OWNER_PASSWORD no
# Environment devolvia ao dono o papel de admin e o acesso de plataforma que
# alguém tivesse revogado pela tela.
if ! ja_configurado="$(psql "$DB" -tA -v email="$OWNER_EMAIL" 2>&1 <<'SQL'
select 1 from public.user_organizations uo
  join auth.users u on u.id = uo.user_id
 where lower(u.email) = lower(:'email')
 limit 1;
SQL
)"; then
  printf '%s\n' "$ja_configurado" | head -3 >&2
  falha "não consegui verificar se o dono já está configurado"
fi
if [ "$(printf '%s' "$ja_configurado" | tr -d '[:space:]')" = "1" ]; then
  log "dono já está configurado: não re-promovo (revogações feitas pela tela continuam valendo)"
  log "pronto"
  exit 0
fi

apk add --no-cache curl jq >/dev/null 2>&1 || falha "não consegui instalar curl e jq (a VPS está sem internet?)"

corpo="$(jq -n --arg e "$OWNER_EMAIL" --arg p "$OWNER_PASSWORD" --arg l "${APP_LOCALE:-pt-BR}" \
  '{email: $e, password: $p, email_confirm: true, user_metadata: {locale: $l}}')"
codigo="$(curl -sS -m 30 -o /tmp/dono.json -w '%{http_code}' -X POST "$SB_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H 'Content-Type: application/json' \
  -d "$corpo" 2>/dev/null)" || codigo=000

existe="$(psql "$DB" -tA -v email="$OWNER_EMAIL" <<'SQL' | tr -d '[:space:]'
select 1 from auth.users where lower(email) = lower(:'email') limit 1;
SQL
)"
case "$codigo" in
  2*) log "dono criado no Auth" ;;
  *)
    if [ "$existe" = "1" ]; then
      log "dono já existia no Auth"
    else
      log "resposta do Auth (HTTP $codigo): $(head -c 300 /tmp/dono.json 2>/dev/null || true)"
      falha "não consegui criar o dono: confira NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY"
    fi
    ;;
esac

# Mesmo SQL do install.sh (etapa 8), com os valores passados por variável do
# psql em vez de colados no texto: e-mail com aspas não quebra nem injeta SQL.
psql "$DB" -v ON_ERROR_STOP=1 -q \
  -v email="$OWNER_EMAIL" -v locale="${APP_LOCALE:-pt-BR}" -v provider="${AI_PROVIDER:-anthropic}" \
  <<'SQL' >/dev/null || falha "não consegui promover o dono a admin"
select set_config('deskcomm.owner_email', :'email', false),
       set_config('deskcomm.locale', :'locale', false),
       set_config('deskcomm.provider', :'provider', false);

do $$
declare
  v_org uuid;
  v_uid uuid;
  v_email text := current_setting('deskcomm.owner_email');
  v_locale text := current_setting('deskcomm.locale');
  v_provider text := current_setting('deskcomm.provider');
begin
  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then
    raise exception 'usuário % não encontrado no auth.users', v_email;
  end if;

  select id into v_org from public.organizations where slug = 'minha-empresa';
  if v_org is null then
    insert into public.organizations (slug, display_name, legal_name, locale, created_by)
    values ('minha-empresa', 'Minha Empresa', 'Minha Empresa', v_locale, v_uid)
    returning id into v_org;
  else
    update public.organizations
       set locale = v_locale
     where id = v_org and coalesce(locale, 'pt-BR') = 'pt-BR';
  end if;

  -- O trigger fn_seed_org_llm_defaults semeia 'anthropic'; outro provedor
  -- escolhido no Environment passa a valer (o modelo fica para a tela).
  if v_provider not in ('', 'anthropic') then
    update public.organizations
       set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{llm,provider}', to_jsonb(v_provider), true)
     where id = v_org;
  end if;

  insert into public.user_organizations (user_id, organization_id, role, accepted_at)
  values (v_uid, v_org, 'admin', now())
  on conflict (user_id, organization_id) do update set role = 'admin', revoked_at = null;

  -- mfa_required explícito: a verificação em duas etapas é opcional e liga em
  -- Configurações › Segurança (mesma decisão do install.sh).
  if not exists (select 1 from public.platform_admins where user_id = v_uid and revoked_at is null) then
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
    values (v_uid, v_uid, 'full', false, 'Bootstrap inicial do self-host (EasyPanel)');
  end if;
end $$;
SQL
log "dono é admin da organização e da plataforma"
log "pronto"
