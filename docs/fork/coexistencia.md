# Coexistência do WhatsApp

Fork MIA. O cliente usa o MESMO número no app WhatsApp Business do celular e na MIA (Cloud API da Meta).
Este documento cresce por etapa; hoje cobre a **S2: o histórico que a Meta manda entra como passado e não
dispara nada** (migration 9162) e a **S3: a conexão pelo app e o pedido único da sincronização** (migration 9164,
carimbo `20261118120000_9164_coexistencia_da_empresa`; seção 5), a **S4: a saída e a volta do número, a edição e o
apagar feitos pelo app** (sem migration nova; seção 6) e a **S5: o Assistente e o teste com um número de verdade**
(seções 7 e 8).

Desenho completo, protótipo e decisões: tarefas MIA-24 (plano) e MIA-25 (desenho) no painel do time.

## 1. O que a Meta manda

Lido em 17/11/2026 em `webhooks/reference/history`, `webhooks/reference/smb_app_state_sync` e na página de
cadastro de usuários do app.

- Depois da conexão, a MIA tem 24 h para pedir a sincronização (`smb_app_data`), UMA vez por tipo:
  primeiro os contatos (`smb_app_state_sync`), depois o histórico (`history`). Pedir é da S3.
- O histórico vem em lotes no campo `history`: `metadata.phase` (0 = de 0 a 1 dia, 1 = de 1 a 90, 2 = de 90
  a 180), `metadata.chunk_order` (os lotes chegam fora de ordem) e `metadata.progress` (100 = acabou). Cada
  lote tem `threads[]`, uma por conversa, com `id` (o telefone do cliente) e `messages[]`.
- A mensagem do lote não tem `to`: `from` é o número da empresa quando ela enviou e o do cliente quando ele
  enviou; `from_user_id` só vem na do cliente. `history_context.status` é o último estado de entrega.
- Mídia dos últimos 14 dias vem no lote como `media_placeholder`, e o arquivo chega depois num webhook do
  mesmo campo com `value.messages[]` direto, o MESMO `id` e o tipo de verdade (`image` com `image.id`).
- Grupos ficam de fora. Cliente só com nome de usuário vem sem telefone.
- Erro `2593109`: o dono desligou o compartilhamento do histórico no app.

## 2. Como entra (S2)

```
webhook da Meta (campo history)
  └─ rota: receberHistoricoDaMeta  ── guarda o lote cru e pede ao worker (coexistencia.lote_requested)
       └─ worker: gravarLoteDoHistorico ── grava como histórico importado e reconta o pedido
```

| Peça | Arquivo |
|---|---|
| Leitura defensiva do campo `history` (pura) | `lib/channels/meta/coexistencia/historico.ts` |
| Mensagem do lote → linha de `messages` (pura) | `lib/channels/meta/coexistencia/mapear.ts` |
| Ciclo de conexão e pedidos | `lib/channels/meta/coexistencia/estado.ts` |
| Recebimento na rota | `lib/channels/meta/coexistencia/receber.ts` |
| Gravação no worker | `lib/channels/meta/coexistencia/gravar-lote.ts` e `lote.handler.ts` |
| Contagem dos contatos do app | `lib/channels/meta/coexistencia/contatos.ts` |

Encaixes `FORK MIA` em arquivos do upstream, um bloco curto cada:

- `app/api/v1/webhooks/meta/[token]/route.ts`: a chamada a `receberHistoricoDaMeta` logo depois de nascer a
  lista de desfechos, e o `ingestMetaAppContactSync` trocado pelo embrulho que conta
  (`ingerirContatoDoAppContando`, que chama o do upstream sem mudar nada nele).
- `lib/channels/consumidores.ts`: o handler do lote entre os consumidores dos canais.

O eco (`smb_message_echoes`) e a pausa da IA pelo atendimento no app são do upstream e não mudaram.

### 2.1 O mesmo corte da importação do canal não oficial

Toda mensagem do lote vai para `messages` com `metadata.historico_importado = 'true'` (texto, letra por
letra a condição da 0760 e da 0686) e `metadata.historico_origem = 'coexistencia'`. A conversa vem de
`fn_upsert_wa_conversation_importada` (0760). Não existe caminho paralelo: é o desenho de
`lib/channels/historico/rodada.ts`.

