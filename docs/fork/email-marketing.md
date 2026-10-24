# Disparo de e-mail marketing (fork MIA, .89)

A empresa manda campanhas de e-mail para a própria base, **pelo domínio dela**,
com descadastro de um clique, lista de supressão e cobrança por e-mail da mesma
carteira do número oficial. É o terceiro caminho do Broadcast unificado (.58):
"Número oficial", "Número por QR" e, agora, **"E-mail"**.

O protótipo clicável foi aprovado pelo Gabriel em 24/10/2026 (nove telas, vinte
decisões: `Projeto sistema MIA/Produto/Prototipo-disparo-de-email-2026-10-24.html`).
O visual é o do sistema; do protótipo vieram as regras. Schema nas migrations
**9060 a 9065**; código em `lib/email-marketing/` e `lib/email/ses.ts`.

> **Os textos padrão de consentimento e de privacidade são RASCUNHO PARA REVISÃO
> JURÍDICA** (`lib/email-marketing/textos-padrao.ts`). A tela mostra a marca ao lado
> de cada um. Antes do primeiro cliente de verdade, o Gabriel leva os dois ao
> jurídico; a empresa pode trocar o de consentimento por uma versão própria e o de
> privacidade pelo endereço da política dela.

## 1. O caminho de uma campanha

1. **Configuração** (Configurações › E-mail marketing, admin): o domínio e os seis
   registros de DNS, os remetentes, o "responder para" (começa com o da marca da
   empresa, da v1.88), o rodapé obrigatório, o ritmo, a janela, os dias úteis, o
   aquecimento de 14 degraus com a saúde dos 30 dias, a lista de supressão e os
   textos de consentimento.
2. **Broadcast › Novo disparo › E-mail** (gestor): cria um RASCUNHO, vazio, de um
   modelo ou de um segmento salvo. Criar não dispara.
3. **Público**: o filtro das Campanhas do upstream (etiquetas, funil, etapas,
   silêncio) mais a empresa do contato e uma campanha de e-mail anterior (clicou,
   abriu, recebeu e não abriu, recebeu). A **base legal** é escolhida aqui:
   *consentimento* (padrão: só quem tem o aceite registrado) ou *interesse legítimo*
   (só clientes com compra nos últimos 24 meses, com a referência da LIA, e sem
   pixel de abertura). A contagem diz quantos recebem e quantos ficam de fora por
   cada um dos **dez motivos**. Segmentos salvos guardam o filtro, não a lista.
4. **Mensagem**: blocos (título, texto, imagem, botão, divisor) com os campos do CRM
   e o texto reserva de cada um, prévia no computador e no celular montada pelo
   mesmo código do envio, a conferência antes de enviar e o **teste obrigatório da
   versão atual** (até 5 endereços, `[TESTE]` no assunto, sem cobrar).
5. **Enviar**: agora ou agendado, ritmo (nunca acima do da configuração), dias
   úteis, o **plano dia a dia** com o aquecimento, o custo e o saldo, e o que trava.
   A confirmação é **na página**, com a declaração da base legal assinada por quem
   confirma (fica gravada na campanha).
6. **Resultados**: entregues, aberturas (sempre estimativa, só de quem aceitou a
   medição), cliques únicos por link (sem robô), descadastros, rejeições,
   reclamações, cobrado; e quem clicou vira segmento, tarefa para o responsável ou
   negócio (pulando quem já tem negócio aberto no funil).

## 2. Quem fica de fora (os dez motivos)

`lib/email-marketing/elegibilidade.ts`, na ordem da tela:

| motivo | o que é |
|---|---|
| descadastro | saiu pelo link, pelo botão do Gmail/Apple ou pela página (a supressão importada conta aqui) |
| reclamacao | marcou como spam |
| manual | pediu à equipe (registrado na ficha) |
| outros | os vetos das Campanhas: bloqueado no WhatsApp, recusou marketing, contato pessoal, anonimizado |
| sem_email | sem endereço no cadastro |
| email_invalido | sem forma de e-mail, ou o domínio não recebe (MX/A conferido antes do envio) |
| rejeicao | rejeição permanente anterior |
| sem_consentimento | base consentimento sem aceite vigente |
| nao_cliente | base interesse legítimo sem compra nos 24 meses |
| duplicado | o mesmo endereço em outro contato da lista: recebe uma vez |

