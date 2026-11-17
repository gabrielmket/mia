# Coexistência do WhatsApp

Fork MIA. O cliente usa o MESMO número no app WhatsApp Business do celular e na MIA (Cloud API da Meta).
Este documento cresce por etapa; hoje cobre a **S2: o histórico que a Meta manda entra como passado e não
dispara nada**. Migration 9162 (carimbo `20261117120000_9162_coexistencia_sincronizacao`).

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

Só o servidor escreve. Sem FK para `contacts`; o dado pessoal fica em `messages` e `contacts`, que a cascata
da LGPD já alcança.

Quando o histórico chega e o número não tem ciclo vivo (conectado por fora do fluxo da S3), o ciclo nasce
com `aberta_por = 'historico_sem_pedido'` e o pedido do histórico já `em_andamento`, sem `pedida_em`.

## 4. O que fica para as próximas etapas

- **S3:** a conexão pelo app, o pedido único (`smb_app_data`) com a trava, a tela do canal e as ferramentas
  do MCP de plataforma (ver e ligar a coexistência, ver a sincronização).
- **S4:** saída e volta do número (`PARTNER_REMOVED`, `ACCOUNT_OFFBOARDED`, `ACCOUNT_RECONNECTED`), edição e
  apagamento.
- **Relatórios e raio-X do fork (9163, decisão D3):** conferido em 17/11/2026, nenhuma das funções do fork
  que leem `messages` corta `historico_importado`. Com 180 dias de histórico, o tempo de resposta e o raio-X
  do primeiro mês contariam conversa velha. O corte espera a decisão do Gabriel.
- Lote guardado sem o pedido ao worker (o `emit_event` falhou na rota) fica em `recebido` e vai ao log com o
  id; a varredura da S3 o retoma.
