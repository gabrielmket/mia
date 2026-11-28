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
#   3b. roda o easypanel/bootstrap.sh DE VERDADE (modo update, env fictícia, sem OWNER_EMAIL)
#      sob disputa provocada por uma sessão que segura lock em public.conversations
#      (MIA-348): disputa curta cura na 2ª passada sem prender o app; disputa que não
#      acaba vira erro no carimbo, e some na rodada seguinte.
#   3c. o bootstrap de verdade com o `create` de uma política restritiva de
#      public.conversations perdendo a disputa nas 3 passadas (o `drop` ganha): a
#      conferência das regras a recria do arquivo, igual, e o carimbo fica com 0 (MIA-354).
#
# Uso:
#   scripts/ensaio-de-banco.sh \
#     --no-ar <pasta supabase/ da versão no ar> --demos-no-ar <pasta com demo-<segmento>.sql> \
#     --novo  <pasta supabase/ da versão nova>  --demos-novo  <pasta com demo-<segmento>.sql> \
#     [--resumo <arquivo.md>] [--imagem <imagem do Postgres>] [--dump <arquivo>]
#     [--bootstrap <easypanel/bootstrap.sh>]   (padrão: o do repositório deste script)
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
BOOTSTRAP="$(cd "$(dirname "$0")/.." && pwd)/easypanel/bootstrap.sh"
while [ $# -gt 0 ]; do
  case "$1" in
    --no-ar) NO_AR="$2"; shift 2 ;;
    --novo) NOVO="$2"; shift 2 ;;
    --demos-no-ar) DEMOS_NO_AR="$2"; shift 2 ;;
    --demos-novo) DEMOS_NOVO="$2"; shift 2 ;;
    --resumo) RESUMO="$2"; shift 2 ;;
    --imagem) IMAGEM="$2"; shift 2 ;;
    --dump) DUMP="$2"; shift 2 ;;
    --bootstrap) BOOTSTRAP="$2"; shift 2 ;;
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
[ -s "$BOOTSTRAP" ] || { echo "falta o easypanel/bootstrap.sh ($BOOTSTRAP)" >&2; exit 2; }
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
# A etapa 3b roda o bootstrap de verdade, que lê os dois arquivos dos caminhos fixos da imagem.
docker exec "$C" mkdir -p /deskcomm
docker cp "$BOOTSTRAP" "$C:/deskcomm/bootstrap.sh"
docker cp "$NOVO/baseline.sql" "$C:/deskcomm/baseline.sql"
docker cp "$NOVO/baseline-mia.sql" "$C:/deskcomm/baseline-mia.sql"
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
  if [ "$p" = 1 ]; then TEMPO=$(( $(date +%s) - T0 )); fi
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

for seg in $SEGMENTOS; do
  if ARQ -v ON_ERROR_STOP=1 -f "/ensaio/demos-novo/demo-$seg.sql" >"$LOGS/demo-novo-$seg.log" 2>&1; then
    conferir 1 "demonstração '$seg' (código novo) reaplica com saída 0"
  else
    conferir 0 "demonstração '$seg' (código novo) falhou ao reaplicar" "$(grep -iE 'ERROR|FATAL' "$LOGS/demo-novo-$seg.log" | head -2 | cut -c1-200 | tr '\n' ';')"
  fi
done

echo "== 3b. a versão nova pelo bootstrap de verdade, sob disputa (MIA-348)"
# O easypanel/bootstrap.sh do PR, no modo update, dentro do contêiner do ensaio. Env
# fictícia e sem OWNER_EMAIL: ele sai antes de qualquer chamada HTTP. Uma sessão
# segura `access share` em public.conversations, o que basta para todo comando do
# schema que pede lock exclusivo nela esperar. A disputa é provocada e o tempo dela
# é escolhido: nada aqui depende de sorte.
BOOT() {
  docker exec \
    -e NEXT_PUBLIC_SUPABASE_URL=https://ensaio.exemplo.invalid \
    -e SUPABASE_SERVICE_ROLE_KEY=chave-ficticia-do-ensaio \
    -e SUPABASE_DB_URL=postgresql://supabase_admin@127.0.0.1:5432/postgres \
    -e NUVEMSHOP_OAUTH_ENCRYPTION_KEY=chave-ficticia-do-ensaio \
    -e OWNER_EMAIL= -e OWNER_PASSWORD= -e CPF_ENCRYPTION_KEY= \
    "$C" sh /deskcomm/bootstrap.sh
}
# segurar_lock <segundos> [tabela] [modo]: em segundo plano, com application_name para
# achar e soltar. O padrão é `access share` em public.conversations (3b); a 3c segura
# outra tabela.
segurar_lock() {
  local tabela="${2:-public.conversations}" modo="${3:-access share}"
  docker exec -e PGAPPNAME=ensaio-trava "$C" psql -U supabase_admin -h 127.0.0.1 -d postgres -q \
    -c "begin; lock table $tabela in $modo mode; select pg_sleep($1); commit;" >/dev/null 2>&1 &
  TRAVA=$!
  for _ in $(seq 1 50); do
    [ "$(PSQL -tAc "select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.application_name = 'ensaio-trava' and l.relation = '$tabela'::regclass and l.granted" 2>/dev/null)" = 1 ] && return 0
    sleep 0.2
  done
  return 1
}
soltar_lock() {
  PSQL -tAc "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'ensaio-trava'" >/dev/null 2>&1
  wait "$TRAVA" 2>/dev/null
}
# Uma linha só: migração|erros|aplicado_em (a amostra, de várias linhas, é lida à parte).
CARIMBO_SQL="select migration_mais_nova || '|' || coalesce(erros_inesperados::text, '?') || '|' || extract(epoch from aplicado_em)::bigint from public.schema_baseline where id = 1"
AMOSTRA_SQL="select coalesce(erros_amostra, '') from public.schema_baseline where id = 1"
POLITICAS="select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'"
POL_ETAPA3=$(PSQL -tAc "$POLITICAS" 2>&1)

