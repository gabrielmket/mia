# Leads dos formulários da Meta (1.21.0-mia.60)

Os anúncios de **cadastro instantâneo** da Meta (o formulário que abre dentro do
Facebook e do Instagram) passam a entregar o lead direto no funil do CRM, do mesmo
jeito que uma fonte de webhook entrega: contato, negócio, respostas do formulário,
origem do anúncio e as automações de "lead criado".

Até a .59 o CRM só **contava** esses cadastros (coluna "Cadastros de formulário" na
tabela de campanhas); o lead em si ficava preso na Meta.

## Como fica para o cliente

1. O administrador da empresa abre **Configurações › Formulários da Meta**. A tela
   confere se o token (o mesmo de Configurações › Meta Ads) tem as permissões e
   diz exatamente qual falta e onde resolver.
2. Ele vê as Páginas que o token alcança e os formulários de cada uma, marca quais
   importar e para qual **funil e etapa** vai cada um.
3. Liga a chave **"Importar os leads dos formulários"** e escolhe quantos dias para
   trás buscar na primeira leitura (até 90, que é o que a Meta guarda).
4. A cada **5 minutos** o sistema busca os leads novos. Cada lead vira:
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

## Por que consulta periódica primeiro, e o webhook depois

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
  e o id do lead não é isso.
- **Tabelas novas (migration 9003):** `mia_leads_da_meta_config` (a chave por
  empresa), `mia_leads_da_meta_formularios` (o que importar e para onde, e a marca
  de leitura), `mia_leads_da_meta_leituras` (o histórico) e
  `mia_leads_da_meta_recebidos` (a deduplicação). RLS por empresa: gerente lê,
  só o servidor escreve. **Nenhuma guarda dado pessoal**: nome, telefone e
  respostas ficam em `contacts`, `crm_leads` e `webhook_lead_captures`, que já
  têm anonimização e exportação da LGPD.
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
| `pages_manage_metadata` | assinar o aviso em tempo real | só na fase 2 |

A proposta inicial era `leads_retrieval` + `pages_show_list` +
`pages_read_engagement` + `ads_read`. A documentação da Meta pede também
`pages_manage_ads` para ler formulários e leads e `ads_management` para os campos
do anúncio, então as duas entraram na lista. A tela confere tudo isso na hora.

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
5. No CRM da empresa: Configurações › Meta Ads › cole o token novo (a tabela de
   campanhas segue funcionando com ele).
6. Configurações › Formulários da Meta: escolha os formulários, o funil e a etapa,
   os dias de recuperação, ligue a chave e clique em **Ler agora**.

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

- Até cerca de 5 minutos de atraso entre o cadastro e o card.
- Mais de 5.000 leads num mesmo formulário em 7 dias: a leitura fica incompleta e
  aparece como erro no histórico.
- A conversão de volta para a Meta com o id do lead (API de conversões para CRM)
  ainda não sai; o dado já fica guardado para quando sair.
- Quando a leitura falha seguidas vezes (token vencido, permissão retirada), a
  falha aparece na tela e no histórico, mas **ninguém é avisado ativamente**. O
  próximo passo é mandar esse aviso ao grupo do time pelo número de avisos.
- Respostas de termos personalizados (as caixinhas de consentimento extras do
  formulário) não são importadas nesta versão.
