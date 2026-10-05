# Leads dos formulários da Meta (1.21.0-mia.60, separado por empresa na .61, em tempo real na .62, Páginas pela conta própria na .64)

Os anúncios de **cadastro instantâneo** da Meta (o formulário que abre dentro do
Facebook e do Instagram) passam a entregar o lead direto no funil do CRM, do mesmo
jeito que uma fonte de webhook entrega: contato, negócio, respostas do formulário,
origem do anúncio e as automações de "lead criado".

Até a .59 o CRM só **contava** esses cadastros (coluna "Cadastros de formulário" na
tabela de campanhas); o lead em si ficava preso na Meta.

## Cada Página é de uma empresa (.61)

Na .60 a tela listava **todas** as Páginas que o token alcança. O token que existe é
o da agência (o usuário do sistema do Gerenciador da Time Company), e ele enxerga as
Páginas de vários clientes: qualquer empresa via, e podia
importar, a Página das outras. Da .61 em diante:

- cada Página tem **um dono só** (`mia_paginas_da_meta`, migration 9004);
- quem define o dono é o **dono da plataforma**, em **/admin › Páginas da Meta**;
- a empresa só vê e só configura formulário das Páginas dela; **Página sem dono não
  aparece** para empresa nenhuma;
- **no banco, não só na tela**: um gatilho recusa formulário ativo de Página que não
  é da empresa (vale para qualquer caminho, inclusive o service role das rotas e da
  rotina), e outro desliga na hora os formulários das outras empresas quando a Página
  ganha, troca ou perde o dono, com o motivo à vista na tela delas. O que a .60 deixou
  ligado em Página sem dono foi desligado no deploy da .61 com o mesmo motivo;
- ao ligar um formulário, a rota confere **na Meta** que ele pertence àquela Página
  (sem isso, o id de um formulário do vizinho colado ao lado da Página certa passaria).

### Com conta própria, a empresa escolhe as Páginas (.64)

Até a .63 só o dono da plataforma atribuía Página, mesmo para a empresa que tinha
conectado a própria conta da Meta. Da .64 em diante (migration 9008):

- **empresa com conexão própria** (a dela em Configurações › Meta Ads › Contas de
  anúncio): a aba Formulários de leads mostra o quadro **Páginas desta empresa**, com
  as Páginas que o token DELA alcança. O administrador marca uma ou várias. Marcar
  confere na Meta, na hora, que o token alcança a Página e grava o dono com a origem
  `conta_propria`; desmarcar (com confirmação) solta a Página e desliga os
  formulários dela com o motivo `pagina_solta`, numa transação só
  (`fn_mia_soltar_pagina_da_meta`);
- **Página já ligada a outra empresa**: aparece travada, com "Esta Página já está
  ligada a outra empresa da plataforma. Fale com o suporte.", sem dizer qual. No
  banco, um gatilho recusa assumir a Página de outra empresa (e a chave da 9004
  recusa a segunda linha), venha a escrita de onde vier;
- **empresa sem conexão própria**: como na .61, só o dono da plataforma atribui;
- **a conta da agência colada numa empresa não conta como própria**: se o token da
  empresa for o mesmo da conexão da plataforma, ou de o mesmo usuário do sistema
  (conferido pelo `me` da Meta), a escolha não abre, porque ele alcança as Páginas
  de todos os clientes. Sem conseguir conferir, também não abre (falha fechado);
- a Página que a plataforma atribuiu aparece marcada e travada: quem solta é o
  suporte;
- em **/admin › Páginas da Meta** cada dono mostra a origem (atribuída pela
  plataforma ou assumida pela empresa), e daqui se transfere ou corrige qualquer
  Página; o que a plataforma grava é sempre da plataforma;
- os formulários da aba vêm **agrupados por Página**.

Código: `lib/leads-da-meta/autoatendimento.ts` e a rota
`/api/v1/leads-da-meta/paginas/escolha` (GET, POST, DELETE).

### De onde vem o token de cada empresa

O token de leitura é o de **Configurações › Meta Ads** (`ad_insights_connections`,
plataforma `meta_ads`). Hoje só a Time Company tem um. Uma empresa cliente sem token
próprio **não conseguia** ler os leads da Página dela: a rotina parava em `sem_conexao`.