# Caso 1 e 2: disputa curta (8 s). A passada 1 sob disputa já leva mais que isso (cada
# comando em conversations espera a espera curta), então o lock cai no meio da passada 1
# e a 2ª sai limpa;
# e uma sessão do "app" que lê conversations durante o lock com statement_timeout de
# 2 s. Sem a espera curta, a leitura ficaria na fila atrás do lock exclusivo que o
# schema pede, até os 8 s.
ANTES_C1=$(PSQL -tAc "$CARIMBO_SQL" 2>&1)
if segurar_lock 8; then
  (
    falhas=0; feitas=0
    for _ in $(seq 1 14); do
      feitas=$((feitas + 1))
      PSQL -tA -c "set statement_timeout = '2s'" -c "select count(*) from public.conversations" </dev/null >/dev/null 2>&1 || falhas=$((falhas + 1))
      sleep 0.5
    done
    echo "$feitas $falhas" >"$LOGS/sonda-do-app.txt"
  ) &
  SONDA=$!
  BOOT >"$LOGS/bootstrap-caso1.log" 2>&1; RC1=$?
  wait "$SONDA"; soltar_lock
  DEPOIS_C1=$(PSQL -tAc "$CARIMBO_SQL" 2>&1)
  POL_C1=$(PSQL -tAc "$POLITICAS" 2>&1)
  IFS='|' read -r mig1 erros1 epoca1 <<<"$DEPOIS_C1"
  epoca0="${ANTES_C1##*|}"
  if [ "$RC1" = 0 ]; then conferir 1 "3b caso 1: o bootstrap sob disputa curta sai 0"
  else conferir 0 "3b caso 1: o bootstrap sob disputa curta saiu $RC1" "$(tail -3 "$LOGS/bootstrap-caso1.log" | cut -c1-200 | tr '\n' ';')"; fi
  if grep -q "passada 2 de 3: sem erro" "$LOGS/bootstrap-caso1.log"; then conferir 1 "3b caso 1: a disputa curta cura na passada 2" "$(grep -c 'perderam a disputa' "$LOGS/bootstrap-caso1.log") passada(s) com disputa"
  else conferir 0 "3b caso 1: a passada 2 não fechou limpa (ou nem houve disputa na 1ª)" "$(grep -E 'passada|espera curta' "$LOGS/bootstrap-caso1.log" | cut -c1-200 | tr '\n' ';')"; fi
  if [ "$erros1" = 0 ]; then conferir 1 "3b caso 1: erros_inesperados = 0"
  else conferir 0 "3b caso 1: erros_inesperados = ${erros1:-?}" "$(printf '%s' "$DEPOIS_C1" | cut -c1-300)"; fi
  if [ "$mig1" = "$CARIMBO_NOVO" ] && [ -n "$epoca1" ] && [ "$epoca1" -ge "${epoca0:-0}" ] 2>/dev/null && [ "$DEPOIS_C1" != "$ANTES_C1" ]; then conferir 1 "3b caso 1: carimbo novo" "$mig1"
  else conferir 0 "3b caso 1: o carimbo não foi regravado" "antes: $ANTES_C1 · depois: $DEPOIS_C1"; fi
  if [ "$POL_C1" = "$POL_ETAPA3" ]; then conferir 1 "3b caso 1: políticas do public iguais às da etapa 3" "$POL_C1"
  else conferir 0 "3b caso 1: políticas do public mudaram" "etapa 3: $POL_ETAPA3 · depois: $POL_C1"; fi
  read -r feitas falhas <"$LOGS/sonda-do-app.txt" 2>/dev/null
  if [ "${feitas:-0}" -gt 0 ] && [ "${falhas:-1}" = 0 ]; then conferir 1 "3b caso 2: o app não fica na fila atrás do schema" "$feitas leitura(s) com statement_timeout de 2 s, todas responderam"
  else conferir 0 "3b caso 2: leitura do app presa atrás do schema" "${falhas:-?} de ${feitas:-?} estouraram os 2 s"; fi
