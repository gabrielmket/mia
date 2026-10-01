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
| Rodapé | dono, "· 1 tarefa atrasada" quando há, o aviso de documento ou obrigação mais urgente ("Alvará venceu há 3 dias"; nada com tudo em dia) e o tempo na etapa | `crm_tasks`; `mia_obrigacoes` ([obrigacoes.md](obrigacoes.md)) |

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

## 2. O cartão aberto

Clicar no cartão abre uma **gaveta larga** (em vez do dossiê estreito do upstream),
com o botão **Tela cheia** (a escolha fica no navegador de quem olha). Mesma porta
de antes: o clique no cartão e o endereço `/app/leads/<id>`.

| Parte | O que mostra | De onde vem |
|---|---|---|
| Trilha | Conversa › Contato › Empresa › Negócio, cada um levando à sua tela | lead, contato, empresa |
| Cabeçalho | título (com a pessoa ou a empresa), ganho/perdido, "Já comprou Nx · R$ X" (leva ao histórico de compras), valor, etapa, dono, faixa com o porquê, canal e campanha, próximo compromisso e fechamento previsto | como o cartão fechado |
| Barra de etapas | as etapas do funil com os **dias em cada uma**; clicar numa etapa move o negócio pelo MESMO caminho do arrasto (inclusive a recusa de campos obrigatórios) | atividades `stage_changed` (`lib/cartoes/etapas.ts`) |
| Foco | lead esperando resposta; proposta da IA ("Aprovar e criar tarefa", dizendo para quem e com que prazo antes do clique); próximo compromisso; tarefa atrasada ou a mais próxima ("Concluir"). Compositor: Nota (com "fixar no topo"), Tarefa (título, prazo, responsável), Mensagem e Agendar (levam à conversa e à agenda) | conversa, `lead_state`, agenda, `crm_tasks` |
| Resumo da IA | estágio, quer, orçamento e pagamento, quem decide, prazo, objeções **abertas e respondidas**, prometido, próxima ação com Aprovar/Descartar, resumo do último turno | `lead_state` (BANT), `lead_checkpoints` (retratos, declaração) |
| Pessoas | contato principal e as pessoas envolvidas com o **papel neste negócio** (incluir/tirar), outros negócios da pessoa, "ligar este negócio à empresa" quando a pessoa tem empresa, e os dados do contato (componente do upstream) | `crm_lead_links` (contact, `envolvido`, `metadata.papel`) |
| Empresa | nome (leva à ficha), CNPJ, telefone, site | `crm_empresas` |
| Histórico de compras | ver a seção 3 | |
| Origem e atribuição | canal, campanha, conjunto, anúncio, 1ª mensagem (sem os códigos de rastreio), 1º toque, respostas do formulário da Meta, conversões enviadas à Meta e ao Google ou por que não | lead e contato, `ad_conversion_dispatches` |
| Campos do funil | os campos do funil com a marca **"veio da conversa"** no que a IA preencheu e ninguém confirmou ("Confirmar"), e "obrigatório para <próxima etapa>"; "Editar campos" abre o formulário do upstream | `lead_edited.payload.custom_field_keys` + ator |
| Agenda, Tarefas, Propostas | os compromissos do negócio (próximos e passados, com comparecimento), as tarefas (concluir/reabrir) e as propostas (componente do upstream) | agenda, `crm_tasks`, propostas |
| Histórico | filtros **Importante** (padrão), **Tudo**, **Conversas** (com as últimas mensagens) e **Tarefas**. Em Importante, a nota fixada vai ao topo e a rotina da IA de um mesmo dia vira uma linha ("A IA fez 14 ações · 12 decisões de não enviar") — continua tudo registrado | `useLeadTimeline` (vivo) + mensagens |

**Convivência com o upstream:** o `LeadDossier` continua no repositório; o quadro
abre o cartão aberto (`components/cartoes/aberto/CartaoAberto.tsx`), que reusa as
peças do dossiê. `tests/unit/cartao-aberto-mia.test.tsx` reprova quando o dossiê
passa a importar uma peça que o cartão aberto não usa.

