#!/usr/bin/env bash
# FORK MIA · ENSAIO DE BANCO — a versão nova aplicada em cima da versão que está no ar.
#
# O que faz, num Postgres descartável (nada de produção, nada de dump por padrão):
#   1. sobe o banco vazio, aplica a versão NO AR (baseline.sql e depois baseline-mia.sql,
#      a ordem do easypanel/bootstrap.sh) e carrega as demonstrações (dado fictício);
#   2. tira a foto "antes" (contagens, funis, relatório de negócios, colunas, objetos nossos);
#   3. aplica a versão NOVA duas vezes, na ordem do bootstrap em modo update (o trecho
#      "antes do upstream" do baseline-mia.sql, o baseline.sql, o baseline-mia.sql; a 2ª
#      passada prova a idempotência) e confere:
#        - 0 erro fora dos BENIGNOS em cada passada;
#        - contagens iguais, configuração dos funis igual (md5) e relatório de negócios igual;
#        - nenhuma coluna do schema public sumiu (tabela nossa renomeada de propósito,
#          declarada em RENOMEADAS, é comparada pelo nome novo e tem de manter as linhas);
#        - nenhuma função ou view lê a organization_modules com coluna da nossa (9163);
#        - fn_mia_*, trg_mia_*, políticas mia_*, tabelas mia_* e gatilhos trg_mia_demonstracao*
#          não diminuem;
#        - 0 tabela mia_* sem RLS;
#        - as demonstrações geradas pelo código NOVO reaplicam com saída 0.
#
# Uso:
#   scripts/ensaio-de-banco.sh \
#     --no-ar <pasta supabase/ da versão no ar> --demos-no-ar <pasta com demo-<segmento>.sql> \
#     --novo  <pasta supabase/ da versão nova>  --demos-novo  <pasta com demo-<segmento>.sql> \
#     [--resumo <arquivo.md>] [--imagem <imagem do Postgres>] [--dump <arquivo>]
#
# `--dump` é só para uso local: restaura um dump no lugar do banco vazio (auth, storage,
# public e private). O padrão é SEM dump, e nada de produção entra no repositório.
# Código de saída: 0 se toda conferência passou; 1 se alguma falhou; 2 se o preparo falhou.
set -u

# O mesmo padrão do easypanel/bootstrap.sh: o que o `psql` diz num banco que já tem o schema.
BENIGNOS='already exists|multiple primary keys|multiple default values|is already a member|is already member of publication|already a partition'
SEGMENTOS="bancada construtora clinica-odonto industria academia"
IMAGEM_PADRAO="supabase/postgres:17.6.1.084"

NO_AR=""; NOVO=""; DEMOS_NO_AR=""; DEMOS_NOVO=""; RESUMO=""; IMAGEM="$IMAGEM_PADRAO"; DUMP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-ar) NO_AR="$2"; shift 2 ;;
    --novo) NOVO="$2"; shift 2 ;;
    --demos-no-ar) DEMOS_NO_AR="$2"; shift 2 ;;
    --demos-novo) DEMOS_NOVO="$2"; shift 2 ;;
    --resumo) RESUMO="$2"; shift 2 ;;
    --imagem) IMAGEM="$2"; shift 2 ;;
    --dump) DUMP="$2"; shift 2 ;;
    *) echo "argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done
for v in NO_AR NOVO DEMOS_NO_AR DEMOS_NOVO; do
  eval "d=\${$v}"
  [ -n "$d" ] || { echo "falta o argumento de $v (veja o cabeçalho do script)" >&2; exit 2; }
done
for d in "$NO_AR" "$NOVO"; do
  [ -s "$d/baseline.sql" ] && [ -s "$d/baseline-mia.sql" ] || { echo "faltam baseline.sql/baseline-mia.sql em $d" >&2; exit 2; }
done
for seg in $SEGMENTOS; do
  for d in "$DEMOS_NO_AR" "$DEMOS_NOVO"; do
    [ -s "$d/demo-$seg.sql" ] || { echo "falta $d/demo-$seg.sql" >&2; exit 2; }
  done
done

export MSYS_NO_PATHCONV=1
C="ensaio-banco-$$"
LOGS="$(mktemp -d "${TMPDIR:-/tmp}/ensaio-banco.XXXXXX")"
FALHAS=0
LINHAS_RESUMO=""

limpa() { docker rm -fv "$C" >/dev/null 2>&1 || true; }
trap limpa EXIT

