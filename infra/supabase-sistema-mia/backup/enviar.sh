#!/bin/sh
# enviar.sh — leva os backups da VPS para o drive compartilhado do Google.
#
# Roda no serviço `backup-envio` (imagem rclone/rclone, Alpine: sh do busybox, sem
# bash). Lê o volume mia-backups, onde o `backup` (fazer-backup.sh) deixa uma pasta
# por dia com PRONTO. Para cada pasta pronta e ainda não enviada:
#
#   1. copia para  <drive>/backups/<pasta>/  CRIPTOGRAFADO (rclone crypt: o
#      conteúdo vira .bin ilegível; os nomes ficam legíveis para achar o dia);
#   2. confere com `rclone cryptcheck` (compara o hash de cada arquivo do drive
#      com o local, sem baixar nada);
#   3. só então marca ENVIADO, e sobe o relatorio.txt ABERTO em
#      <drive>/relatorios/<pasta>.txt (resumo sem dado pessoal, para quem abre o
#      drive saber o que tem ali).
#
# Retenção no drive: BACKUP_MANTER_DIAS (padrão 30). Os 7 backups mais novos
# nunca são apagados, mesmo velhos: backup que parou não pode levar os últimos
# junto.
#
# A cada volta grava /backups/ENVIO-STATUS (1ª linha: quando; resto: o relato),
# que o `backup` leva para operacao.backup_envio.
#
# Credencial do Google, uma das duas (em base64, porque JSON não cabe no .env):
#   GOOGLE_DRIVE_TOKEN_B64  token OAuth de um membro do drive, gerado por
#                           `rclone authorize drive` (o jeito em uso desde 29/09/2026:
#                           um clique do dono da conta, sem Google Cloud);
#   GOOGLE_SA_JSON_B64      JSON de uma conta de serviço, membro "Gerente de
#                           conteúdo" SÓ do drive (menos acesso; exige Google Cloud).
# O drive é o compartilhado BACKUP_DRIVE_ID. Senha e sal da criptografia:
# BACKUP_CRIPTO_SENHA / BACKUP_CRIPTO_SAL, já no formato `rclone obscure`. Sem
# credencial ou sem senha, o serviço fica parado avisando, sem enviar nada.
#
# BACKUP_UMA_VEZ=sim: uma volta só e sai. BACKUP_RAIZ_DRIVE troca o destino (o
# teste usa uma pasta local no lugar do drive).

set -u
umask 077

log() { echo "[envio $(date -u +%FT%TZ)] $*"; }
status() { printf '%s\n%s\n' "$(date -u +%FT%TZ)" "$*" > /backups/ENVIO-STATUS; }

INTERVALO="${BACKUP_ENVIO_INTERVALO:-600}"
MANTER_DIAS="${BACKUP_MANTER_DIAS:-30}"
MANTER_SEMPRE=7
RAIZ_DRIVE="${BACKUP_RAIZ_DRIVE:-gdrive:}"

if { [ -z "${GOOGLE_DRIVE_TOKEN_B64:-}" ] && [ -z "${GOOGLE_SA_JSON_B64:-}" ]; } || [ -z "${BACKUP_DRIVE_ID:-}" ] \
   || [ -z "${BACKUP_CRIPTO_SENHA:-}" ] || [ -z "${BACKUP_CRIPTO_SAL:-}" ]; then
  while true; do
    msg="parado: falta configurar a conta do Google, o drive ou a senha da criptografia. Nada sai da VPS."
    status "$msg"; log "$msg"
    [ "${BACKUP_UMA_VEZ:-}" = "sim" ] && exit 1
    sleep 3600
  done
fi

credencial_invalida() {
  status "a credencial do Google ($1) não é base64 válido"
  log "credencial inválida: $1"
  sleep 3600
  exit 1
}

# Os remotos saem do ambiente. O rclone grava o token renovado no arquivo de
# configuração: um descartável em /tmp (o token de base continua o do ambiente).
export RCLONE_CONFIG=/tmp/rclone.conf
: > "$RCLONE_CONFIG"
export RCLONE_CONFIG_GDRIVE_TYPE=drive
export RCLONE_CONFIG_GDRIVE_SCOPE=drive
export RCLONE_CONFIG_GDRIVE_TEAM_DRIVE="$BACKUP_DRIVE_ID"
if [ -n "${GOOGLE_DRIVE_TOKEN_B64:-}" ]; then
  RCLONE_CONFIG_GDRIVE_TOKEN="$(echo "$GOOGLE_DRIVE_TOKEN_B64" | base64 -d 2> /dev/null)" || credencial_invalida GOOGLE_DRIVE_TOKEN_B64
  [ -n "$RCLONE_CONFIG_GDRIVE_TOKEN" ] || credencial_invalida GOOGLE_DRIVE_TOKEN_B64
  export RCLONE_CONFIG_GDRIVE_TOKEN
