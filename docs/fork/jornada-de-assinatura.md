# Jornada de assinatura: a cobrança (fork MIA, .90)

A empresa que chega pelo site escolhe um plano, se cadastra, testa, paga e usa o que o
plano dela libera, sem ninguém da Time no meio. A Time acompanha numa tela própria e
recebe no zap só os momentos em que precisa agir.

O protótipo clicável foi aprovado pelo Gabriel em 25/10/2026
(`Projeto sistema MIA/Produto/Prototipo-jornada-de-assinatura-2026-10-25.html`). Esta
versão (.90) é a parte da **cobrança**: telas 1 (preços), 2 (cadastro), 4 (o plano
libera módulo), 5 (as empresas que entraram sozinhas), 6 (atraso e suspensão) e 8 (MCP).
Os primeiros passos e o assistente de quem acabou de entrar são da .91.

A base é a cobrança do upstream (Rafael, `docs/saas/cobranca.md`): planos, assinaturas,
régua, troca de plano, link de pagamento, Asaas e Stripe. Ela já estava no sistema,
desligada. O que é nosso fica ao lado: schema nas migrations **9070 a 9072**, código em
`lib/planos-mia/` e `lib/carteira/compra-pelo-asaas.ts`.

> **Plano e preço são DADO, nunca código.** Os valores do protótipo (R$ 297, 597 e 990,
> os pacotes de crédito, os 14 dias de teste) são exemplos. Quem cria os planos é a Time,
> pela aba Planos do painel (os módulos de cada plano, em `/admin/cobranca/modulos-dos-planos`)
> ou pelo MCP (`plataforma_garantir_planos`).

---

## 1. Tudo sai desligado

A .90 chega à produção sem mudar nada para ninguém:

- a cobrança (`MODULO_COBRANCA`) continua **desligada**;
- as empresas de hoje continuam **isentas** (sem linha em `cobranca_assinaturas`);
- o cadastro continua **"com aprovação"** (o modo é do upstream, em `/admin/cadastro`).

Com a cobrança desligada: nenhum módulo vem pelo plano (a função do banco devolve vazio),
a liberação à mão segue valendo, Vendas B2B segue a instalação, o preço por mensagem é o
combinado de sempre, a página de preços e a rota pública dizem "indisponível", o cadastro
não mostra cartões, os recados da jornada calam, a compra de crédito por Pix não existe e
as rotinas do Broadcast e do e-mail não pausam nada.

Provas: `tests/unit/jornada-tudo-desligado.test.ts` (peça por peça),
`tests/invariants/jornada-de-assinatura.test.ts` (o banco),
`tests/unit/rotina-pula-modulo-fora-do-plano.test.ts` e
`tests/unit/compra-de-creditos-pelo-asaas.test.ts`.

## 2. O plano libera módulo

Cada plano de `cobranca_planos` (do upstream, intocado) ganha uma linha ao lado em
**`mia_plano_modulos`** (9070): os módulos vendáveis que ele liga (`disparador`,
`email_marketing`, `crm_b2b`), o preço por mensagem do Broadcast, a frase e o selo do
cartão da página de preços.

**Duas origens** para um módulo numa empresa:

| origem | onde mora | sai com troca de plano? |
|---|---|---|
| **pela Time** | `organization_modules` (0245), a liberação à mão de sempre | não |
| **pelo plano** | `mia_plano_modulos` do plano ATUAL da assinatura | sim |

A pergunta "o plano liga este módulo?" é feita ao banco na hora
(`fn_mia_modulos_do_plano`), sem cópia que envelheça. Ela devolve vazio com a cobrança
desligada e para a empresa isenta. A isenta nunca ganha módulo pelo plano.

**Quando a mudança vale** é a regra de troca do upstream (`lib/cobranca/troca.ts`), e o
módulo segue o `plano_id`:

- no **teste**, a troca vale na hora, e o módulo também;
- **subindo** depois do teste, vale quando a diferença é paga (a releitura no provedor);
- **descendo**, vale na renovação. **Sete dias antes**, quem administra recebe e-mail e
  aviso na Central com os módulos que vão sair (`avisarModulosQueSaem`, uma vez por troca
  agendada).

