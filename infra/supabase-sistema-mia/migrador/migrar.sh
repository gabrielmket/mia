#!/usr/bin/env bash
# migrar.sh — copia a plataforma MIA do Supabase da nuvem para esta instância.
#
# Roda dentro do serviço `migrador` (docker-compose.yml desta pasta), na VPS,
# pela rede interna: nenhuma porta do banco novo fica aberta para a internet.
#
# O QUE É COPIADO, E POR QUÊ SÓ ISSO
#
#   public + private   o app inteiro, com donos e permissões (pg_dump sem
#                      --no-owner/--no-acl: as políticas e GRANTs do anon e do
#                      authenticated são o isolamento entre empresas).
#   auth.users         as contas de login, com o hash da senha: ninguém troca
#   auth.identities    de senha. Sessões e tokens NÃO vêm — a chave JWT é nova,
#                      todo mundo entra de novo uma vez.
#   storage.buckets    os baldes com as mesmas regras (público, limites).
#
# O resto — políticas do Storage, gatilhos em auth, publicação do realtime —
# é recriado pelo bootstrap do `deskcomm` a cada deploy (easypanel/bootstrap.sh
# reaplica o baseline inteiro). Os ARQUIVOS do Storage vão pela API, de fora,
# depois que isto termina (scripts/infra/copiar-storage.mjs).
#
# A ORDEM IMPORTA: login antes do app. As FKs do app apontam para auth.users e
# o pg_restore valida cada uma ao criá-la; com auth.users vazio, as FKs caem.
#
# IDEMPOTÊNCIA: se o `public` deste banco já tem tabela, a migração já rodou
# neste volume e o script sai sem tocar em nada. Para refazer, troque o volume
# (MIA_VOLUME_SUFIXO) — nunca apague dados por aqui.

set -uo pipefail

