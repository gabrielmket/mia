# Agenda com o Microsoft 365: Outlook e Teams (desenho para aprovação)

> **Situação:** desenho. Nada implementado. Branch `mia-agenda-microsoft`, a partir de
> `mia/main` na .64 (upstream v1.67). A implementação começa depois da aprovação do
> Gabriel e do protótipo clicável das telas da seção 6.

O pedido: "integrar a agenda com a agenda do Outlook, ou produtos da Microsoft como a
videochamada lá, pois tem empresa que usa isso, assim dá opção do Google Agenda e suas
funcionalidades ou a da Microsoft". Quer dizer: quem atende conecta a agenda do
Outlook (conta de trabalho do Microsoft 365 ou conta pessoal outlook.com); os horários
ocupados lá bloqueiam a marcação aqui, pela tela e pela IA; o que se marca aqui
aparece lá; e a reunião pode ser no **Microsoft Teams**, com o link criado sozinho e
enviado ao cliente, como já acontece com o Google Meet.

## 1. O que já existe: a agenda do Google (é do upstream)

O upstream não tem nada de Microsoft (conferido no código, nos documentos e nas
branches em 30/09). O que ele tem é uma agenda Google completa e muito cuidada:

| peça | como funciona hoje | onde |
|---|---|---|
| Conexão | **por pessoa** (cada atendente conecta a dele; piso de papel `agent`). OAuth web com `access_type=offline`, `prompt=consent select_account` e `login_hint`. `state` assinado (org, pessoa, sessão, 10 min), cookie de vínculo `SameSite=Lax` só no caminho do callback, nonce queimado em `calendar_oauth_nonces` antes de trocar o código, volta por página-ponte (o cookie de sessão `Strict` não viaja na volta) | `lib/agenda/google/{oauth,estado,vinculo,token}.ts`, `/api/v1/agenda/google/{connect,callback}` |
| Tokens | cifrados (`bytea`, via `encryptWebhookSecret`) em `calendar_connections`; escopos `calendar.events` + `calendar.readonly`; o e-mail da conta é o id do calendário primário | `calendar_connections` (única por org + pessoa + provedor + e-mail) |
| App OAuth da instalação | banco primeiro (`platform_google_oauth`, tela `/admin/google`), `.env` como piso (`GOOGLE_CALENDAR_CLIENT_ID/SECRET`) | `lib/agenda/google/config.ts` |
| Renovação | rotina a cada 10 min varre `token_expires_at`; `fundirTokens` nunca perde o `refresh_token` | `cron/agenda-google-refresh` |
| Catálogo e escolha | todas as agendas da conta, 1x por dia. O primeiro catálogo marca a primária como "Conta como ocupado" e "Destino". A pessoa escolhe **as fontes e UM destino entre todas as contas dela** | `fn_google_catalog`, `fn_google_selection`, `AgendasConectadas` em `/app/settings/tenant/agenda` |
| Volta (Google → CRM) | **consulta periódica, sem webhook**, a cada 15 min: `syncToken` por calendário, página a página, com reserva de 90 s; janela de -1 a +90 dias refeita do zero a cada 24 h; `410` recomeça. Grava a ocupação em `calendar_external_events` **sem o título** | `calendar-executor.ts`, `fn_google_calendar`, `cron/agenda-google-sync` |
| Ida (CRM → Google) | a cada 5 min. Id do evento definido por nós (`deskcommapp` + uuid), reconciliação de três vias (base, local, remoto, por hash, sem dado pessoal), `If-Match` com etag, conflito vira decisão humana ("Usar horário do Google" / "Manter horário daqui" / "Preservar campos do Google"). Remarcação e cancelamento feitos no Google voltam para o CRM | `sync-model.ts`, `sync-executor.ts`, `fn_google_appointment`, `cron/agenda-google-push` |
| Google Meet | o local vem do **tipo de agendamento** ("Onde acontece"). `fn_meet_stamp` abre o pedido, a ida manda `conferenceData.createRequest` se o calendário permitir `hangoutsMeet`, a leitura acompanha até o link ficar pronto (só `meet.google.com`) | `google/meet.ts`, colunas `meeting_*` |
| Entrega do link | quando a **IA** marca, o link vai sozinho ao cliente pelo WhatsApp assim que fica pronto; pela tela, o responsável manda com "Enviar link ao cliente". Desde a 0366 a máquina é genérica (também manda os dados de compromisso sem Meet) | `meeting_delivery`, job `transactional_delivery`, `agent-engine/agent/meet-delivery.ts`, `fn_meet_action` |
| Horários livres | IA, grade e encaixe perguntam a **uma** coleta: compromissos do CRM + `fn_agenda_ocupacao_google_do_dono` (por dono, `security definer`). Leitura antiga vira aviso ("Ocupação do Google ainda não verificada neste período", `fn_google_coverage`) | `lib/agenda/consulta.ts` (`coletaOQueOcupa`), `ocupacao-externa.ts` |
| Quem saiu da empresa | a agenda dele para de ser lida (`apenasDeMembrosAtivos`, falha fechado) | `google/membros.ts` |
| LGPD | anonimizar o contato redige o compromisso (inclusive `meeting_url`), limpa os instantâneos e bloqueia a entrega; o espelho externo nunca guarda título; o link do Meet é apagado dos estados da IA | `fn_redigir_agenda_do_contato_anonimizado`, `fn_google_redact_contact`, `fn_meet_redact_contact`, `fn_meet_minimize_runtime` |

### Existe uma camada de "provedor de agenda"? Não.