Na .61 existe a **conexão da plataforma** (`mia_meta_conexao_da_plataforma`, escolhida
em /admin › Páginas da Meta): a empresa cuja conexão de Meta Ads é emprestada. Para
cada empresa, a rotina procura o token de cada Página **dela**:

1. no token da própria empresa, se ela tiver um;
2. senão, no token da plataforma.

O token emprestado nunca lista nem lê Página que não seja da empresa que está lendo:
tudo parte da lista de Páginas da empresa, e o token só serve para achar o token de
cada uma (`lib/leads-da-meta/paginas.ts`).

## Como fica para o cliente

1. O administrador da empresa abre **Configurações › Meta Ads › Formulários de
   leads** (até a .60 era o item próprio "Formulários da Meta"; o endereço antigo
   redireciona para a aba). A aba confere se o token tem as permissões e diz
   exatamente qual falta e onde resolver.
2. Ele vê **as Páginas da empresa** e os formulários de cada uma, marca quais
   importar e para qual **funil e etapa** vai cada um. Sem Página atribuída, a aba
   diz que a Página é atribuída pela plataforma e nem consulta a Meta. Com a
   própria conta da Meta conectada (.64), ele mesmo marca as Páginas no quadro
   **Páginas desta empresa**.
3. Liga a chave **"Importar os leads dos formulários"** e escolhe quantos dias para
   trás buscar na primeira leitura (até 90, que é o que a Meta guarda).
4. Com o **tempo real** ligado (.62), a Meta avisa na hora em que alguém preenche e
   o lead entra em segundos. A cada **5 minutos** o sistema também busca os leads
   novos, como garantia do que o aviso perder. Cada lead vira:
   - contato (acha pelo telefone ou pelo e-mail; não duplica);
   - negócio na etapa escolhida, com as etiquetas **Meta_ads** e **Formulario_Meta**
     no card (a segunda só existe aqui: quem veio do clique para o WhatsApp leva só
     `Meta_ads`, e é por ela que uma régua de follow-up aborda só quem preencheu);
   - as respostas do formulário com as **perguntas originais** (a IA do agente
     lê isso e sabe que a pessoa "preencheu o formulário X");
   - a origem: campanha, conjunto, anúncio, formulário e Página.
   As automações e o follow-up de "lead criado" disparam como em qualquer captação.
5. Se a mesma pessoa preencher de novo e já tiver negócio aberto no mesmo funil,
   **não nasce card novo**: o negócio aberto recebe uma anotação.
6. A tela mostra a **última leitura** de cada formulário e o histórico: sucesso
   (quantos novos), sem novos, ou erro com o motivo e o que fazer. O botão
   **"Ler agora"** busca na hora, para testar.

## Por que consulta periódica primeiro, e o webhook depois (e os dois juntos na .62)

| | Consulta a cada 5 min (agora) | Aviso em tempo real / webhook `leadgen` (depois) |
|---|---|---|
| Atraso | até 5 min | segundos |
| O que exige na Meta | o token da empresa com as permissões de leads e a Página atribuída ao usuário do sistema | tudo isso **mais**: produto Webhooks configurado no app (endereço público, token de verificação, assinatura), assinatura de **cada** Página (`subscribed_apps`, com `pages_manage_metadata`), app publicado; para Páginas de fora do nosso negócio, possivelmente análise do app |
| Quando algo quebra | a próxima leitura dá erro e a tela mostra o motivo | a Meta simplesmente para de avisar, e ninguém vê |
| Servidor fora do ar por um dia | a leitura seguinte busca o que faltou (90 dias de folga) | o aviso se perde; precisaria de uma varredura de qualquer jeito |

Para um SDR que responde por WhatsApp, 5 minutos não mudam o resultado, e a
consulta não depende de nada além do token que a empresa já cola. O webhook entra
como **acelerador**, com a consulta ficando de rede de segurança (a mesma rotina
deduplica pelo id do lead, então os dois caminhos podem rodar juntos).

É o que a .62 fez: os dois rodam juntos, e a coluna da direita deixou de ser um
risco calado. Quando a Meta para de avisar, a consulta continua trazendo o lead; a
tela mostra quando chegou o último lead pelo aviso; e quando a leitura falha três
vezes seguidas, os administradores são avisados (ver abaixo).

