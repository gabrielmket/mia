#!/usr/bin/env bash
# testar-restauracao.sh — prova que um backup RESTAURA. Roda fora da VPS, na
# máquina da operação, com docker. Backup que nunca foi restaurado não é backup.
#
#   bash testar-restauracao.sh <pasta>           pasta de um backup já decifrado
#   bash testar-restauracao.sh --drive [PASTA]   baixa e decifra do drive (padrão:
#                                                o backup mais novo)
#
# Com --drive, lê do ambiente os mesmos valores do serviço backup-envio:
# GOOGLE_DRIVE_TOKEN (CAMINHO do JSON do token OAuth) ou GOOGLE_SA_JSON (CAMINHO
# do JSON da conta de serviço), BACKUP_DRIVE_ID, BACKUP_CRIPTO_SENHA e
# BACKUP_CRIPTO_SAL (formato rclone obscure). Os segredos vão ao contêiner por
# arquivo, nunca pela linha de comando.
#
# O que prova, num Postgres descartável com a MESMA imagem da produção:
#   1. cada arquivo bate com o SHA256SUMS (a cópia não se corrompeu);
#   2. o login entra (auth.users e identities, pela interseção de colunas);
#   3. o app restaura (pg_restore do app.dir.tar) e a contagem linha a linha é
#      IGUAL à do instante do backup (nuvem.txt);
#   4. cada objeto do Storage listado no banco tem o seu arquivo no storage.tar,
#      com md5 igual ao eTag.
# Os dados ficam só numa pasta temporária; contêiner e pasta são apagados no fim.
# Nada aqui imprime senha, chave ou URL com senha.