PSQL() { docker exec -i "$C" psql -U supabase_admin -h 127.0.0.1 -d postgres "$@"; }
ARQ() { PSQL -q "$@"; }
FORA() { grep -iE 'ERROR|FATAL' "$1" | grep -viE "$BENIGNOS"; }

# Registra uma conferência: ok|FALHOU, o nome e o detalhe.
conferir() {
  local ok="$1" nome="$2" detalhe="${3:-}"
  if [ "$ok" = 1 ]; then
    echo "  [ok]     $nome${detalhe:+ · $detalhe}"
    LINHAS_RESUMO="$LINHAS_RESUMO| ok | $nome | ${detalhe:-} |"$'\n'
  else
    echo "  [FALHOU] $nome${detalhe:+ · $detalhe}"
    LINHAS_RESUMO="$LINHAS_RESUMO| **FALHOU** | $nome | ${detalhe:-} |"$'\n'
    FALHAS=$((FALHAS + 1))
  fi
}

echo "== Ensaio de banco (imagem $IMAGEM)"
docker rm -f "$C" >/dev/null 2>&1
docker run -d --name "$C" --memory=1600m --memory-swap=2600m -e POSTGRES_PASSWORD=ensaio "$IMAGEM" >/dev/null \
  || { echo "o Postgres não subiu" >&2; exit 2; }
for _ in $(seq 1 90); do docker exec "$C" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 2; done
for _ in $(seq 1 60); do PSQL -tAc "select 1" >/dev/null 2>&1 && break; sleep 2; done
PSQL -tAc "select 1" >/dev/null 2>&1 || { echo "o Postgres não ficou pronto" >&2; exit 2; }

docker exec "$C" mkdir -p /ensaio/no-ar /ensaio/novo /ensaio/demos-no-ar /ensaio/demos-novo
docker cp "$NO_AR/baseline.sql" "$C:/ensaio/no-ar/baseline.sql"
docker cp "$NO_AR/baseline-mia.sql" "$C:/ensaio/no-ar/baseline-mia.sql"
docker cp "$NOVO/baseline.sql" "$C:/ensaio/novo/baseline.sql"
docker cp "$NOVO/baseline-mia.sql" "$C:/ensaio/novo/baseline-mia.sql"
# O que o bootstrap aplica ANTES do baseline.sql no modo update (o trecho marcado
# do baseline-mia.sql; migration 9163). Arquivo vazio quando a versão não tem.
for lado in no-ar novo; do
  if [ "$lado" = no-ar ]; then origem="$NO_AR"; else origem="$NOVO"; fi
  sed -n '/^-- >>> ANTES DO BASELINE DO UPSTREAM/,/^-- <<< ANTES DO BASELINE DO UPSTREAM/p' "$origem/baseline-mia.sql" >"$LOGS/antes-$lado.sql"
  docker cp "$LOGS/antes-$lado.sql" "$C:/ensaio/$lado/antes-do-upstream.sql"
done
for seg in $SEGMENTOS; do
  docker cp "$DEMOS_NO_AR/demo-$seg.sql" "$C:/ensaio/demos-no-ar/demo-$seg.sql"
  docker cp "$DEMOS_NOVO/demo-$seg.sql" "$C:/ensaio/demos-novo/demo-$seg.sql"
done

# ── Preparo: o que o bootstrap faz antes do schema (extensões) e o que o Supabase
#    próprio já traz (papéis, auth). O `storage` das imagens vem sem tabelas: o baseline
#    cria buckets e políticas em storage.objects, então entram dois stubs mínimos.
if [ -n "$DUMP" ]; then
  docker cp "$DUMP" "$C:/ensaio/dump.bin"
  PSQL -q -c "drop schema if exists auth cascade; drop schema if exists storage cascade; create schema auth; create schema storage; create schema if not exists private;" >/dev/null 2>&1
  docker exec "$C" pg_restore -U supabase_admin -h 127.0.0.1 -d postgres --no-owner --no-privileges -n auth -n storage /ensaio/dump.bin >"$LOGS/restore1.log" 2>&1
  PSQL -q -c "create extension if not exists vector with schema public; create extension if not exists citext with schema public; create extension if not exists pg_trgm with schema public;" >/dev/null 2>&1
  docker exec "$C" pg_restore -U supabase_admin -h 127.0.0.1 -d postgres --no-owner --no-privileges -n public -n private /ensaio/dump.bin >"$LOGS/restore2.log" 2>&1
  echo "dump restaurado (uso local)"
else
  PSQL -v ON_ERROR_STOP=1 -q >"$LOGS/preparo.log" 2>&1 <<'SQL' || { echo "o preparo do banco falhou:" >&2; tail -15 "$LOGS/preparo.log" >&2; exit 2; }
