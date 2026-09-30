#!/usr/bin/env bash
# fazer-backup.sh — a cópia diária do banco e dos arquivos da plataforma MIA.
#
# Roda no serviço `backup` (docker-compose.yml da pasta de cima), na VPS, pela
# rede interna. Uma vez por dia (BACKUP_HORA_UTC, padrão 06 = 03:00 de Brasília)
# grava uma pasta em /backups (volume mia-backups) com o MESMO formato que o
# migrador/migrar.sh já restaura — o caminho provado na virada de 29/09/2026:
#
#   app.dir.tar            pg_dump -Fd -n public -n private, com donos e GRANTs
#   auth_users.json        login: usuários (com o hash da senha) e identidades
#   auth_identities.json
#   storage_buckets.json   baldes e a lista de objetos do Storage
#   storage_objects.json
#   nuvem.txt              contagem linha a linha de cada tabela do app (o nome
#                          vem do migrador, que compara a ORIGEM com o destino)
#   storage.tar            os arquivos do Storage (volume mia-storage). O tipo e o
#                          cache de cada um estão no storage_objects.json: restaurar
#                          é subir pela API do Storage (ver BACKUP.md), não
#                          desempacotar no volume.
#   SHA256SUMS             para conferir a cópia antes de restaurar
#   relatorio.txt          o resumo legível
#
# TUDO DO MESMO INSTANTE: dump, contagem e JSON saem de UM snapshot
# (pg_export_snapshot). Sem isso, um usuário criado no meio do backup viraria FK
# quebrada na restauração, e a contagem nunca bateria com o dump.
#
# Este script só marca PRONTO. Quem leva para fora da VPS é o `backup-envio`
# (enviar.sh), que marca ENVIADO. Na VPS ficam as BACKUP_MANTER_LOCAL cópias mais
# novas já enviadas; as nunca enviadas ficam até 14 dias.
#
# ONDE VER SE FUNCIONA: não há log central na VPS, então o log é uma tabela deste
# mesmo banco: operacao.backup (uma linha por execução, com a etapa em que parou)
# e operacao.backup_envio (o último relato do envio). O schema `operacao` não é
# do app: fica fora do dump, da API e das migrations.
#
# BACKUP_UMA_VEZ=sim: faz um backup agora e sai (teste e disparo manual).

set -uo pipefail