else
  soltar_lock
  conferir 0 "3b casos 1 e 2: a sessão que segura o lock não pegou o lock"
fi

# Caso 3: disputa que não acaba. A sessão segura o lock até o bootstrap terminar
# (e não por um tempo fixo: as 3 passadas, com as esperas de 10 s e 20 s, duram o
# que a lista de comandos em conversations mandar). O app sobe (saída 0), o
# carimbo fica com erros > 0 e `lock timeout` na amostra; solto o lock, a rodada
# seguinte volta a 0. É a /health dizendo `em_dia: false` e depois `true`.
if segurar_lock 900; then
  BOOT >"$LOGS/bootstrap-caso3.log" 2>&1; RC3=$?
  soltar_lock
  DEPOIS_C3=$(PSQL -tAc "$CARIMBO_SQL" 2>&1)
  AMOSTRA_C3=$(PSQL -tAc "$AMOSTRA_SQL" 2>&1)
  IFS='|' read -r _ erros3 _ <<<"$DEPOIS_C3"
  if [ "$RC3" = 0 ]; then conferir 1 "3b caso 3: sob disputa que não acaba, o bootstrap sai 0 (o app sobe)"
  else conferir 0 "3b caso 3: o bootstrap saiu $RC3" "$(tail -3 "$LOGS/bootstrap-caso3.log" | cut -c1-200 | tr '\n' ';')"; fi
  if grep -q "passada 3 de 3: .* perderam a disputa, e acabaram as passadas" "$LOGS/bootstrap-caso3.log"; then conferir 1 "3b caso 3: três passadas, e para na 3ª"
  else conferir 0 "3b caso 3: não foram as 3 passadas" "$(grep -E 'passada' "$LOGS/bootstrap-caso3.log" | cut -c1-200 | tr '\n' ';')"; fi
  if [ "${erros3:-0}" -gt 0 ] 2>/dev/null && printf '%s' "$AMOSTRA_C3" | grep -qi 'lock timeout'; then conferir 1 "3b caso 3: erros_inesperados > 0, com lock timeout na amostra" "$erros3 erro(s)"
  else conferir 0 "3b caso 3: o carimbo não contou a disputa" "$DEPOIS_C3 · $(printf '%s' "$AMOSTRA_C3" | cut -c1-200 | tr '\n' ';')"; fi
  BOOT >"$LOGS/bootstrap-caso3-depois.log" 2>&1; RC3B=$?
  erros3b=$(PSQL -tAc "select erros_inesperados from public.schema_baseline where id = 1" 2>&1)
  if [ "$RC3B" = 0 ] && [ "$erros3b" = 0 ]; then conferir 1 "3b caso 3: solto o lock, a rodada seguinte volta a 0"
  else conferir 0 "3b caso 3: solto o lock, a rodada seguinte não voltou a 0" "saída $RC3B · erros ${erros3b:-?} · $(grep -iE 'ERROR' "$LOGS/bootstrap-caso3-depois.log" | head -2 | cut -c1-200 | tr '\n' ';')"; fi
else
  soltar_lock
  conferir 0 "3b caso 3: a sessão que segura o lock não pegou o lock"
fi

echo "== 3c. a regra restritiva que o drop tirou e o create não devolveu volta do arquivo (MIA-354)"
# O buraco que sobra da espera curta: na última passada, o `drop policy if exists`
# ganha a disputa e o `create policy` perde, e a regra fica fora do banco. Uma
# restritiva faltando AMPLIA o acesso. Apagar a regra à mão antes do bootstrap não
# provaria nada: a passada a recria sozinha. Então a disputa é provocada só no
# `create` dela: um gatilho de evento do ensaio (`ddl_command_start`, CREATE POLICY)
# tenta um lock numa tabela que outra sessão segura, nas 3 primeiras vezes em que o
# comando dela chega (contadas por uma sequência, que não volta no rollback). Nas 3
# passadas o `drop` ganha e o `create` perde por lock timeout de verdade; a 4ª vez
# é a da conferência das regras, que tem de trazê-la de volta. Nada depende de sorte.
REGRA_3C=conversation_participant_read_is_not_control_update
DEF_3C="select polpermissive::text || '|' || polcmd::text || '|' || array_to_string(polroles::regrole[], ',') || '|' || coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), '') from pg_policy where polname = '$REGRA_3C' and polrelid = 'public.conversations'::regclass"
DEF_ANTES_3C=$(PSQL -tAc "$DEF_3C" 2>&1)
if [ "${DEF_ANTES_3C%%|*}" != false ]; then
  conferir 0 "3c: a política restritiva $REGRA_3C não está em public.conversations" "o baseline.sql mudou? Troque REGRA_3C por outra restritiva de conversations criada fora de \`do \$\$\`. Lido: $(printf '%s' "$DEF_ANTES_3C" | cut -c1-200)"