set client_min_messages = warning;
create schema if not exists extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema public;
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;
create schema if not exists private;
-- O que o GoTrue instala no Supabase de verdade e a imagem pura não traz.
create or replace function auth.jwt() returns jsonb language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$f$;
create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid, not_after timestamptz, aal text);
create table if not exists auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text, factor_type text);
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz not null default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz not null default now()
);
SQL
fi

echo "== 1. versão no ar e demonstrações"
if [ -n "$DUMP" ]; then
  ARQ -f /ensaio/no-ar/antes-do-upstream.sql >"$LOGS/no-ar.log" 2>&1
  ARQ -f /ensaio/no-ar/baseline.sql >>"$LOGS/no-ar.log" 2>&1; ARQ -f /ensaio/no-ar/baseline-mia.sql >>"$LOGS/no-ar.log" 2>&1
  n=$(FORA "$LOGS/no-ar.log" | grep -c .)
  [ "$n" = 0 ] || { echo "a versão no ar aplicou com $n erro(s) fora dos benignos:" >&2; FORA "$LOGS/no-ar.log" | head -10 >&2; exit 2; }
else
  # Banco novo: o mesmo que o bootstrap faz, com ON_ERROR_STOP.
  if ! { ARQ -v ON_ERROR_STOP=1 -f /ensaio/no-ar/baseline.sql && ARQ -v ON_ERROR_STOP=1 -f /ensaio/no-ar/baseline-mia.sql; } >"$LOGS/no-ar.log" 2>&1; then
    echo "a versão no ar não aplicou num banco vazio (preparo, não conferência):" >&2; tail -15 "$LOGS/no-ar.log" >&2; exit 2
  fi
fi
CARIMBO_NO_AR=$(PSQL -tAc "select migration_mais_nova from public.schema_baseline" 2>/dev/null | head -1)
echo "carimbo no ar: ${CARIMBO_NO_AR:-?}"
for seg in $SEGMENTOS; do
  if ! ARQ -v ON_ERROR_STOP=1 -f "/ensaio/demos-no-ar/demo-$seg.sql" >"$LOGS/demo-no-ar-$seg.log" 2>&1; then
    echo "a demonstração '$seg' (código no ar) não carregou no banco no ar:" >&2; tail -8 "$LOGS/demo-no-ar-$seg.log" >&2; exit 2
  fi
done

# 9176 (MIA-337): as empresas de chave própria passam à IA da plataforma. Só
# quando a versão no ar ainda não tem a 9176 (sem a marca em `platform_ia`): com
# ela no ar, a passagem já rodou no banco vazio e não roda de novo, de propósito.
# Quatro empresas fictícias, ANTES da foto (as contagens incluem as delas):
#   alfa  · escolha própria, openai e typesafe, teto 'off', versão presa à chave → passa;
#   beta  · demonstração, com chave openai → fica;
#   vita  · já segue a plataforma, com chave openai → fica (e, entre as passadas,
#           escolhe chave própria: a 2ª passada não a puxa);
#   delta · escolha própria com a chave openai desativada → fica.
S9176=0
if [ "$(PSQL -tAc "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'platform_ia' and column_name = 'chaves_proprias_passaram_em'" 2>/dev/null)" = 0 ]; then
  S9176=1
  if ! PSQL -v ON_ERROR_STOP=1 -q >"$LOGS/sonda-9176.log" 2>&1 <<'SQL'
insert into public.platform_ia (id, provider, model_id) values (1, 'openai', 'gpt-5.6-luna')
  on conflict (id) do update set provider = excluded.provider, model_id = excluded.model_id;
insert into public.organizations (id, slug, legal_name, display_name, status, settings, ia_segue_a_plataforma, demonstracao) values
  ('e9176000-0000-4000-8000-000000000001', 'ensaio-9176-alfa', 'Academia Alfa LTDA', 'Academia Alfa', 'active', '{"llm":{"provider":"openai","default_model":"gpt-5.4-mini"}}', false, false),
  ('e9176000-0000-4000-8000-000000000002', 'ensaio-9176-beta', 'Academia Beta LTDA', 'Academia Beta', 'active', '{"llm":{"provider":"openai","default_model":"gpt-5.4-mini"}}', false, true),
  ('e9176000-0000-4000-8000-000000000003', 'ensaio-9176-vita', 'Vita Odonto LTDA', 'Vita Odonto', 'active', '{}', true, false),
  ('e9176000-0000-4000-8000-000000000004', 'ensaio-9176-delta', 'Construtora Delta LTDA', 'Construtora Delta', 'active', '{"llm":{"provider":"openai","default_model":"gpt-5.4-mini"}}', false, false);