| Não dispara | Quem corta |
|---|---|
| IA, push, webhook de saída, resposta de campanha, follow-up, automações | 0760 em `fn_emit_message_event`: sem `message.received`/`message.sent`, nenhum consumidor acorda |
| Demanda, SLA, reabertura, revisão de contexto | 0760 (`fn_demanda_abre_no_inbound`, `fn_reply_inbound_revision`) |
| Atividade do vendedor | 0686 (`trg_mensagem_do_vendedor_e_atividade`) |
| Roteamento da conversa nova | a conversa nasce `closed` e sem dono |
| `last_message_*`, `last_inbound_at`, não lidas, janela de 24 h | o worker não chama o carimbo da conversa, e a conversa que já existe não é tocada |
| Pausa da IA | o worker não chama `pausarIaPorAtendimentoManual` (o contrário do eco) |
| Lead, etapa e data de etapa, conversões da Meta | o worker não chama os efeitos pós-entrada nem cria negócio |

Guardas iguais às da agenda do app: número interno de avisos não vira contato; titular apagado a pedido
(LGPD) e ficha anonimizada não voltam pelo histórico. A pergunta do apagado é uma por lote e, se falhar, o
lote espera (falha fechada).

Prova: `tests/invariants/coexistencia-historico-nao-dispara.test.ts` roda a rota e o worker contra o banco e
mede nenhum evento além do pedido ao worker, nenhuma atividade, nenhum envio de conversão, a conversa e o
negócio que já existiam iguais coluna por coluna, e o controle (sem a chave, a mesma mensagem dispara).

### 2.2 Reentrega e lote refeito

- O mesmo lote reentregue: `unique (sincronizacao_id, chave)` em `mia_coexistencia_lotes`, com a chave
  `f<fase>:o<ordem>` (ou `midia:<wamid>`). Sem linha nova não há pedido ao worker.
- A mesma mensagem por dois caminhos: o `external_id` é o `wamid`, e a unique `(organization_id,
  external_id)` de `messages` recusa a segunda. Conta como "já existente".
- O lote que falhou no meio é refeito pelo `event_log`; o que ele mesmo já gravou é reconhecido por
  `metadata.coexistencia_lote_id`. Na 3ª falha o lote desiste (`falhou`) e o pedido conta em
  `lotes_com_falha`.
- O lote cru (`payload`) vira nulo assim que é gravado ou desiste: a conversa não fica guardada duas vezes.

### 2.3 Mídia

O `media_placeholder` vira linha `text` sem corpo com `metadata.meta_media_placeholder = 'true'` e
`media_status` `pendente` (até 14 dias) ou `indisponivel` (mais velha). Quando o arquivo chega, a linha passa
ao tipo de verdade, com `media_url = meta-media:<id>`, e o worker de mídia é chamado
(`media.persist_requested`; pela chave do histórico, ele guarda e não deriva). A mídia que chega antes da
mensagem espera por ela até 30 minutos.

### 2.4 Os contadores

`mia_coexistencia_sincronizacoes`, por pedido:

- **contatos** (`smb_app_state_sync`): +1 quando o contato da agenda NASCE ou MUDA DE NOME, enquanto o
  pedido está em aberto. O mesmo nome reentregue não conta. Quem grava o contato continua sendo o upstream.
- **histórico**: `conversas_recebidas` (conversas que o histórico criou), `mensagens_recebidas`,
  `mensagens_existentes`, `midias_guardadas`, `lotes_com_falha`, a fase e o progresso. São a soma dos lotes,
  recalculada pelo banco a cada lote (`fn_mia_coexistencia_recontar`), então reentrega não soma duas vezes.
  Fecha em `concluida` quando o lote de progresso 100 chegou e nenhum está pendente; o pedido de contatos em
  andamento fecha junto (a Meta não avisa o fim dos contatos).
- Erro `2593109` fecha o histórico em `recusada_pelo_dono`; outro erro, em `falhou`, com o código e o título
  da Meta. Estado de erro não é desfeito.

