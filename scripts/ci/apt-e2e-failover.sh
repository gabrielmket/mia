#!/usr/bin/env bash
# Compartilhado pelos dois preparos do E2E. Nunca roda apt fora do timeout
# que pertence ao chamador, nem altera a fonte de um executor próprio.

trocar_espelho_apt_e2e() {
  if [ "${GITHUB_ACTIONS:-}" != true ] || [ "${RUNNER_ENVIRONMENT:-}" != github-hosted ]; then
    echo '::error title=Troca APT recusada::somente o runner descartável do GitHub pode alterar suas fontes.'
    return 1
  fi
  sudo python3 - /etc/apt <<'PY'
from pathlib import Path
import re
import sys

raiz = Path(sys.argv[1])
# O espelho da nuvem em que o runner nasceu: o do Azure ou, desde que o GitHub
# passou a pôr runner na AWS, o regional do EC2 (`us-east-2.ec2.archive...`).
# Medido no run 45289294686 (parte 6, runner na AWS): a lista apontava para o
# EC2, os .deb do ffmpeg desciam a 97 kB/s, e esta troca não fazia nada
# ("0 arquivo(s)") porque só conhecia o Azure. A parte foi cortada pelo teto.
nuvem = re.compile(r"(https?://)(?:azure|[a-z0-9-]+\.ec2)\.archive\.ubuntu\.com(/ubuntu/?)\Z")
lista = raiz / "apt-mirrors.txt"
lista_conhecida = lista.is_file() and any(
    nuvem.fullmatch(linha.split()[0])
    for linha in lista.read_text().splitlines()
    if linha.strip() and not linha.lstrip().startswith("#")
)


def uri_oficial(uri):
    espelho = nuvem.fullmatch(uri)
    if espelho:
        return f"{espelho[1]}archive.ubuntu.com{espelho[2]}"
    if uri == "mirror+file:/etc/apt/apt-mirrors.txt" and lista_conhecida:
        return "https://archive.ubuntu.com/ubuntu/"
    return uri


def deb822(bloco):
    if re.search(r"(?im)^Enabled:\s*no\s*$", bloco):
        return bloco
    linhas = []
    em_uris = False
    for linha in bloco.splitlines(keepends=True):
        if linha.lstrip().startswith("#"):
            linhas.append(linha)
            continue
        campo = re.match(r"^([A-Za-z][A-Za-z0-9-]*):", linha)
        if campo:
            em_uris = campo[1].lower() == "uris"
        if em_uris and (campo or linha[:1] in (" ", "\t")):
            linha = re.sub(r"\S+", lambda token: uri_oficial(token[0]), linha)
        linhas.append(linha)
    return "".join(linhas)


arquivos = [raiz / "sources.list"]
arquivos += sorted((raiz / "sources.list.d").glob("*.list"))
arquivos += sorted((raiz / "sources.list.d").glob("*.sources"))
alterados = 0
for arquivo in arquivos:
    if not arquivo.is_file():
        continue
    texto = arquivo.read_bytes().decode("utf-8")
    if arquivo.suffix == ".sources":
        blocos = re.split(r"(\r?\n[ \t]*\r?\n)", texto)
        novo = "".join(deb822(bloco) for bloco in blocos)
    else:
        novo = re.sub(
            r"(?m)^(\s*deb(?:-src)?[ \t]+(?:\[[^\]\r\n]*\][ \t]+)?)(\S+)",
            lambda linha: linha[1] + uri_oficial(linha[2]),
            texto,
        )
    if novo != texto:
        arquivo.write_bytes(novo.encode("utf-8"))
        alterados += 1
print(f"APT: {alterados} arquivo(s) de fonte passaram do espelho da nuvem (Azure ou EC2) ao arquivo oficial Ubuntu")
PY
}