insert into public.ai_provider_credentials
  (id, organization_id, provider, label, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4, is_active, validated_at) values
  ('e9176000-0000-4000-8000-000000000011', 'e9176000-0000-4000-8000-000000000001', 'openai', 'chave openai', '\x00', '\x00', '\x00', '9176', true, now()),
  ('e9176000-0000-4000-8000-000000000012', 'e9176000-0000-4000-8000-000000000001', 'typesafe', 'chave do jev', '\x00', '\x00', '\x00', '9176', true, now()),
  ('e9176000-0000-4000-8000-000000000021', 'e9176000-0000-4000-8000-000000000002', 'openai', 'chave openai', '\x00', '\x00', '\x00', '9176', true, now()),
  ('e9176000-0000-4000-8000-000000000031', 'e9176000-0000-4000-8000-000000000003', 'openai', 'chave openai', '\x00', '\x00', '\x00', '9176', true, now()),
  ('e9176000-0000-4000-8000-000000000041', 'e9176000-0000-4000-8000-000000000004', 'openai', 'chave openai', '\x00', '\x00', '\x00', '9176', false, now());
insert into public.ai_budgets (organization_id, monthly_limit_cents, enforcement_mode)
  values ('e9176000-0000-4000-8000-000000000001', 5000, 'off');
insert into public.channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
  values ('e9176000-0000-4000-8000-000000000051', 'e9176000-0000-4000-8000-000000000001', 'ensaio-9176-alfa', 'WORKING', '\x00'::bytea);
insert into public.ai_agents (id, organization_id, name, system_prompt)
  values ('e9176000-0000-4000-8000-000000000061', 'e9176000-0000-4000-8000-000000000001', 'Atendente', 'system');
insert into public.ai_agent_versions
  (id, organization_id, agent_id, version_number, system_prompt, provider, model, credential_id, channel_session_id, status)
  values ('e9176000-0000-4000-8000-000000000071', 'e9176000-0000-4000-8000-000000000001', 'e9176000-0000-4000-8000-000000000061',
          1, 'system', 'openai', 'gpt-5.4-mini', 'e9176000-0000-4000-8000-000000000011', 'e9176000-0000-4000-8000-000000000051', 'published');
update public.ai_agents set published_version_id = 'e9176000-0000-4000-8000-000000000071'
 where id = 'e9176000-0000-4000-8000-000000000061';
SQL
  then
    echo "o preparo da sonda 9176 falhou (preparo, não conferência):" >&2; tail -8 "$LOGS/sonda-9176.log" >&2; exit 2
  fi
fi
# O estado que a 9176 pode mudar, uma linha por empresa fictícia: segue | par |
# credenciais (provedor:ativa:validada) | teto | linhas de auditoria | a versão.
ESTADO_9176="select substr(o.slug, 13) || '|' || o.ia_segue_a_plataforma::text
  || '|' || coalesce(o.settings->'llm'->>'provider', '-') || '/' || coalesce(o.settings->'llm'->>'default_model', '-')
  || '|' || coalesce((select string_agg(c.provider || ':' || c.is_active::text || ':' || (c.validated_at is not null)::text, ',' order by c.provider)
                        from public.ai_provider_credentials c where c.organization_id = o.id), '-')
  || '|' || coalesce((select b.monthly_limit_cents || ':' || b.enforcement_mode from public.ai_budgets b where b.organization_id = o.id), '-')
  || '|' || (select count(*) from public.api_audit_log l where l.organization_id = o.id and l.action = 'ai.chave_propria_passou_a_plataforma')
  || '|' || coalesce((select v.provider || '/' || v.model || '/' || (v.credential_id is not null)::text || '/' || v.status
                        from public.ai_agent_versions v where v.organization_id = o.id), '-')
  from public.organizations o where o.slug like 'ensaio-9176-%' order by o.slug"
[ "$S9176" = 1 ] && E9176_ANTES=$(PSQL -tAc "$ESTADO_9176" 2>&1)