O schema foi pensado para ter uma (`calendar_connections.provider`,
`PROVEDORES_DE_AGENDA`), mas tudo chama o Google direto:

- `calendar_connections_provider_check` só aceita `'google_calendar'`;
- o compromisso guarda o vínculo em colunas `google_*` (`google_connection_id`,
  `google_event_id`, `google_etag`, `google_base_projection`, `google_pending_write`...);
- as funções são `fn_google_*`, com o vocabulário de papéis do Google
  (`owner`, `writer`, `reader`, `writerWithoutPrivateAccess`);
- o local `google_meet` está no CHECK de `calendar_event_types` e de
  `calendar_appointments`, e o link só vale se for `meet.google.com` (em TypeScript e
  em três funções SQL).

### Por que a conta Microsoft não pode morar nas tabelas dele hoje

Três leitores do motor do Google olham a tabela **sem filtrar o provedor**:

1. **A renovação** (`agenda-google-refresh`) renova toda conexão `healthy` que está
   vencendo. Uma conexão Microsoft ali seria renovada no endereço do Google, levaria
   `invalid_grant` e viraria "Reconecte sua agenda" na primeira hora.
2. **A reserva do destino** (`fn_google_appointment`, ação `claim`) publica no
   calendário `is_destination` da pessoa **de qualquer conexão**. Com o destino no
   Outlook, o motor do Google chamaria a API do Google com o token da Microsoft.
3. **A escolha** (`fn_google_selection`) zera `is_destination` de todas as conexões da
   pessoa e exige que o destino seja um calendário Google.

E o CHECK do provedor precisaria aceitar `'microsoft_calendar'`: no fork isso é
redefinir uma constraint dele (regra 3 do `FORK-MIA.md`, vigiada por
`schema-mia-estende-nunca-redefine`).

Em compensação, a leitura de ocupação, a situação das conexões e a cobertura já são
por **conexão e dono**, não por provedor. São os pontos naturais de encaixe.

## 2. Arquitetura: duas opções

### Opção A · Interface de provedor dentro do motor dele

Criar `ProvedorDeAgenda` em `lib/agenda/` (OAuth, conta, transporte
`get/write/page/calendars`, tradução evento ↔ projeção, reunião online,
classificação de erro) e pôr Google e Microsoft atrás dela. O motor de três vias, as
reservas, o cursor e a tela de escolha passam a servir os dois. No banco: CHECK do
provedor com `microsoft_calendar`, local `microsoft_teams`, as funções `fn_google_*`
despachando por provedor, a reunião online genérica (`fn_meet_stamp`,
`fn_meet_observe`, `fn_meet_minimize_runtime`, "Link do Google Meet") e o id do evento
escolhido pelo provedor (o Google aceita o nosso; a Microsoft não).

- **Prós:** um motor só; toda correção futura dele vale para os dois (ele mexe nesse
  motor toda semana: 20 commits em `lib/agenda/google/` só em setembro); Teams entra
  como local de verdade; nenhuma tabela em dobro; a tela "fontes e um destino entre
  contas" já foi desenhada para isso.
- **Contras:** é reescrever a parte mais delicada do código dele (`sync-executor`,
  `calendar-executor`, ~8 funções SQL, 2 CHECKs e as catracas de vocabulário). No
  fork isso é proibido (regra 3) e seria conflito em toda sincronização. Só funciona
  **como contribuição aceita por ele**, no tempo dele e pelas catracas dele. E a
  Microsoft pede mudança no contrato do motor (id do evento definido pelo provedor, e
  leitura incremental só no calendário padrão), que ele pode preferir desenhar do
  jeito dele.

### Opção B · Módulo Microsoft ao lado, com pontos de ligação contados

`lib/agenda/microsoft/*` espelhando o do Google arquivo a arquivo, tabelas
`mia_agenda_microsoft_*` (migration 9011), rotas e rotinas próprias, e uma lista
fechada de pontos de ligação pequenos no código dele (seção 3.4). Reaproveita sem
copiar o que já é genérico: `state` assinado (`estado.ts`), cookie de vínculo
(`vinculo.ts`), queima de nonce (`calendar_oauth_nonces`), cifra, as funções puras
da comparação de três vias (`compare`, `checkpoint`, `hash`), o filtro de membros
ativos, a leitura de fuso e **a máquina de entrega do link ao cliente**.

- **Prós:** não depende dele para ir ao ar; zero redefinição no banco; o motor do
  Google fica intocado e segue recebendo as melhorias dele sem conflito; a conexão
  Microsoft não é vista por nenhum dos três leitores cegos.
- **Contras:** um segundo motor de sincronização para manter (a comparação é
  reaproveitada; reservas e cursor são nossos); o Teams não vira valor novo no CHECK
  do local, então entra como "Link de vídeo" marcado como Teams (seção 3.6); cerca de
  dez arquivos dele ganham uma linha ou um bloco nosso.

### A escolha: B, com a costura da A

| critério | A | B |
|---|---|---|
| respeita "estender, nunca redefinir" | não, no fork | sim |
| depende do Rafael para ir ao ar | sim | não |
| conflito nas sincronizações com o upstream | alto (motor dele) | baixo (pontos pequenos e listados) |
| motores de sincronização para manter | 1 | 2 |
| Teams como local | valor próprio | "Link de vídeo" marcado como Teams |

**Escolho a B.** A interface de provedor não dá para ser introduzida estendendo: ela
exige reescrever o motor e os CHECKs dele. Mas o módulo Microsoft nasce **com a forma
do adaptador da A** (`lib/agenda/microsoft/provedor.ts` cumpre exatamente a interface
proposta). Se o Rafael aceitar a A, o módulo vira o adaptador dele e as tabelas
`mia_agenda_microsoft_*` migram para as dele numa migration de dados planejada.

