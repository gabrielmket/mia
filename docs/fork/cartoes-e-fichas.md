# Cartões e fichas do CRM (fork MIA)

Fases 1 a 3 do plano "Cartões do CRM v2" (30/09/2026), aprovadas pelo Gabriel no
protótipo clicável. O visual segue o do sistema; do protótipo vieram as regras e
os dados. Tudo que é nosso mora em `lib/cartoes/` e `components/cartoes/`, plugado
nos arquivos do upstream por poucas linhas marcadas `FORK MIA`.

## 1. O cartão fechado do funil

O cartão passa a responder, sem abrir: quanto vale, vai fechar, o que fazer agora,
quem está tocando e **com quem está a bola**.

| Linha | O que mostra | De onde vem |
|---|---|---|
| Título | "Empresa · título" quando o negócio tem empresa; "Mariana C. · título" quando é de uma pessoa. Sem repetir: o título que já nomeia a pessoa fica como está | `lib/cartoes/identidade.ts` |
| Selo | "recorrente" quando a pessoa (ou a empresa) já comprou; ao passar o mouse, "Já comprou 2x · R$ 587 mil" | negócios ganhos + `orders` (`compras-servidor.ts`) |
| Contexto | a sigla do canal (META, FORM, GOOGLE, SITE, INDIC, ATIVO, CAMP, IMPORT, SOCIAL, LIGAÇÃO, DIRETO, MANUAL) e, ao lado, a pessoa principal com cargo e "+N contatos" (negócio de empresa) ou a campanha (negócio de pessoa) | `lib/cartoes/canal.ts` |
| Valor | como antes | `crm_leads.value_cents` |
| Compromisso | o próximo, explícito: "Visita ao decorado · Jardim das Flores · sáb 03/10 10h", cortado com reticências e inteiro ao passar o mouse; "sem compromisso marcado" quando não há | `calendar_appointments` + `crm_lead_links` (`compromisso.ts`) |
| Fechamento | "Fechamento previsto 31/10 · 78%", numa linha própria. A chance é a da IA; sem ela, a da etapa | `expected_close_date`, `crm_lead_scores`, `crm_stages.win_probability` |
| Faixa do agente | a precedência do upstream não muda (proposta › retomada › esfriando › medidor). No estado normal, o medidor ganha a palavra da faixa (quente, morno, frio) e a objeção aberta mais recente | `lead_checkpoints` (último retrato) |
| Conversa | "Lead há 12 min:" (em cor de alerta quando a bola é nossa), a última mensagem e o selo "bola: nós" / "bola: cliente". Quem falou: Lead, Agente, Automação, Você ou o primeiro nome de quem da equipe respondeu | `conversations.last_inbound_at/last_outbound_at` + `messages.sent_via` |
| Rodapé | dono, "· 1 tarefa atrasada" quando há, e o tempo na etapa | `crm_tasks` |

**Contrato de altura** (upstream, `docs/handoffs/BRIEFING-crm-vivo.md` §5): as linhas
novas existem SEMPRE, com texto apagado quando falta o dado. O cartão não cresce com
dados; ele troca de estado. Vigiado em `tests/unit/cartao-fechado-mia.test.tsx`.

**De onde saem os sinais:** a rota do quadro (`/api/v1/pipelines/[id]/board`) chama
`comSinaisDoCartao` (`lib/cartoes/sinais-do-quadro.ts`) uma vez por quadro. Falha
de qualquer leitura devolve os cartões como o upstream os entregou, e o cartão volta
a ser o de antes. A objeção e o remetente da última mensagem são "a linha mais recente
por contato"; o PostgREST não tem `distinct on`, então a migration **9012**
(`fn_mia_sinais_do_cartao`, `security invoker`) responde as duas numa leitura.

### O quadro

- **Filtros** Canal, Faixa e Ordem como listas suspensas, na mesma barra dos
  filtros do upstream (o Dono é o "Responsável" que já existe). Moram na URL
  (`canal`, `faixa`, `ordem`), e mudar um filtro do upstream não apaga os nossos.
- **Ordem por urgência** (padrão): lead esperando resposta (quem espera há mais
  tempo em cima) › tarefa atrasada › compromisso hoje › proposta da IA para aprovar ›
  esfriando › sem próximo passo › próximo passo futuro. Também "Quentes primeiro",
  "Maior valor" e "Manual (arrastar)". A ordem é da tela: a posição salva não muda.
  Fora do Manual, arrastar dentro da mesma coluna não faz nada (a próxima leitura
  reordenaria) e arrastar para outra coluna põe o negócio no fim da posição salva.

### Aprovar a próxima ação cria a tarefa

"Aprovar" (no cartão e no cartão aberto) passa a criar uma tarefa de verdade
(`lib/cartoes/tarefa-da-proxima-acao.ts`, plugada em
`POST /api/v1/leads/[id]/next-action`): título = a ação, prazo hoje às 18h no fuso
da empresa (ou amanhã às 10h, depois das 17h), responsável = o dono humano do
negócio (ou quem aprovou), ligada ao negócio e ao contato, `source_kind =
next_action_approved`. Audita (`crm_task.created`) e entra na linha do tempo
(`task_created`). A falha na criação não desfaz a aprovação; a tela avisa.

## Sistema vivo (checklist)

1. **Quem me alimenta:** conversas e mensagens (bola), checkpoints da IA (objeção),
   agenda, tarefas, negócios ganhos e pedidos (compras), origem do lead e do contato.
2. **Quem eu alimento:** a decisão do humano (a ordem da coluna diz o que fazer
   primeiro) e as tarefas (aprovar vira `crm_tasks`).
3. **Registro:** aprovar emite `next_action_approved` (upstream) e `task_created`,
   e audita `crm_task.created`. Ler o quadro não é mutação e não audita.
4. **Tela:** o cartão do funil (`components/kanban/KanbanCard.tsx` com as linhas de
   `components/cartoes/LinhasDoCartao.tsx`).
5. **Porta:** o funil (`/app/pipelines/[id]`), que já existia.
6. **Anti-morte:** a bola nossa sobe para o topo da coluna; tarefa atrasada aparece
   no rodapé; aprovar gera tarefa com prazo.
7. **Configuração:** os filtros e a ordem ficam na barra do funil e na URL.
8. **Continuidade IA↔humano:** a proposta da IA vira tarefa de uma pessoa; a
   objeção que a IA registrou fica à vista de quem assume.
9. **Laço de retorno:** a tarefa aprovada e não cumprida volta ao cartão como
   "1 tarefa atrasada" e sobe na ordem por urgência.
