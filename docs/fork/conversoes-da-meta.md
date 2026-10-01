# Conversões da Meta por etapa do funil (migration 9017)

Até aqui a Meta só ficava sabendo da **compra** (o negócio ganho), e só de quem veio
de clique em anúncio para o WhatsApp. O Google Ads já tinha a régua inteira: cada
etapa do funil podia avisar uma conversão. Esta peça dá à Meta a mesma régua, faz o
lead de formulário voltar para a Meta, e dá à Meta um diagnóstico, que só o Google
tinha.

Quanto mais cedo o sinal chega, mais rápido o anúncio aprende quem vira cliente. Uma
clínica que só avisa a venda dá à Meta um punhado de sinais por mês; a mesma clínica
avisando "qualificou" e "agendou" dá dezenas.

## O que a peça faz

| o quê | onde aparece |
|---|---|
| **Regras por etapa**: cada etapa aberta do funil pode avisar um evento à Meta (evento, canal de entrada, valor) | Configurações › Conversões › "O que cada etapa do funil informa à Meta" |
| **Leads de formulário voltam para a Meta**: uma chave; ligada, as etapas com regra e a venda também vão para o lead que veio de formulário | Configurações › Conversões, logo abaixo das regras |
| **Diagnóstico da Meta**: botão "Testar conexão" | Configurações › Conversões › aba Diagnóstico |
| **Histórico de envios** das duas plataformas, com a situação pelo motivo e o "Reenviar" só onde resolve | Configurações › Conversões › aba Histórico de envios |
| **O que cada plataforma ficou sabendo** deste negócio | cartão aberto do negócio › Origem e atribuição |
| **Seis ferramentas no MCP de plataforma** | `lib/mcp-plataforma/ferramentas/conversoes.ts` |

## As travas

São as mesmas do Google (migration 0436 do upstream), com as duas que a Meta pede a mais.

1. **Uma vez por negócio e evento.** Sair e voltar à etapa não duplica. O mesmo
   evento ligado em duas etapas só sai na primeira em que o negócio entrar, e a tela
   **avisa** ("repetido: não envia de novo para o mesmo negócio"), sem bloquear.
2. **Ligar uma regra não envia o passado.** Vale para os negócios que entrarem nas
   etapas a partir dali. Quem já está na etapa não é enviado. Desligar e religar
   conta como ligar de novo.
3. **O reenvio usa o retrato do primeiro envio**: a data em que o negócio entrou na
   etapa e o valor daquele dia, e não a regra de agora.
4. **Canal de entrada**: todos, só WhatsApp (o negócio tem conversa) ou só fora do
   WhatsApp.
5. **Ganho e perda não entram na régua.** Ganho é a compra. Perda não é conversão.
6. **A Meta recusa evento com mais de 7 dias.** Passou disso, não há reenvio que
   resolva, e a tela diz isso em vez de oferecer o botão.
7. **Só há o que informar quando o negócio veio da Meta**: clique em anúncio para o
   WhatsApp ou, com a chave ligada, formulário.

### O valor do evento

Opcional, e nasce **sem valor** até alguém configurar:

- **sem valor**: a Meta recebe o evento, e não aprende quanto ele vale;
- **valor fixo**, em reais: quanto vale, em média, aquele passo (um agendamento);
- **valor do negócio**: o valor do negócio na hora. Negócio sem valor envia o evento
  de etapa **sem valor** (zero nunca sai: ensinaria que o evento não vale nada).

A **compra** continua exigindo valor, como sempre.

### O código de teste e a chave de vendas

- Com o **código de teste** preenchido na conexão, os eventos de etapa também vão
  marcados como teste. A Meta os mostra na ferramenta de teste, eles não contam para
  a otimização, e no histórico ficam como "não enviado · conexão ou modo de teste",
  para saírem de verdade depois de o código ser apagado.
- A chave **"Reportar vendas automaticamente"** do cartão da Meta pausa **tudo**, a
  compra e as etapas. É o comportamento do Google hoje: lá a chave "Enviar conversões
  para o Google Ads" também pausa as etapas, e o que os eventos de etapa não exigem é
  só a ação de conversão **da venda**. O quadro "Como a Meta vai enxergar este funil"
  avisa quando o envio está pausado.

## Os eventos

A lista mora num lugar só: `lib/conversoes-meta/eventos.ts`. O banco e o histórico
guardam a **chave** (`lead_qualificado`); o nome técnico que viaja para a Meta
(`QualifiedLead`) só existe naquela lista. Trocar um nome técnico é uma linha, e não
reenvia o que já foi.