## Tempo real (.62)

```
alguém preenche ─► Meta ─► POST /api/v1/webhooks/leads-da-meta (campo leadgen)
                              │ HMAC do corpo com o App Secret da instalação
                              ▼
                   receberAvisoDeLead (lib/leads-da-meta/tempo-real.ts)
                              │ Página → empresa por mia_paginas_da_meta (9004);
                              │ sem dono: ignorado. Formulário ligado na empresa
                              │ dona, naquela Página; senão: ignorado.
                              │ Já recebido pela leitura? para aqui, sem chamar a Meta.
                              ▼
                   GET /{leadgen_id} com o token da Página desta empresa
                              ▼
                   gravarLeadDaMeta, a MESMA da leitura (via = tempo_real)
```

- **A assinatura da Página.** A Meta só avisa as Páginas assinadas no app
  (`POST /{page-id}/subscribed_apps` com `subscribed_fields=leadgen`). O sistema
  assina ao **ligar o formulário** e, para o formulário ligado antes da .62, na
  próxima leitura. A recusa é revista a cada 6 horas e a assinatura aceita é
  conferida uma vez por dia. Antes de escrever, o sistema lê o que o app já
  assina naquela Página, para não apagar outro campo (`lib/plataformas-de-anuncio/meta/leads.ts`).
- **A recusa aparece na tela**, no formulário: "Tempo real desligado: a Meta
  recusou assinar a Página por falta da permissão `pages_manage_metadata`...",
  com o botão **Ligar o tempo real** para tentar de novo. Os leads continuam
  entrando pela leitura; nada para.
- **O que prova que funciona** não é a assinatura aceita, é o aviso chegando: a
  tela mostra "Último lead pelo aviso da Meta" com a hora.
- **Dedup entre os dois caminhos:** a mesma chave do lead (`mia_leads_da_meta_recebidos`,
  hash do id) e o mesmo `external_id` do negócio. Quem chega primeiro grava;
  `recebidos.via` diz qual foi (`consulta` ou `tempo_real`). O aviso que chega
  depois da leitura nem chama a Meta; a leitura que chega depois do aviso acha o
  lead e não grava de novo; a Meta reentregando o mesmo aviso também não duplica.
- **A mesma URL de app do WhatsApp:** o app é o mesmo (`platform_meta_app`, em
  /admin), então o App Secret e o token de verificação são os mesmos. O token de
  leitura (o do usuário do sistema) tem de ser gerado para **esse** app: a Meta
  assina a entrega com o segredo do app do token, e segredo de outro app vira
  `401` (a recusa fica no log como "assinatura recusada").

## Telefone em pergunta própria (.62)

Formulários como o da Construtora Delta não usam o campo padrão `phone_number`: o celular é
uma pergunta criada por eles, e a chave que a Meta devolve é
`celular:_(ddd_+_número)`. Até a .61 esse lead entrava sem telefone.

- **Automático:** o campo padrão da Meta primeiro; senão, a pergunta cuja chave ou
  texto fala em celular, telefone, WhatsApp, fone ou zap. Só vale a resposta que
  vira telefone (DDD e número): "Melhor horário para ligar no seu telefone?" com a
  resposta "de manhã" é pulada, e o sistema tenta a próxima. Nome e e-mail seguem
  a mesma regra ("Qual é o seu nome?" é nome; "Nome da empresa" não é).
- **Manual:** no formulário, em "Quais perguntas são o telefone, o nome e o
  e-mail", o administrador escolhe a pergunta de cada um. A tela mostra o que o
  automático está usando. A escolha vence o automático; com resposta inválida,
  cai no automático em vez de deixar o contato sem telefone.
- **Normalização:** E.164 brasileiro com o nono dígito no celular, a mesma de todo
  o sistema (`normalizePhoneBR` + `canonicalPhoneBR`). O zero de longa distância
  da frente ("011 9...") sai.
- Guarda-se a **chave** da pergunta (`campo_telefone`, `campo_nome`,
  `campo_email`), nunca a resposta. Vale para os leads que chegarem depois de salvar.

## Aviso quando a leitura para (.62)