**Desligado pelo plano**, o módulo some do menu, a tela mostra "não contratado"
(`components/planos-mia/ForaDoPlano.tsx`), a rota recusa (`403 modulo_nao_contratado` no
Vendas B2B; o Broadcast e o e-mail já recusavam pela `moduloLiberado`) e a rotina pausa a
campanha com o motivo `modulo_nao_contratado` na tela (seção 2.1). **Os dados ficam**:
lista, campanhas, números. Voltando o módulo, tudo está lá.

**Regras do banco** (9070):

- plano com assinante (atual, agendado ou troca pendente) **não perde módulo nem muda o
  preço por mensagem**: o gatilho recusa com `plano_com_assinantes` (23514). Acrescentar
  módulo pode, e vale na hora para as empresas do plano. Para tirar, arquiva-se o plano e
  cria-se outro;
- **Vendas B2B** só vem pelo plano com o módulo da instalação (`MODULO_CRM_B2B`) ligado.
  Com a cobrança ligada, a empresa que tem plano sem Vendas B2B não o vê; a isenta segue a
  instalação, como hoje.

O histórico do que ligou e desligou pelo plano fica em `mia_modulos_do_plano_registro`
(gravado só por `fn_mia_seguir_o_plano`, que não repete). Cada mudança deixa aviso na
Central da empresa e a auditoria `planos_mia.modulos_seguiram_o_plano`. O registro sai na
hora quando a mudança passa pelo nosso código (a releitura do pagamento, a troca no teste, o
MCP, a página dos módulos dos planos) e, nas ações do card Cobrança do upstream (atribuir e isentar pela tela,
cuja rota ficou intocada), na rodada de hora em hora da cobrança
(`app/api/v1/cron/cobranca`), que segue o plano em todas as empresas. O módulo em si vale
na hora em todos os casos: quem decide é a função do banco, não o registro.

### 2.1 A rotina pula a empresa

O motor do Broadcast (`app/api/v1/cron/broadcast-worker`) e o do e-mail marketing
(`lib/email-marketing/motor.ts`) perguntam `moduloSaiuPeloPlano` antes de mandar. Só pausa
quando as quatro coisas foram lidas e são certas: cobrança ligada, empresa com assinatura,
sem liberação da Time e plano atual sem o módulo. Leitura que falha segue como sempre: a
pergunta aqui é "paro o que o gestor já mandou sair?", e pausar campanha paga por uma
oscilação do banco seria o erro visível.

## 3. A origem da empresa

`mia_origem_da_empresa` (9071) diz por onde a empresa nasceu: **`cadastro`** (a própria
pessoa, no cadastro aberto ou no pedido aprovado) ou **`implantacao`** (a Time: painel, MCP,
demonstração). Grava no nascimento, pelo gatilho `trg_mia_origem_da_empresa`: sem autor ou
com autor admin de plataforma é implantação; senão, cadastro. As empresas que já existiam
entraram como `implantacao`. O `plataforma_criar_cliente` grava `implantacao` também.

## 4. O cadastro, a página de preços e a rota pública

- **Cadastro** (`/signup`): os planos oferecidos viram cartões
  (`components/planos-mia/CartoesDoPlano.tsx`) e `?plano=<slug ou id>` chega com o plano
  marcado. Plano escondido ou inexistente no link cai no padrão do cadastro. Pelo Google, a
  empresa entra no plano padrão do cadastro (a regra do upstream). Um campo novo, opcional,
  "o que a empresa faz" (até 200 caracteres), vai no pedido para a Time ler antes de
  aprovar.