CONTAGEM="select (select count(*) from public.organizations) || ' empresas, ' || (select count(*) from public.contacts) || ' contatos, ' || (select count(*) from public.crm_leads) || ' negócios, ' || (select coalesce(sum(value_cents),0) from public.crm_leads) || ' centavos, ' || (select count(*) from public.conversations) || ' conversas, ' || (select count(*) from public.messages) || ' mensagens, ' || (select count(*) from public.crm_pipelines) || ' funis, ' || (select count(*) from public.crm_stages) || ' etapas, ' || (select count(*) from public.channel_sessions) || ' sessões de canal, ' || (select count(*) from public.meta_templates) || ' modelos da Meta'"
FUNIS="select md5(coalesce(string_agg(id::text || coalesce(settings::text,''), ',' order by id),'')) from public.crm_pipelines"
RELATORIO="select md5(coalesce(string_agg(o.id::text || ':' || (select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public.fn_mia_relatorio_linhas(o.id, 'negocios', '2020-01-01'::timestamptz, '2031-01-01'::timestamptz, '{}'::jsonb, '2026-11-17 12:00+00'::timestamptz, 'America/Sao_Paulo') t), ',' order by o.id), '')) from public.organizations o"
COLUNAS="select table_name || '.' || column_name from information_schema.columns where table_schema='public' order by 1"
# Uma chave por linha, para comparar uma a uma ("não diminui").
NOSSOS="select 'funções fn_mia_=' || count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'fn_mia_%'
union all select 'gatilhos trg_mia_=' || count(*) from pg_trigger where tgname like 'trg_mia_%' and not tgisinternal
union all select 'políticas das tabelas mia_=' || count(*) from pg_policies where tablename like 'mia_%'
union all select 'tabelas mia_=' || count(*) from pg_tables where schemaname='public' and tablename like 'mia_%'
union all select 'gatilhos trg_mia_demonstracao=' || count(*) from pg_trigger where tgname like 'trg_mia_demonstracao%' and not tgisinternal"

ANTES=$(PSQL -tAc "$CONTAGEM" 2>&1); F_ANTES=$(PSQL -tAc "$FUNIS" 2>&1); R_ANTES=$(PSQL -tAc "$RELATORIO" 2>&1)
N_ANTES=$(PSQL -tAc "$NOSSOS" 2>&1)
PSQL -tAc "$COLUNAS" >"$LOGS/colunas-antes.txt"

# Tabela NOSSA renomeada de propósito: "antigo:novo:coluna que só o formato nosso
# tem". Só vale quando o banco no ar ainda tem o formato nosso no nome antigo; aí
# as colunas dela são comparadas pelo nome novo e as linhas têm de bater.
# 9163: a nossa organization_modules saiu do caminho da do upstream (9416).
RENOMEADAS="organization_modules:mia_modulos_contratados:revoked_at"
LINHAS_RENOMEADAS=""
for r in $RENOMEADAS; do
  antiga="${r%%:*}"; resto="${r#*:}"; nova="${resto%%:*}"; marca="${resto#*:}"
  grep -qxF "$antiga.$marca" "$LOGS/colunas-antes.txt" || continue
  n=$(PSQL -tAc "select count(*) from public.$antiga" 2>&1)
  LINHAS_RENOMEADAS="$LINHAS_RENOMEADAS $antiga:$nova:$n"
  sed -i.bak "s/^$antiga\./$nova./" "$LOGS/colunas-antes.txt"
done
# O comm exige as duas listas na mesma ordem: o renomear acima tira a de antes
# da ordem do Postgres, então as duas são reordenadas com a mesma regra.
LC_ALL=C sort -o "$LOGS/colunas-antes.txt" "$LOGS/colunas-antes.txt"
echo "foto antes: $ANTES"

echo "== 2. versão nova, duas passadas"
T0=$(date +%s)
# A ordem do easypanel/bootstrap.sh no modo update: o trecho "antes do upstream"
# do nosso arquivo, o baseline.sql dele, o baseline-mia.sql inteiro.
for p in 1 2; do
  ARQ -f /ensaio/novo/antes-do-upstream.sql >"$LOGS/novo$p.log" 2>&1
  ARQ -f /ensaio/novo/baseline.sql >>"$LOGS/novo$p.log" 2>&1; ARQ -f /ensaio/novo/baseline-mia.sql >>"$LOGS/novo$p.log" 2>&1
  if [ "$p" = 1 ]; then
    TEMPO=$(( $(date +%s) - T0 ))
    # 9176: depois da implantação, a Vita escolhe chave própria (já tem a openai
    # ativa). A 2ª passada roda o baseline de novo e não pode puxá-la de volta.
    if [ "$S9176" = 1 ]; then
      E9176_P1=$(PSQL -tAc "$ESTADO_9176" 2>&1)
      PSQL -qc "update public.organizations set ia_segue_a_plataforma = false where slug = 'ensaio-9176-vita'" >/dev/null 2>&1
    fi
  fi