log() { printf '[backup %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
# Nada que o script imprime ou grava pode carregar URL com senha.
sem_segredo() { sed -E 's#postgres(ql)?://[^ ]*#<url>#g'; }

ALVO="postgresql://supabase_admin:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
export PGCONNECT_TIMEOUT=20 PGAPPNAME=backup-sistema-mia
RAIZ=/backups
STORAGE=/storage
HORA="${BACKUP_HORA_UTC:-06}"
MANTER_LOCAL="${BACKUP_MANTER_LOCAL:-3}"
JOBS="${BACKUP_JOBS:-2}"
TENTATIVAS_POR_DIA=3
TEMPO_ENTRE_TENTATIVAS=1800

sql() { psql "$ALVO" -X -q -tA -v ON_ERROR_STOP=1 "$@"; }

esperar_banco() {
  for _ in $(seq 1 60); do
    sql -c "select 1" >/dev/null 2>&1 && return 0
    sleep 5
  done
  log "o banco não respondeu em 5 min"
  return 1
}

preparar_tabela() {
  sql <<'SQL'
set client_min_messages = warning;
create schema if not exists operacao;
comment on schema operacao is 'Infraestrutura da VPS (backup diário). Não é do app: fica fora do dump do app, da API e das migrations.';
create table if not exists operacao.backup (
  pasta           text primary key,
  iniciado_em     timestamptz not null default now(),
  terminado_em    timestamptz,
  ok              boolean,
  etapa           text,
  detalhe         text,
  bytes           bigint,
  tabelas         int,
  linhas          bigint,
  usuarios        int,
  objetos_storage int,
  enviado_em      timestamptz,
  envio_detalhe   text
);
create table if not exists operacao.backup_envio (
  id       int primary key default 1 check (id = 1),
  visto_em timestamptz not null,
  relato   text
);
SQL
}

# registrar PASTA OK ETAPA DETALHE [BYTES TABELAS LINHAS USUARIOS OBJETOS]
# OK vazio = em andamento. Falhar em registrar não derruba o backup.
registrar() {
  sql -v pasta="$1" -v ok="$2" -v etapa="$3" -v det="$4" -v bytes="${5:-}" -v tab="${6:-}" \
      -v lin="${7:-}" -v usu="${8:-}" -v obj="${9:-}" >/dev/null 2>&1 <<'SQL' || log "AVISO: não consegui registrar em operacao.backup"
insert into operacao.backup as b (pasta, ok, etapa, detalhe, terminado_em, bytes, tabelas, linhas, usuarios, objetos_storage)
values (:'pasta', nullif(:'ok', '')::boolean, :'etapa', nullif(:'det', ''),
        case when nullif(:'ok', '') is null then null else now() end,
        nullif(:'bytes', '')::bigint, nullif(:'tab', '')::int, nullif(:'lin', '')::bigint,
        nullif(:'usu', '')::int, nullif(:'obj', '')::int)
on conflict (pasta) do update
   set ok = excluded.ok, etapa = excluded.etapa, detalhe = excluded.detalhe, terminado_em = excluded.terminado_em,
       bytes = coalesce(excluded.bytes, b.bytes), tabelas = coalesce(excluded.tabelas, b.tabelas),
       linhas = coalesce(excluded.linhas, b.linhas), usuarios = coalesce(excluded.usuarios, b.usuarios),
       objetos_storage = coalesce(excluded.objetos_storage, b.objetos_storage);
SQL
}

# O snapshot vive enquanto esta sessão segura a transação aberta. O id sai por
# arquivo (\o), não pela saída do psql: saída de programa em pipe fica em buffer.
SNAP_ARQ=/tmp/snapshot.id
abrir_snapshot() {
  rm -f "$SNAP_ARQ"
  coproc SEGURA { psql "$ALVO" -X -q -tA -v ON_ERROR_STOP=1 > /tmp/snapshot.log 2>&1; }
  printf '%s\n' "begin transaction isolation level repeatable read read only;" \
    "\\o $SNAP_ARQ" "select pg_export_snapshot();" "\\o" >&"${SEGURA[1]}"
  for _ in $(seq 1 60); do
    [ -s "$SNAP_ARQ" ] && break
    sleep 1
  done
  SNAP="$(tr -d '[:space:]' < "$SNAP_ARQ" 2>/dev/null)"
  [[ "$SNAP" =~ ^[0-9A-F]+-[0-9A-F]+-[0-9]+$ ]]
}
fechar_snapshot() {
  local pid="${SEGURA_PID:-}"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    printf 'commit;\n\\q\n' >&"${SEGURA[1]}" 2>/dev/null || true
  fi
  [ -n "$pid" ] && wait "$pid" 2>/dev/null
  unset SEGURA_PID
  rm -f "$SNAP_ARQ"
}

fazer_backup() {
  local pasta="$1" dir="$RAIZ/$1.parcial" inicio t0
  inicio="$(date -u +%FT%TZ)"
  t0=$(date +%s)
  rm -rf "$RAIZ"/*.parcial
  if [ -e "$RAIZ/$pasta" ]; then log "a pasta $pasta já existe; nada a fazer"; return 0; fi
  mkdir -p "$dir"
  registrar "$pasta" "" "início" ""
  log "backup $pasta: começando"

  falhou() { # ETAPA DETALHE
    local det; det="$(printf '%s' "$2" | sem_segredo | tr '\n' ' ' | cut -c1-900)"
    log "FALHOU na etapa $1: $det"
    registrar "$pasta" false "$1" "$det"
    fechar_snapshot
    rm -rf "$dir"
    return 1
  }

  abrir_snapshot || { falhou snapshot "sem id de snapshot: $(sem_segredo < /tmp/snapshot.log | tail -n 3)"; return 1; }

  pg_dump "$ALVO" --snapshot="$SNAP" -Fd -j "$JOBS" -n public -n private -f "$dir/app.dir" 2> "$dir/.erro" \
    || { falhou pg_dump "$(tail -n 3 "$dir/.erro")"; return 1; }
  pg_restore --list "$dir/app.dir" > /dev/null 2> "$dir/.erro" \
    || { falhou "leitura do dump" "$(tail -n 3 "$dir/.erro")"; return 1; }
  tar -C "$dir" -cf "$dir/app.dir.tar" app.dir 2> "$dir/.erro" && rm -rf "$dir/app.dir" \
    || { falhou "tar do dump" "$(tail -n 3 "$dir/.erro")"; return 1; }

  # Login, baldes, contagem e resumo no MESMO snapshot do dump.
  sql > /dev/null 2> "$dir/.erro" <<SQL || { falhou "login, baldes e contagem" "$(tail -n 3 "$dir/.erro")"; return 1; }
set statement_timeout = 0;
begin transaction isolation level repeatable read read only;
set transaction snapshot '$SNAP';
\o $dir/auth_users.json
select coalesce(json_agg(x), '[]'::json) from auth.users x;
\o $dir/auth_identities.json
select coalesce(json_agg(x), '[]'::json) from auth.identities x;
\o $dir/storage_buckets.json
select coalesce(json_agg(x), '[]'::json) from storage.buckets x;
\o $dir/storage_objects.json
select coalesce(json_agg(x), '[]'::json) from storage.objects x;
\o $dir/nuvem.txt
select table_schema || '.' || table_name,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
 where table_schema in ('public', 'private') and table_type = 'BASE TABLE'
 order by 1;
\o $dir/.resumo
select concat_ws('|', (select count(*) from auth.users), (select count(*) from auth.identities),
                      (select count(*) from storage.buckets), (select count(*) from storage.objects),
                      pg_database_size(current_database()), split_part(version(), ' on ', 1));
\o
commit;
SQL
  fechar_snapshot

  # O tar desta imagem é o do busybox (sem --xattrs): o que o volume guarda em
  # atributo estendido está também no storage_objects.json.
  [ -d "$STORAGE" ] || { falhou storage "o volume do Storage não está montado em $STORAGE"; return 1; }
  tar -C "$STORAGE" -cf "$dir/storage.tar" . 2> "$dir/.erro" && [ -s "$dir/storage.tar" ] \
    || { falhou storage "$(tail -n 3 "$dir/.erro")"; return 1; }

  (cd "$dir" && sha256sum app.dir.tar auth_users.json auth_identities.json storage_buckets.json \
      storage_objects.json nuvem.txt storage.tar > SHA256SUMS) 2> "$dir/.erro" \
    || { falhou conferência "$(tail -n 3 "$dir/.erro")"; return 1; }

  local usuarios identidades baldes objetos banco_bytes versao tabelas linhas bytes arquivos_storage
  IFS='|' read -r usuarios identidades baldes objetos banco_bytes versao < "$dir/.resumo"
  tabelas="$(wc -l < "$dir/nuvem.txt" | tr -d ' ')"
  linhas="$(awk -F'|' '{s+=$2} END {print s+0}' "$dir/nuvem.txt")"
  arquivos_storage="$(tar -tf "$dir/storage.tar" | grep -vc '/$')"
  rm -f "$dir/.erro" "$dir/.resumo"
  bytes="$(du -sb "$dir" | cut -f1)"

  cat > "$dir/relatorio.txt" <<TXT
Backup da plataforma MIA · $pasta
Início $inicio · fim $(date -u +%FT%TZ) · $(( $(date +%s) - t0 )) s

Banco: $versao · $(( banco_bytes / 1048576 )) MB em disco
App (public, private): $tabelas tabelas · $linhas linhas
Login: $usuarios usuários · $identidades identidades
Storage: $baldes baldes · $objetos objetos no banco · $arquivos_storage arquivos no volume

Arquivos:
$(cd "$dir" && stat -c '%n %s' app.dir.tar auth_users.json auth_identities.json storage_buckets.json storage_objects.json nuvem.txt storage.tar \
  | awk '{ if ($2 < 1048576) printf "  %-22s %8.1f KB\n", $1, $2/1024; else printf "  %-22s %8.1f MB\n", $1, $2/1048576 }')

Tudo criptografado no drive (rclone crypt). Como restaurar:
infra/supabase-sistema-mia/BACKUP.md no repositório gabrielmket/mia.
TXT

  mv "$dir" "$RAIZ/$pasta" && touch "$RAIZ/$pasta/PRONTO" \
    || { falhou "fechar a pasta" "mv falhou"; return 1; }
  registrar "$pasta" true fim "pronto em $(( $(date +%s) - t0 )) s" \
    "$bytes" "$tabelas" "$linhas" "$usuarios" "$objetos"
  log "backup $pasta: pronto ($(( bytes / 1048576 )) MB, $tabelas tabelas, $linhas linhas, $objetos objetos)"
}

# Leva para a tabela o que o backup-envio deixou no volume.
sincronizar_envio() {
  local d
  for d in "$RAIZ"/20*/; do
    d="${d%/}"
    [ -f "$d/ENVIADO" ] && [ ! -f "$d/.registrado" ] || continue
    sql -v pasta="$(basename "$d")" -v quando="$(head -n 1 "$d/ENVIADO")" \
        -v det="$(tail -n +2 "$d/ENVIADO" | head -c 500)" >/dev/null 2>&1 <<'SQL' && touch "$d/.registrado"
update operacao.backup set enviado_em = :'quando'::timestamptz, envio_detalhe = :'det' where pasta = :'pasta';
SQL
  done
  if [ -f "$RAIZ/ENVIO-STATUS" ]; then
    sql -v quando="$(head -n 1 "$RAIZ/ENVIO-STATUS")" \
        -v rel="$(tail -n +2 "$RAIZ/ENVIO-STATUS" | head -c 2000)" >/dev/null 2>&1 <<'SQL' || true
insert into operacao.backup_envio (id, visto_em, relato) values (1, :'quando'::timestamptz, :'rel')
on conflict (id) do update set visto_em = excluded.visto_em, relato = excluded.relato;
SQL
  fi
}

limpar_local() {
  local n=0 d
  for d in $(ls -1d "$RAIZ"/20*/ 2>/dev/null | sort -r); do
    d="${d%/}"
    if [ -f "$d/ENVIADO" ]; then
      n=$((n + 1))
      if [ "$n" -gt "$MANTER_LOCAL" ]; then rm -rf "$d"; log "apagado da VPS (já está no drive): $(basename "$d")"; fi
    elif [ -n "$(find "$d" -maxdepth 0 -mtime +14)" ]; then
      rm -rf "$d"; log "AVISO: apagado sem nunca ter sido enviado (mais de 14 dias): $(basename "$d")"
    fi
  done
}

# Devido = nunca houve backup, ou já passou do horário de hoje e o último pronto é
# de antes dele. Falha tenta de novo a cada 30 min, até 3 vezes no dia.
devido() {
  local agora slot ultimo t
  agora=$(date -u +%s)
  slot=$(date -u -d "$(date -u +%F) ${HORA}:00" +%s)
  ultimo="$(for d in "$RAIZ"/20*/; do [ -f "${d}PRONTO" ] && basename "$d"; done 2>/dev/null | sort | tail -n 1)"
  if [ -n "$ultimo" ]; then
    t=$(date -u -d "$(sed -E 's/^([0-9-]+)T([0-9]{2})([0-9]{2})Z$/\1 \2:\3/' <<< "$ultimo")" +%s 2>/dev/null || echo 0)
    [ "$agora" -ge "$slot" ] && [ "$t" -lt "$slot" ] || return 1
  fi
  local f="$RAIZ/.falhas-$(date -u +%F)"
  if [ -f "$f" ]; then
    [ "$(cat "$f")" -lt "$TENTATIVAS_POR_DIA" ] || return 1
    [ $(( agora - $(stat -c %Y "$f") )) -ge "$TEMPO_ENTRE_TENTATIVAS" ] || return 1
  fi
  return 0
}
contar_falha() {
  local f="$RAIZ/.falhas-$(date -u +%F)"
  echo $(( $(cat "$f" 2>/dev/null || echo 0) + 1 )) > "$f"
}

mkdir -p "$RAIZ"
log "no ar: backup diário às ${HORA}:00 UTC; ${MANTER_LOCAL} cópias já enviadas ficam na VPS"
esperar_banco || exit 1
preparar_tabela > /dev/null 2>&1 || log "AVISO: não criei operacao.backup (sigo sem registro no banco)"

if [ "${BACKUP_UMA_VEZ:-}" = "sim" ]; then
  fazer_backup "$(date -u +%Y-%m-%dT%H%MZ)"; rc=$?
  sincronizar_envio
  exit "$rc"
fi

while true; do
  sincronizar_envio
  if devido; then
    if fazer_backup "$(date -u +%Y-%m-%dT%H%MZ)"; then rm -f "$RAIZ"/.falhas-*; else contar_falha; fi
    limpar_local
  fi
  sleep 600
done