## 3. As tabelas (9162)

| Tabela | O que guarda | Quem lê |
|---|---|---|
| `mia_coexistencia_conexoes` | o ciclo de conexão do número pelo app (`no_ar`, `fora_do_ar`, `encerrada`); um ciclo vivo por número; `aberta_por` | a equipe da empresa |
| `mia_coexistencia_sincronizacoes` | os dois pedidos do ciclo; `unique (conexao_id, tipo)` é a trava do pedido único da S3 | a equipe da empresa |
| `mia_coexistencia_lotes` | cada lote e cada mídia à parte, com o cru até ser gravado | só o administrador de plataforma |

Só o servidor escreve. Sem FK para `contacts`; o dado pessoal gravado fica em `messages` e `contacts`, que a
cascata da LGPD já alcança. A exceção é o lote cru em `mia_coexistencia_lotes.payload` enquanto o lote está em
`recebido`: ele tem nome, telefone e texto, e a anonimização do titular não olha essa tabela. Vira nulo quando o
lote é gravado ou desiste; o lote que nunca sai de `recebido` fica para a S3 (ver a seção 4).

Quando o histórico chega e o número não tem ciclo vivo (conectado por fora do fluxo da S3), o ciclo nasce
com `aberta_por = 'historico_sem_pedido'` e o pedido do histórico já `em_andamento`, sem `pedida_em`.

## 4. O que fica para as próximas etapas

- **S3:** feita (seção 5).
- **S4:** feita (seção 6).
- **Relatórios e raio-X do fork (9163, decisão D3):** conferido em 17/11/2026, nenhuma das funções do fork
  que leem `messages` corta `historico_importado`. Com 180 dias de histórico, o tempo de resposta e o raio-X
  do primeiro mês contariam conversa velha. O Gabriel aprovou excluir (D3, 17/11/2026), e a 9163 ainda não
  existe: até ela entrar, o primeiro mês de um número que trouxe o histórico sai distorcido nesses relatórios.
- Lote guardado sem o pedido ao worker (o `emit_event` falhou na rota) fica em `recebido` e vai ao log com o
  id; a varredura da S3 o retoma (seção 5.5).
- **Prazo do lote cru (S3, LGPD):** nesta etapa, um lote que nunca sai de `recebido` (worker parado, ou o
  pedido ao worker perdido) guarda o `payload` sem prazo. A mesma varredura da S3 fecha isso: retoma o lote
  parado e, passado o prazo (proposta: 7 dias), marca o lote `falhou` com `payload` nulo e conta a falha no
  pedido. Até a S3 entrar, a MIA não abre a conexão pelo app: o histórico só chega se o número for conectado
  por fora do fluxo. Apontado pelo Revisor no PR #92.

## 5. A conexão pelo app e o pedido único (S3)

### 5.1 O caminho

```
tela do canal oficial (chave ligada)
  └─ "Conectar pelo app WhatsApp Business" → aviso de limites e custos → janela da Meta (SDK JS)
       └─ POST /api/v1/channels/official/coexistencia {acao: "abrir"}    → nonce (10 min, empresa + pessoa)
       └─ FB.login com featureType whatsapp_business_app_onboarding      → código + FINISH_..._ONBOARDING (waba_id)
       └─ POST /api/v1/channels/official/coexistencia {acao: "concluir"} → conectarPeloApp
            ├─ código → token (oauth/access_token, App Secret no servidor)
            ├─ número da janela ou da conta (numeros-da-waba.ts); validado com o token novo
            ├─ número ativo em OUTRA empresa: recusa (nunca toma o número de ninguém)
            ├─ sessão do canal oficial NA EMPRESA DA SESSÃO, WORKING, origem embedded_signup (9328 do upstream)
            ├─ webhook do número registrado (a mesma peça da porta manual); meta_onboardings já amarrado
            ├─ ciclo da coexistência aberto (mia_coexistencia_conexoes)
            ├─ canal por QR do mesmo número arquivado (D5)
            └─ coexistencia.sincronizacao_requested → worker: pedirSincronizacao (contatos, depois histórico)
```