- **Três leituras com erro seguidas** (15 minutos) abrem **um** aviso na Central
  de avisos, crítico, com o motivo em linguagem simples, o que fazer e a garantia
  de que os leads ficam guardados na Meta por até 90 dias e entram sozinhos
  quando a leitura voltar. Cada **administrador** da empresa recebe um push no
  celular (um só por rodada, mesmo que mais de um formulário tenha parado).
- O motivo que passa sozinho (a Meta fora do ar, cota, gravação que caiu) espera
  **12 seguidas** (1 hora) antes de avisar.
- **Uma vez por problema:** enquanto o motivo for o mesmo, ninguém é avisado de
  novo (`aviso_de_falha_motivo` e um índice único na Central). Motivo diferente é
  outro problema: o aviso antigo fecha e um novo abre.
- **Fecha sozinho** na primeira leitura que dá certo, e também quando o formulário
  ou a importação é desligada, ou quando a Página muda de dono.
- Empresa que lê pela conexão da plataforma e para por token ou permissão: o aviso
  manda falar com o suporte, porque o token não é dela.
- O botão do aviso leva à aba dos formulários (só para admin, que é quem entra lá).

## O caminho técnico

- **Leitura na Meta** (`lib/plataformas-de-anuncio/meta/leads.ts`, API v22):
  `/me/permissions` (diagnóstico), `/me/accounts` (Páginas e o token de cada
  Página), `/{pagina}/leadgen_forms` (formulários), `/{formulario}/leads` com
  filtro por `time_created` (os leads). O token vai no cabeçalho, nunca na URL.
- **Rotina** (`app/api/v1/cron/leads-da-meta`, a cada 5 min no `scheduler`):
  para cada empresa com a chave ligada, cada formulário ativo lê a janela
  `[última leitura − 15 min, agora]` (no máximo 7 dias por vez, até alcançar o
  presente), grava do mais antigo para o mais novo e só avança a marca de
  leitura quando tudo deu certo. Cada leitura vira uma linha no histórico.
- **Gravação pela mesma via da fonte de webhook** (`lib/leads-da-meta/gravar.ts`):
  `mapInboundPayload` → contato por telefone (ou e-mail) → `createLeadHandler`
  (evento `lead.created`: automações, follow-up, atividade, auditoria) →
  `registrarCaptacao` em `webhook_lead_captures` (tela de captações, LGPD, IA) →
  `kickLocalPipeline`. Duas diferenças declaradas em relação à rota do webhook:
  cria contato também quando só veio e-mail, e não abre negócio duplicado.
- **Deduplicação:** pelo id do lead da Meta (`mia_leads_da_meta_recebidos`, único
  por empresa, e `crm_leads.external_id = leadgen:<id>` com o índice único que já
  existe); a pessoa, por telefone e e-mail.
- **Atribuição:** contato (primeiro toque) e negócio recebem `ad_platform`,
  `ad_id`, `ad_name`, `adset_id`, `adset_name`, `campaign_id`, `campaign_name`,
  `meta_form_id`, `meta_form_name`, `meta_page_id` e `meta_lead_id`. A ficha do
  contato já resolve o anúncio pelo `ad_id`. O `ad_source_id` fica vazio **de
  propósito**: hoje ele é enviado à Meta como identificador de clique do WhatsApp,
  e o id do lead não é isso. É o `meta_lead_id` do **negócio** que volta para a
  Meta como identidade do lead de formulário ([`conversoes-da-meta.md`](conversoes-da-meta.md)).
- **Dono de cada Página (migration 9004):** `mia_paginas_da_meta` (page_id é a
  chave: uma Página, um dono) e `mia_meta_conexao_da_plataforma` (linha única, zero
  policies). Gatilhos `trg_mia_formulario_da_meta_so_da_pagina_da_empresa` e
  `trg_mia_pagina_da_meta_mudou_de_dono`. Provado com o papel sem RLS em
  `tests/invariants/paginas-da-meta-por-empresa.test.ts`.
- **Etiqueta do card (.61):** o card nasce com `Meta_ads` e `Formulario_Meta`. A
  segunda só existe aqui (o clique para o WhatsApp leva só `Meta_ads`) e é por ela
  que a régua de follow-up aborda só quem preencheu o formulário. O texto é
  contrato: renomear desliga a régua em silêncio.