else
  echo "$GOOGLE_SA_JSON_B64" | base64 -d > /tmp/conta-google.json 2> /dev/null || credencial_invalida GOOGLE_SA_JSON_B64
  export RCLONE_CONFIG_GDRIVE_SERVICE_ACCOUNT_FILE=/tmp/conta-google.json
fi
export RCLONE_CONFIG_COFRE_TYPE=crypt
export RCLONE_CONFIG_COFRE_REMOTE="${RAIZ_DRIVE}backups"
export RCLONE_CONFIG_COFRE_PASSWORD="$BACKUP_CRIPTO_SENHA"
export RCLONE_CONFIG_COFRE_PASSWORD2="$BACKUP_CRIPTO_SAL"
export RCLONE_CONFIG_COFRE_FILENAME_ENCRYPTION=off
export RCLONE_CONFIG_COFRE_DIRECTORY_NAME_ENCRYPTION=false
RELATORIOS="${RAIZ_DRIVE}relatorios"

# Marcas do volume (PRONTO, ENVIADO, .registrado) não viajam.
enviar() { rclone copy "$1" "cofre:$2" --exclude PRONTO --exclude ENVIADO --exclude '.*' \
             --transfers 4 --retries 3 --low-level-retries 10; }
conferir() { rclone cryptcheck "$1" "cofre:$2" --exclude PRONTO --exclude ENVIADO --exclude '.*' --one-way; }

log "no ar: envio a cada ${INTERVALO}s, ${MANTER_DIAS} dias guardados no drive"

while true; do
  enviados=0
  erros=""

  for d in $(ls -1d /backups/20*/ 2> /dev/null | sort); do
    d="${d%/}"
    nome="$(basename "$d")"
    [ -f "$d/PRONTO" ] || continue
    [ -f "$d/ENVIADO" ] && continue
    log "enviando $nome ($(du -sh "$d" | cut -f1))…"
    if enviar "$d" "$nome" 2> /tmp/erro.txt && conferir "$d" "$nome" 2> /tmp/erro.txt; then
      rclone copyto "$d/relatorio.txt" "$RELATORIOS/$nome.txt" 2> /dev/null \
        || log "AVISO: o relatório de $nome não subiu (o backup subiu)"
      printf '%s\n%s\n' "$(date -u +%FT%TZ)" "enviado e conferido no drive: $(du -sh "$d" | cut -f1)" > "$d/ENVIADO"
      enviados=$((enviados + 1))
      log "$nome enviado e conferido"
    else
      e="$(grep -E 'ERROR|Failed|NOTICE' /tmp/erro.txt | tail -n 2 | tr '\n' ' ' | cut -c1-400)"
      erros="$erros $nome: ${e:-falhou sem mensagem};"
      log "FALHOU $nome: $e"
    fi
  done

  # Retenção: só os mais velhos que MANTER_DIAS, e nunca os MANTER_SEMPRE mais novos.
  lista="$(rclone lsf cofre: --dirs-only 2> /dev/null | sed 's#/$##' | grep -E '^20[0-9-]+T[0-9]{4}Z$' | sort)"
  total="$(printf '%s\n' "$lista" | grep -c . || true)"
  corte="$(date -u -d "@$(( $(date +%s) - MANTER_DIAS * 86400 ))" +%Y-%m-%dT%H%MZ)"
  apagados=0
  if [ "$total" -gt "$MANTER_SEMPRE" ]; then
    for n in $(printf '%s\n' "$lista" | head -n $((total - MANTER_SEMPRE)) | awk -v c="$corte" '$0 < c'); do
      if rclone purge "cofre:$n" 2> /dev/null; then
        rclone deletefile "$RELATORIOS/$n.txt" 2> /dev/null || true
        apagados=$((apagados + 1))
        log "apagado do drive (mais de ${MANTER_DIAS} dias): $n"
      fi
    done
  fi

  rclone copyto /backup-scripts/LEIA-ME.txt "${RAIZ_DRIVE}LEIA-ME.txt" 2> /dev/null || true

  # O mais novo nunca é apagado; o total é o que ficou depois da retenção.
  ultimo="$(printf '%s\n' "$lista" | tail -n 1)"
  total=$((total - apagados))
  if [ -z "$erros" ]; then
    status "ok: ${enviados} enviado(s) nesta volta, ${apagados} apagado(s) por idade; no drive: ${total} backup(s), o mais novo ${ultimo:-nenhum}"
  else
    status "ERRO:${erros} (no drive: ${total} backup(s), o mais novo ${ultimo:-nenhum})"
  fi

  if [ "${BACKUP_UMA_VEZ:-}" = "sim" ]; then
    [ -z "$erros" ]
    exit $?
  fi
  sleep "$INTERVALO"
done