- **Página de preços**: `https://app.iamia.com.br/precos` (`app/precos/page.tsx`).
- **Rota pública** para o site da iamia: `GET https://app.iamia.com.br/api/v1/publico/planos`.
  Sem sessão, CORS aberto, cache curto. Devolve `disponivel` e os planos oferecidos com
  `slug`, `nome`, `frase`, `destaque`, `padrao`, `preco_cents`, `intervalo`, `trial_dias`,
  `pessoas`, `numeros`, `conversas_estimadas`, `modulos` (chave, nome, descrição),
  `preco_por_mensagem_cents` (só com Broadcast) e `cadastro` (o link absoluto com o plano
  marcado). **Nunca o teto de IA em dólar**: no lugar dele, "cerca de N conversas por mês"
  (`conversasEstimadas`: teto ÷ US$ 0,048 por conversa, arredondado a 50).

## 5. O dinheiro na tela da empresa

- **Painel da assinatura** (Configurações › Plano e cobrança): a IA em **porcentagem do
  incluído**, nunca em dólar. Em 80%, aviso; em 100%, a IA para até o mês virar e as
  conversas novas vão para a equipe (o teto do plano do upstream, que agora vale também
  para quem não tem chave própria). Os módulos do plano com a origem.
- **Créditos por Pix** (`lib/carteira/compra-pelo-asaas.ts`, 9072): a empresa com plano no
  Asaas compra um pacote (`mia_pacotes_de_creditos`) por Pix, pelo mesmo Asaas da
  cobrança. O valor entra na carteira **só quando a releitura no Asaas diz pago**, pela
  função `fn_mia_confirmar_compra_de_creditos`, uma vez só (a trava é a linha da compra e o
  índice único da carteira). O CPF ou CNPJ de quem paga fica só no Asaas. A isenta continua
  com a Time; Stripe não compra por aqui.
- Nada em dólar sai para o cliente: a tela de suspensão e o painel passam por `semDolar`.

## 6. Os espelhos

O MCP e a tela da Time fazem o que o card Cobrança do upstream faz. Onde a lógica mora
dentro da rota do upstream, há um espelho, e a cerca
`tests/unit/mcp-de-implantacao-espelhos.test.ts` guarda a impressão de cada rota: mudou o
código dela, reprova e diz qual espelho reler.

| rota do upstream | espelho |
|---|---|
| `app/api/v1/admin/tenants/[id]/assinatura/route.ts` (atribuir, trocar, isentar) | `lib/planos-mia/acoes-do-dono.ts` |
| `app/api/v1/admin/tenants/[id]/assinatura/prazo/route.ts` | `lib/planos-mia/acoes-do-dono.ts` |
| `app/actions/registration/decide.ts` (a fila de `/admin/cadastro`) | `lib/planos-mia/pedidos-de-cadastro.ts` |
| `app/api/v1/admin/cobranca/planos/route.ts` e `[id]/route.ts` | `lib/planos-mia/garantir-planos.ts` |
| `lerCobrancaDoTenant` em `app/admin/(protected)/tenants/[id]/page.tsx` (página, sem impressão: conferir à mão na fusão) | `lib/planos-mia/card-de-cobranca.ts` |

## 7. A tela da Time: Empresas do cadastro

`/admin/empresas-do-cadastro` (menu do painel). Números do topo, filtros por situação,
"só quem entrou sozinho", a tabela (origem, plano, situação, passos feitos de 6, o próximo
passo da régua), os pedidos de cadastro esperando (com o plano escolhido e o que a empresa
faz; aprovar e recusar com o motivo, que vai por e-mail), os números oficiais esperando
ligação e o detalhe da empresa com a régua ponto a ponto e o card Cobrança. A empresa de
demonstração fica de fora. As escritas seguem `falhaDaEscritaDePlatformAdmin` (MFA).

Os passos contam os primeiros passos do upstream (`passosVisiveis`); quando a .91 entrar,
a contagem passa a ser a dela.

## 8. Os recados no zap da Time

O mesmo grupo interno dos chamados do assistente (.88), pelo `reportar`
(`lib/planos-mia/recados.ts`, no cron `report-da-plataforma`). Quatro momentos:

1. pedido novo de cadastro, com o plano escolhido;
2. número oficial esperando ligação;
3. o teste acaba amanhã sem assinatura;
4. um dia antes de suspender quem entrou sozinho.