- **Tabelas novas (migration 9003):** `mia_leads_da_meta_config` (a chave por
  empresa), `mia_leads_da_meta_formularios` (o que importar e para onde, e a marca
  de leitura), `mia_leads_da_meta_leituras` (o histórico) e
  `mia_leads_da_meta_recebidos` (a deduplicação). RLS por empresa: gerente lê,
  só o servidor escreve. **Nenhuma guarda dado pessoal**: nome, telefone e
  respostas ficam em `contacts`, `crm_leads` e `webhook_lead_captures`, que já
  têm anonimização e exportação da LGPD.
- **Colunas da .62 (migration 9005):** em `mia_leads_da_meta_formularios`, o
  tempo real (`tempo_real`, `tempo_real_motivo`, `tempo_real_detalhe`,
  `tempo_real_em`, `ultimo_aviso_da_meta_em`), a pergunta escolhida
  (`campo_telefone`, `campo_nome`, `campo_email`) e o aviso (`falhas_seguidas`,
  `aviso_de_falha_motivo`, `aviso_de_falha_em`); `mia_leads_da_meta_recebidos.via`;
  e o índice `uq_mia_aviso_de_leitura_da_meta_aberto` em `agent_inbox_items`.
- **Módulo vendável pronto:** `LEADS_DA_META_E_MODULO_VENDAVEL` em
  `lib/leads-da-meta/modulo.ts`. Hoje `false`: toda empresa pode ligar. Virando
  `true`, a tela, a API e a rotina passam a exigir a liberação do módulo
  `leads_da_meta` no painel da plataforma, e ele aparece na lista de módulos.

## O que o Gabriel faz na Meta

### Permissões do token

| permissão | para quê | situação |
|---|---|---|
| `leads_retrieval` | ler os leads | **obrigatória** (nova) |
| `pages_show_list` | listar as Páginas atribuídas | **obrigatória** (nova) |
| `pages_read_engagement` | ler dados da Página | **obrigatória** (nova) |
| `pages_manage_ads` | listar os formulários da Página e ler os leads com os dados do anúncio | **obrigatória** (nova) |
| `ads_read` | tabela de campanhas (já usada) | manter |
| `ads_management` | a Meta pede para devolver anúncio, conjunto e campanha de cada lead | recomendada; sem ela o lead entra, mas sem a origem do anúncio |
| `pages_manage_metadata` | assinar a Página no app para o aviso em tempo real | **recomendada (.62)**; sem ela o lead entra só pela leitura a cada 5 min |

A proposta inicial era `leads_retrieval` + `pages_show_list` +
`pages_read_engagement` + `ads_read`. A documentação da Meta pede também
`pages_manage_ads` para ler formulários e leads e `ads_management` para os campos
do anúncio, então as duas entraram na lista. A tela confere tudo isso na hora.

### Tempo real: o que ligar no painel do app (.62, uma vez só)

No **developers.facebook.com › Meus apps › o app da plataforma** (o MESMO do
WhatsApp, cujo App Secret está em /admin):

1. **Webhooks** (menu do produto) › no seletor de objeto, escolha **Página** (Page),
   não "WhatsApp Business Account".
2. **Assinar este objeto** (Subscribe to this object):
   - URL de retorno: `https://crm.timecompany.com.br/api/v1/webhooks/leads-da-meta`
   - Token de verificação: o **mesmo** do webhook do WhatsApp (o que está em
     /admin › app da Meta). A Meta confere na hora; se recusar, o token não bate.
3. Na lista de campos da Página, **ligue `leadgen`** (Subscribe). Os outros campos
   da Página ficam desligados.
4. O app precisa estar **publicado** (modo Live); em modo de desenvolvimento a
   Meta só avisa leads de quem tem papel no app.
5. **Gere o token de novo** com `pages_manage_metadata` marcada (permissão nova
   sempre pede token novo, passo A.4 abaixo) e cole em Configurações › Meta Ads da
   empresa da conexão. O token tem de ser do **mesmo app** do passo 1.
6. Confira em **Acesso a leads** da Página (Gerenciador de Negócios › Integrações)
   que o **app** está liberado na aba CRMs (passo A.3 abaixo).