A proposta ao Rafael vai como **issue primeiro** (não PR): a interface, o que a
Microsoft exige de diferente e a oferta de escrever o adaptador. Regra 6 do fork: o
que é genérico vai para ele. Junto, dois defeitos genéricos achados neste estudo que
valem PR independente: o cartão da Agenda mostra "Agenda conectada" para conexão em
`token_expired`, e o botão "Conectar de novo" da faixa de erro não faz nada.

## 3. Como fica a Opção B

### 3.1 Módulos

| Microsoft (novo) | espelho do Google | o que muda |
|---|---|---|
| `microsoft/config.ts` | `config.ts` | app da instalação: `mia_microsoft_oauth_da_plataforma` (banco) e `MICROSOFT_CALENDAR_*` (`.env`), mesma ordem e mesmo memo de 30 s |
| `microsoft/oauth.ts`, `token.ts` | idem | Entra `common`, PKCE, escopos, renovação que **troca** o `refresh_token` (4.1) |
| `microsoft/conta.ts` | `calendarios.ts` | `GET /me`: id do usuário e e-mail (`mail` ou `userPrincipalName`) |
| `microsoft/transport.ts` | `transport.ts` | Graph v1.0, `If-Match`, `Prefer: IdType="ImmutableId"` e `outlook.timezone="UTC"` |
| `microsoft/evento.ts` | `evento.ts` | tradução evento ↔ compromisso e leitura como ocupação (4.2, 4.3) |
| `microsoft/eventos-remotos.ts` | `eventos-remotos.ts` | `calendarView/delta` no calendário padrão; `calendarView` completo nos outros |
| `microsoft/teams.ts` | `meet.ts` | pedido, observação e validação do link do Teams |
| `microsoft/erros.ts` | `erros.ts` | a mesma tabela de desfechos, com os códigos do Entra e da Graph |
| `microsoft/sync-executor.ts`, `calendar-executor.ts` | idem | mesmo algoritmo sobre as tabelas nossas; `compare`/`checkpoint`/`hash` importados de `google/sync-model.ts`, sem cópia |
| `microsoft/notificacoes.ts` | (não existe no Google) | assinaturas da Graph (4.5) |
| `microsoft/provedor.ts` | (não existe) | a interface da Opção A |
| `lib/agenda-mia/ocupacao.ts` | (não existe) | soma Google + Microsoft para os leitores dele |

### 3.2 Tabelas (migration 9011, `agenda_microsoft`)

| tabela | papel | espelha |
|---|---|---|
| `mia_microsoft_oauth_da_plataforma` | app da instalação, linha única, segredo cifrado, **vencimento do segredo**, tenant | `platform_google_oauth` |
| `mia_agenda_microsoft_conexoes` | conta por pessoa: e-mail, id na Microsoft, tipo (trabalho/pessoal), tokens cifrados, validade, escopos, `status` com os mesmos 7 valores de `SITUACOES_DA_CONEXAO` | `calendar_connections` |
| `mia_agenda_microsoft_calendarios` | catálogo, "Conta como ocupado", destino, Teams permitido, papel (no vocabulário do Google, para reaproveitar regras e tela), reserva, cursor, `deltaLink`, cobertura, assinatura de notificação | `calendar_connection_calendars` |
| `mia_agenda_microsoft_eventos` | ocupação vinda do Outlook, **sem título** | `calendar_external_events` |
| `mia_agenda_microsoft_compromissos` | vínculo compromisso ↔ evento: id, `transactionId`, etag, base, conflito, escrita pendente, reserva, revisão publicada, erro, estado do Teams e a autorização de entrega da IA | colunas `google_*` e `meeting_state` |
| `mia_agenda_tipos_com_teams` | quais tipos "Link de vídeo" são reunião do Teams | (novo) |

Regras: RLS por empresa (dono da conexão ou gerente lê; só o servidor escreve);
nenhum dado pessoal de contato (o link do Teams mora só em
`calendar_appointments.meeting_url`, que a redação dele já apaga); a revisão do
compromisso é **lida** (`revision`, `google_local_revision`), nunca escrita.
MANIFEST, carimbo e espelho no `baseline-mia.sql`; tabelas novas na lista de
`rls-tabelas-da-mia.test.ts`.

Funções nossas (`fn_mia_agenda_microsoft_*`): reserva, página, erro e liberação do
calendário; catálogo; escolha; reserva e efetivação do compromisso; e três leituras
com **as mesmas colunas** das dele, para somar sem adaptar:

- `fn_mia_agenda_ocupacao_microsoft_do_dono` ↔ `fn_agenda_ocupacao_google_do_dono`
- `fn_mia_agenda_conexoes_microsoft_do_dono` ↔ `fn_agenda_conexoes_google_do_dono`
- `fn_mia_agenda_cobertura_microsoft` ↔ `fn_google_coverage`

Gatilhos nossos (extensão, nunca redefinição): destino único entre provedores (3.5),
redação do espelho ao anonimizar o contato, e `trg_mia_teams_minimize_runtime` nas
seis tabelas onde o dele apaga o link do Meet dos estados da IA.

### 3.3 Rotas e rotinas

