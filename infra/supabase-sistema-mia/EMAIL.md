# E-mail do login: o que o GoTrue manda, e por onde

O GoTrue (serviço `mia-auth` desta pilha) manda seis e-mails: confirmação de
conta, "esqueci a senha", convite, troca de e-mail, link mágico e código de
reautenticação. Todos saem em português, com a cara da MIA, e pelo SMTP do
Google Workspace.

Este arquivo trata só desses. Os e-mails que o próprio app manda (exportação
de dados da LGPD, por exemplo) usam a configuração de e-mail do app (tela
Admin › E-mail, ou as `SMTP_*` do serviço `deskcomm`), que é outra, e não
passam por aqui.

## Servidor de envio: Google Workspace

Desde 30/09/2026. As variáveis ficam no Environment do serviço
`banco-de-dados/supabase-sistema-mia` no EasyPanel. **Os valores reais moram
SÓ no painel**: nenhuma senha entra em arquivo do repositório.

| variável | o que vai nela |
|---|---|
| `SMTP_HOST` | `smtp-relay.gmail.com` |
| `SMTP_PORT` | `587` (o GoTrue negocia o STARTTLS sozinho) |
| `SMTP_USER` | o endereço da conta do Workspace dona da senha de app |
| `SMTP_PASS` | a senha de app dessa conta (Conta Google › Segurança › Senhas de app; exige verificação em duas etapas) |
| `SMTP_ADMIN_EMAIL` | o remetente: `naoresponda@iamia.com.br` |
| `SMTP_SENDER_NAME` | `MIA` |
| `RATE_LIMIT_EMAIL_SENT` | opcional; teto de e-mails do login por hora na instalação inteira (padrão 100, ver o compose) |

O GoTrue fica só na rede interna desta pilha, e ela tem saída para a
internet (é por ela que o `backup-envio` chega ao Google Drive). Não há nada
a ligar na rede `easypanel` para o e-mail sair.

### Trocar a senha de app

1. Gerar a nova senha de app na conta do Workspace.
2. Trocar `SMTP_PASS` no Environment e implantar o serviço. O compose recria
   só o `mia-auth`; o kong acompanha o IP novo em até 10 s
   (`KONG_DNS_VALID_TTL`).
3. Testar (abaixo) e só então revogar a senha antiga.

## Modelos e assuntos

O corpo de cada e-mail está em `volumes/email/*.html`, servido ao GoTrue pelo
serviço `modelos-email` (só na rede interna). Os assuntos estão no bloco do
`mia-auth` no `docker-compose.yml` (`GOTRUE_MAILER_SUBJECTS_*`). Nenhum domínio
está escrito nos modelos: os links saem do `SITE_URL` ou do retorno que o app
pediu.

Mudou um modelo: `node gerar-inline.mjs`, colar o `docker-compose.inline.yml`
no painel e implantar. Com o recarregamento ligado, o GoTrue pega o modelo
novo em uns 10 s. Se o `modelos-email` cair, o login continua e o e-mail sai
no modelo padrão do GoTrue, em inglês, até ele voltar.

## Como testar

1. Na tela de entrar do app, "Esqueci minha senha" com um endereço real.
2. Deve chegar, em menos de um minuto, um e-mail de **MIA
   &lt;naoresponda@iamia.com.br&gt;**, em português, com o botão que abre
   `/auth/confirm` do app.

Não chegou: logs do `mia-auth` no painel, procurando o erro do envio.

| sintoma no log | causa provável |
|---|---|
| `535 5.7.8 Username and Password not accepted` | senha de app errada, revogada, ou `SMTP_USER` diferente da conta dona dela |
| `550 5.7.1 Invalid credentials for relay` | a regra do serviço de retransmissão SMTP no Admin Console do Workspace (Apps › Google Workspace › Gmail › Roteamento) não aceita autenticação SMTP ou o remetente |
| tempo esgotado conectando | saída pela porta 587 bloqueada na VPS |
| `429` / "email rate limit exceeded" no app | o teto por hora (`RATE_LIMIT_EMAIL_SENT`) |
| chega, mas em inglês | `modelos-email` parado ou modelo com erro de sintaxe |

Chegou na caixa de spam: conferir no DNS do `iamia.com.br` o SPF com
`include:_spf.google.com` e o DKIM do Google ativo (Admin Console › Gmail ›
Autenticar e-mail).

## O que ficou para trás

De 29 a 30/09/2026 houve a ideia de um relay próprio (`mia-smtp`, na branch
`email-servidor`), e o GoTrue chegou a entrar na rede `easypanel` para
alcançá-lo. O relay nunca foi ao ar: o do Google entrega com a reputação dele,
sem servidor de e-mail, DKIM e PTR para manter na VPS. O GoTrue voltou para a
rede interna, e do nome daquela fase ficou só o `mia-auth` (o porquê está no
bloco dele no compose).