Não chama `/register`: a página da Meta manda pular, o número já está registrado no app. A mesma volta duas vezes
dá uma sessão, um ciclo e um pedido: o ciclo vivo aberto pela janela há menos de 10 minutos é o mesmo; mais velho é
passagem nova (o cliente saiu do app e voltou), e aí o velho vira `encerrada` e nasce outro.

| Peça | Arquivo |
|---|---|
| A chave da empresa (9164) | `lib/channels/meta/coexistencia/chave.ts`, `ligar.ts` (recusas) |
| A janela: configuração e nonce | `lib/channels/meta/coexistencia/janela.ts` |
| A conexão | `lib/channels/meta/coexistencia/conectar.ts` |
| O pedido único e o worker | `lib/channels/meta/coexistencia/sincronizacao.ts`, `sincronizacao.handler.ts` |
| O aviso quando não vem | `lib/channels/meta/coexistencia/avisos.ts` |
| O canal por QR do mesmo número (D5) | `lib/channels/meta/coexistencia/qr-do-mesmo-numero.ts` |
| O estado (tela, /admin/meta, MCP) | `lib/channels/meta/coexistencia/leitura.ts` |
| A varredura de 5 minutos | `lib/channels/meta/coexistencia/varredura.ts`, `app/api/v1/cron/coexistencia` |
| As rotas | `app/api/v1/channels/official/coexistencia`, `app/api/v1/admin/coexistencia` |
| A tela | `components/connections/coexistencia/` (SDK em `sdk-da-meta.ts`), `components/admin/coexistencia/` (em /admin/meta pelo layout do fork `app/admin/(protected)/meta/layout.tsx`, sem tocar a página do upstream) |
| O MCP de plataforma | `lib/mcp-plataforma/ferramentas/coexistencia.ts` |

Encaixes `FORK MIA` em arquivos do upstream, um bloco curto cada:

- `components/connections/CanalOficialClient.tsx`: `<ConectarPeloApp />` depois do cartão do canal conectado.
- `app/api/v1/channel-sessions/[id]/route.ts`: `barrarQrEmCoexistencia` onde o número do aparelho do QR é lido e
  gravado (a consulta que a tela de pareamento faz). O QR que acabou de parear um número em coexistência na mesma
  empresa sai do ar, e a rota responde 409 `coexistencia_ativa`.
- `lib/channels/consumidores.ts`: o handler do pedido. `docker/scheduler/entrypoint.sh`: a varredura.

A porta manual (`channels/official/route.ts`), o link hospedado (`embedded_signup_url`) e o canal parceiro ficam
como estão.

### 5.2 A configuração da janela

A janela precisa de `META_APP_ID` (o app da MIA na Meta, que já existia no `.env`) e de
`META_COEXISTENCIA_CONFIG_ID` (a configuração do cadastro incorporado com a opção do app WhatsApp Business), mais o
App Secret que a instalação já tem. Sem os dois ids, o botão aparece desligado e a tela diz que falta configurar.
Decisão D2 (17/11/2026): o `featureType` é a opção da v4 do cadastro incorporado; na v5 ela já vem ligada e o campo é
ignorado. O fluxo é o mesmo nas duas.

### 5.3 O pedido único

A trava é `unique (conexao_id, tipo)` em `mia_coexistencia_sincronizacoes` (9162): a linha nasce `pedindo` ANTES de
chamar a Meta, com `on conflict do nothing`, e só quem inseriu chama. Antes, confere ciclo `no_ar` e o prazo de 24 h.

| O que aconteceu | Estado | Aviso |
|---|---|---|
| 200 com `request_id` | `pedida` (a S2 leva a `em_andamento` no 1º contato ou lote) | nenhum |
| A Meta respondeu erro | `falhou`, com o código e o título dela | Central da empresa + log de erro |
| Rede caída, tempo esgotado, 5xx sem corpo | `sem_resposta` (não dá para saber se a Meta aceitou) | idem |
| Processo morreu no meio | a varredura muda `pedindo` de mais de 5 min para `sem_resposta` | idem |
| Passou das 24 h | `prazo_vencido` (insert com o estado final, mesma trava) | idem |