| caminho | o quê |
|---|---|
| `GET /api/v1/agenda/microsoft/connect` e `/callback` | ida e volta do consentimento, com a página-ponte |
| `DELETE /api/v1/agenda/microsoft/desconectar` | desconecta, cancela as assinaturas, apaga tokens, catálogo e ocupação |
| `GET/PATCH /api/v1/agenda/microsoft/calendarios`, `POST .../atualizar` | catálogo e escolha (com MFA, como a dele) |
| `POST /api/v1/agenda/agendamentos/{id}/microsoft/{resolver,retry}` | decisão de conflito e nova tentativa |
| `POST /api/v1/agenda/microsoft/notificacoes` | recebe as notificações da Graph (pública, conferida por `clientState`) |
| rotinas no `docker/scheduler/entrypoint.sh` | `agenda-microsoft-refresh` (10 min), `agenda-microsoft-push` (5 min), `agenda-microsoft-sync` (1 min, só o que está vencido ou foi avisado), `agenda-microsoft-assinaturas` (1 h) |
| `/admin/microsoft` | credencial do app, só o dono da plataforma |

### 3.4 Os pontos de ligação no código do Rafael (lista fechada)

| # | arquivo dele | mudança |
|---|---|---|
| 1 | `lib/agenda/consulta.ts` | `coletaOQueOcupa` e a leitura de conexões e cobertura somam a Microsoft (uma chamada a `lib/agenda-mia/ocupacao.ts`). Isso leva a ocupação do Outlook à IA (`crm_find_free_slots`), à grade de marcar e ao encaixe |
| 2 | `lib/agenda/ocupacao-externa.ts` | idem, para a grade da Agenda |
| 3 | `app/app/agenda/page.tsx` | cartão "Outlook · Microsoft 365" ao lado do do Google e a faixa de volta do consentimento |
| 4 | `app/app/settings/tenant/agenda/_client.tsx` | `AgendasConectadas` trocado pela versão MIA (as duas contas, um destino); opção "Microsoft Teams" em "Onde acontece" |
| 5 | `app/api/v1/agenda/tipos/route.ts` | aceitar o apelido `microsoft_teams` (grava `video_link` + a marca) |
| 6 | `app/api/v1/agenda/agendamentos/_handler.ts` | para tipo Teams marcado pela IA, guardar a autorização de entrega (como ele faz para `google_meet` na linha 396) |
| 7 | `app/api/v1/agenda/agendamentos/[id]/route.ts` e `components/agenda/DetalheDoCompromisso.tsx` | blocos "Sincronização Outlook" e "Microsoft Teams" |
| 8 | `lib/agent-engine/agent/meet-delivery.ts` e `lib/agenda/texto-do-compromisso.ts` | o link do Teams entra no texto enviado, como "Link do Microsoft Teams:" |
| 9 | `lib/mcp/tools/agendamento.ts` e `lib/agent-engine/agent/compromissos-do-contato.ts` | a IA passa a ver o link do Teams (hoje só vê `meeting_url` quando o Meet está `ready`) |
| 10 | `lib/auth/public-paths.ts`, `components/admin/AdminSidebar.tsx`, `lib/recursos-opcionais/catalogo.ts`, `lib/lgpd/export-collector.ts`, `docker/scheduler/entrypoint.sh` | registros: rotas públicas, item "Microsoft 365" no `/admin` e em `/admin/sistema`, exportação LGPD do espelho, rotinas |

Todo o resto mora em arquivo nosso. Esta lista entra no `FORK-MIA.md` como código da
MIA dentro de arquivo do upstream, para quem fizer a próxima sincronização.

### 3.5 Um destino por pessoa, entre Google e Microsoft

A regra dele já é "um destino entre todas as contas". Mantida entre os provedores:

- a tela MIA de agendas mostra as contas Google e Microsoft juntas, com **um** rádio
  "Destino dos novos compromissos";
- salvar com destino **Google** chama a `fn_google_selection` dele, como hoje, e zera
  o destino Microsoft; salvar com destino **Outlook** grava o nosso e, do lado Google,
  só as fontes e `is_destination = false`, subindo a revisão dele (para a tela dele
  saber que mudou);
- um gatilho nosso em `calendar_connection_calendars` zera o destino Microsoft quando
  um destino Google é gravado por qualquer caminho (inclusive o primeiro catálogo).

Efeito conhecido: com destino no Outlook, a reserva do Google continua gravando
"Escolha uma agenda de destino nas configurações." em `google_sync_error` a cada 15
min (o que já acontece hoje com quem não tem Google). O detalhe do compromisso mostra
"Sincronização Outlook" no lugar da do Google quando o compromisso é do Outlook.

### 3.6 Teams como local

O local vem do tipo de agendamento ("Onde acontece", escolhido ao criar o tipo). Sem
poder acrescentar `microsoft_teams` ao CHECK:

- a opção **"Microsoft Teams"** grava o tipo com `location_kind = 'video_link'`,
  `location_details = 'Microsoft Teams'` e uma linha em `mia_agenda_tipos_com_teams`.
  Onde a tela dele escreve o local (`rotuloDoLocal`), e onde a IA lê o `onde` do tipo,
  aparece "Link de vídeo · Microsoft Teams", sem mexer no código dele;
- ao publicar um compromisso desse tipo num calendário do Outlook que permite
  `teamsForBusiness`, a ida pede a reunião no próprio evento, lê
  `onlineMeeting.joinUrl`, valida o endereço (`teams.microsoft.com` ou
  `teams.live.com`) e grava em `calendar_appointments.meeting_url` (o gatilho dele
  deixa o servidor escrever quando o local não é Meet). Daí em diante tudo o que ele
  mostra de "link de vídeo" mostra o Teams;
- destino que não permite Teams (conta pessoal sem Teams, ou destino no Google):
  "Esta agenda não permite Microsoft Teams. Confira a conta conectada ou escolha outro
  destino." no compromisso e aviso na Central.