Só o nome da empresa e o que fazer, nunca e-mail, telefone ou nome de pessoa. Cada recado
tem chave própria (`jornada:zap:...`) e sai uma vez. **Com a cobrança desligada, calam.**

## 9. Pelo MCP de plataforma

Nove ferramentas novas (`lib/mcp-plataforma/ferramentas/cobranca.ts`; a lista vai a 92),
descritas em [`mcp-de-implantacao.md`](mcp-de-implantacao.md), "A cobrança da jornada de
assinatura (.90)". Três caixinhas novas no token: `gerir_planos`, `gerir_cobranca` e
`decidir_cadastro`. Crescem três: `plataforma_ver_cliente` (a cobrança e os módulos com a
origem), `plataforma_criar_cliente` (`plano` ou `isenta`, e a origem implantação) e
`plataforma_liberar_modulo` (aceita `crm_b2b`, diz a origem "pela Time" e avisa o que o
plano já liga). `plataforma_ver_implantacao` não mudou.

**O MCP não** conecta nem troca a chave do provedor, não marca nada como pago, não cancela
a assinatura do cliente, não muda o modo do cadastro e não arquiva plano.

## 10. Passo a passo para o Gabriel ligar

Uma vez, na plataforma inteira. Antes, os requisitos do upstream (`docs/saas/cobranca.md`,
"Antes de começar"): endereço https público, envio de e-mail configurado e
`AI_CRED_AES_KEY`.

1. **Conta no Asaas.** Abra a conta de **sandbox** (testes) e, depois, a de produção, com
   o CNPJ da Time.
2. **Ligar a cobrança.** Painel › **Recursos opcionais** › **Cobrança dos seus clientes**.
   As empresas de hoje continuam isentas.
3. **Chave de teste pela tela.** **Cobrança** › **Conexão** › Asaas: cole a chave de
   sandbox (`$aact_hmlg_...`) e **Testar e conectar**. Se aparecer "Falta um passo", cadastre
   o aviso de pagamento no Asaas como o quadro mostra. A chave nunca passa pelo MCP.
4. **Planos pelo MCP.** `plataforma_garantir_planos` com os planos de verdade (preço em
   reais, dias de teste, pessoas, números, teto de IA, módulos, preço do Broadcast, frase,
   qual é o do cadastro) e os `pacotes_de_creditos`. Confira em `/precos`.
5. **Testar.** Uma empresa de teste com outro e-mail, o plano escolhido no cadastro,
   assinar e pagar no sandbox, comprar um pacote de crédito por Pix, e ver em Empresas do
   cadastro. A régua e os recados aparecem no zap da Time.
6. **Chave de produção.** De volta à **Conexão**, troque pela chave `$aact_prod_...`.
7. **Nota fiscal.** O sistema não emite. Ligue a emissão de nota de serviço no **painel do
   Asaas**, com o contador.
8. **Site da iamia.** Aponte os botões para `https://app.iamia.com.br/signup?plano=<slug>`
   ou leia `https://app.iamia.com.br/api/v1/publico/planos`.
9. **Cadastro aberto** (quando quiser): `/admin/cadastro`. Até lá, os pedidos esperam a
   aprovação da Time (o recado avisa).

## 11. Para quem mexe no código

### Onde o código do upstream foi tocado (marcado `FORK MIA`)

- `lib/modulos/liberacao.ts`: `moduloLiberado` e `modulosDaOrganizacao` somam o plano.
- `lib/cobranca/sincronizar.ts` (depois da releitura aplicada) e `lib/cobranca/troca.ts`
  (troca no teste): os módulos seguem o plano.
- `lib/cobranca/sinal.handler.ts`: o aviso do Asaas também relê as compras de crédito da
  empresa.