elif ! PSQL -v ON_ERROR_STOP=1 -q >"$LOGS/preparo-3c.log" 2>&1 <<SQL
create schema ensaio_3c;
create table ensaio_3c.trava (x int);
create sequence ensaio_3c.vezes;
create function ensaio_3c.perde() returns event_trigger language plpgsql as \$\$
begin
  if current_query() ~* 'create\s+policy\s+${REGRA_3C}\M' and nextval('ensaio_3c.vezes') <= 3 then
    lock table ensaio_3c.trava in access share mode;
  end if;
end \$\$;
create event trigger ensaio_3c_perde on ddl_command_start when tag in ('CREATE POLICY') execute function ensaio_3c.perde();
SQL
then
  conferir 0 "3c: o preparo (gatilho de evento do ensaio) falhou" "$(grep -iE 'ERROR' "$LOGS/preparo-3c.log" | head -2 | cut -c1-200 | tr '\n' ';')"
elif segurar_lock 900 ensaio_3c.trava "access exclusive"; then
  BOOT >"$LOGS/bootstrap-3c.log" 2>&1; RC3C=$?
  soltar_lock
  VEZES_3C=$(PSQL -tAc "select last_value from ensaio_3c.vezes" 2>&1)
  DEF_DEPOIS_3C=$(PSQL -tAc "$DEF_3C" 2>&1)
  DEPOIS_3C=$(PSQL -tAc "$CARIMBO_SQL" 2>&1)
  IFS='|' read -r _ erros3c _ <<<"$DEPOIS_3C"
  if [ "$RC3C" = 0 ]; then conferir 1 "3c: o bootstrap sai 0"
  else conferir 0 "3c: o bootstrap saiu $RC3C" "$(tail -3 "$LOGS/bootstrap-3c.log" | cut -c1-200 | tr '\n' ';')"; fi
  if grep -q "passada 3 de 3: .* perderam a disputa, e acabaram as passadas" "$LOGS/bootstrap-3c.log" \
     && grep -q "regras de isolamento: 1 fora do banco depois da última passada" "$LOGS/bootstrap-3c.log"; then
    conferir 1 "3c: o create perdeu nas 3 passadas e a regra ficou fora do banco" "$VEZES_3C vez(es) o comando chegou"
  else conferir 0 "3c: a disputa provocada não deixou a regra fora do banco" "$(grep -E 'passada|regras de isolamento' "$LOGS/bootstrap-3c.log" | cut -c1-200 | tr '\n' ';')"; fi
  if grep -q "política $REGRA_3C em public.conversations voltou ao banco" "$LOGS/bootstrap-3c.log" && [ "$VEZES_3C" = 4 ]; then
    conferir 1 "3c: a conferência das regras recriou só ela, do arquivo"
  else conferir 0 "3c: a regra não voltou pela conferência" "vezes: ${VEZES_3C:-?} · $(grep -E 'regras de isolamento' "$LOGS/bootstrap-3c.log" | cut -c1-300 | tr '\n' ';')"; fi
  if [ "$DEF_DEPOIS_3C" = "$DEF_ANTES_3C" ]; then conferir 1 "3c: voltou restritiva e com a mesma definição (comando, papéis, using, with check)"
  else conferir 0 "3c: a definição da regra mudou" "antes: $(printf '%s' "$DEF_ANTES_3C" | cut -c1-200) · depois: $(printf '%s' "$DEF_DEPOIS_3C" | cut -c1-200)"; fi
  if [ "$erros3c" = 0 ]; then conferir 1 "3c: o carimbo ficou com 0 erros"
  else conferir 0 "3c: erros_inesperados = ${erros3c:-?}" "$(PSQL -tAc "$AMOSTRA_SQL" 2>&1 | cut -c1-300 | tr '\n' ';')"; fi
else
  soltar_lock
  conferir 0 "3c: a sessão que segura o lock não pegou o lock"
fi
PSQL -q -c "drop event trigger if exists ensaio_3c_perde" -c "drop schema if exists ensaio_3c cascade" >/dev/null 2>&1

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
