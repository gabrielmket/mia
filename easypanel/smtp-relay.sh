#!/bin/sh
# Entrada do serviço `mia-smtp` do docker-compose.easypanel.yml.
#
# Prepara a chave DKIM e as variáveis do boky/postfix e só então entrega o
# processo para o /scripts/run.sh da própria imagem (que configura o Postfix e o
# OpenDKIM e sobe os dois).
#
# Por que um script, e não `environment:` no compose:
#
#  1. A chave DKIM é segredo e vem do `.env` (env_file), em base64 numa linha só.
#     O OpenDKIM só lê ARQUIVO, e o run.sh da imagem procura esse arquivo ANTES
#     de rodar os scripts de /docker-init.d/ (o setup do DKIM vem primeiro). Por
#     isso ela é escrita aqui, antes do run.sh, e não num script de init.
#  2. Os padrões (domínio, hostname, seletor) moram AQUI, e não em
#     `${VAR:-padrão}` no compose: `environment:` ganha do `env_file`, e nunca
#     foi medido se o deploy do EasyPanel lê o `.env` ao interpolar. Se não ler,
#     o padrão do compose passaria por cima do valor que alguém pôs no painel,
#     em silêncio. Aqui o `.env` sempre vence e o padrão só vale na ausência.
#
# Variáveis (todas no Environment do serviço clientes/deskcomm):
#
#   SMTP_DKIM_PRIVATE_KEY_B64  obrigatória. A chave privada RSA (PEM) inteira em
#                              base64 numa linha (`base64 -w0 chave.pem`).
#   SMTP_RELAY_DOMAINS         domínios que podem aparecer no remetente,
#                              separados por espaço. Padrão: iamia.com.br.
#                              A mesma chave assina todos: publique o mesmo TXT
#                              DKIM em cada um (é assim que se troca de domínio
#                              sem parar o envio).
#   SMTP_RELAY_HOSTNAME        o nome do servidor no HELO. Padrão:
#                              mail.<primeiro domínio>. Precisa bater com o PTR
#                              do IP da VPS e ter registro A para o mesmo IP.
#   SMTP_DKIM_SELECTOR         seletor DKIM. Padrão: mia (mia._domainkey.<domínio>).
set -eu

DOMINIOS="${SMTP_RELAY_DOMAINS:-iamia.com.br}"
# shellcheck disable=SC2086 # a lista é separada por espaço de propósito
set -- $DOMINIOS
if [ "$#" -eq 0 ]; then
  echo "[mia-smtp] SMTP_RELAY_DOMAINS está vazia: nenhum domínio pode enviar." >&2
  exit 1
fi
PRINCIPAL="$1"
NOME="${SMTP_RELAY_HOSTNAME:-mail.$PRINCIPAL}"
SELETOR="${SMTP_DKIM_SELECTOR:-mia}"

# Sem DKIM o contêiner NÃO sobe. E-mail sem assinatura saindo de um IP novo é
# o caminho mais curto para cair no spam e sujar a reputação do IP, que depois
# demora semanas para limpar. Melhor o serviço reiniciando com este aviso no
# log do que convite chegando na caixa de spam do cliente.
if [ -z "${SMTP_DKIM_PRIVATE_KEY_B64:-}" ]; then
  echo "[mia-smtp] SMTP_DKIM_PRIVATE_KEY_B64 vazia: sem chave DKIM o relay não sobe (ver easypanel/LEIA-ME.md)." >&2
  exit 1
fi

umask 077
mkdir -p /etc/opendkim/keys
# O diretório é volume da imagem e sobrevive à recriação do contêiner: sem
# limpar, a chave de um domínio que saiu da lista continuaria assinando.
rm -f /etc/opendkim/keys/*.private /etc/opendkim/keys/*.txt
CHAVE=/etc/opendkim/keys/.recebida.pem
if ! printf '%s' "$SMTP_DKIM_PRIVATE_KEY_B64" | base64 -d > "$CHAVE" 2>/dev/null \
  || ! openssl pkey -in "$CHAVE" -noout 2>/dev/null; then
  rm -f "$CHAVE"
  echo "[mia-smtp] SMTP_DKIM_PRIVATE_KEY_B64 não é uma chave privada PEM em base64 (gere com: base64 -w0 chave.pem)." >&2
  exit 1
fi
for dominio in "$@"; do
  cp "$CHAVE" "/etc/opendkim/keys/$dominio.private"
done
rm -f "$CHAVE"
chown -R opendkim:opendkim /etc/opendkim/keys
chmod 400 /etc/opendkim/keys/*.private
unset SMTP_DKIM_PRIVATE_KEY_B64
umask 022

echo "[mia-smtp] remetentes aceitos: $DOMINIOS | HELO: $NOME | DKIM: s=$SELETOR"

export ALLOWED_SENDER_DOMAINS="$DOMINIOS"
export POSTFIX_myhostname="$NOME"
export DKIM_SELECTOR="$SELETOR"

exec /scripts/run.sh