| evento na tela | chave | nome técnico | está na lista da Meta para anúncio de WhatsApp? |
|---|---|---|---|
| Novo lead | `novo_lead` | `LeadSubmitted` | sim |
| Lead qualificado | `lead_qualificado` | `QualifiedLead` | sim |
| Agendou | `agendou` | `Schedule` | **não** |
| Pediu orçamento ou proposta | `pediu_orcamento` | `SubmitApplication` | **não** |
| Iniciou a compra | `iniciou_compra` | `InitiateCheckout` | sim |
| Compra (o negócio ganho) | não é regra de etapa | `Purchase` | sim |

### O que a documentação da Meta diz (conferido em 01/10/2026)

**Clique em anúncio para o WhatsApp** usa a API de conversões para mensagens de
negócio: `action_source: business_messaging`, `messaging_channel: whatsapp`,
identidade pelo `ctwa_clid`. A página publica uma lista **fechada** de eventos:

> Purchase, LeadSubmitted, InitiateCheckout, AddToCart, ViewContent, OrderCreated,
> OrderShipped, OrderDelivered, OrderCanceled, OrderReturned, CartAbandoned,
> QualifiedLead, RatingProvided, ReviewProvided

Fonte: <https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/>

Dos cinco eventos da casa, três estão nessa lista. **"Agendou" e "Pediu orçamento ou
proposta" não têm evento nela.** O protótipo usava `Schedule` e `SubmitApplication`,
que são eventos padrão da API de conversões geral (a de site e aplicativo), e não
desta porta. Eles foram mantidos com esses nomes, marcados como fora da lista, e a
tela avisa em cada etapa que os usa: "Evento fora da lista da Meta para anúncio de
WhatsApp: pode ser recusado ou não servir para otimizar. Confira com o código de
teste." O que a Meta responder aparece no histórico: aceito, ou recusado com a frase
dela. **Só uma conta real diz qual dos dois acontece.**