A conta é refeita na confirmação e **de novo antes de cada e-mail sair**: quem se
descadastra depois de agendado não recebe (`lib/email-marketing/motor.ts`).

## 3. O ritmo, o aquecimento e a trava de saúde

`lib/email-marketing/ritmo.ts` (puro, testado):

- **Aquecimento** do domínio: 200, 400, 700, 1.000, 1.500, 2.000, 3.000, 4.000,
  5.000, 6.500, 8.000, 10.000, 15.000 e 20.000 por dia de envio; depois, a cota da
  conta na Amazon. Só conta dia com envio, e o degrau só sobe se o dia anterior
  teve rejeição abaixo de 2% e reclamação abaixo de 0,1%. O teto é do DOMÍNIO
  (todas as campanhas somadas).
- **Ritmo e janela**: e-mails por hora dentro da janela (padrão 8h às 19h, no fuso
  da empresa, só dias úteis). A rodada nunca vira rajada (teto de 120 por rodada).
- **Trava de saúde**: a partir de 300 entregues, rejeição de 4% ou reclamação de
  0,08% **pausam a campanha sozinha** (a Amazon revisa a conta em 5% e 0,1%, e a
  conta é UMA para todas as empresas). Retomar depois da trava pede confirmação.

## 4. A Amazon (SES v2)

`lib/email/ses.ts` chama a API HTTP da Amazon com a **Assinatura V4 feita com
`node:crypto`** (nenhum pacote novo; conferida contra o vetor publicado pela
Amazon em `tests/unit/email-marketing-regras.test.ts`). Serve **só ao disparo**:
convite, senha e LGPD continuam no servidor de e-mail da instalação.

- Sem as variáveis, o módulo fica desligado: dá para montar a campanha, e nada sai
  nem é cobrado.
- O e-mail sai em MIME montado aqui (`lib/email-marketing/mime.ts`) com
  `List-Unsubscribe` (https) e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
  (RFC 8058) e `Feedback-ID`.
- Os avisos (entrega, rejeição, reclamação) chegam pelo SNS em
  `POST /api/v1/webhooks/email-marketing/amazon`. Nada entra sem: o tópico igual a
  `AWS_SES_SNS_TOPIC_ARN`, o certificado servido por `sns.<região>.amazonaws.com`,
  a assinatura conferida e o aviso recente. Assinatura inválida: 403, auditado
  (`webhook.hmac_invalid`), nada muda. Rejeição permanente e reclamação entram na
  supressão na hora; a temporária, na terceira campanha seguida.

### Variáveis de ambiente (EasyPanel)

| variável | o que é |
|---|---|
| `AWS_SES_ACCESS_KEY_ID` | a chave do usuário IAM do envio |
| `AWS_SES_SECRET_ACCESS_KEY` | o segredo dele |
| `AWS_SES_REGION` | `sa-east-1` (São Paulo) |
| `AWS_SES_CONFIGURATION_SET` | o conjunto de configuração que publica os eventos no SNS |
| `AWS_SES_SNS_TOPIC_ARN` | o ARN do tópico do SNS (a rota recusa qualquer outro) |
| `EMAIL_MARKETING_TOKEN_SECRET` | opcional: o segredo dos links (sem ele, vale o `INTERNAL_SECRET`) |

As quatro primeiras e o tópico são obrigatórias para o envio ligar
(`VARIAVEIS_DA_AMAZON`). A tela e o MCP só dizem "ligado" ou o NOME do que falta,
nunca o valor.

### Passo a passo para o Gabriel (uma vez, para a plataforma inteira)

1. **Conta da Amazon**: entrar em <https://aws.amazon.com> com a conta da
   plataforma (ou criar uma) e ligar a autenticação em dois fatores do usuário raiz.
2. **Região**: no canto de cima, escolher **América do Sul (São Paulo) ·
   sa-east-1**. Tudo abaixo é nessa região.