### 3.7 Entrega do link do Teams ao cliente

A máquina dele é genérica desde a 0366 (`meeting_delivery`, job
`transactional_delivery`, política, travas do canal, remarcação, avisos na Central,
`fn_meet_action` para o "Enviar ao cliente" da tela). Ela só não sabe **esperar** o
link de quem não é Meet: para `video_link` ela enfileira na hora e manda sem link. Por
isso:

1. quando a IA marca um tipo Teams, o ponto 6 guarda a autorização (fronteira do
   atendimento, job de origem, autor) no nosso espelho, e o compromisso nasce com a
   entrega em `none`;
2. quando o link fica pronto, o nosso executor grava `meeting_url` e arma
   `meeting_delivery` em `waiting_for_link` com aquela autorização. O gatilho dele
   confere se o atendimento ainda é o mesmo (senão marca `stale` e avisa) e enfileira;
3. o worker dele manda, pela mesma saída do produto (janela, opt-out, LGPD, limites),
   "Sua reunião está marcada para {data} ({fuso}). Link do Microsoft Teams: {url}"
   (ponto 8);
4. pela tela, o bloco "Microsoft Teams" do compromisso usa as rotas dele
   (`deliver`/`resend`), liberando "Enviar link ao cliente" só com o link pronto.

### 3.8 Ida e volta

- **Ida:** a revisão local é a `google_local_revision`, que o gatilho dele já sobe a
  cada mudança de horário, situação, título, descrição, local ou convidado. O espelho
  guarda a revisão que publicou; diferença = publicar. Três vias, `If-Match`, conflito
  com decisão humana: o mesmo algoritmo, com "Outlook" no lugar de "Google" nas
  frases.
- **Volta:** remarcação ou cancelamento feito no Outlook é aplicado com a
  `fn_appointment_change` pública dele (como servidor), com atividade "Remarcado no
  Outlook" / "Cancelado no Outlook" no negócio. Compromisso realizado ou com ausência
  registrada não é mexido pela volta (mesma proteção dele), e horário que cairia em
  cima de outro compromisso vira conflito, não remarcação.
- **Anti-eco:** o evento que é compromisso nosso sai do espelho de ocupação (senão o
  horário contaria duas vezes), reconhecido pela tupla gravada e pela propriedade
  estendida `deskcomm_appointment` no evento.

### 3.9 LGPD e membros

- nenhum título, descrição ou convidado de evento do Outlook é guardado;
- anonimizar o contato: a redação dele apaga `meeting_url` e bloqueia a entrega; o
  nosso gatilho limpa base, conflito e escrita pendente do espelho e para a
  sincronização daquele compromisso;
- o espelho entra na exportação LGPD (`lgpd-exporta-o-que-redige` exige);
- quem sai da empresa: rotinas com `apenasDeMembrosAtivos` e funções conferindo
  `revoked_at`, falhando fechado. A catraca `agenda-apenas-de-membros-ativos` só olha
  `cron/agenda-google-*`; ganha uma irmã para `agenda-microsoft-*`.

## 4. Microsoft Graph e Entra: as decisões técnicas

### 4.1 Consentimento e tokens

- **Fluxo:** código de autorização com **PKCE**, cliente confidencial (segredo), em
  `https://login.microsoftonline.com/common/oauth2/v2.0/{authorize,token}`. `common`
  aceita conta de trabalho e pessoal. O `code_verifier` é derivado do nonce com o
  `INTERNAL_SECRET`, então nada novo é guardado (e fecha, no nosso lado, a dívida que
  o callback do Google declara: "o caminho real é PKCE").
- **`prompt=select_account` + `login_hint`** com o e-mail do CRM: a pessoa sempre pode
  escolher a conta de trabalho. `prompt=consent` não é preciso: a Microsoft devolve
  `refresh_token` sempre que `offline_access` é pedido (a armadilha 1 do Google não
  existe aqui).
- **Escopos:** `offline_access User.Read Calendars.ReadWrite`. Nada além:
  - `Calendars.ReadWrite` cobre ler, criar, alterar e cancelar evento **e criar a
    reunião do Teams no próprio evento**. `OnlineMeetings.ReadWrite` fica de fora: cria
    reunião avulsa, fora da agenda, e não existe para conta pessoal;
  - `User.Read` dá o id e o e-mail da conta (chave da conexão);
  - agendas compartilhadas por colegas (`Calendars.ReadWrite.Shared`) ficam de fora de
    propósito: cada pessoa conecta a própria, como no Google;
  - **nenhuma permissão de aplicativo** (as que leem todas as caixas da empresa).
- **Validade:** `expires_in` vira instante (armadilha 3, igual). A renovação devolve
  um `refresh_token` **novo**, que substitui o velho (o contrário da armadilha 2 do
  Google; `fundirTokens` cobre as duas). Renovando a cada hora, a expiração por 90
  dias de inatividade não acontece enquanto a conexão está ligada.
- **Erros de renovação:** `invalid_grant` (senha trocada, acesso revogado,
  inatividade: `AADSTS50173`, `AADSTS700082`...) e `interaction_required` (MFA ou
  acesso condicional pediu interação) viram `token_expired`, "Reconecte sua agenda";
  `temporarily_unavailable` e 5xx são transitórios; `invalid_client` (segredo vencido
  ou trocado) avisa o dono da plataforma, não a pessoa.

### 4.2 Leitura (Outlook → CRM)