7. No CRM da empresa: Configurações › Meta Ads › Formulários de leads › no
   formulário ligado, **Ligar o tempo real** (ou salve o formulário de novo; a
   rotina também tenta sozinha na próxima leitura).
8. Teste: Ferramenta de teste de anúncios de cadastro › criar lead › em segundos o
   card aparece e o formulário mostra "Último lead pelo aviso da Meta".

Se a Meta recusar a assinatura por outro motivo que não permissão, a tela mostra a
frase; a URL do passo 2 responde `401` a qualquer entrega que não venha assinada
com o App Secret da instalação.

### A. Página do nosso Gerenciador de Negócios (Time Company)

1. business.facebook.com › **Configurações do negócio** › Usuários › **Usuários do
   sistema** › o usuário que já gera o token do Meta Ads.
2. **Atribuir ativos** › Páginas › a Página do cliente › acesso de **anúncios e de
   leads** (se a tela não separar, "Controle total").
3. Configurações do negócio › Integrações › **Acesso a leads** › a Página: se o
   acesso estiver personalizado, inclua o **usuário do sistema** (aba Usuários) e o
   **nosso app** (aba CRMs). Sem personalização, todo administrador da Página já lê.
4. De volta ao usuário do sistema › **Gerar novo token** › o nosso app › validade
   **Nunca** › marque as permissões da tabela acima.
   Permissão nova **sempre** pede token novo; Página nova atribuída ao mesmo
   usuário **não** pede.
5. No CRM da Time Company: Configurações › Meta Ads › cole o token novo (a tabela
   de campanhas segue funcionando com ele).
6. **/admin › Páginas da Meta** (.61): escolha a Time Company como conexão da
   plataforma (uma vez só) e atribua a Página à empresa dona dela.
7. No CRM da empresa: Configurações › Meta Ads › **Formulários de leads**: escolha
   os formulários, o funil e a etapa, os dias de recuperação, ligue a chave e clique
   em **Ler agora**. A empresa não precisa de token próprio.

Para testar sem anúncio no ar: **Ferramenta de teste de anúncios de cadastro**
(developers.facebook.com/tools/lead-ads-testing) › Página e formulário › criar
lead › no CRM, "Ler agora".

### B. Página que está no Gerenciador do cliente (acesso de parceiro)

1. **O cliente**, no Gerenciador dele: Configurações do negócio › **Parceiros** ›
   adicionar a Time Company pelo ID do nosso Gerenciador › compartilhar a
   **Página** com acesso de anúncios e de leads (e a conta de anúncios, se ainda
   não compartilhou).
2. **O cliente**: Integrações › **Acesso a leads** › a Página › dar acesso à Time
   Company (parceiro) e, na aba CRMs, ao nosso app. É o passo mais esquecido: sem
   ele a Meta recusa a leitura mesmo com a Página compartilhada, e a tela vai
   mostrar "sem permissão para ler os leads deste formulário".
3. **Nós**: a Página aparece em Configurações do negócio › Contas › Páginas; faça o
   passo A.2 (atribuir ao usuário do sistema). O token não muda se já tiver as
   permissões.
4. Isso deve funcionar sem análise do app, porque o token é do nosso negócio
   lendo ativos compartilhados com ele. **A confirmar na primeira empresa real**:
   se a Meta responder pedindo "acesso avançado" para `leads_retrieval`, aí o app
   precisa passar pela análise da Meta.

## Limites desta versão

- Sem o tempo real ligado (sem `pages_manage_metadata` ou sem o campo `leadgen`
  no painel do app), até cerca de 5 minutos de atraso entre o cadastro e o card.
- Mais de 5.000 leads num mesmo formulário em 7 dias: a leitura fica incompleta e
  aparece como erro no histórico.
- A conversão de volta para a Meta com o id do lead (API de conversões para CRM)
  sai desde a migration 9017, com a chave "Leads de formulário da Meta voltam para a
  Meta" ligada em Configurações › Conversões. Vem desligada, e ligar não envia o
  passado: ver [`conversoes-da-meta.md`](conversoes-da-meta.md).
- Respostas de termos personalizados (as caixinhas de consentimento extras do
  formulário) não são importadas nesta versão.