3. **Sair do sandbox**: no console do **Amazon SES** › *Account dashboard* ›
   *Request production access*. Tipo de e-mail: *Marketing*; site: o da
   plataforma; descrever o uso: "plataforma de CRM; cada empresa cliente envia para a
   própria base, com consentimento registrado ou cliente dos últimos 24 meses,
   descadastro de um clique, lista de supressão e tratamento automático de
   rejeição e reclamação por SNS". Sem isso a Amazon só envia para endereços
   verificados um a um. A resposta costuma sair em até 24 horas.
4. **Conjunto de configuração**: SES › *Configuration sets* › *Create*, nome
   `mia-disparo`. Em *Event destinations* › *Add destination*: eventos *Delivery*,
   *Hard bounces*, *Soft bounces* (e *Bounce*), *Complaints*; destino **Amazon
   SNS**, criando um tópico novo (ex.: `mia-avisos-de-email`). Anotar o ARN.
5. **A inscrição do tópico**: SNS › *Topics* › o tópico › *Create subscription*:
   protocolo **HTTPS**, endpoint
   `https://<endereço do app>/api/v1/webhooks/email-marketing/amazon` (o mesmo
   `NEXT_PUBLIC_APP_URL` do servidor). A plataforma
   confirma sozinha (a rota visita o endereço de confirmação do SNS, que só pode ser
   da Amazon). Depois de implantar com as variáveis, a inscrição deve aparecer
   *Confirmed*.
6. **Usuário do envio**: IAM › *Users* › *Create user* `mia-ses-envio`, sem acesso
   ao console, com uma política só com `ses:SendEmail`, `ses:SendRawEmail`,
   `ses:CreateEmailIdentity`, `ses:GetEmailIdentity`,
   `ses:PutEmailIdentityMailFromAttributes` e `ses:GetAccount`. Em *Security
   credentials* › *Create access key* (uso: aplicação fora da AWS). Guardar a chave e
   o segredo no gerenciador de senhas; **não** colar em conversa nem em arquivo do
   repositório.
7. **EasyPanel**: no serviço do app, em *Environment*, acrescentar as variáveis da
   tabela acima e implantar (a implantação derruba uns 2 minutos: avisar antes).
8. **Conferir**: Configurações › E-mail marketing de uma empresa mostra "Amazon SES,
   região sa-east-1" ligado; em `plataforma_ver_saude`/`plataforma_ver_email_marketing`
   o envio aparece configurado.

Para cada empresa cliente, depois: liberar o módulo (`email_marketing`), o preço por
e-mail (padrão R$ 0,02, ajustável por empresa) e o domínio. Os seis registros (3
CNAME de DKIM, o MX e o SPF do subdomínio de retorno `envio`, e o DMARC) vão para
quem cuida do DNS do cliente; a tela confere na hora e a Amazon, de hora em hora.
Provedor gratuito (gmail.com, hotmail.com...) não serve de remetente.

## 5. Dinheiro: preço, saldo e débito

- Preço por e-mail em `tenant_broadcast_pricing.preco_por_email_cents` (coluna nova,
  9060); nulo = o padrão de 2 centavos (`PRECO_PADRAO_POR_EMAIL_CENTS`). O preço é
  CONGELADO na campanha na confirmação.
- O saldo é conferido na confirmação e no começo de cada rodada; sem saldo, a
  campanha pausa ("o crédito acabou").
- O débito sai da `tenant_wallet_ledger` **por lote** enviado (`ref_kind
  'email_lote'`), só pelo que a Amazon ACEITOU, por `fn_mia_email_cobrar`: lote com
  e-mail ainda saindo espera, e rodar de novo não cobra duas vezes (o índice único
  da carteira). Por lote, e não por e-mail, porque `lerSaldoDaCarteira` soma no
  máximo 100 mil linhas do extrato. O teste não cobra.
- Envio que caiu no meio (rodada interrompida) vira `falhou`, nunca é reenviado e
  não é cobrado: e-mail duplicado é pior que e-mail perdido.

## 6. Descadastro, preferências e supressão

- **Um clique** (RFC 8058): o botão do Gmail/Apple faz `POST` em
  `/api/v1/webhooks/email-marketing/descadastro/<token>` e a pessoa sai na hora.
  O `GET` **nunca** descadastra (filtro de segurança abre link sozinho): leva à
  página com "sair" escolhido.