log() { printf '[migrador %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
falha() { log "FALHOU: $*"; exit 1; }

MODO="${MIGRAR:-off}"
if [ "$MODO" = "off" ]; then
  log "desligado (MIGRAR=off) — nada a fazer"
  exit 0
fi
[ -n "${NUVEM_DB_URL:-}" ] || falha "NUVEM_DB_URL vazio"

ALVO="postgresql://supabase_admin:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
export PGCONNECT_TIMEOUT=20
TMP=/tmp/migracao
mkdir -p "$TMP"

# O que o psql imprime vai para o log do EasyPanel. A URL da nuvem carrega a
# senha: nada aqui pode ecoá-la. Os erros passam por este filtro.
sem_segredo() { sed -E 's#postgres(ql)?://[^ ]*#<url>#g'; }

log "modo: $MODO"

# ── 0. Os serviços criaram os schemas deles? ─────────────────────────────────
# O GoTrue e o storage-api migram os próprios schemas ao subir. O depends_on
# espera o healthcheck, mas "saudável" não garante que a última migration
# acabou; conferir a tabela é o que garante.
pronto=0
for _ in $(seq 1 60); do
  pronto="$(psql "$ALVO" -tAc "select (to_regclass('auth.users') is not null
                                   and to_regclass('auth.identities') is not null
                                   and to_regclass('storage.buckets') is not null)::int" 2>/dev/null || echo 0)"
  [ "$pronto" = "1" ] && break
  sleep 5
done
[ "$pronto" = "1" ] || falha "auth/storage não criaram os schemas em 5 min"
sleep 15   # folga para a última migration dos serviços assentar

# ── 1. Idempotência ──────────────────────────────────────────────────────────
ja="$(psql "$ALVO" -tAc "select count(*) from information_schema.tables where table_schema = 'public'")"
if [ "${ja:-0}" -gt 0 ]; then
  log "o public deste banco já tem ${ja} tabelas: a migração já rodou neste volume. Nada a fazer."
  exit 0
fi

# ── 2. A nuvem responde? ─────────────────────────────────────────────────────
versao="$(psql "$NUVEM_DB_URL" -tAc "select split_part(version(), ' ', 2)" 2>&1 | sem_segredo)" \
  || falha "não conectei na nuvem: $versao"
log "nuvem: Postgres $versao"

# ── 3. Extensões que as tabelas do app usam como TIPO (vector, citext) ──────
# O dump de um schema não leva a extensão; sem ela, a tabela não nasce.
psql "$ALVO" -v ON_ERROR_STOP=1 -q <<'SQL' || falha "extensões"
set client_min_messages = warning;
create extension if not exists vector  with schema public;
create extension if not exists citext  with schema public;
create extension if not exists pg_trgm with schema public;
SQL
log "extensões ok"

# ── 4. Login e baldes, por JSON ──────────────────────────────────────────────
# Por JSON, e não por COPY, porque a versão do GoTrue da nuvem não é a daqui:
# a coluna que só um lado tem quebraria o COPY. Aqui entra a interseção das
# colunas, menos as geradas (confirmed_at, identities.email).
copiar_json() { # $1 = schema.tabela
  local tabela="$1" arq="$TMP/$(echo "$1" | tr . _).json"
  psql "$NUVEM_DB_URL" -tAc "select coalesce(json_agg(x), '[]'::json) from $tabela x" > "$arq" 2>"$TMP/erro" \
    || falha "ler $tabela na nuvem: $(sem_segredo < "$TMP/erro" | head -3)"
  psql "$ALVO" -v ON_ERROR_STOP=1 -q -v tabela="$tabela" -v doc="$(cat "$arq")" <<'SQL' 2>&1 | sem_segredo
create temp table _j (tabela text, doc json);
insert into _j values (:'tabela', :'doc');
do $$
declare
  alvo text; sch text; tab text; cols text; d json; n int;
begin
  select _j.tabela, _j.doc into alvo, d from _j;
  sch := split_part(alvo, '.', 1);
  tab := split_part(alvo, '.', 2);
  select string_agg(quote_ident(c.column_name), ',' order by c.ordinal_position) into cols
    from information_schema.columns c
   where c.table_schema = sch and c.table_name = tab and c.is_generated = 'NEVER'
     and exists (select 1 from json_array_elements(d) e where (e::jsonb) ? c.column_name);
  if cols is null then
    raise notice '% : nada para copiar', alvo;
    return;
  end if;
  execute format('insert into %I.%I (%s) select %s from json_populate_recordset(null::%I.%I, $1) on conflict do nothing',
                 sch, tab, cols, cols, sch, tab) using d;
  get diagnostics n = row_count;
  raise notice '% : % linhas copiadas de %', alvo, n, json_array_length(d);
end $$;
SQL
}
copiar_json auth.users
copiar_json auth.identities
copiar_json storage.buckets
log "login e baldes ok"

# ── 5. O app: public + private, com donos e permissões ───────────────────────
log "pg_dump da nuvem (public, private)…"
pg_dump "$NUVEM_DB_URL" -Fc -n public -n private -f "$TMP/app.dump" 2>"$TMP/dump.err" \
  || falha "pg_dump: $(sem_segredo < "$TMP/dump.err" | tail -5)"
log "dump: $(du -h "$TMP/app.dump" | cut -f1)"

log "pg_restore…"
pg_restore -d "$ALVO" "$TMP/app.dump" > "$TMP/restore.log" 2>&1
n_erros="$(grep -c 'ERROR' "$TMP/restore.log" || true)"
log "pg_restore terminou com ${n_erros} erro(s). Por tipo:"
grep 'ERROR' "$TMP/restore.log" | sed -E 's/.*ERROR: +//; s/"[^"]*"/"…"/g' | sort | uniq -c | sort -rn | head -25 | sem_segredo

# ── 6. Os links do Storage apontavam para o domínio da nuvem ────────────────
# Gatilhos desligados (session_replication_role = replica): reescrever uma URL
# não é um evento do negócio — sem isto, cada linha tocada dispararia
# updated_at, auditoria e aviso de webhook.
if [ -n "${NUVEM_URL_PUBLICO:-}" ] && [ -n "${NOVO_URL_PUBLICO:-}" ]; then
  psql "$ALVO" -q -v velho="$NUVEM_URL_PUBLICO" -v novo="$NOVO_URL_PUBLICO" <<'SQL' 2>&1 | sem_segredo
set session_replication_role = replica;
create temp table _u (velho text, novo text);
insert into _u values (:'velho', :'novo');
do $$
declare r record; v text; nv text; n bigint; total bigint := 0;
begin
  select velho, novo into v, nv from _u;
  for r in
    select c.table_schema s, c.table_name t, c.column_name col, c.data_type dt
      from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema in ('public', 'private') and tb.table_type = 'BASE TABLE'
       and c.is_generated = 'NEVER'
       and c.data_type in ('text', 'character varying', 'jsonb', 'json')
  loop
    if r.dt in ('jsonb', 'json') then
      execute format('update %I.%I set %I = replace(%I::text, %L, %L)::%s where %I::text like %L',
                     r.s, r.t, r.col, r.col, v, nv, r.dt, r.col, '%' || v || '%');
    else
      execute format('update %I.%I set %I = replace(%I, %L, %L) where %I like %L',
                     r.s, r.t, r.col, r.col, v, nv, r.col, '%' || v || '%');
    end if;
    get diagnostics n = row_count;
    if n > 0 then
      raise notice 'link reescrito: %.%.% — % linha(s)', r.s, r.t, r.col, n;
      total := total + n;
    end if;
  end loop;
  raise notice 'links reescritos no total: %', total;
end $$;
SQL
fi

# ── 7. A prova: contagem linha a linha, nuvem x aqui ─────────────────────────
contar() { # $1 = url
  psql "$1" -tAF'|' -c "
    select table_schema || '.' || table_name,
           (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
      from information_schema.tables
     where table_schema in ('public', 'private') and table_type = 'BASE TABLE'
     order by 1" 2>&1 | sem_segredo
}
contar "$NUVEM_DB_URL" > "$TMP/nuvem.txt"
contar "$ALVO"         > "$TMP/aqui.txt"
tabelas="$(wc -l < "$TMP/nuvem.txt" | tr -d ' ')"
linhas="$(awk -F'|' '{s+=$2} END {print s+0}' "$TMP/nuvem.txt")"
if diff -q "$TMP/nuvem.txt" "$TMP/aqui.txt" >/dev/null; then
  log "CONTAGEM IGUAL: ${tabelas} tabelas, ${linhas} linhas na nuvem e aqui."
else
  log "CONTAGEM DIFERENTE (nuvem | aqui):"
  diff "$TMP/nuvem.txt" "$TMP/aqui.txt" | head -40
fi
for t in users identities; do
  a="$(psql "$NUVEM_DB_URL" -tAc "select count(*) from auth.$t" 2>/dev/null)"
  b="$(psql "$ALVO" -tAc "select count(*) from auth.$t")"
  log "auth.$t: nuvem ${a} / aqui ${b}"
done

log "FIM (modo ${MODO}): erros do pg_restore = ${n_erros}. Proximo passo: copiar os arquivos do Storage e implantar o deskcomm."
exit 0
