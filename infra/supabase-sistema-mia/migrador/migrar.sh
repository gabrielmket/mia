#!/usr/bin/env bash
# migrar.sh — restaura a plataforma MIA, vinda do Supabase da nuvem, nesta instância.
#
# Roda dentro do serviço `migrador` (docker-compose.yml desta pasta), na VPS,
# pela rede interna: nenhuma porta do banco novo fica aberta para a internet.
#
# DE ONDE VÊM OS DADOS: de arquivos num balde PRIVADO deste mesmo Supabase
# (`migracao-da-nuvem`), subidos de fora por quem tem acesso de leitura à nuvem
# (preparar-migracao.sh). A senha do banco da nuvem NUNCA entra neste serviço:
# levar credencial de um sistema para a configuração de outro é vazamento.
#
#   app.dir.tar           pg_dump -Fd -n public -n private num tar (com donos e GRANTs:
#                         as políticas e GRANTs do anon/authenticated são o
#                         isolamento entre empresas)
#   auth_users.json       json_agg(auth.users) — com o hash da senha: ninguém troca
#   auth_identities.json  json_agg(auth.identities)   de senha. Sessões NÃO vêm: a
#                         chave JWT é nova, todo mundo entra de novo uma vez.
#   storage_buckets.json  json_agg(storage.buckets) — mesmas regras de balde
#   nuvem.txt             contagem linha a linha na nuvem, para a prova final
#
# O resto — políticas do Storage, gatilhos em auth, publicação do realtime — é
# recriado pelo bootstrap do `deskcomm` a cada deploy (ele reaplica o baseline
# inteiro). Os ARQUIVOS do Storage vão pela API (copiar-storage.mjs).
#
# A ORDEM IMPORTA: login antes do app. As FKs do app apontam para auth.users e o
# pg_restore valida cada uma ao criá-la.
#
# IDEMPOTÊNCIA: se o `public` deste banco já tem tabela, a migração já rodou
# neste volume e o script sai sem tocar em nada. Para refazer, troque o volume
# (MIA_VOLUME_SUFIXO) — nunca apague dados por aqui.

set -uo pipefail

log() { printf '[migrador %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
falha() { log "FALHOU: $*"; exit 1; }
# Nada que o script imprime pode carregar URL com senha.
sem_segredo() { sed -E 's#postgres(ql)?://[^ ]*#<url>#g'; }

MODO="${MIGRAR:-off}"
if [ "$MODO" = "off" ]; then
  log "desligado (MIGRAR=off) — nada a fazer"
  exit 0
fi
[ -n "${SERVICE_ROLE_KEY:-}" ] || falha "SERVICE_ROLE_KEY vazio"

ALVO="postgresql://supabase_admin:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
export PGCONNECT_TIMEOUT=20
TMP=/tmp/migracao
BALDE="migracao-da-nuvem"
mkdir -p "$TMP"
log "modo: $MODO"

# ── 0. Os serviços criaram os schemas deles? ─────────────────────────────────
# GoTrue e storage-api migram os próprios schemas ao subir; "saudável" não
# garante que a última migration acabou. Conferir a tabela garante.
pronto=0
for _ in $(seq 1 60); do
  pronto="$(psql "$ALVO" -tAc "select (to_regclass('auth.users') is not null
                                   and to_regclass('auth.identities') is not null
                                   and to_regclass('storage.buckets') is not null)::int" 2>/dev/null || echo 0)"
  [ "$pronto" = "1" ] && break
  sleep 5
done
[ "$pronto" = "1" ] || falha "auth/storage não criaram os schemas em 5 min"
sleep 15

# ── 1. Idempotência ──────────────────────────────────────────────────────────
ja="$(psql "$ALVO" -tAc "select count(*) from information_schema.tables where table_schema = 'public'")"
if [ "${ja:-0}" -gt 0 ]; then
  log "o public deste banco já tem ${ja} tabelas: a migração já rodou neste volume. Nada a fazer."
  exit 0
fi

# ── 2. Os arquivos da nuvem, do balde interno ────────────────────────────────
for a in app.dir.tar auth_users.json auth_identities.json storage_buckets.json nuvem.txt; do
  curl -sf -o "$TMP/$a" "http://storage:5000/object/$BALDE/$a" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "apikey: $SERVICE_ROLE_KEY" \
    || falha "não baixei $a do balde $BALDE (ele foi subido antes de ligar o migrador?)"
done
log "arquivos baixados: $(du -sh "$TMP" | cut -f1)"

# ── 3. Extensões que as tabelas do app usam como TIPO (vector, citext) ──────
psql "$ALVO" -v ON_ERROR_STOP=1 -q <<'SQL' || falha "extensões"
set client_min_messages = warning;
create extension if not exists vector  with schema public;
create extension if not exists citext  with schema public;
create extension if not exists pg_trgm with schema public;
SQL
log "extensões ok"

# ── 4. Login e baldes, por JSON ──────────────────────────────────────────────
# JSON, e não COPY: o GoTrue da nuvem não tem a mesma versão do daqui, e coluna
# que só um lado tem quebraria o COPY. Entra a interseção das colunas, menos as
# geradas (confirmed_at, identities.email).
copiar_json() { # $1 = schema.tabela  $2 = arquivo
  local tabela="$1" arq="$TMP/$2"
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
copiar_json auth.users auth_users.json
copiar_json auth.identities auth_identities.json
copiar_json storage.buckets storage_buckets.json
log "login e baldes ok"

# ── 5. O app: public + private, com donos e permissões ───────────────────────
tar -C "$TMP" -xf "$TMP/app.dir.tar" || falha "tar do dump"
log "pg_restore do dump da nuvem ($(du -sh "$TMP/app.dir" | cut -f1)), 4 conexões…"
pg_restore -j 4 -d "$ALVO" "$TMP/app.dir" > "$TMP/restore.log" 2>&1
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
psql "$ALVO" -tAF'|' -c "
  select table_schema || '.' || table_name,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
    from information_schema.tables
   where table_schema in ('public', 'private') and table_type = 'BASE TABLE'
   order by 1" > "$TMP/aqui.txt" 2>&1
tabelas="$(wc -l < "$TMP/nuvem.txt" | tr -d ' ')"
linhas="$(awk -F'|' '{s+=$2} END {print s+0}' "$TMP/nuvem.txt")"
if diff -q "$TMP/nuvem.txt" "$TMP/aqui.txt" >/dev/null; then
  log "CONTAGEM IGUAL: ${tabelas} tabelas, ${linhas} linhas na nuvem e aqui."
else
  log "CONTAGEM DIFERENTE (< nuvem | > aqui):"
  diff "$TMP/nuvem.txt" "$TMP/aqui.txt" | head -40
fi
for t in users identities; do
  a="$(grep -o '"id"' "$TMP/auth_$t.json" | wc -l | tr -d ' ')"
  b="$(psql "$ALVO" -tAc "select count(*) from auth.$t")"
  log "auth.$t: nuvem ${a} / aqui ${b}"
done

log "FIM (modo ${MODO}): erros do pg_restore = ${n_erros}. Próximo passo: arquivos do Storage e deploy do deskcomm."
exit 0
