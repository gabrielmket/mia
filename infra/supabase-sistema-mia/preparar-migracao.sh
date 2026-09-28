#!/usr/bin/env bash
# preparar-migracao.sh — lê a nuvem (só leitura) e entrega os arquivos da migração
# no balde privado `migracao-da-nuvem` do Supabase de destino.
#
# Roda FORA da VPS, numa máquina que já tem acesso de leitura ao banco da nuvem.
# É esta a peça que mantém a senha da nuvem fora do supabase-sistema-mia: o
# migrador de lá só enxerga arquivos no balde dele.
#
#   NUVEM_DB_URL=... DESTINO_URL=https://... DESTINO_SERVICE_KEY=... \
#     bash preparar-migracao.sh
#
# Precisa de docker (usa o pg_dump/psql 17 da imagem do Supabase) e curl.
# Nada aqui imprime URL ou chave.

set -euo pipefail
: "${NUVEM_DB_URL:?falta NUVEM_DB_URL}"
: "${DESTINO_URL:?falta DESTINO_URL}"
: "${DESTINO_SERVICE_KEY:?falta DESTINO_SERVICE_KEY}"

IMG="public.ecr.aws/supabase/postgres:17.6.1.143"
DIR="$(mktemp -d)"
BALDE="migracao-da-nuvem"
log() { printf '[preparar %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

pg() { # roda pg_dump/psql da imagem, com /out montado em $DIR
  MSYS_NO_PATHCONV=1 docker run --rm -e NUVEM="$NUVEM_DB_URL" -v "$DIR:/out" "$IMG" bash -c "$1"
}

log "dump do app (public, private) com donos e permissões…"
pg 'pg_dump "$NUVEM" -Fc -n public -n private -f /out/app.dump'
log "login e baldes (JSON)…"
pg 'psql "$NUVEM" -tAc "select coalesce(json_agg(x), '"'"'[]'"'"'::json) from auth.users x"      > /out/auth_users.json
    psql "$NUVEM" -tAc "select coalesce(json_agg(x), '"'"'[]'"'"'::json) from auth.identities x" > /out/auth_identities.json
    psql "$NUVEM" -tAc "select coalesce(json_agg(x), '"'"'[]'"'"'::json) from storage.buckets x" > /out/storage_buckets.json'
log "contagem linha a linha da nuvem…"
pg 'psql "$NUVEM" -tAF"|" -c "
  select table_schema || '"'"'.'"'"' || table_name,
         (xpath('"'"'/row/c/text()'"'"', query_to_xml(format('"'"'select count(*) as c from %I.%I'"'"', table_schema, table_name), false, true, '"'"''"'"')))[1]::text
    from information_schema.tables
   where table_schema in ('"'"'public'"'"', '"'"'private'"'"') and table_type = '"'"'BASE TABLE'"'"'
   order by 1" > /out/nuvem.txt'
log "objetos do Storage (para copiar-storage.mjs)…"
pg 'psql "$NUVEM" -tAc "select coalesce(json_agg(json_build_object('"'"'bucket_id'"'"', bucket_id, '"'"'name'"'"', name, '"'"'mimetype'"'"', metadata->>'"'"'mimetype'"'"')), '"'"'[]'"'"'::json) from storage.objects" > /out/objetos.json'
ls -la "$DIR" | awk 'NR>1 {print "   ", $5, $NF}'

log "balde privado $BALDE no destino…"
curl -s -o /dev/null -w "   criar balde: HTTP %{http_code}\n" -X POST "$DESTINO_URL/storage/v1/bucket" \
  -H "apikey: $DESTINO_SERVICE_KEY" -H "Authorization: Bearer $DESTINO_SERVICE_KEY" -H "Content-Type: application/json" \
  -d "{\"id\":\"$BALDE\",\"name\":\"$BALDE\",\"public\":false}"
for a in app.dump auth_users.json auth_identities.json storage_buckets.json nuvem.txt; do
  curl -sf -o /dev/null -w "   $a: HTTP %{http_code}\n" -X POST "$DESTINO_URL/storage/v1/object/$BALDE/$a" \
    -H "apikey: $DESTINO_SERVICE_KEY" -H "Authorization: Bearer $DESTINO_SERVICE_KEY" \
    -H "Content-Type: application/octet-stream" -H "x-upsert: true" --data-binary @"$DIR/$a" \
    || { log "FALHOU subir $a"; exit 1; }
done
cp "$DIR/objetos.json" ./objetos-do-storage.json
log "pronto. Ligue o migrador (MIGRAR=ensaio ou virada) e depois: node copiar-storage.mjs objetos-do-storage.json"
rm -rf "$DIR"
