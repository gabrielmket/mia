#!/bin/sh
# Bootstrap do banco na instalação via EasyPanel.
#
# Faz, dentro da VPS e sem terminal, o que o hostgator-setup-kit/install.sh faz
# nas etapas 7, 8 e 11:
#   1. extensões que o schema usa (vector, citext, pg_trgm)
#   2. o schema (supabase/baseline.sql): banco novo com ON_ERROR_STOP; banco que
#      já tem schema em modo update, ignorando os "já existe" esperados
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
BENIGNOS='already exists|multiple primary keys|multiple default values|is already a member|already a partition'

for var in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL NUVEMSHOP_OAUTH_ENCRYPTION_KEY; do
  eval "valor=\${$var:-}"
  [ -n "$valor" ] || falha "falta $var no Environment do EasyPanel"
done
[ -s "$BASELINE" ] || falha "supabase/baseline.sql não chegou ao contêiner (Build Path precisa ser /)"

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
if [ "${existentes:-0}" -gt 0 ]; then
  log "banco já tem ${existentes} tabelas: re-aplicando o schema em modo update"
  psql "$DB" -q -f "$BASELINE" > /tmp/baseline.log 2>&1 || true
  inesperados="$(grep -iE 'ERROR|FATAL' /tmp/baseline.log | grep -viE "$BENIGNOS" || true)"
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
  n_erros="$(printf '%s' "$inesperados" | grep -c . || true)"
  amostra="$(printf '%s\n' "$inesperados" | head -3 | cut -c1-500)"
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