- **Calendário padrão:** `GET /me/calendarView/delta?startDateTime&endDateTime`
  (v1.0). O `@odata.deltaLink` faz o papel do `syncToken`; o `@odata.nextLink`, do
  `pageToken`. Janela igual à do Google (-1 a +90 dias), refeita do zero a cada 24 h,
  porque o `deltaLink` congela a janela da primeira leitura.
- **Outros calendários:** a delta de `calendarView` de calendário que não é o padrão
  **só existe na beta** (conferido na documentação em 30/09), e a beta não é suportada
  em produção. Para eles a leitura é o `calendarView` completo da janela a cada rodada
  (o mesmo cursor, sempre no modo "completo"). Custa pouco: dezenas de eventos em 90
  dias.
- **Cabeçalhos:** `Prefer: outlook.timezone="UTC"` (todo horário volta em UTC, sem
  adivinhar nome de fuso do Windows), `Prefer: IdType="ImmutableId"` (o id não muda se
  o evento trocar de calendário) e `Prefer: odata.maxpagesize=100`. A delta não aceita
  `$select`: o corpo vem inteiro e o tradutor descarta o que não usa, inclusive o
  título.
- **Tradução para ocupação:** `showAs` `free` não ocupa; `workingElsewhere` também não
  (é o "estou trabalhando em outro lugar", como o `workingLocation` do Google); `busy`,
  `oof`, `tentative` e `unknown` ocupam. `isCancelled`, `@removed` ou o dono ter
  recusado (`responseStatus.response = declined`) tiram da ocupação. Dia inteiro: a
  data é lida no fuso da organização. Série já vem expandida em ocorrências.
- `@removed` de fora da janela é ignorado (a documentação avisa que a delta devolve
  exclusões de fora do intervalo). Token de delta inválido recomeça do zero, como o
  `410` do Google.

### 4.3 Escrita (CRM → Outlook)

- **Criar:** `POST /me/calendars/{id}/events` com `subject`, `body` (texto),
  `start`/`end`, `location`, `attendees` (e-mail da ficha e convidado), `showAs: busy`,
  **`transactionId`** derivado do id do compromisso (a Graph descarta o POST repetido
  por nova tentativa) e **propriedades estendidas** `deskcomm_org`,
  `deskcomm_appointment`, `deskcomm_v` (as mesmas chaves privadas do Google).
  Diferença que muda o motor: é a Microsoft que escolhe o id. Se a resposta se perder,
  a próxima reserva procura o evento pela propriedade estendida antes de criar de novo.
- **Fuso:** o IANA do compromisso quando está na lista aceita pela Graph
  (`America/Sao_Paulo` está); fora dela (`America/Manaus` não está), o instante vai em
  UTC. O instante é o mesmo, e o Outlook mostra no fuso de quem abre.
- **Alterar e cancelar:** `PATCH` só dos grupos que mudaram, com `If-Match:
  {@odata.etag}`; cancelar com convidados usa `POST /events/{id}/cancel` (a Microsoft
  avisa os convidados); sem convidados, `DELETE`.
- **Convites:** a Graph manda convite sempre que há `attendees` (não existe
  `sendUpdates`). Vale a regra dele: o e-mail da ficha vai na criação e junto de uma
  alteração, nunca em massa na primeira sincronização.
- **Teams:** `isOnlineMeeting: true` + `onlineMeetingProvider: teamsForBusiness`, só
  se o calendário listar `teamsForBusiness` em `allowedOnlineMeetingProviders`. Depois
  de criada, a reunião **não sai** do evento (regra da Graph): trocar o tipo não tira o
  Teams do evento já publicado, e a tela diz isso.

### 4.4 Limites

Serviço do Outlook: 10.000 requisições a cada 10 minutos e 4 simultâneas **por
aplicativo e por caixa**. As rotinas tratam uma caixa por vez, em sequência. `429` e
`503` com `Retry-After` viram `rate_limited` e esperam o tempo pedido (o vocabulário
já tem esse estado).

### 4.5 Notificações de mudança

O Google dele é só consulta a cada 15 min: um compromisso pessoal marcado no Google
pode levar esse tempo para bloquear o horário aqui, e nesse intervalo a IA pode
oferecê-lo. Para a Microsoft a consulta continua sendo a **rede de segurança**, e as
notificações entram como **acelerador** (mesmo desenho do tempo real dos Leads da
Meta na .62):

- uma assinatura por calendário que "Conta como ocupado" ou é destino:
  `resource = me/calendars/{id}/events`, `changeType = created,updated,deleted`;
- validade máxima de **10.080 min (menos de 7 dias)** para evento do Outlook; a
  rotina renova quando faltam menos de 48 h;
- **validação:** ao criar, a Graph chama a URL com `validationToken` e espera a mesma
  string em `text/plain` em até 10 s;
- **`clientState`** aleatório por assinatura (guardado com hash), conferido em toda
  notificação; o que não confere é descartado;
- **`lifecycleNotificationUrl`** para `reauthorizationRequired` (renova),
  `subscriptionRemoved` (recria) e `missed` (leitura completa);
- a notificação não traz dado: só marca aquele calendário para ler **agora**, e a
  rotina de 1 min lê. A documentação não promete latência para evento, por isso a
  consulta periódica fica. A tela mostra "Tempo real ligado" por calendário.

## 5. O que o Gabriel faz no portal Azure (uma vez só)

Em **entra.microsoft.com** (ou portal.azure.com › Microsoft Entra ID), com a conta
Microsoft 365 da Time Company:

1. **Registros de aplicativo › Novo registro**
   - Nome: o que o cliente vai ler na tela de consentimento (ex.: "MIA Agenda").
   - Tipos de conta: **"Contas em qualquer diretório organizacional e contas pessoais
     da Microsoft"**.
   - URI de redirecionamento, plataforma **Web**:
     `https://crm.timecompany.com.br/api/v1/agenda/microsoft/callback`