done
CARIMBO_NOVO=$(PSQL -tAc "select migration_mais_nova from public.schema_baseline" 2>/dev/null | head -1)
echo "tempo da 1ª passada: ${TEMPO} s · carimbo novo: ${CARIMBO_NOVO:-?}"

DEPOIS=$(PSQL -tAc "$CONTAGEM" 2>&1); F_DEPOIS=$(PSQL -tAc "$FUNIS" 2>&1); R_DEPOIS=$(PSQL -tAc "$RELATORIO" 2>&1)
N_DEPOIS=$(PSQL -tAc "$NOSSOS" 2>&1)
PSQL -tAc "$COLUNAS" >"$LOGS/colunas-depois.txt"
LC_ALL=C sort -o "$LOGS/colunas-depois.txt" "$LOGS/colunas-depois.txt"

echo "== 3. conferências"
for p in 1 2; do
  n=$(FORA "$LOGS/novo$p.log" | grep -c .)
  if [ "$n" = 0 ]; then conferir 1 "passada $p da versão nova: 0 erro fora dos benignos"
  else conferir 0 "passada $p da versão nova: $n erro(s) fora dos benignos" "$(FORA "$LOGS/novo$p.log" | sort | uniq -c | sort -rn | head -3 | cut -c1-200 | tr '\n' ';')"; fi
done
if [ "$ANTES" = "$DEPOIS" ]; then conferir 1 "contagens iguais" "$DEPOIS"
else conferir 0 "contagens mudaram" "antes: $ANTES · depois: $DEPOIS"; fi
if [ "$F_ANTES" = "$F_DEPOIS" ]; then conferir 1 "configuração dos funis igual (md5)"
else conferir 0 "configuração dos funis mudou" "$F_ANTES x $F_DEPOIS"; fi
if printf '%s' "$R_ANTES" | grep -qi 'ERROR'; then
  echo "  [aviso]  relatório de negócios não medido: a função não existe na versão no ar"
  LINHAS_RESUMO="$LINHAS_RESUMO| aviso | relatório de negócios | não medido (função ausente na versão no ar) |"$'\n'
elif [ "$R_ANTES" = "$R_DEPOIS" ]; then conferir 1 "relatório de negócios igual (fn_mia_relatorio_linhas)"
else conferir 0 "relatório de negócios mudou" "$R_ANTES x $R_DEPOIS"; fi

SUMIU=$(LC_ALL=C comm -23 "$LOGS/colunas-antes.txt" "$LOGS/colunas-depois.txt")
NSUMIU=$(printf '%s' "$SUMIU" | grep -c .)
NOVAS=$(LC_ALL=C comm -13 "$LOGS/colunas-antes.txt" "$LOGS/colunas-depois.txt" | grep -c .)
if [ "$NSUMIU" = 0 ]; then conferir 1 "nenhuma coluna do public sumiu" "$NOVAS coluna(s) nova(s)"
else conferir 0 "$NSUMIU coluna(s) do public sumiram" "$(printf '%s\n' "$SUMIU" | head -8 | tr '\n' ' ')"; fi

for r in $LINHAS_RENOMEADAS; do
  antiga="${r%%:*}"; resto="${r#*:}"; nova="${resto%%:*}"; antes="${resto#*:}"
  depois=$(PSQL -tAc "select count(*) from public.$nova" 2>&1)
  if [ "$antes" = "$depois" ]; then conferir 1 "$antiga (nossa) renomeada para $nova com as mesmas linhas" "$depois linha(s)"
  else conferir 0 "$antiga (nossa) renomeada para $nova perdeu ou ganhou linha" "antes: $antes · depois: $depois"; fi
done

# O `rename` não corrige texto: função ou view que ainda leia a nossa pelo nome
# antigo, com coluna do formato nosso, quebra calada. 9163.
CITAM=$(PSQL -tAc "select string_agg(nome, ', ' order by nome) from (
  select p.proname as nome from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosrc ~ 'organization_modules' and p.prosrc ~ '(revoked_at|granted_at|granted_by|revoked_by)'
  union all
  select viewname from pg_views where schemaname = 'public' and definition ~ 'organization_modules' and definition ~ '(revoked_at|granted_at)') x" 2>&1)
if [ -z "$CITAM" ]; then conferir 1 "nenhuma função ou view lê a organization_modules com coluna da nossa"
else conferir 0 "função ou view lê a organization_modules com coluna da nossa (troque para mia_modulos_contratados)" "$CITAM"; fi

