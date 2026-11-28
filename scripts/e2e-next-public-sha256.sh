#!/usr/bin/env bash
#
# FORK MIA (MIA-360): a impressão digital das `NEXT_PUBLIC_*` do build do e2e.
#
# O `e2e.yml` faz o `pnpm e2e:build` UMA vez, no job `e2e-build`, e as partes
# reaproveitam o `.next`. Isso só vale porque o bundle depende apenas das
# `NEXT_PUBLIC_*` (o resto do `.env.e2e` é lido pelo servidor no `next start`),
# e elas saem iguais em todas as partes. Este script é a prova, não a suposição:
# o job do build grava o sha256 dentro do artefato e cada parte recalcula o seu.
# Diferiu, a parte falha antes de rodar teste com o bundle de outro ambiente.
#
# Lê o ambiente do MESMO jeito que o `scripts/e2e-build.sh`: o ambiente do job
# com o `.env.e2e` exportado por cima (`set -a`). Entra TODA `NEXT_PUBLIC_*`, não
# só as três de hoje: uma quarta que nascer no `.env.e2e` passa a contar sozinha.
#
# Uso: scripts/e2e-next-public-sha256.sh [pasta com o .env.e2e]
# Saída: o sha256 na saída padrão; os nomes conferidos na saída de erro.
set -euo pipefail

cd "${1:-$(dirname "$0")/..}"

if [ ! -f .env.e2e ]; then
  echo "::error::falta o .env.e2e em $(pwd): rode 'pnpm e2e:env' antes" >&2
  exit 1
fi

publicas="$(
  set -a
  # shellcheck disable=SC1091
  . ./.env.e2e
  set +a
  env | grep -E '^NEXT_PUBLIC_[A-Z0-9_]*=' | LC_ALL=C sort
)"

# As três que o bundle do e2e embute hoje (scripts/e2e-build.sh e o
# gerar-env-e2e.sh). Vazia quer dizer `.env.e2e` quebrado: o hash de "nada"
# bateria entre o build e a parte e não provaria coisa nenhuma.
for nome in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_APP_URL; do
  if ! grep -q "^${nome}=." <<<"$publicas"; then
    echo "::error::${nome} está vazia ou ausente no ambiente do build do e2e" >&2
    exit 1
  fi
done

echo "NEXT_PUBLIC_* conferidas: $(cut -d= -f1 <<<"$publicas" | paste -sd' ' -)" >&2
printf '%s\n' "$publicas" | sha256sum | cut -d' ' -f1