**"Veio da conversa":** a edição do negócio (`updateLeadHandler`, upstream) passou a
gravar em `lead_edited.payload.custom_field_keys` QUAIS campos personalizados
mudaram. Vale a última palavra: se foi da IA, a marca aparece; "Confirmar"
(`POST /api/v1/leads/[id]/campos-confirmados`) grava a palavra humana. Edição
anterior a esta versão não tem a lista: esses campos ficam sem marca.

**Rotas novas** (todas com `requireSupportWrite` antes do efeito, papel `agent`,
organização do cookie, Zod, linha do tempo e auditoria):
`GET /api/v1/leads/[id]/cartao` (leitura, `viewer`), `POST /api/v1/leads/[id]/notas`
(`lead.nota_adicionada`), `POST|DELETE /api/v1/leads/[id]/envolvidos`
(`lead.contato_envolvido_incluido`/`_retirado`), `POST
/api/v1/leads/[id]/campos-confirmados` (`lead.campo_confirmado`).

## 3. Fichas conectadas e histórico de compras

### Ficha do contato (`/app/contacts/<id>`, aba Visão geral)

O componente `FichaConectadaDoContato` entra na ficha do upstream por uma linha,
acima dos dados de cadastro: estágio do ciclo (Novo › Qualificando › Qualificado ›
Negociando › Cliente), **empresa opcional**, negócios (os dele e aqueles em que ele
está envolvido, com o papel; "Novo negócio" já ligado à pessoa), conversas, histórico
de compras, resumo da IA, memória da IA (`lead_notes`), agenda e tarefas. Os dados
propostos pela IA para aprovar continuam no topo da página (`PropostasDeDado`).

**Empresa opcional** (regra do Gabriel): sem empresa não aparece campo vazio, só o
link "Vincular a uma empresa". Vincular pede a empresa, o cargo, o **papel**
(decisor, financeiro, usuário, influenciador, outro) e se é o **contato principal**,
e oferece ligar os negócios abertos da pessoa (sem empresa) a ela. "Desvincular"
solta. Em modo B2C ("vende a pessoas") nada de empresa aparece. Tudo pela rota de
contato que já existia (`PATCH /api/v1/contacts/[id]`, que passou a aceitar
`papel_na_empresa` e `principal_na_empresa`).

### Ficha da empresa (`/app/empresas/<id>`)

Página própria: dados, selo de cliente com compras e total, números (negócios abertos
com valor, total comprado, última interação, negócio mais quente), **contatos com
papel e o principal** (vincular pessoa aqui mesmo), negócios (etapa, valor, dono,
chance), histórico de compras somando todas as pessoas (cada compra diz quem
comprou) e "Editar" com o formulário da lista. A lista `/app/empresas` segue igual.

### Do atendimento ao negócio

No painel do atendimento (`CRMSidePanel`), "Abrir cartão do negócio" leva ao cartão
aberto, e o nome da empresa leva à ficha dela.

### Histórico de compras (contato, empresa e cartão aberto)

Uma régua só (`lib/cartoes/compras.ts`) e um bloco só (`HistoricoDeCompras`):
selo **"Já é cliente"** (1 compra) ou **"Cliente recorrente"** (2+), número de
compras e total, ticket médio, última compra e há quanto tempo, intervalo médio
entre compras, **próxima compra provável** (última + intervalo médio, marcada como
**estimativa**; com uma compra só não há padrão e a tela diz isso), o **hábito**
(o quê, pagamento, finalidade) DERIVADO do que existe e dito assim, e a lista com
data, o que comprou, valor e origem.

Fontes: **negócios ganhos** (`crm_leads.status = 'won'`, valor e `closed_at`) e
**pedidos do contato** (`orders`, a tabela que a ferramenta `crm_list_contact_orders`
lê; contam pago, faturado, enviado e entregue). O pedido entra na régua do negócio
(×100) antes de somar. Na empresa, soma os negócios ligados a ela e os de todas as
pessoas dela, sem contar duas vezes.

### Migration 9013

`contacts.papel_na_empresa` (vocabulário fechado por CHECK) e
`contacts.principal_na_empresa`. Dado pessoal profissional, como `cargo`: vão ao
relatório da LGPD e somem na anonimização (gatilho nosso da 0264, redefinido). Na
fase 6 do plano (empresa única no módulo do upstream), migram para o vínculo de lá.