2. **Autenticação › Adicionar URI** (mesma plataforma Web):
   `https://app.iamia.com.br/api/v1/agenda/microsoft/callback` e, para teste local,
   `http://localhost:3000/api/v1/agenda/microsoft/callback`. Deixar desmarcados
   "Tokens de acesso" e "Tokens de ID" (fluxo implícito desligado).
3. **Certificados e segredos › Novo segredo do cliente**, validade de 24 meses (o
   máximo). Copiar o **Valor** na hora (não aparece de novo) e anotar a data de
   vencimento: ela vai na tela `/admin/microsoft`, que avisa 30 dias antes.
4. **Permissões de API › Adicionar › Microsoft Graph › Permissões delegadas:**
   `offline_access`, `User.Read`, `Calendars.ReadWrite`. **Nenhuma** permissão de
   aplicativo.
5. **Identidade visual e propriedades:** logo, página inicial, termos de uso e
   política de privacidade (aparecem no consentimento). **Domínio do editor:**
   verificar `timecompany.com.br` (a Microsoft pede o arquivo
   `/.well-known/microsoft-identity-association.json` publicado no domínio).
6. **Verificação do editor:** vincular o ID do Microsoft AI Cloud Partner Program
   (cadastro gratuito, com o mesmo domínio). **Sem isso, em boa parte das empresas o
   funcionário não consegue autorizar sozinho** e vê "precisa da aprovação do
   administrador": desde nov/2020 a Microsoft bloqueia o consentimento de usuário para
   app multilocatário de editor não verificado. Conta pessoal consegue, com o aviso de
   "não verificado".
7. Copiar o **ID do aplicativo (cliente)** e colar, com o segredo, em
   `/admin/microsoft` de cada instalação (crm.timecompany.com.br e app.iamia.com.br).
   O mesmo app serve às duas.

**Empresa cliente que bloqueia consentimento:** o TI dela aprova uma vez pelo link de
consentimento do administrador, que a tela gera
(`https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=...`).
Depois disso cada funcionário conecta sozinho.

**Variáveis de ambiente novas** (piso, como as do Google; o que se salva em
`/admin/microsoft` vale por cima):

| variável | para quê |
|---|---|
| `MICROSOFT_CALENDAR_CLIENT_ID` | ID do aplicativo (cliente) |
| `MICROSOFT_CALENDAR_CLIENT_SECRET` | valor do segredo |
| `MICROSOFT_CALENDAR_TENANT` | opcional, padrão `common`; um id de tenant restringe a uma empresa só |

Custo na Microsoft: nenhum. O registro do app e a API de agenda são gratuitos; o
Teams é o do Microsoft 365 do próprio cliente.

## 6. Telas que mudam (vão para o protótipo clicável antes do código)

**6.1 Agenda (`/app/agenda`), topo.** Os dois cartões lado a lado (empilhados no
celular). O da Microsoft já nasce com o estado "precisa reconectar", que o do Google
não tem.

```
┌ Google Agenda ─────────────────────────┐ ┌ Outlook · Microsoft 365 ───────────────────────┐
│ [G] Agenda conectada: ana@gmail.com     │ │ Conecte sua agenda do Outlook para ver aqui o  │
│ Configurar suas agendas · Desconectar   │ │ que já está marcado lá, e enviar para lá o que │
└─────────────────────────────────────────┘ │ for marcado aqui. Serve conta de trabalho      │
                                            │ (Microsoft 365) e pessoal (outlook.com).       │
                                            │ [ Conectar Outlook ]                           │
                                            └────────────────────────────────────────────────┘
```

Estados do cartão Microsoft:

| estado | o que diz |
|---|---|
| não configurado (dono da plataforma) | "Falta cadastrar o aplicativo da Microsoft desta instalação." + "Cadastrar as credenciais da Microsoft" → `/admin/microsoft` |
| não configurado (demais) | "Esta instalação ainda não tem a conexão com a Microsoft. Não é nada que você tenha feito." |
| sem conexão | texto acima + "Conectar Outlook" |
| conectado | "Outlook conectado: ana@clinica.com.br · conta de trabalho" · "Configurar suas agendas" · "Desconectar" |
| precisa reconectar | "A conexão com o Outlook parou: a Microsoft pediu para entrar de novo." + "Conectar de novo" |

Faixa da volta do consentimento, além dos códigos que o Google já tem:
"**A empresa precisa aprovar o aplicativo.** A conta ana@clinica.com.br é de uma
empresa que só libera aplicativos aprovados pelo TI. Mande este link para o
responsável de TI; depois da aprovação, conecte de novo." + [Copiar link para o TI].

**6.2 Suas agendas (`/app/settings/tenant/agenda`).** Uma lista só, as duas contas,
um destino.

```
Suas agendas
Escolha quais agendas ocupam seus horários e onde publicar os novos compromissos.
Os já publicados continuam na agenda onde estão.

Google · ana@gmail.com                                      [Atualizar lista]
  [x] Conta como ocupado  ( ) Destino   Ana (pessoal)       Permite Google Meet

Outlook · ana@clinica.com.br · conta de trabalho            [Atualizar lista]
  [x] Conta como ocupado  (•) Destino   Calendário          Permite Microsoft Teams
  [ ] Conta como ocupado  ( ) Destino   Feriados do Brasil  Só leitura
  Última sincronização: há 2 min · Tempo real ligado

                                        [Descartar alterações]  [Salvar agendas]
```