recuperar_apt_e2e() {
  local codigo="$1" log="$2" tentativa="$3"
  # A troca de transporte não corrige integridade, pacote inexistente ou dpkg.
  if grep -Eqi 'NO_PUBKEY|EXPKEYSIG|BADSIG|not signed|signatures couldn.t be verified|Hash Sum mismatch|Unable to locate package|has no installation candidate|dpkg: error|Sub-process.*dpkg.*error|held broken packages|unmet dependencies' "$log"; then
    echo '::error title=Falha fatal no preparo APT::assinatura, hash, pacote ou dpkg recusou a instalação; sem repetir nem trocar a fonte.'
    return 1
  fi
  # Runner que não resolve nome não é espelho lento nem CDN: é a rede dele.
  # Medido em 11/11/2026 (runs 43014074395, 43023280678, 43027136525): desde
  # ~11:36Z o apt devolvia `Temporary failure resolving` para os três hosts
  # (azure.archive, archive e security.ubuntu.com) e fechava com `W: Some index
  # files failed to download` — frase que o ramo abaixo lê como download do
  # browser (`Failed to download`, sem diferenciar caixa). A parte reprovava na
  # tentativa 1 de 3, em 6 das 8 partes do mesmo run. Não troca espelho: os
  # três hosts falham juntos, o destino da troca inclusive. Espera antes de
  # repetir, porque DNS não volta no mesmo segundo. Vem DEPOIS do fatal acima:
  # hash ou assinatura recusados continuam vermelhos mesmo com DNS no log.
  if grep -Eq 'Temporary failure resolving|Could not resolve' "$log"; then
    if [ "${GITHUB_ACTIONS:-}" != true ] || [ "${RUNNER_ENVIRONMENT:-}" != github-hosted ]; then
      echo '::error title=Recuperação APT recusada::não mata processos nem altera fontes fora do runner descartável do GitHub.'
      return 1
    fi
    if [ "$tentativa" -eq 3 ]; then return 0; fi
    echo "::warning title=Preparo do e2e: runner sem DNS::a tentativa ${tentativa} de 3 falhou por resolução de nome (DNS) do runner, não por espelho nem pacote; repete em $((tentativa * 20)) s, sem trocar a fonte."
    sudo pkill -KILL -x apt-get || :
    sudo dpkg --configure -a
    sleep "$((tentativa * 20))"
    return 0
  fi
  # Um timeout depois de começar o download do browser é do CDN, não do APT
  # que já terminou. Não troca fonte nem mata processo para esse caso.
  if grep -Eqi 'Downloading.*(Chrome|Chromium|FFMPEG|ffmpeg|Headless Shell).*https?://|Failed to download' "$log" ||
     ! grep -Eq '^(Get|Hit|Ign|Err):[0-9]+ |^E: (Failed to fetch|Unable to fetch)' "$log"; then
    echo '::error title=Preparo falhou fora do transporte APT::não há falha APT medida nesta tentativa; sem repetir nem trocar a fonte.'
    return 1
  fi
  if [ "$codigo" -ne 124 ] && [ "$codigo" -ne 137 ] &&
     ! grep -Eq 'Failed to fetch (https?://(azure\.|[a-z0-9-]+\.ec2\.)?archive\.ubuntu\.com/ubuntu/|mirror\+file:/etc/apt/apt-mirrors\.txt)' "$log"; then
    echo '::error title=Preparo falhou fora do transporte APT::o erro permanece vermelho, sem nova tentativa.'
    return 1
  fi
  if [ "${GITHUB_ACTIONS:-}" != true ] || [ "${RUNNER_ENVIRONMENT:-}" != github-hosted ]; then
    echo '::error title=Recuperação APT recusada::não mata processos nem altera fontes fora do runner descartável do GitHub.'
    return 1
  fi
  # O último erro será reportado pelo próprio laço; não deixa trabalho novo após ele.
  if [ "$tentativa" -eq 3 ]; then return 0; fi
  sudo pkill -KILL -x apt-get || :
  sudo dpkg --configure -a
  if [ "$tentativa" -eq 1 ] &&
     grep -Eq '(https?://(azure|[a-z0-9-]+\.ec2)\.archive\.ubuntu\.com/ubuntu/|file:/etc/apt/apt-mirrors\.txt)' "$log"; then
    trocar_espelho_apt_e2e
  fi
}
