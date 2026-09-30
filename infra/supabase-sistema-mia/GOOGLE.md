# Entrar e criar conta com Google

Quem liga é o GoTrue (serviço `mia-auth` desta pilha). O app não tem chave
nenhuma do Google: ele pergunta ao GoTrue (`/auth/v1/settings`) se o Google
está ligado e, se estiver, desenha o botão em até 1 minuto
(`lib/auth/google-na-tela.ts`). Desligado é o padrão.

## O caminho de um clique

1. Na tela de entrar (ou de criar conta), o app grava o verificador do PKCE
   num cookie **do domínio em que a pessoa está** e manda o navegador ao
   GoTrue (`/auth/v1/authorize`).
2. O GoTrue manda ao Google; o Google devolve ao GoTrue, em
   `API_EXTERNAL_URL/auth/v1/callback`.
3. O GoTrue devolve ao app, em `/auth/callback` do **mesmo domínio** do passo 1
   (`lib/auth/dominio-do-retorno-do-google.ts`), desde que o domínio esteja em
   `ADDITIONAL_REDIRECT_URLS`. Fora da lista, ele cai no `SITE_URL`, o cookie do
   passo 1 não está lá e a entrada falha.
4. O app troca o código por sessão e decide para onde a pessoa vai (abaixo).

## 1. No Google Cloud (uma vez)

1. No console do Google Cloud, num projeto da conta do Workspace: tela de
   consentimento do OAuth com tipo **Externo**, nome **MIA**, e-mail de suporte,
   domínios autorizados `timecompany.com.br` e `iamia.com.br`. Escopos: só os
   básicos (`openid`, `email`, `profile`), que são os que o GoTrue pede.
2. **Publicar** o app (status "Em produção"). Em "Teste", só entram as contas
   cadastradas como usuários de teste.
3. Criar um cliente OAuth do tipo **Aplicativo da Web** com UM URI de
   redirecionamento autorizado: o `API_EXTERNAL_URL` do serviço seguido de
   `/auth/v1/callback`. Hoje:
   `https://sistema-db.timecompany.com.br/auth/v1/callback`.
   Origens JavaScript não são necessárias (o fluxo é todo por redirecionamento).
4. Guardar o ID do cliente e a chave secreta. A chave vai **só** no painel.

## 2. No Environment do serviço `banco-de-dados/supabase-sistema-mia`

| variável | valor |
|---|---|
| `GOOGLE_ENABLED` | `true` |
| `GOOGLE_CLIENT_ID` | o ID do cliente (termina em `.apps.googleusercontent.com`) |
| `GOOGLE_SECRET` | a chave secreta do cliente |
| `ADDITIONAL_REDIRECT_URLS` | `https://crm.timecompany.com.br/**,https://app.iamia.com.br/**` |

O URI de retorno do GoTrue (`GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI`) é montado
no compose a partir do `API_EXTERNAL_URL`: não há o que colar para ele.

`ADDITIONAL_REDIRECT_URLS` vale também para os links dos e-mails do login
(`/auth/confirm`, ver EMAIL.md). O valor acima cobre qualquer caminho dos dois
domínios, então substitui o que houver. Domínio novo do app = entrar nesta
lista, separado por vírgula.

Depois, implantar o serviço. O compose recria só o `mia-auth`; o kong acompanha
em até 10 s. No app (`deskcomm`) não muda nada.

## O primeiro acesso de quem entra pelo Google

É o `app/auth/callback/route.ts`, com as mesmas travas do cadastro por e-mail:

| quem chega | para onde vai |
|---|---|
| já tem vínculo com uma empresa | `/app` |
| teve o acesso retirado | tela de entrar, com o aviso; não cria empresa |
| veio do link de convite (`/team/accept-invite/…` › criar conta › Google) | entra na equipe do convite, **se** o e-mail da conta Google for o do convite; outro e-mail é recusado, sem criar empresa |
| sem convite, cadastro **aberto** | cria a empresa, a pessoa é admin dela, e cai no `/onboarding/welcome` |
| sem convite, cadastro **com aprovação** | `/get-started`, onde pede a liberação |
| sem convite, cadastro **só por convite** | tela de entrar, com o aviso; não cria empresa |
| tem segundo fator (TOTP) | `/login/mfa` antes de entrar |

O modo de cadastro é o de `/admin/cadastro` (ou `SIGNUP_MODE` do app); o
Google não tem regra própria.

Quem já tem conta por e-mail e senha e entra com o Google do MESMO e-mail cai
na mesma conta: o GoTrue liga as duas identidades quando o Google diz que o
e-mail é verificado.

## Como testar

1. `GET https://sistema-db.timecompany.com.br/auth/v1/settings` com o cabeçalho
   `apikey` (a chave anon) deve trazer `"google": true` em `external`.
2. Em até 1 minuto, o botão aparece em `/login` e `/signup` dos dois domínios.
3. Numa janela anônima, entrar com uma conta Google sem empresa e conferir o
   destino da tabela acima.

| sintoma | causa provável |
|---|---|
| o Google mostra `redirect_uri_mismatch` | o URI do cliente OAuth não é exatamente `API_EXTERNAL_URL/auth/v1/callback` |
| volta à tela de entrar com "Não foi possível concluir a entrada com o Google" | o domínio da tela não está em `ADDITIONAL_REDIRECT_URLS` (a volta caiu em outro domínio, sem o cookie do passo 1); na auditoria, `auth.google_signin_failed` com `troca_do_code_falhou` |
| "O Google não está habilitado nesta instalação" | `GOOGLE_ENABLED` não é `true`, ou o `mia-auth` não foi reimplantado |
| só algumas contas conseguem | o app do Google Cloud ainda está em "Teste" |

## Limite conhecido

Os desvios de `/auth/callback` para páginas públicas (erro, segundo fator)
usam `NEXT_PUBLIC_APP_URL`. Quem entra pelo Google no outro domínio e tem
segundo fator é mandado ao `/login/mfa` do domínio principal, onde a sessão
recém-criada não está; resolve entrando pelo domínio principal. Os caminhos
comuns (entrar, convite, criar empresa) seguem no domínio da tela.

## Desligar

`GOOGLE_ENABLED=false` e implantar. O botão some em até 1 minuto. As contas
criadas pelo Google continuam existindo; para entrar sem ele, "Esqueci minha
senha" cria uma senha.