- `lib/cobranca/rodada.ts`: o aviso de 80% em porcentagem, sem dólar.
- `app/api/v1/cron/cobranca/route.ts`: a rodada da jornada depois da do upstream.
- `lib/agent-engine/edge/llm/orcamento.ts`: o teto do plano vale sem chave própria.
- `lib/ai/inbox-destino.ts`: a Central aceita `ref_kind` `plano`.
- `lib/crm-b2b/route-helpers.ts`, `app/app/people/layout.tsx`, `app/app/imports/layout.tsx`,
  `app/app/crm/page.tsx`, `app/app/layout.tsx`: Vendas B2B fora do plano.
- `components/auth/SignupForm.tsx`, `app/(public)/signup/page.tsx`, `lib/auth/schemas.ts`,
  `app/actions/auth/signUp.ts`: os cartões, o `?plano=` e o "o que a empresa faz".
- `app/actions/registration/decide.ts`: o e-mail para quem pediu.
- `components/cobranca/PainelDaAssinatura.tsx`, `components/cobranca/AcoesDaAssinatura.tsx`,
  `app/app/settings/billing/page.tsx`, `app/account-suspended/page.tsx`: sem dólar, a IA
  em %, os módulos e o crédito por Pix.
- `app/admin/(protected)/cobranca/page.tsx` e `components/admin/AdminSidebar.tsx`: o link
  da aba Planos para a página própria dos módulos (`/admin/cobranca/modulos-dos-planos`) e o
  item Empresas do cadastro. A aba não lê nada a mais nem repete o nome de plano nenhum ao lado
  da lista do upstream (o e2e dele acha o plano pelo nome).
- `lib/auth/public-paths.ts`: `/precos` e a rota pública.
- `lib/audit/actions.ts`, `lib/i18n/dicionario.ts`, `lib/mcp-plataforma/ferramentas.ts`,
  `lib/mcp-plataforma/operacoes.ts`, `lib/mcp-plataforma/ferramentas/plataforma.ts`.

Do fork (não do upstream), também tocados: o Broadcast (`app/api/v1/broadcasts/*`,
`app/api/v1/carteira/route.ts`, o worker e `components/broadcast/textos.ts`: o preço do
plano e a pausa), o e-mail marketing (`lib/email-marketing/motor.ts` e `rotulos.ts`) e o
`report-da-plataforma` (os recados).

### LGPD

Nenhuma tabela nova guarda dado do titular (contato): só ids de empresa, de plano e de
quem criou. O documento de quem paga vai direto ao Asaas. As cinco tabelas são só do
servidor (RLS ligada, sem política, `authenticated` e `anon` recebem permission denied).

### Provas

| arquivo | o que prova |
|---|---|
| `tests/invariants/jornada-de-assinatura.test.ts` | o banco: módulo pelo plano (desligado, isenta, B2B, sessão), a trava do plano assinado, seguir o plano sem repetir, a origem, a compra paga que lança uma vez, as tabelas só do servidor |
| `tests/unit/jornada-tudo-desligado.test.ts` | nada muda com a cobrança desligada |
| `tests/unit/planos-mia-regras.test.ts` | o catálogo, as conversas estimadas, o `?plano=`, a vitrine sem dólar, a situação, a régua e os recados |
| `tests/unit/rotina-pula-modulo-fora-do-plano.test.ts` | as rotinas do Broadcast e do e-mail |
| `tests/unit/compra-de-creditos-pelo-asaas.test.ts` | o Pix: quem compra, a cobrança avulsa, a releitura |
| `tests/unit/mcp-de-implantacao-cobranca.test.ts` | as nove ferramentas, a contagem (92) e o que o MCP não faz |
| `tests/unit/painel-da-assinatura.test.tsx` | a IA em %, o aviso de 80% e a parada de 100% |

### Lacunas conhecidas

- Desligar a cobrança depois de ligada não grava o "desligou" no histórico de cada
  empresa (a rodada da cobrança para junto). Não muda o efeito: a função do banco já
  devolve vazio.
- Crédito por Pix só pelo Asaas. Quem assina pela Stripe recarrega com a Time.
- A compra de teste **pela tela** contra o sandbox do Asaas de verdade não foi feita aqui
  (os testes usam um Asaas dublado); é o passo 5 da seção 10.