- **Página de preferências** (`/preferencias/<token>`, sem login, `noindex`, teto
  por IP, prévia de link recebe página neutra): sair (e, se a pessoa marcar, também
  do marketing pelo WhatsApp, em `consent.marketing.declined_at`), com motivo
  opcional; e **voltar a receber**, que só a própria pessoa faz, por aqui, e nunca
  depois de rejeição permanente nem com o contato anonimizado. A aba "Privacidade"
  mostra a política da empresa ou o texto padrão (rascunho jurídico).
- O **token** é o do convite e do #1738: `corpo.assinatura` em base64url, HMAC-SHA256
  com o segredo do servidor, e leva a empresa e o destinatário (o banco confere a
  linha). O do e-mail de teste é de outro tipo: os links abrem e nada muda.
- A **supressão** é a lista do upstream (`campaign_suppressions`) ESTENDIDA (9063)
  com `tipo_de_endereco` e `motivo`; a chave é o hash do e-mail. Um gatilho só deixa
  ACRESCENTAR: a equipe não apaga nem troca o endereço (42501); passam a exclusão da
  empresa (cascata) e a volta pela própria pessoa (`fn_mia_email_voltar_a_receber`).

## 7. LGPD

- O consentimento mora em `contacts.consent.email_marketing` (data, origem, versão
  do texto, evidência, quem registrou) e, linha a linha, em `mia_email_consentimentos`
  (cada aceite e cada recusa). Na ficha do contato, atendente para cima registra o
  aceite (**evidência obrigatória**) ou a recusa; a importação de aceites pede data e
  origem por linha.
- **Anonimizar** o contato (gatilho 9064): apaga o e-mail COPIADO de cada envio e
  solta o contato; apaga origem, evidência e texto aceito dos registros. O **hash** e
  o **veto da supressão** ficam: quem pediu para sair não volta a receber por um
  cadastro novo.
- O relatório de acesso do titular (`lib/lgpd/export-collector.ts`) entrega os
  e-mails que chegaram a ele (campanha, assunto, entregue, aberto, clicado e em quais
  links, descadastro) e cada aceite e recusa (sem o id da pessoa da equipe).

## 8. Quem vê e quem grava

| papel | o que faz |
|---|---|
| admin | configura: domínio, remetentes, rodapé, ritmo, textos, supressão à mão |
| gestor (manager) | cria, testa, confirma, pausa e retoma campanhas; segmentos; resultados |
| atendente (agent) | registra o consentimento (aceite ou recusa) na ficha |

Treze tabelas, todas com RLS de leitura pela própria empresa e o papel (o
consentimento por atendente, o resto por gestor) e escrita **só pelo servidor**. O
módulo vendável é `email_marketing` (`lib/modulos/vendaveis.ts`), com a linha no
catálogo de recursos opcionais. A tela do Broadcast e a da carteira abrem também
para quem só contratou o e-mail (`TELAS_TAMBEM_DE`).

## 9. A empresa de demonstração não manda nada

Duas portas: no código, `mandar` passa por `travaDaDemonstracao` antes da Amazon
(fecha se não der para confirmar); no banco, o gatilho
`trg_mia_email_demonstracao_nao_envia` recusa campanha agendada ou enviando e o
registro de teste (42501). Na demonstração dá para montar tudo e ver a prévia.

## 10. O worker

`* * * * *` → `POST /api/v1/cron/email-marketing` (`docker/scheduler/entrypoint.sh`,
com `$SEGREDO_DO_CRON`). A régua das empresas operantes (`STATUS_OPERANTE`,
`ehOperante`) vale: empresa parada não envia. Cada rodada solta os envios presos
há 15 minutos (viram `falhou`), reivindica destinatários com `for update skip locked`
(`fn_mia_email_reivindicar`), confere de novo quem pode receber, respeita o ritmo,
a janela, o aquecimento, a trava de saúde e o saldo, e cobra os lotes terminados.

## 11. Pelo MCP de plataforma

