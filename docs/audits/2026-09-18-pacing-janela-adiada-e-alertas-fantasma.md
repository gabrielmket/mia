# Janela adiada e alertas fantasma — três defeitos que custaram uma hora

**18/09/2026** · achado na implantação do tenant **Academia Alfa**
(`0637f3c1-53c3-45ac-a75f-5f0126fc6ecc`), canal WAHA
`19fa43bd-466e-4474-8905-4986066322a9`, `WORKING`.

**Sintoma:** mensagem entrou no inbox e o agente publicado não respondeu, sem
erro em tela nenhuma.

**A causa raiz estava certa e o sistema estava correto:** janela anti-ban
fechada, turno adiado. O que custou uma hora foram os três defeitos abaixo —
todos no caminho de *descobrir* isso.

> As evidências de banco vêm de leituras de produção feitas na sessão de
> implantação. As alegações de CÓDIGO foram conferidas linha a linha nesta
> auditoria; onde a conferência discordou do relato original, está anotado.

---

## 1. `channel_knobs.updated_at` nunca muda — CONFIRMADO

**Evidência de banco:** a linha tinha `created_at == updated_at == 03:18:26Z`
mesmo tendo sido alterada depois das 04:36.

**Conferido no código:** a coluna existe com `default now()`
(`supabase/baseline.sql:6749`), o upsert em
[`app/api/v1/ai/pacing/route.ts:169`](../../app/api/v1/ai/pacing/route.ts)
grava `organization_id`, `channel_session_id` e os campos alterados — **e não
toca `updated_at`**. Não há gatilho na tabela (`grep` por trigger em
`channel_knobs` volta vazio).

**Por que dói mais do que parece:** o campo não fica em branco, fica *mentindo
com cara de verdade*. Lendo a tabela, a conclusão inevitável é "a janela já
estava aberta quando o turno foi adiado" — e isso transforma comportamento
correto em suspeita de bug no worker. Foi o que aconteceu.

**Correção proposta:** gatilho `before update` na tabela, e não conserto do
upsert. O gatilho pega também SQL direto e qualquer rota futura; consertar o
upsert conserta um chamador e deixa a armadilha armada para o próximo.

---

## 2. Alargar a janela não reprograma turno já adiado — CONFIRMADO

**Evidência de banco:** job `d2504332…`, `inbound_turn`, `pending`,
`run_after = 10:00:00.803Z` (7h local), com `channel_knobs` já em 0h–23h.

**Conferido no código:** em
[`lib/agent-engine/agent/inbound-turn.ts:1640`](../../lib/agent-engine/agent/inbound-turn.ts),
o bloco "JANELA ANTI-BAN" calcula `proximaAberturaDaJanela(agora, knobs)` **no
momento do adiamento** e congela o resultado em `run_after` via `rescheduleJob`.
Nada revisita jobs pendentes quando os knobs mudam. O worker reavalia a janela,
mas só depois do `run_after` — tarde demais.

**Por que é o pior dos três:** é exatamente o caminho que o operador percorre
para destravar um teste. Ele alarga a janela, nada acontece, e conclui que a
configuração não funciona. O produto fica sem saída pela tela.

**Correção proposta:** no `PUT /api/v1/ai/pacing`, reprogramar para `now()` os
jobs pendentes daquela sessão que foram adiados **por janela** — sem tocar nos
adiados por cap diário ou por horário do agente, que dependem de outra condição
e voltariam cedo demais.

Isso pede um passo anterior: **gravar o motivo do adiamento em coluna própria.**
Hoje o motivo vive numa string livre (`reason: 'fora da janela anti-ban de envio
— turno adiado para a abertura'`), e filtrar jobs comparando texto de mensagem é
a receita de quebrar calado no dia em que alguém melhorar a frase.

**Alternativa de superfície** (não substitui, mas dá saída imediata): mostrar na
tela "há N turnos adiados para `<hora>`" com ação "liberar agora".

---

## 3. Alerta de inbox não fecha quando a condição acaba — PARCIALMENTE CONFIRMADO