**6.3 Tipos de agendamento, "Onde acontece".** Uma opção a mais: Presencial ·
Telefone · WhatsApp · Link de vídeo · Google Meet · **Microsoft Teams**. Ajuda da
opção: "O link do Teams é criado sozinho quando o compromisso vai para uma agenda do
Outlook que permite Teams. Quem atende este tipo precisa ter o Outlook como destino."
Se quem atende o tipo não tem destino no Outlook, aviso amarelo com o nome da pessoa.

**6.4 Detalhe do compromisso.** Dois blocos novos, no lugar dos do Google quando o
compromisso é do Outlook:

```
Sincronização Outlook
  Alterações sincronizadas. Última sincronização: 14:32
  (conflito: "Aqui: 15/10 14:00" / "No Outlook: 15/10 16:00"
   [Usar horário do Outlook] [Manter horário daqui] [Preservar campos do Outlook])

Microsoft Teams
  ● Link do Microsoft Teams pronto
  [Abrir reunião]  [Copiar link]
  Conversa que receberá o link: [WhatsApp · Maria Souza  v]
  [Enviar link ao cliente]            Link enviado na conversa autorizada.
```

Estados do Teams: "Criando link do Microsoft Teams", "Link do Microsoft Teams
pronto", "Esta agenda não permite Microsoft Teams. Confira a conta conectada ou
escolha outro destino.", "O Teams só é criado em agenda do Outlook. Este compromisso
foi para o Google."

**6.5 `/admin/microsoft` (dono da plataforma).**

```
Microsoft 365 desta instalação
Com estas informações, quem atende conecta a agenda do Outlook. Valem para a
instalação inteira; cada pessoa conecta a conta dela depois.

Endereço de retorno          https://crm.timecompany.com.br/api/v1/agenda/microsoft/callback  [Copiar]
                             Cole exatamente isto em "URIs de redirecionamento" (plataforma Web).
ID do aplicativo (cliente)   [ 00000000-0000-0000-0000-000000000000 ]
Valor do segredo do cliente  [ ••••••••  (já cadastrado) ]
O segredo vence em           [ 30/09/2028 ]      (aviso: vence em 23 dias)
Quem pode conectar           (•) Qualquer empresa e contas pessoais
                             ( ) Só uma empresa: [ id do tenant ]
Link de aprovação para o TI  https://login.microsoftonline.com/organizations/v2.0/adminconsent?...  [Copiar]
                                                                                    [Salvar]
```

Mais: item "Microsoft 365" no menu do `/admin` e em `/admin/sistema` › "Depende do
servidor" (Configurado / Não configurado / segredo vencendo).

**Textos dele que ficam imprecisos** (sem mexer, ou por proposta a ele): o aviso
"Ocupação do Google ainda não verificada neste período" passa a valer também para o
Outlook, e o bloco de ocupação da grade diz "ocupado na agenda do Google". O
protótipo mostra a versão "da agenda conectada" para o Gabriel decidir se vale o
ponto de ligação a mais.

## 7. A IA e o MCP

- **Horários livres:** pelo ponto 1, `crm_find_free_slots`, `crm_book_appointment` e
  `crm_find_and_book_appointment` passam a recusar horário ocupado no Outlook, e
  `fontes_defasadas` / `agenda_externa_nunca_lida` passam a contar a conexão
  Microsoft.
- **Teams:** a IA escolhe o tipo pelo `slug`, e o `onde` do tipo diz "Link de vídeo ·
  Microsoft Teams". Marcando pelo WhatsApp, o link vai sozinho quando fica pronto
  (3.7). Pelo ponto 9, ela vê "link ainda sendo criado" enquanto espera e o link
  quando está pronto; a regra dela ("não invente um link") vale igual.
- **MCP externo** (token de API, sem conversa): como no Meet, o link é criado mas não
  é enviado sozinho; alguém manda pela tela.

## 8. O que precisa ser provado no primeiro teste com conta real

1. `If-Match` com o `@odata.etag` no `PATCH` e no `DELETE` responde `412` quando a
   versão mudou (a documentação da Graph não é explícita). Sem isso, a escrita vira
   "lê, compara e escreve dentro da reserva", com janela de segundos, e a reconciliação
   seguinte pega o que escapar.
2. `onlineMeeting.joinUrl` já vem na resposta do `POST` (se vier vazio, a leitura
   acompanha até aparecer, como o Meet `pending`).
3. `teamsForBusiness` em conta pessoal outlook.com (se não vier em
   `allowedOnlineMeetingProviders`, a tela já diz que a agenda não permite Teams).
4. Consentimento numa empresa com a política padrão, antes e depois da verificação do
   editor.

Os quatro se provam com uma conta de teste do Microsoft 365 e uma outlook.com antes da
primeira entrega ir ao ar.

## 9. Entregas (cada uma completa, na ordem)

1. **Conexão e ocupação:** `/admin/microsoft`, conectar, reconectar e desconectar,
   renovação, catálogo, "Suas agendas", leitura com notificações. O Outlook bloqueia
   horário na IA, na grade e no encaixe, com aviso de cobertura.
2. **Publicação:** destino no Outlook, ida e volta com conflitos, "Sincronização
   Outlook" no compromisso, convites.
3. **Teams:** tipo "Microsoft Teams", criação do link, entrega ao cliente pela IA e
   pela tela, avisos na Central.

Cada entrega vai com as catracas verdes (`tsc`, vitest,
`schema-mia-estende-nunca-redefine`, LGPD, RLS) e com testes das traduções puras
(evento, erros, delta, token) antes de qualquer token de verdade.