# Cada contagem dos objetos nossos: o depois não pode ser menor que o antes.
DIM=""
while IFS= read -r linha; do
  [ -n "$linha" ] || continue
  chave="${linha%=*}"; antes="${linha##*=}"
  depois=$(printf '%s\n' "$N_DEPOIS" | grep -F "$chave=" | head -1 | sed 's/.*=//')
  if [ -z "$depois" ] || [ "$depois" -lt "$antes" ] 2>/dev/null; then DIM="$DIM $chave: $antes -> ${depois:-?};"; fi
done <<EOF
$N_ANTES
EOF
if [ -z "$DIM" ]; then conferir 1 "objetos nossos não diminuíram" "$(printf '%s' "$N_DEPOIS" | tr '\n' ';')"
else conferir 0 "objetos nossos diminuíram" "$DIM"; fi

SEM_RLS=$(PSQL -tAc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'mia_%' and not c.relrowsecurity" 2>&1)
if [ "$SEM_RLS" = 0 ]; then conferir 1 "0 tabela mia_ sem RLS"; else conferir 0 "tabelas mia_ sem RLS: $SEM_RLS"; fi

# 9173 (MIA-251 D): com a sessão de um membro, o custo de IA não se grava; a
# anonimização LGPD (`tool_calls`) e o servidor (service_role) gravam. Cada
# tentativa roda num subbloco que se desfaz: nada fica no banco.
CUSTO=$(PSQL -tA 2>&1 <<'SQL'
do $$
declare
  v_uid uuid;
  v_org uuid;
  r record;
  res text;
begin
  select uo.user_id, uo.organization_id into v_uid, v_org
    from public.user_organizations uo
   where uo.accepted_at is not null
   order by (uo.role = 'admin') desc, uo.organization_id
   limit 1;
  v_org := coalesce(v_org, (select o.id from public.organizations o order by o.id limit 1));
  v_uid := coalesce(v_uid, gen_random_uuid());
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  for r in
    select * from (values
      ('membro: update llm_calls.cost_cents', 'authenticated',
       format('update public.llm_calls set cost_cents = 0 where organization_id = %L', v_org), 'negado'),
      ('membro: insert em llm_calls', 'authenticated',
       format('insert into public.llm_calls (organization_id, purpose, provider, model, cost_cents, latency_ms) values (%L, %L, %L, %L, 0, 0)', v_org, 'agent_turn', 'ensaio', 'ensaio'), 'negado'),
      ('membro: delete em llm_calls', 'authenticated',
       format('delete from public.llm_calls where organization_id = %L', v_org), 'negado'),
      ('membro: update ai_agent_runs.cost_cents', 'authenticated',
       format('update public.ai_agent_runs set cost_cents = 0 where organization_id = %L', v_org), 'negado'),
      ('membro: update ai_agent_runs.tool_calls (anonimização LGPD)', 'authenticated',
       format('update public.ai_agent_runs set tool_calls = tool_calls where organization_id = %L', v_org), 'grava'),
      ('servidor: insert em llm_calls (service_role)', 'service_role',
       format('insert into public.llm_calls (organization_id, purpose, provider, model, cost_cents, latency_ms) values (%L, %L, %L, %L, 1, 0)', v_org, 'agent_turn', 'ensaio', 'ensaio'), 'grava'),
      ('servidor: update ai_agent_runs.cost_cents (service_role)', 'service_role',
       format('update public.ai_agent_runs set cost_cents = cost_cents where organization_id = %L', v_org), 'grava')
    ) t(nome, papel, comando, esperado)
  loop
    begin
      execute format('set local role %I', r.papel);
      execute r.comando;
      raise exception using errcode = 'P0001', message = 'desfaz';
    exception
      when insufficient_privilege then
        res := case when sqlerrm like 'permission denied%' then 'negado' else 'rls: ' || sqlerrm end;
      when sqlstate 'P0001' then
        res := 'grava';
      when others then
        res := 'erro ' || sqlstate || ': ' || sqlerrm;
    end;
    raise notice 'CUSTO|%|%|%', case when res = r.esperado then 'ok' else 'FALHOU' end, r.nome, res;
  end loop;
end $$;
SQL
)
N_CUSTO=0
while IFS='|' read -r _ ok nome res; do
  [ -n "$nome" ] || continue
  N_CUSTO=$((N_CUSTO + 1))
  if [ "$ok" = ok ]; then conferir 1 "custo de IA (9173) · $nome" "$res"
  else conferir 0 "custo de IA (9173) · $nome" "$res"; fi
done <<EOF
$(printf '%s\n' "$CUSTO" | grep -F 'CUSTO|')
EOF
[ "$N_CUSTO" -gt 0 ] || conferir 0 "custo de IA (9173): a sonda não rodou" "$(printf '%s' "$CUSTO" | head -3 | cut -c1-200 | tr '\n' ';')"

# 9176 (MIA-337): só a de chave própria passou, e a 2ª passada não puxou ninguém.
if [ "$S9176" = 1 ]; then
  E9176_DEPOIS=$(PSQL -tAc "$ESTADO_9176" 2>&1)
  linha_9176() { printf '%s\n' "$1" | grep "^$2|"; }
  conferir_9176() {
    local nome="$1" obtido="$2" esperado="$3"
    if [ "$obtido" = "$esperado" ]; then conferir 1 "chave própria (9176) · $nome" "$obtido"
    else conferir 0 "chave própria (9176) · $nome" "esperado: $esperado · obtido: ${obtido:-nada}"; fi
  }
  conferir_9176 "a de chave própria passa: openai desativada (validada), segue a plataforma, typesafe ativa, teto 3000 avisar, 1 auditoria, versão intacta" \
    "$(linha_9176 "$E9176_P1" alfa)" \
    "alfa|true|openai/gpt-5.6-luna|openai:false:true,typesafe:true:true|3000:avisar|1|openai/gpt-5.4-mini/true/published"
  conferir_9176 "a 2ª passada não muda a que passou" "$(linha_9176 "$E9176_DEPOIS" alfa)" "$(linha_9176 "$E9176_P1" alfa)"
  conferir_9176 "a demonstração fica" "$(linha_9176 "$E9176_DEPOIS" beta)" "$(linha_9176 "$E9176_ANTES" beta)"
  conferir_9176 "a de chave desativada fica" "$(linha_9176 "$E9176_DEPOIS" delta)" "$(linha_9176 "$E9176_ANTES" delta)"
  conferir_9176 "a que já seguia fica na 1ª passada" "$(linha_9176 "$E9176_P1" vita)" "$(linha_9176 "$E9176_ANTES" vita)"
  conferir_9176 "quem escolhe chave própria depois da implantação não volta na 2ª passada" \
    "$(linha_9176 "$E9176_DEPOIS" vita | cut -d'|' -f2,4,6)" "false|openai:true:true|0"
  conferir_9176 "a marca de que já rodou" \
    "$(PSQL -tAc "select (chaves_proprias_passaram_em is not null)::text from public.platform_ia where id = 1" 2>&1)" "true"
else
  echo "  [aviso]  chave própria (9176): não se aplica, a 9176 já está na versão no ar"
  LINHAS_RESUMO="$LINHAS_RESUMO| aviso | chave própria (9176) | não se aplica (já está na versão no ar) |"$'\n'
fi

for seg in $SEGMENTOS; do
  if ARQ -v ON_ERROR_STOP=1 -f "/ensaio/demos-novo/demo-$seg.sql" >"$LOGS/demo-novo-$seg.log" 2>&1; then
    conferir 1 "demonstração '$seg' (código novo) reaplica com saída 0"
  else
    conferir 0 "demonstração '$seg' (código novo) falhou ao reaplicar" "$(grep -iE 'ERROR|FATAL' "$LOGS/demo-novo-$seg.log" | head -2 | cut -c1-200 | tr '\n' ';')"
  fi
done

echo
if [ "$FALHAS" = 0 ]; then echo "RESULTADO: ensaio verde (todas as conferências passaram)"; else echo "RESULTADO: ensaio VERMELHO ($FALHAS conferência(s) falharam)"; fi

if [ -n "$RESUMO" ]; then
  {
    echo "## Ensaio de banco"
    echo
    echo "Carimbo no ar: \`${CARIMBO_NO_AR:-?}\` · carimbo novo: \`${CARIMBO_NOVO:-?}\` · 1ª passada da versão nova: ${TEMPO} s · imagem: \`$IMAGEM\`"
    echo
    echo "Foto antes: $ANTES"
    echo
    echo "| Resultado | Conferência | Detalhe |"
    echo "|---|---|---|"
    printf '%s' "$LINHAS_RESUMO"
    echo
    if [ "$FALHAS" = 0 ]; then echo "**Verde.**"; else echo "**Vermelho: $FALHAS conferência(s) falharam.**"; fi
  } >>"$RESUMO"
fi
[ "$FALHAS" = 0 ]