O relato original juntou dois casos como se fossem o mesmo defeito. **Não são**,
e a diferença muda o conserto.

### 3a. `conhecimento_nao_indexado` — CONFIRMADO, sem quem feche

**Evidência de banco:** `agent_inbox_items d73a8e56…`, `open` desde 03:21,
enquanto a fonte referenciada está `ready` desde 04:22.

**Conferido no código:** [`workers/rag-indexer.ts:155`](../../workers/rag-indexer.ts)
ABRE o item (com dedup por `ref_id`), e na linha 483 marca a fonte como
`status: "ready"` ao concluir — **sem nenhum update em `agent_inbox_items`**.
Não existe função que resolva este `kind`. O alerta é imortal até alguém fechar
à mão.

**Custo real:** durante a investigação este alerta levou a um diagnóstico
errado, desmentido só depois de ler `ai_knowledge_sources` direto.

### 3b. `janela_de_envio_fechada` — O RELATO ESTÁ ERRADO

O relatório diz que ninguém fecha este item. **Fecha sim.**
`resolverAvisoDeJanela` existe em
[`lib/agent-engine/pacing/aviso-de-janela.ts:131`](../../lib/agent-engine/pacing/aviso-de-janela.ts)
e É CHAMADA em
[`inbound-turn.ts:1687`](../../lib/agent-engine/agent/inbound-turn.ts), no mesmo
ponto que abriria o aviso, com o comentário certo ao lado:

> *"A janela está ABERTA: se havia aviso de silêncio pendurado, ele morre AQUI —
> no mesmo ponto que o abriu."*

**A razão de ele ter ficado aberto é o defeito 2.** O fechamento depende de um
turno RODAR e encontrar a janela aberta; o turno estava congelado em `run_after`
7h local. Os dois defeitos se compõem: o job não reprograma, então nenhum turno
roda, então nada fecha o aviso.

⚠️ **Consequência prática:** quem for consertar isto **não deve escrever um
resolvedor para `janela_de_envio_fechada`** — ele já existe e está certo.
Consertar o defeito 2 fecha este alerta de graça. Construir um segundo caminho
de fechamento criaria duas réguas que divergem na primeira mudança.

---

## Prioridade

| | por quê |
|---|---|
| **2** | é o único que deixa o produto sem saída pela tela, e é o que o cliente sente. Consertá-lo também resolve o 3b. |
| **1** | barato, e devolve confiança no diagnóstico — sem ele, a próxima investigação recomeça enganada |
| **3a** | higiene, mas poupa a próxima hora de alguém |

E uma varredura que vale fazer junto do 3a: **percorrer a família de alertas
perguntando quem fecha cada `kind`.** Dois de dois auditados aqui tinham
problema, e um deles não tinha resolvedor nenhum — a chance de os outros estarem
inteiros é baixa.

---

## O padrão, para quem for consertar

Os três são o mesmo defeito de sistema, em três roupas: **um estado mudou e
ninguém reavaliou o que dependia dele.** O `updated_at` não acompanhou a
alteração; o job não acompanhou a janela nova; o alerta não acompanhou a
condição que o criou.

É primo da regra que este repositório já aprendeu duas vezes em
`lib/channels/meta/credenciais-da-org.ts` e no dedup de eco: *peça pronta e
nunca ligada*. Aqui é a variação temporal — **ligada uma vez e nunca
revisitada**.

---

# Segunda rodada — 18/09/2026, implantação do tenant Academia Beta

Três achados novos. O primeiro estava no relato original desta sessão e não
sobreviveu à reescrita; os outros dois apareceram configurando o segundo cliente.

## 4. Turno adiado vira ralo: a mensagem seguinte do contato some dentro dele

**O mais grave da série, e o único sem saída pela tela.**

**Evidência de banco (Academia Alfa):** quatro mensagens inbound do mesmo contato
(04:36:14, 04:51:55, 04:58:04, 05:01:50) e **um único** job na fila, o das 04:36,
`pending`, `run_after = 10:00Z`. `llm_calls` vazio: o modelo nunca foi chamado.