Nove ferramentas (78 no total); ver
[`mcp-de-implantacao.md`](mcp-de-implantacao.md), "O disparo de e-mail marketing".
**O MCP nunca dispara**: monta o rascunho e manda o teste só para a equipe do
cliente. Duas operações novas no token: `importar_consentimentos` e
`criar_campanha_de_email`.

## 12. Para quem mexe no código

| peça | arquivo |
|---|---|
| migrations | `supabase/migrations-mia/20261025100000_9060_*` a `..._100500_9065_*` (e o espelho em `supabase/baseline-mia.sql`) |
| transporte | `lib/email/ses.ts` |
| regras puras | `lib/email-marketing/{regras,elegibilidade,ritmo,fuso,blocos,variaveis,mime,token,dominio,recorte,cliques}.ts` |
| banco e envio | `lib/email-marketing/{banco,publico,envio,campanhas,motor,eventos,supressao,consentimentos,preferencias,resultados,configuracao,segmentos-e-modelos,retrato}.ts` |
| rotas | `app/api/v1/email-marketing/**`, `app/api/v1/webhooks/email-marketing/**`, `app/api/v1/cron/email-marketing`, `app/api/v1/contacts/[id]/consentimento-de-email` |
| telas | `app/app/settings/email-marketing`, `app/app/broadcast/email/[id]`, `app/preferencias/[token]`, `components/email-marketing/**` |
| espanhol | `lib/i18n/dicionario-mia-email-marketing.ts` |

### Onde o código do upstream foi tocado (marcado `FORK MIA`)

`lib/lgpd/export-collector.ts` e `lib/lgpd/copia-do-titular.ts` (as duas seções
novas do relatório do titular), `lib/navigation/catalogo.ts` (o item do menu),
`lib/navigation/interface.ts` (a tela que abre por mais de um módulo),
`lib/recursos-opcionais/*` (as duas linhas), `lib/auth/public-paths.ts` (a página
de preferências), `lib/audit/actions.ts` (as ações `email_marketing.*`),
`lib/env.ts` e `.env.example` (as variáveis), `docker/scheduler/entrypoint.sh` (o
cron), `app/app/contacts/[id]/_client.tsx` (o consentimento na ficha) e
`lib/i18n/dicionario.ts` (o espalhar do dicionário).

### Provas

| teste | o que prova |
|---|---|
| `tests/unit/email-marketing-regras.test.ts` | os dez motivos, o plano com o aquecimento, o ritmo e a janela, a trava de saúde, o token, os cabeçalhos do descadastro de um clique, os seis registros e o provedor gratuito, a Assinatura V4 contra o vetor da Amazon e o aviso do SNS forjado |
| `tests/unit/email-marketing-rotas-publicas.test.ts` | o descadastro de um clique (e o GET que não descadastra), a página de preferências (voltar só pela pessoa; rejeição e anonimizado não voltam), os avisos da Amazon (forjado: 403 e nada muda; rejeição, reclamação e três temporárias) e a demonstração que não chama a Amazon |
| `tests/unit/mcp-de-implantacao-email-marketing.test.ts` | as nove ferramentas, o MCP que nunca dispara e o teste só para a equipe |
| `tests/invariants/email-marketing.test.ts` | isolamento, só o servidor grava, demonstração, supressão que só acrescenta, anonimização, débito por lote e a fila do worker |

### Lacunas conhecidas

- **Tópicos de assunto** na página de preferências (o protótipo tinha caixinhas por
  assunto): as campanhas não têm tópico, então a página oferece sair de tudo e
  voltar. Entra quando a campanha ganhar tópico.
- **Imagem** do bloco vai para um bucket público (`email-marketing-imagens`, 1 MB,
  PNG/JPEG/GIF): é o que o e-mail precisa para abrir em qualquer caixa. Imagem
  apagada da campanha não é apagada do bucket.
- **Domínio por empresa é um só** (o protótipo também): remetentes diferentes usam
  o mesmo domínio verificado.
- **A Amazon nunca foi chamada de verdade** no desenvolvimento: o transporte é
  provado pelo vetor da assinatura e por dublês. O primeiro envio real precisa do
  passo a passo acima e de um teste para a equipe.