set -uo pipefail
IMG_PG="supabase/postgres:17.6.1.084"
IMG_RCLONE="rclone/rclone:1.75.1"
NOME="mia-restauracao-teste"
log() { printf '[restauracao %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

TMP="$(mktemp -d)"
# Git Bash no Windows: /tmp chega ao Docker como caminho da VM dele (ver
# preparar-migracao.sh). O caminho misto (C:/...) é o que os dois lados enxergam.
command -v cygpath > /dev/null 2>&1 && TMP="$(cygpath -m "$TMP")"
limpar() { docker rm -f "$NOME" > /dev/null 2>&1; rm -rf "$TMP"; }
trap limpar EXIT

if [ "${1:-}" = "--drive" ]; then
  : "${BACKUP_DRIVE_ID:?falta BACKUP_DRIVE_ID}" "${BACKUP_CRIPTO_SENHA:?falta BACKUP_CRIPTO_SENHA}" "${BACKUP_CRIPTO_SAL:?falta BACKUP_CRIPTO_SAL}"
  ENVF="$TMP/.rclone.env"
  {
    echo "RCLONE_CONFIG=/tmp/rclone.conf"
    echo "RCLONE_CONFIG_GDRIVE_TYPE=drive"
    echo "RCLONE_CONFIG_GDRIVE_SCOPE=drive"
    echo "RCLONE_CONFIG_GDRIVE_TEAM_DRIVE=$BACKUP_DRIVE_ID"
    if [ -n "${GOOGLE_DRIVE_TOKEN:-}" ]; then
      echo "RCLONE_CONFIG_GDRIVE_TOKEN=$(tr -d '\r\n' < "$GOOGLE_DRIVE_TOKEN")"
      CRED=""
    else
      : "${GOOGLE_SA_JSON:?falta GOOGLE_DRIVE_TOKEN ou GOOGLE_SA_JSON}"
      echo "RCLONE_CONFIG_GDRIVE_SERVICE_ACCOUNT_FILE=/conta-google.json"
      CRED="$GOOGLE_SA_JSON"; command -v cygpath > /dev/null 2>&1 && CRED="$(cygpath -m "$CRED")"
    fi
    echo "RCLONE_CONFIG_COFRE_TYPE=crypt"
    echo "RCLONE_CONFIG_COFRE_REMOTE=${BACKUP_RAIZ_DRIVE:-gdrive:}backups"
    echo "RCLONE_CONFIG_COFRE_PASSWORD=$BACKUP_CRIPTO_SENHA"
    echo "RCLONE_CONFIG_COFRE_PASSWORD2=$BACKUP_CRIPTO_SAL"
    echo "RCLONE_CONFIG_COFRE_FILENAME_ENCRYPTION=off"
    echo "RCLONE_CONFIG_COFRE_DIRECTORY_NAME_ENCRYPTION=false"
  } > "$ENVF"
  chmod 600 "$ENVF"
  rc() {
    MSYS_NO_PATHCONV=1 docker run --rm --env-file "$ENVF" -v "$TMP:/out" \
      ${CRED:+-v "$CRED:/conta-google.json:ro"} "$IMG_RCLONE" "$@"
  }
  PASTA="${2:-}"
  [ -n "$PASTA" ] || PASTA="$(rc lsf cofre: --dirs-only | sed 's#/$##' | grep -E '^20[0-9-]+T[0-9]{4}Z$' | sort | tail -n 1)"
  [ -n "$PASTA" ] || { log "nenhum backup no drive"; exit 1; }
  log "baixando e decifrando $PASTA do drive…"
  rc copy "cofre:$PASTA" "/out/$PASTA" || { log "FALHOU o download"; exit 1; }
else
  ORIGEM="${1:?uso: testar-restauracao.sh <pasta> | --drive [PASTA]}"
  PASTA="$(basename "$ORIGEM")"
  cp -r "$ORIGEM" "$TMP/$PASTA"
fi
log "backup $PASTA: $(du -sh "$TMP/$PASTA" | cut -f1)"

MSYS_NO_PATHCONV=1 docker run -d --name "$NOME" -e POSTGRES_PASSWORD=teste -v "$TMP:/restaurar" "$IMG_PG" \
  postgres -c config_file=/etc/postgresql/postgresql.conf -c log_min_messages=fatal > /dev/null \
  || { log "o Postgres descartável não subiu"; exit 1; }
for _ in $(seq 1 60); do
  docker exec "$NOME" psql -U supabase_admin -h localhost -d postgres -tAc "select to_regclass('auth.users') is not null" 2> /dev/null | grep -q t && break
  sleep 2
done

MSYS_NO_PATHCONV=1 docker exec -i -e PASTA="$PASTA" "$NOME" bash -s <<'DENTRO'
set -uo pipefail
export PGPASSWORD=teste
A="postgresql://supabase_admin:teste@localhost:5432/postgres"
D="/restaurar/$PASTA"
ok=1
log() { printf '[restauracao %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
cd "$D" || exit 1

# sha256sum desta imagem é o do busybox: sem --quiet.
if sha256sum -c SHA256SUMS > /tmp/sha.txt 2>&1; then log "1. SHA256SUMS: os $(wc -l < SHA256SUMS) arquivos intactos"
else log "1. SHA256SUMS: ARQUIVO CORROMPIDO"; grep -v ': OK$' /tmp/sha.txt | head -5; ok=0; fi

psql "$A" -q -c "set client_min_messages = warning;
  create extension if not exists vector with schema public;
  create extension if not exists citext with schema public;
  create extension if not exists pg_trgm with schema public;"

copiar_json() { # tabela arquivo — a mesma interseção de colunas do migrar.sh
  psql "$A" -X -q -tA -v tabela="$1" -v arq="$D/$2" <<'SQL'
create temp table _j as select :'tabela'::text as tabela, pg_read_file(:'arq')::json as doc;
do $$
declare alvo text; sch text; tab text; cols text; d json; n int;
begin
  select _j.tabela, _j.doc into alvo, d from _j;
  sch := split_part(alvo, '.', 1); tab := split_part(alvo, '.', 2);
  if to_regclass(alvo) is null then raise notice '%: tabela não existe neste Postgres cru (o GoTrue cria)', alvo; return; end if;
  select string_agg(quote_ident(c.column_name), ',' order by c.ordinal_position) into cols
    from information_schema.columns c
   where c.table_schema = sch and c.table_name = tab and c.is_generated = 'NEVER'
     and exists (select 1 from json_array_elements(d) e where (e::jsonb) ? c.column_name);
  if cols is null then return; end if;
  execute format('insert into %I.%I (%s) select %s from json_populate_recordset(null::%I.%I, $1) on conflict do nothing',
                 sch, tab, cols, cols, sch, tab) using d;
  get diagnostics n = row_count;
  raise notice '%: % de % linhas', alvo, n, json_array_length(d);
end $$;
SQL
}
copiar_json auth.users auth_users.json 2>&1 | sed 's/^NOTICE: */   /'
copiar_json auth.identities auth_identities.json 2>&1 | sed 's/^NOTICE: */   /'
log "2. login copiado"

mkdir -p /tmp/r && tar -C /tmp/r -xf app.dir.tar
pg_restore -j 4 -d "$A" /tmp/r/app.dir > /tmp/restore.log 2>&1
erros="$(grep -c 'ERROR' /tmp/restore.log || true)"
log "3. pg_restore: ${erros} erro(s) (num Postgres cru, sem o GoTrue/Storage/bootstrap, alguns são esperados). Por tipo:"
grep 'ERROR' /tmp/restore.log | sed -E 's/.*ERROR: +//; s/"[^"]*"/"…"/g' | sort | uniq -c | sort -rn | head -8

psql "$A" -tAF'|' -c "
  select table_schema || '.' || table_name,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
    from information_schema.tables
   where table_schema in ('public', 'private') and table_type = 'BASE TABLE'
   order by 1" > /tmp/aqui.txt
tabelas="$(wc -l < nuvem.txt | tr -d ' ')"; linhas="$(awk -F'|' '{s+=$2} END {print s+0}' nuvem.txt)"
if diff -q nuvem.txt /tmp/aqui.txt > /dev/null; then
  log "3. CONTAGEM IGUAL: ${tabelas} tabelas, ${linhas} linhas no backup e na restauração"
else
  log "3. CONTAGEM DIFERENTE (< backup | > restaurado):"; diff nuvem.txt /tmp/aqui.txt | head -20; ok=0
fi

mkdir -p /tmp/s && tar -C /tmp/s -xf storage.tar
# Pelo JSON, sem depender do schema storage (num Postgres cru ele não existe).
psql "$A" -X -q -tA -F'|' -v arq="$D/storage_objects.json" > /tmp/objetos.txt <<'SQL'
select o.bucket_id, o.name, coalesce(o.version, ''), replace(o.metadata->>'eTag', '"', '')
  from json_to_recordset(pg_read_file(:'arq')::json) as o(bucket_id text, name text, version text, metadata jsonb);
SQL
total=0; iguais=0
while IFS='|' read -r b n v e; do
  total=$((total + 1))
  f="$(find /tmp/s -path "*/$b/$n/$v" -type f 2> /dev/null | head -n 1)"
  [ -z "$f" ] && [ -z "$v" ] && f="$(find /tmp/s -path "*/$b/$n" -type f 2> /dev/null | head -n 1)"
  if [ -n "$f" ] && [ "$(md5sum "$f" | cut -c1-32)" = "$e" ]; then iguais=$((iguais + 1)); else echo "   sem arquivo ou md5 diferente: $b/$n"; fi
done < /tmp/objetos.txt
if [ "$total" -eq "$iguais" ]; then log "4. STORAGE: ${iguais} de ${total} objetos com arquivo e md5 iguais"; else log "4. STORAGE: só ${iguais} de ${total}"; ok=0; fi

[ "$ok" = 1 ] && log "RESTAURAÇÃO OK" || log "RESTAURAÇÃO COM PROBLEMA (ver acima)"
[ "$ok" = 1 ]
DENTRO