**Causa.** A coalescência em `lib/agent-engine/edge/crm/drain.ts:379`:

```sql
select id from job_queue
where organization_id = $1 and contact_id = $2
  and kind = 'inbound_turn' and status = 'pending' and run_after > now()
```

Existindo job pendente com `run_after` futuro, a mensagem entra de carona e o
evento vira `processado`. A regra foi desenhada para o debounce de rajada
(segundos) e não distingue disso um job adiado por janela para daqui a cinco horas,
que satisfaz a mesma condição.

**Por que importa.** Enquanto o turno está adiado, o contato entra num ralo: tudo
que ele escrever some, sem turno, sem log de modelo, sem alerta. Repetir a
mensagem, primeira reação de qualquer pessoa, alimenta o ralo em vez de sair dele.
Em cliente real, o lead que escreve às 22h30 e insiste três vezes só é atendido às
7h, e o histórico mostra uma pessoa falando sozinha a noite inteira.

**Correção sugerida.** Coalescer apenas quando o job pendente está dentro da janela
de debounce (`run_after <= now() + debounceMs`). Fora disso, enfileirar turno novo
ou antecipar o existente — mas a mensagem não pode desaparecer sem deixar trabalho.

## 5. `crm_save_org_memory` nunca funcionou — falha 100% das vezes

**Evidência.** Cinco chamadas pelo MCP, cinco falhas idênticas:
`gravar_memoria_falhou: new row for relation "org_memory_entries" violates check
constraint "org_memory_entries_source_check"`.

**Causa.** O handler em `lib/mcp/tools/evolucao.ts:213` insere `source: "agent"`.
A tabela (`supabase/baseline.sql:7793`) declara
`source text not null check (source in ('manual', 'flywheel'))`. O valor que a
ferramenta escreve não está na lista: é impossível a chamada dar certo, com
qualquer entrada.

**Agravante.** O erro cru do Postgres volta como resultado da tool, ou seja, chega
ao modelo com nome de tabela e de constraint dentro. É exatamente o tipo de texto
que `TRANSPARENCIA_SYSTEM_BLOCK` existe para impedir que chegue ao lead.

**Correção sugerida.** Decidir qual é a origem certa e alinhar os dois lados: ou o
check passa a aceitar `'agent'` (e a tela ganha como distinguir o que a IA anotou,
que é o propósito declarado no comentário da ferramenta), ou o handler grava
`'manual'`. A primeira respeita a intenção; a segunda é de uma linha.

**Nota de método.** Uma ferramenta que não pode funcionar em nenhum caminho não é
regressão, é peça nunca exercitada. Vale um teste de integração que chame cada tool
de escrita uma vez contra o banco real de teste — este defeito morreria no primeiro.

## 6. Proteção de envio não segue o número quando ele troca de tenant

**Evidência.** O mesmo chip físico foi desconectado da Academia Alfa e
conectado na Academia Beta. Na Academia Alfa havia linha em `channel_knobs` com janela 0h–23h
e `number_activated_at` de março. Na Academia Beta, `channel_knobs` não tem linha nenhuma:
janela 7h–22h e idade zero, ou seja, teto de 20 envios por aquecimento.

**Causa.** A chave de `channel_knobs` é `(organization_id, channel_session_id)`, e
trocar de tenant cria sessão nova. Correto por construção — mas invisível.

**Por que importa.** Quem acabou de configurar a proteção de envio acha que
configurou **o número**. Ele reconecta o mesmo chip em outro tenant e cai de novo na
janela fechada e no cap de 20, sem nenhum aviso de que a configuração ficou para
trás. Somado ao defeito 4, o operador perde a noite: o teste não responde, ele mexe
na janela, e as mensagens que mandou enquanto isso já sumiram no ralo.

**Correção sugerida.** Ao conectar um número cujo `phone_number` já existe em outra
sessão da instalação, oferecer herdar os knobs dela (ou ao menos avisar que o número
é conhecido e nasceu com os padrões). Nada disso muda regra: muda o silêncio.