Sobre o valor, a página da Meta só mostra o exemplo da compra, com valor e moeda, e
não diz o que cada evento exige. Que evento que não é compra pode ir sem
`custom_data` vem da documentação da AWS para a mesma API ("Non-purchase event types
such as LeadSubmitted do not require custom_data"), que também diz que nome de evento
não reconhecido é um dos motivos de recusa da Meta:
<https://docs.aws.amazon.com/social-messaging/latest/userguide/conversions-api.html>.
É fonte de terceiro, e por isso o item 1 da lista de testes com conta real, mais
abaixo, é o que decide.

**Lead de formulário** usa outra porta, a API de conversões para CRM:
`action_source: system_generated`, `custom_data.event_source: crm`,
`custom_data.lead_event_source: <nome do CRM>`, identidade pelo `user_data.lead_id`
(o `leadgen_id` do formulário, 15 a 17 dígitos, **sem hash**). O nome do evento é
texto livre ("a etapa que você usa no CRM"): os mesmos nomes servem.

Fonte: <https://developers.facebook.com/docs/marketing-api/conversions-api/conversion-leads-integration/payload-specification>

**Nas duas portas**, o evento pode ter no máximo 7 dias; mais velho que isso a Meta
recusa a requisição inteira.

Fonte: <https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event>

O `lead_id` vai como **texto**: com até 17 dígitos ele passa de 2^53, e como número
do JavaScript perderia os últimos dígitos.

## Leads de formulário voltam para a Meta

O id do lead do formulário já era guardado na origem do negócio desde a migration 9003
(`crm_leads.source_metadata.meta_lead_id`); a Meta nunca ficava sabendo o que tinha
acontecido com ele. A chave mora em `mia_conversoes_meta_config`:

- **desligada por padrão.** Toda empresa que existe chega aqui sem linha, e ausente
  é desligada;
- **ligada**, os eventos de etapa com regra ligada **e a venda** vão para o lead de
  formulário pela porta do CRM, mesmo sem clique em anúncio de WhatsApp;
- **ligar não envia o passado**: o banco carimba quando a chave foi ligada, e só o
  que acontecer depois é informado;
- o **clique vence** o formulário: quem tem os dois vai pela porta de mensagens;
- **contato anonimizado** não volta para a Meta pelo id de um formulário antigo.

Saem para a Meta o identificador do lead, o evento, o valor e o telefone e o e-mail do
contato com hash. A tela diz isso e pede que a chave só seja ligada se a política de
privacidade do cliente cobrir esse uso.

A **venda de quem veio de clique** continua sendo do consumidor de venda do upstream.
O nosso sai de cena na hora em que o contato tem clique: uma venda, um caminho, uma
linha `Purchase` no livro-razão.

## O diagnóstico

"A Meta está recebendo?", em seis conferências. As três primeiras perguntam à própria
Meta, e por isso o diagnóstico só roda quando alguém clica em "Testar conexão":

| conferência | de onde vem |
|---|---|
| token aceito | a Meta, agora |
| destino de conversões encontrado | a Meta, agora |
| permissão de envio | a Meta, agora, e o histórico |
| último envio aceito há quanto tempo | o histórico de envios |
| eventos recusados nos últimos 7 dias, com o motivo e o atalho para o histórico | o histórico de envios |
| modo de teste ligado | a conexão |

São três **leituras** na Meta. Nenhum evento é enviado por um diagnóstico, e o token
não aparece na resposta nem em log.

**A permissão de envio é inferência, e a tela não finge o contrário.** A Meta não diz
"este token pode enviar para este destino" numa leitura. O que dá para ler é a lista
de permissões do token, e um token gerado dentro do próprio destino de conversões
envia sem aparecer nela. Por isso: um envio **aceito** nos últimos 7 dias conta mais
que a lista (se a Meta aceitou, o token pode); sem essa evidência e sem a permissão
listada, o item fica em **atenção**, com a instrução de conferir pelo código de teste,
e não em vermelho.

## O histórico de envios

Uma linha por negócio e evento, das duas plataformas, com sete situações:

| situação | quando | Reenviar |
|---|---|---|
| Enviado | a plataforma aceitou | não |
| Aguardando | na fila, ou a plataforma ainda está processando | só quando a plataforma demorou mais de 24 horas |
| Recusado pela plataforma | com o motivo que ela deu | sim, até 7 dias na Meta |
| Não enviado · sem clique de anúncio | o lead de formulário com a chave desligada | não |
| Não enviado · sem valor | compra sem valor preenchido | sim, depois de preencher o valor |
| Não enviado · anterior à regra | o movimento foi antes de a regra (ou a chave) ser ligada | não |
| Não enviado · conexão ou modo de teste | sem conexão, pausada, incompleta, ou em teste | sim, depois de consertar a conexão |

A sétima não estava no protótipo: o livro-razão já tinha esses motivos, e uma linha
sem situação sumiria dos filtros.

**Negócio orgânico não aparece aqui.** Um negócio que não veio de anúncio nem de
formulário e entra numa etapa com regra não é uma conversão que deixou de ser
informada: não havia o que informar. Gravar uma linha para cada um encheria o
histórico de ruído, que é o motivo de o upstream também não gravar. O cartão do
negócio diz isso na seção Origem ("Nada foi informado à Meta: este negócio não veio de
um anúncio desta plataforma").

## Como está montado

```
negócio muda de etapa ─► event_log (lead.stage_changed)
                              │
        ┌─────────────────────┼─────────────────────────┐
        ▼                     ▼                         ▼
 venda (upstream)     etapa do Google (upstream)   etapa da Meta e venda do
 envio.handler.ts     qualificacao.handler.ts      lead de formulário (NOSSO)
                                                   lib/conversoes-meta/etapa.handler.ts
        └─────────────────────┼─────────────────────────┘
                              ▼
                 ad_conversion_dispatches (o livro-razão, do upstream)
                 uma linha por organização + negócio + evento
```

- **O schema é nosso, ao lado** (migration `9017`): `mia_conversoes_meta_regras` e
  `mia_conversoes_meta_config`, com RLS como as outras `mia_*` (gerente lê, só o
  servidor escreve), e `fn_mia_solicitar_reenvio_conversao_meta`. Nenhuma tabela do
  upstream muda.
- **O livro-razão é o do upstream**, sem mudança de schema. A chave dos eventos de
  etapa da Meta é `Meta:<evento>` (por evento, e não por etapa: é o que faz o
  repetido não duplicar). A venda do lead de formulário usa `Purchase`, a mesma
  chave da venda de clique.
- **O consumidor é nosso**, ao lado dos dois do upstream, escutando os mesmos
  eventos. O reenvio de um evento de etapa tem tipo próprio
  (`conversao_meta.retry_requested`): com o do upstream, o consumidor de venda dele
  leria um nome que não conhece como reenvio de compra.
- **O transporte é nosso**, ao lado do dele, na mesma fronteira
  (`lib/plataformas-de-anuncio/meta/eventos-do-funil.ts`). Reusa dele o hash, o teto
  de 7 dias e a classificação do erro.
- **A empresa de demonstração**: a regra pode ser gravada e ligada, e nada sai,
  porque a conexão de conversões ligada não existe nela (migration 9010) e o
  consumidor para antes da rede.

### Arquivos do upstream tocados

| arquivo | o que mudou |
|---|---|
| `app/app/settings/conversoes/page.tsx` | as seções da Meta entram na tela; o histórico e as pendências passam a ser lidos pelos módulos nossos; o nome do evento e o link do negócio na lista de pendências |
| `app/actions/settings/salvarRegrasDeConversaoGoogle.ts` | o miolo saiu para `lib/conversoes/gravar-regras-google.ts`, que o MCP também chama |
| `lib/event-log/register-handlers.ts` | o registro do consumidor |
| `lib/audit/actions.ts` | três ações de auditoria |

`app/app/settings/conversoes/_historico.tsx` e `lerPendencias`
(`lib/conversoes/estado-da-conexao.ts`) continuam no upstream, sem uso nesta tela.

Na próxima sincronização: o upstream passou a exigir que cada consumidor declare o que
faz com a organização parada (`naOrgParada`). O nosso precisa de `naOrgParada: "pula"`,
como os dois dele.

## O que é genérico e o que é nosso

| peça | para quem |
|---|---|
| Regras por etapa para a Meta | **genérico**: vale para qualquer instalação. Candidata a pull request ao upstream, como par da 0436 do Google |
| Diagnóstico da Meta | **genérico**: idem |
| Histórico com a situação pelo motivo e o reenvio só onde resolve | **genérico** |
| O link do negócio na lista de pendências (`/app/kanban?lead=` parava na lista de funis) e o nome do evento de etapa nessa lista (lia "Compra") | **genérico**: são dois defeitos da tela dele |
| Leads de formulário voltam para a Meta | **nosso**: depende dos leads dos formulários da Meta (`docs/fork/leads-da-meta.md`), que o upstream não tem |
| A seção Origem do cartão aberto | **nosso**: o cartão aberto é do fork |
| As ferramentas do MCP de plataforma | **nosso** |

## O que só uma conta real da Meta prova

Nenhum teste fala com a Meta. Com o **código de teste** preenchido na conexão:

1. **`Schedule` e `SubmitApplication` são aceitos pela porta de mensagens de negócio?**
   Mova um negócio de anúncio para uma etapa com "Agendou" e veja o histórico. Se a
   Meta recusar o nome, a troca é uma linha em `lib/conversoes-meta/eventos.ts`.
2. **O evento de lead de formulário chega?** Ligue a chave, mova um lead de formulário
   e confira no gerenciador de eventos (o destino precisa ser o mesmo que a campanha
   de formulário usa). Dois pontos a olhar nesse teste: a documentação descreve o
   `lead_id` como número de 15 a 17 dígitos e nós o mandamos como texto (para não
   perder dígito); e ela não fala de valor e moeda nos eventos de CRM, que nós
   mandamos na venda e nas etapas com valor.
3. **O diagnóstico lê o destino com o token do cliente?** Um token gerado dentro do
   destino de conversões pode não responder à leitura de permissões; nesse caso o
   item fica em atenção, como previsto.
4. A documentação mostra `whatsapp_business_account_id` no `user_data` do exemplo de
   WhatsApp. O transporte da compra (do upstream) não o envia, e o nosso segue o dele.
   Se a Meta passar a exigir, é uma mudança nos dois.

## Testes

| arquivo | o que mede |
|---|---|
| `tests/unit/conversoes-da-meta-regras-puras.test.ts` | os eventos, o recomendado, o valor, a sequência do funil, as situações e o reenvio |
| `tests/unit/conversoes-da-meta-transporte.test.ts` | o corpo que sai nas duas portas, o teto de 7 dias, o diagnóstico na Meta (com dublê) |
| `tests/unit/conversoes-da-meta-consumidor.test.ts` | o consumidor: as travas, o valor, a conexão, o modo de teste, o lead de formulário e a venda |
| `tests/unit/conversoes-da-meta-regras-e-diagnostico.test.ts` | gravar as regras, a chave, o diagnóstico e o histórico |
| `tests/unit/conversoes-da-meta-acoes.test.ts` | o portão das ações da tela |
| `tests/unit/conversoes-da-meta-tela.test.tsx` | a tela, pelo que a pessoa vê e clica: a régua, o recomendado, o quadro, a chave, o diagnóstico e o histórico |
| `tests/unit/mcp-de-implantacao-conversoes.test.ts` | as seis ferramentas do MCP |
| `tests/invariants/conversoes-da-meta-por-etapa.test.ts` | as travas no Postgres de verdade: os CHECK, os gatilhos, a função do reenvio, a empresa de demonstração, e as ferramentas do MCP (rodar de novo não muda uma linha) |
| `tests/invariants/rls-tabelas-da-mia.test.ts` | as duas tabelas novas: uma empresa não lê a outra, e a sessão não escreve |