Nenhum desfecho tem segunda tentativa automática. D1 (17/11/2026): contatos recusados, o histórico é pedido mesmo
assim. O aviso da Central é `kind = 'other'` apontando para a conexão (`ref_kind = 'channel_session'`), um por número e
por tipo de pedido, e fecha por decisão de quem lê.

### 5.4 A chave e o canal por QR do mesmo número

`mia_coexistencia_da_empresa` (9164): sem linha é desligada, e é assim que toda empresa nasce. Quem liga é o
administrador de plataforma, em /admin/meta (escrita com MFA) ou pelo MCP. Recusa empresa que não opera e empresa
de demonstração (a 9010 não deixa nascer canal vivo nela). Desligar não derruba o número conectado: só esconde o
botão, e a conexão nova é recusada.

D5 (17/11/2026): quando a Meta confirma a conexão, o canal por QR do mesmo número na mesma empresa (comparado só pelos
dígitos: o oficial grava `+55…`, o QR grava `55…`) sai do aparelho e é arquivado, com os avisos fechados. Enquanto o
ciclo estiver vivo, o QR que parear o mesmo número sai do ar no primeiro momento em que o número é lido.

### 5.5 A varredura (5 em 5 minutos)

`app/api/v1/cron/coexistencia`: `pedindo` parado vira `sem_resposta`; ciclo aberto pela janela sem os dois pedidos é
pedido (atrás da trava) ou vence o prazo; lote do histórico esquecido em `recebido` há 2 horas volta ao worker; lote
cru parado há 7 dias vira `falhou` com o `payload` nulo e o pedido reconta (LGPD, a ressalva do Revisor no PR #92).
Fora da régua da empresa operante, declarado na cerca: é entrada da própria empresa, com prazo de 24 h da Meta.

### 5.6 Provas

- `tests/invariants/coexistencia-pedido-unico.test.ts`: três chegadas ao mesmo tempo dão UMA chamada de cada tipo à
  Meta simulada; reexecução, varredura, erro, rede caída e prazo vencido não chamam de novo; contatos recusados não
  impedem o histórico; ciclo fora do ar não pede; a janela concluída duas vezes ao mesmo tempo abre um ciclo. E a
  varredura dos lotes: lote cru de 8 dias vira `falhou` com o `payload` nulo e o pedido reconta; lote esquecido há
  3 h volta ao worker uma vez só (a 2ª rodada não pede de novo); lote de 1 dia mexido há pouco fica como está.
- `tests/unit/coexistencia-ids-em-fatias.test.ts`: a leitura de /admin/meta manda os ids ao banco em fatias de no
  máximo 100 (`fatias.ts`): mil uuids num `.in` só estourariam a URL do PostgREST. Com 350 empresas, nada se perde.
- `tests/invariants/coexistencia-conexao-pelo-app.test.ts`: a conexão de ponta a ponta no servidor com a Graph
  simulada (empresa certa, origem do upstream, cadastro amarrado, ciclo, pedido ao worker, QR do mesmo número
  arquivado, a mesma volta sem duplicar, número de outra empresa recusado, QR novo do número barrado).
- `tests/unit/coexistencia-conexao-pelo-app.test.ts` (nonce, fim da janela, troca do código, chave desligada) e
  `tests/unit/mcp-de-implantacao-coexistencia.test.ts` (as três ferramentas).

O e2e de tela fica para quando o `e2e.yml` puder apontar a Graph para um dublê: hoje ele fixa `META_GRAPH_BASE_URL`
numa porta que recusa, e outras specs dependem disso.

## 6. A saída, a volta, a edição e o apagar (S4)

Sem migration nova: as colunas da saída e da volta já nasceram na 9162 (`fora_do_ar_motivo`,
`fora_do_ar_iniciado_por`, `fora_do_ar_em`, `voltou_em`, `ultimo_evento_em`).

### 6.1 O que a Meta manda (lido em 18/11/2026)

Na página de cadastro de usuários do app e na referência `webhooks/reference/messages`:

- `account_update` com `event: "PARTNER_REMOVED"`: `waba_info` (`waba_id`, `owner_business_id`) e
  `disconnection_info` (`reason`: `ACCOUNT_DISCONNECTED`, `BUSINESS_DOWNGRADE`, `CHANGE_NUMBER`, `COMPANION_INACTIVITY`,
  `PRIMARY_INACTIVITY`, `USER_RE_REGISTERED`; `initiated_by`: `USER` ou `SYSTEM`).
- `account_update` com `ACCOUNT_OFFBOARDED` e com `ACCOUNT_RECONNECTED`: só `event`. A conta é o `entry.id`.
- **Nenhum dos três traz o `phone_number_id`**: o ciclo é o vivo da WABA na empresa que `donoDoEvento` resolveu.
- A hora é o `entry.time` (segundos). No exemplo da própria página o `ACCOUNT_RECONNECTED` tem `time` 1 segundo
  MENOR que o `ACCOUNT_OFFBOARDED`: a ordem de chegada não é a ordem dos fatos.
- Edição: `type: "edit"`, `edit.original_message_id` e a mensagem nova em `edit.message` (texto em `text.body`, legenda
  em `<tipo>.caption`). Apagar: `type: "revoke"`, `revoke.original_message_id`. O mesmo miolo vem em `messages` (o
  cliente) e em `smb_message_echoes` (o dono pelo app).

### 6.2 A saída e a volta

```
webhook da Meta (account_update)
  └─ rota: receberSaidaEVolta ── leitura pura (lerSaidaOuVolta) → ciclo vivo da WABA → aplica
```

| Evento | Ciclo | Sessão do canal | Central |
|---|---|---|---|
| `PARTNER_REMOVED`, `ACCOUNT_OFFBOARDED` | `fora_do_ar`, com o motivo e quem iniciou; `fora_do_ar_em` é o da primeira saída | `WORKING` → `STOPPED`, `status_reason = coexistencia_fora_do_ar` (só se estava `WORKING`) | abre UM aviso `<número> fora do ar` (`kind = 'other'`, `ref_kind = 'channel_session'`); o mesmo evento de novo atualiza o mesmo; o "voltou" aberto é resolvido |
| `ACCOUNT_RECONNECTED` | volta a `no_ar` no MESMO ciclo, com `voltou_em` | volta a `WORKING` só se o motivo ainda é o nosso | o de fora do ar é resolvido; abre `<número> voltou` |
| a janela de novo (`conectarPeloApp`, S3) | o velho vira `encerrada`, nasce outro (D4: a sincronização só nessa passagem) | a MESMA sessão volta a `WORKING`, sem o motivo | o de fora do ar é resolvido |

Nada é criado na volta: sessão, contato, conversa e cartão são os de antes, e a conversa segue presa à mesma sessão.
Evento com `time` menor que o `ultimo_evento_em` do ciclo não muda nada (a volta velha não traz de volta, a saída velha
não tira do ar); empate aplica. A volta com o número já no ar só guarda o `time`. WABA sem ciclo vivo (número do canal
oficial que não entrou pelo app) não muda nada.

A volta que falha no meio se cura na reentrega. Se o ciclo já foi a `no_ar` e a escrita da sessão caiu, o desfecho é
`conta:failed` e a rota responde 200. Quando a Meta entrega o mesmo evento de novo, ele cai no ramo "já no ar". Lá, se o
ciclo tem `voltou_em`, o passo da sessão roda de novo, e ele só pega a sessão com o nosso `status_reason`. Se esse passo
mudou alguma linha, o aviso de "voltou" também é refeito, e o desfecho é `conta:voltou_reparado`. Se não mudou nada, o
desfecho é `conta:ja_no_ar`, e o "voltou" que a equipe já fechou não reabre. A saída já se curava assim: o ramo "já
fora do ar" repete a sessão e o aviso. A rota continua respondendo 200 em `conta:failed`; sem a reentrega, o caso fica
no log de erro (`saída ou volta do número não aplicada`).

Com a sessão fora de `WORKING`, o que já existe do upstream passa a valer sem encaixe: o envio para, e a conversa
mostra a faixa de número fora do ar (`components/inbox/NumeroForaDoAr.tsx`). `lib/channels/historico/quedas.ts`
filtra `provider = waha`, então a saída não abre a recuperação de queda do QR (conferido na S4).

A tela do canal mostra o número fora do ar (desde quando, o motivo em palavras, o que para, "Conectar de novo" pela
mesma janela) e o de volta (`components/connections/coexistencia/ForaDoArEVolta.tsx`, a tela 4 do protótipo v3). O
motivo em palavras é um só para a tela e para o aviso (`motivo.ts`).

`lib/channels/meta/chegada-do-cadastro.ts` deixa de tratar esses três eventos como "chegada": antes, a saída (sem
número) reescrevia o retrato do cadastro já amarrado com número nulo.

### 6.3 A edição e o apagar

`lib/channels/meta/webhook.ts` lê o `edit`/`revoke` como `MessageEditEvent` (o alvo, a origem `cliente` ou `app`, o
texto novo e a hora), e `edicao.ts` aplica na mensagem `(organization_id, external_id)`:

- **Editar** sobrescreve o corpo e carimba `edited_at` com a hora do EVENTO. Só se a edição for mais nova que a já
  aplicada e a mensagem não estiver apagada. Edição sem texto carimba e não zera o corpo.
- **Apagar** carimba `revoked_at` e NÃO remove a linha nem limpa o corpo (quem decide o que a tela mostra é
  `lib/messaging/apagada.ts`). Só a linha ainda não apagada; a reentrega não muda nada nem grava outra trilha. A trilha
  vai à auditoria (`message.revoked_in_channel`, com a origem e sem o corpo). A prévia da conversa sai do texto apagado
  pelo cliente quando ele era a última mensagem (o mesmo cuidado do QR, upstream #4500).
- Sem a original na MIA (mensagem de antes da conexão, por exemplo): `sem_alvo`, nada é criado, 200.

O que acontecia antes: o `edit`/`revoke` do cliente caía no ramo genérico do campo `messages` e virava linha com
`type = 'edit'`, que o CHECK de `messages.type` recusa: a edição sumia com um erro no log. O do app caía no `continue`
do upstream. O nosso bloco entra ANTES dos dois; o `continue` do upstream fica para o eco sem alvo. O PR aberto do
upstream #4867 (tipo desconhecido vira texto vazio) não muda isso: o desvio nosso vem antes do ramo que ele mexe.

O Datafy (`lib/channels/inbound.ts`) usa a mesma leitura e não aplica a edição: o evento é ignorado lá (antes, a linha
falhava no insert). Ligar a edição no Datafy é outra tarefa.

### 6.4 Pontos de encaixe da S4

- `app/api/v1/webhooks/meta/[token]/route.ts`: `receberSaidaEVolta` logo depois de `receberHistoricoDaMeta`, e o ramo
  `e.kind === "message_edit"` com `aplicarEdicaoDaMeta`.
- `lib/channels/meta/webhook.ts`: o tipo `MessageEditEvent` na união; no campo `messages`, o desvio depois da reação;
  no eco, o bloco antes do `continue` do upstream.

O eco e a pausa da IA do upstream não mudaram.

### 6.5 MCP

`plataforma_ver_coexistencia` passa a mostrar a `situacao` (`no_ar`, `de_volta`, `fora_do_ar`, `encerrada`), o motivo
e quem iniciou a saída, quando saiu, quando voltou e o último aviso da Meta aplicado. Nenhuma ferramenta nova: tirar
ou pôr o número no ar é da Meta e do dono no app, e conectar de novo é credencial (fica fora do MCP).

### 6.6 Riscos e o que fica

- **O vigia de saúde do upstream** (`app/api/v1/cron/channel-health`) pergunta à Graph o estado do número. Se a Graph
  disser que o número funciona, ele grava `WORKING` por cima do `STOPPED` da saída (o ciclo continua `fora_do_ar`, e a
  tela do canal segue dizendo fora do ar). Se a Graph recusar, ele grava `FAILED` e abre o aviso dele, além do nosso. Não
  mexi nele: a resposta da Graph é a palavra final sobre o envio, e o upstream é quem cuida desse vigia.
- **Formato:** os payloads são os da página da Meta; o teste real (S5) confere com um número de verdade.

### 6.7 Provas

- `tests/unit/coexistencia-saida-e-volta.test.ts`: a leitura dos três eventos (os seis motivos, motivo desconhecido, sem
  `time`), a saída com UM aviso e a reentrega, a volta sem nenhuma escrita em contato, conversa, cartão, sessão ou ciclo
  novos, os eventos fora de ordem nos dois sentidos, a sessão que outro tirou do ar, WABA sem ciclo, e a volta que falhou
  na escrita da sessão e se cura na reentrega do mesmo evento.
- `tests/unit/meta-edicao-e-apagar.test.ts`: a leitura nos dois campos (texto e legenda), a edição (reentrega, edição
  velha, sem texto, sem alvo) e o apagar (linha e corpo ficam, prévia, uma trilha só, a do app, sem alvo).
- `tests/invariants/coexistencia-saida-e-volta.test.ts`, contra o banco: sair e voltar pelo aviso da Meta e pela janela
  de novo (Graph simulada), com a contagem de contatos, conversas, cartões, sessões e mensagens igual antes e depois; a
  edição e o apagar com as constraints de verdade.
- `lib/channels/meta/chegada-do-cadastro.test.ts`: a saída e a volta não são chegada.
- `tests/unit/mcp-de-implantacao-coexistencia.test.ts`: o MCP com o número fora do ar e de volta.

## 7. O Assistente (S3 e S5)

Dois manuais em `lib/assistente/manuais-das-telas.ts`, os dois na tela Conexões, para o administrador da empresa:

| Manual | Responde |
|---|---|
| `coexistencia-pelo-app` (S3) | como conectar o número que já está no app, a sincronização que não veio, se dá para pedir o histórico de novo |
| `coexistencia-fora-do-ar` (S5) | o número que saiu do ar (o motivo, o que para, "Conectar de novo"), a volta sem duplicar, a mensagem editada ou apagada no WhatsApp |

As frases são as da tela (`ForaDoArEVolta.tsx`, `AvisoDeLimitesECustos.tsx`, `motivo.ts`). Prova:
`tests/unit/assistente-perguntas-reais.test.ts`, com sete perguntas da coexistência; "meu número desconectou" continua
achando primeiro o manual do QR (`numero-desconectado`).

## 8. O teste com um número de verdade (S5)

O roteiro passo a passo está no documento `roteiro` da tarefa MIA-24, no painel do time. Ele é com o Gabriel, fora de
produção, e só depois da revisão da sessão dev. O resumo:

- **Antes:** a MIA como Provedor de Tecnologia na Meta; `META_APP_ID` e `META_COEXISTENCIA_CONFIG_ID` na instalação de
  teste; os campos `account_update`, `history`, `smb_app_state_sync` e `smb_message_echoes` assinados no app da Meta; o
  número de teste no app WhatsApp Business 2.24.17 ou mais novo, que não seja de cliente; a chave da empresa de teste
  ligada em /admin/meta.
- **A sincronização sai uma vez só.** Contatos e histórico só podem ser pedidos uma vez por conexão, e só nas 24 h depois
  dela. Para repetir, o número precisa sair da coexistência no app e passar pela janela de novo (ciclo novo). Por isso o
  número de teste não pode ser um que alguém precise do histórico depois, e a conexão só é feita quando todo o resto do
  roteiro estiver pronto.
- **O que o teste confere** e a Meta simulada não confere: o formato do lote do histórico e da mídia à parte (seção 1),
  o `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` e o número que vem com ele, os três eventos da saída e da volta
  (seção 6.1), e o vigia de saúde do upstream com o número fora do ar (seção 6.6).
- **Empresa de teste:** uma empresa nova, que não seja de demonstração. A 9010 não deixa nascer canal vivo na empresa de
  demonstração, e a chave da coexistência recusa ligar nela (seção 5.4).

Os custos e limites que aparecem na tela são os conferidos nas páginas da Meta em 17/11/2026 (o aviso de limites e
custos). O valor em reais por mensagem no Brasil não está na página e segue "a conferir".
