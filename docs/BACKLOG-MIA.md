# MIA — o que falta

Atualizado em 18/09/2026. Ordenado por bloco; dentro de cada bloco, por valor.

> Esta lista é viva. Item concluído sai daqui e vira linha no histórico do git.

---

## Fechado e no ar (`v1.21.0-mia.26`)

Fatura da OpenAI (cron provado rodando sozinho) · metas e relatório de vendas ·
reunião marcada e no-show · liberação por módulo · MIA Broadcast fases 1 e 2
(carteira, motor, margem, templates pela plataforma) · webhook multi-WABA ·
credencial do canal por service role · disparo virando mensagem na conversa ·
ver destinatários com erro por linha · QR sem piscar · chave de IA fora da vista
do cliente · seletor de tags com contagem · editar e excluir campanha · agendar
campanha · cabeçalho com imagem no template · meta do mês voltando a gravar.

**Na próxima imagem** (ainda não cortada): o **aviso no grupo** na passagem de
bastão — número da plataforma no painel administrativo, grupo escolhido pelo
nome em cada cliente, e o recado saindo dos dois motores de handoff com dedup
compartilhado. Ver o Bloco G.

---

## ~~Bloco A — Disparador~~ — FECHADO

> Os oito itens entregues. O disparador tem tags com contagem, etapa do funil,
> edição e exclusão de campanha, agendamento, custo por cliente, tela própria
> por campanha, edição e exclusão de template, e cabeçalho com imagem sem
> precisar hospedar arquivo.

### O que era

| # | o que | tamanho | por quê |
|---|---|---|---|
| ~~A1~~ | ~~**Seletor de tags** em vez de texto livre~~ | — | seletor de tags com contagem, na tela da campanha |
| ~~A2~~ | ~~**Editar campanha** completo (trocar template, remontar lista)~~ | — | trocar template, renomear e remontar a lista |
| ~~A3~~ | ~~**Agendar campanha**~~ | — | agendar campanha pela tela — o worker já sabia, faltava quem criasse |
| ~~A4~~ | ~~**Gravar o custo que vem no webhook** e mostrar a quem paga~~ | — | `/admin/custo-da-meta`: categoria e cobrança por mensagem + tabela de preços nossa |
| ~~A5~~ | ~~**Tela própria por campanha**~~ | — | `/app/broadcast/[id]` com resumo clicável por estado, filtro e paginação |
| ~~A6~~ | ~~**Filtrar por tag do lead e etapa do funil**~~ | — | Funil + Etapa ao lado das tags; só negócio ABERTO, e a mesma regra vale ao editar |
| ~~A7~~ | ~~**Editar/excluir template**~~ | — | editar e excluir na tela, com o aviso de que editar aprovado volta para análise |
| ~~A8~~ | ~~**Cabeçalho com imagem/vídeo** e botões de link/telefone~~ | — | cabeçalho com imagem, e o arquivo sobe direto sem precisar de hospedagem pública |

---

## Bloco B — Defeitos que queimam conversa de cliente

| # | o que | tamanho | por quê |
|---|---|---|---|
| ~~B1~~ | ~~**A despedida de 6 segundos**~~ | — | **corrigido**, e o diagnóstico que estava aqui era FALSO. Não era "olha a conversa errada": a detecção sempre foi por CONTATO. A resposta do lead FOI vista, acordou a espera e empurrou a régua para o passo seguinte — que era a despedida. `cancel_on_reply` passou a valer também para a espera ativa (`lib/followup/reactivity.ts`) |
| B1-a | **Decidir o PADRÃO da régua** (ver abaixo) | decisão | o conserto vale para quem ligou `cancel_on_reply`. Quem não ligou continua tendo a própria resposta usada para empurrar a régua adiante — e isso é escolha de produto, não bug |

### B1-a, em português

Um lead está numa régua de follow-up, parado num nó de espera. **Ele responde.**
O que a régua deve fazer, por padrão, para quem não configurou nada?

1. **Seguir em frente** (hoje) — a resposta acorda a espera e o motor vai para o
   próximo passo. Se o próximo passo for a despedida, ele se despede de alguém
   que acabou de falar com a gente.
2. **Encerrar a régua** — respondeu, então a régua cumpriu o papel e sai de cena;
   a conversa segue com o agente ou com uma pessoa.
3. **Sair por uma porta própria** — o autor da régua desenha o que acontece
   quando alguém responde, e a régua só segue por ali.

A 2 é o que quase todo mundo espera ao ler "follow-up". A 3 é a mais correta e a
mais trabalhosa. A 1 é a que está no ar.

---

## Bloco B2 — Pacing e alertas (auditoria de 18/09)

Detalhe e evidências em `docs/audits/2026-09-18-pacing-janela-adiada-e-alertas-fantasma.md`.

| # | o que | tamanho | por quê |
|---|---|---|---|
| ~~B2-1~~ | ~~**Alargar a janela reprograma turno adiado**~~ | — | feito: `job_queue.motivo` em coluna própria (não string livre), `rescheduleJob` grava sempre, e o `PUT /api/v1/ai/pacing` chama `reprogramarTurnosAdiadosPelaJanela` quando um campo de JANELA muda — só janela, porque cap diário e horário do agente dependem de outra condição e voltariam cedo demais |
| ~~B2-2~~ | ~~**Gatilho de `updated_at` em `channel_knobs`**~~ | — | feito (migration 0260): gatilho, não conserto do upsert — pega SQL direto e rota futura também |
| B2-3 | ~~Resolver `conhecimento_nao_indexado`~~ + ~~varredura dos `kind`~~ | — | feito em 18/09 — resultado abaixo |

### ~~O resultado da varredura (18/09): 19 de 26 alertas não têm quem os feche~~ — RESOLVIDO

> Fechado por `lib/inbox-do-agente/como-cada-aviso-fecha.ts` + o cron
> `varredura-de-avisos`: todo `kind` agora é OBRIGADO pelo compilador a
> declarar como deixa de valer (condição, idade ou decisão humana), e o vigia
> aplica. Os que só uma pessoa fecha estão declarados como tal, com o motivo —
> isso não é dívida, é a resposta certa escrita.

#### O diagnóstico original

Auditados todos os `kind` de `agent_inbox_items`. **Só 7 são resolvidos por
algum caminho automático.** Os outros 19 ficam abertos até alguém fechar à mão —
e a maioria tem condição que se desfaz sozinha, então o aviso passa a mentir.

**Consertados em 18/09** (a condição se desfaz e agora o aviso morre junto):

- `handoff` — fecha ao devolver o atendimento à IA. ⚠️ Era o mais grave de
  todos: a chave de dedup de quem ABRE exige que não haja item aberto para
  aquele contato, então o aviso velho **calava o handoff novo e real**.
- `snooze_expired` — fecha quando o lead responde, ainda que atrasado.
- `conhecimento_nao_indexado` — fechado no ramo de sucesso da indexação.

**Ainda abertos, por gravidade:**

| gravidade | kinds |
|---|---|
| **alta** | `midia_nao_lida`, `channel_template_review`, `channel_number_alert` (fecha só em parte), `promise_unfulfilled`, `job_dead`, `next_action_ambiguous`, `reactivation_expired`, `capabilities_missing` |
| **média** | `voice_call_missed`, `event_dead`, `followup_dead`, `promotion_review`, `risk_backlog_seeded` |
| **baixa** | `message_send_stuck`, `contact_proposal_expired`, `judge_unaligned` |

Dois casos merecem nota própria:

- **`job_dead`** — o cabeçalho de `queue.ts` registra um incidente real desta
  VPS: 49 jobs mortos numa rajada de segundos por limite de taxa da OpenAI. O
  limite cede em minutos; os 49 avisos críticos ficam para sempre. E `dead` é
  terminal — nada ressuscita o job, então nem existe a ação que fecharia o item.
  Precisa de decisão: agrupar por causa, expirar sozinho, ou virar outra coisa.
- **`event_dead`** — o oposto do órfão: declarado no CHECK, com rótulo de tela
  e orientação ao operador, e **ninguém o emite**. O dead-letter real
  (`drain.ts`) só faz `log.error`. Um evento que morre em definitivo não deixa
  uma linha na Central. A tela promete um aviso que nunca chega.

## Bloco C — Empresa (o CRM virar B2B de verdade)

| # | o que | tamanho |
|---|---|---|
| C1 | ~~Entidade **empresa** + vínculo do contato~~ · **falta cargo e setor** | pequeno (o que sobrou) |
| C2 | **Modo B2B/B2C por organização** — cliente B2C nunca vê que empresa existe | incluído em C1 |
| C3 | Adaptar **cartão do funil** e **painel do atendimento** | incluído em C1 |
| C4 | **Fusão de empresas duplicadas** (contato já tem; empresa vai precisar) | incluído em C1 |
| C5 | **A Rafa perguntar o nome da empresa** — sem isso o campo nasce vazio | pequeno, depende de C1 |
| C6 | **Campos adicionais** por organização, em EMPRESA e em LEAD | médio, junto de C1 |

Sobre o C6, pedido do Gabriel em 18/09: o cadastro precisa de campo livre além
do núcleo. É o terceiro nível do desenho — **núcleo** (o que o sistema usa),
**derivado** (o que ele calcula) e **livre** (o que cada cliente precisa).
O que a clínica precisa não é o que a imobiliária precisa, e adivinhar isso no
schema é como se acumula campo morto.

Regra que segura o desenho: **a conversa é sempre com uma PESSOA**. WhatsApp é
número de telefone; empresa é vínculo do contato, nunca substituto. Isso mantém
inbox, janela de 24h e agente intocados.

---

## Bloco D — Canais

| # | o que | tamanho | estado |
|---|---|---|---|
| D1 | **Ligar chamada de voz** (WaCalls) | pequeno | já construído; falta o contêiner no compose do EasyPanel, dois segredos e ativar por organização |
| D2 | **Disparador fase 3** — cadastro embutido | — | bloqueado: depende de virar Tech Provider da Meta |
| D3 | **Instagram Direct** | — | bloqueado na Meta |

---

## Bloco E — Plataforma e operação

| # | o que | tamanho | por quê |
|---|---|---|---|
| E1 | **Aba "Uso"** do admin — custo de **IA** por cliente | médio | o custo de MENSAGEM já tem tela (`/admin/custo-da-meta`); o de IA por tenant ainda se levanta na mão por SQL |
| ~~E2~~ | ~~**Tela de modelo padrão da plataforma**~~ | — | `/admin/modelo-de-ia`: vale para todo cliente novo, e a aba Operação deixou de ser a porta dos fundos |
| E3 | **Aba "Equipe"** do admin | médio | placeholder declarado na navegação e nunca construído |
| E4 | **Ligar agregação de logs** na VPS | pequeno | Loki está zerado; sem log do servidor, defeito em produção é diagnosticado por eliminação |
| E5 | ~~Desligar o workflow `release`~~ | — | feito em 18/09 |
| E7 | **A página legal nomeia o CLIENTE como controlador** | pequeno | `lib/legal/operador.ts` lê a organização ATIVA da sessão. Num self-host (uma instalação, um operador) está certo; no modelo gerenciado as organizações são CLIENTES, e o operador é sempre a Time Company. Aberta com a Academia Reativa selecionada, `/legal/privacy` declara que a Reativa controla os dados da instalação. Mesma família do custo de IA e da chave: a suposição de operador único não vale aqui. O operador deveria vir de `platform_branding`, não da sessão. |
| E6 | **MCP de administração da plataforma** | médio | hoje implantar cliente é tela por tela; especificação fica para quando o item subir |

Sobre o E6, pedido do Gabriel em 18/09. O que já se sabe do desenho:

- O MCP atual é **por organização** (o token carrega um `organizationId` e um
  papel) e o catálogo só tem operações de dentro de um cliente. Administração
  não existe nele — é **servidor novo**, não extensão.
- As rotas de administração **já existem e já exigem admin de plataforma**
  (`/api/v1/admin/tenants`, `/admin/carteira`, módulos). O MCP é camada fina
  por cima; a permissão não precisa ser reinventada.
- ⚠️ "Acesso total" é o que cria o estrago: o token de hoje erra dentro de um
  cliente, um de plataforma erra em todos — e mora num arquivo de configuração
  que qualquer sessão carrega. Escopar pelo que se repete ao implantar (criar
  organização, liberar módulo, conectar canal, definir preço, lançar crédito,
  criar template) resolve o mesmo problema sem o raio.
- Leitura livre, escrita nomeada e auditada com o token como autor.
- **Ordem:** rende mais DEPOIS do bloco C (empresa e campos adicionais) — aí dá
  para implantar um cliente inteiro por conversa, cadastro incluído.

---

## Fora do meu alcance — do Gabriel

- **Revisar o preço ao cliente** (R$ 0,12 nos testes) agora que se sabe que o
  custo da Meta é do cliente, não nosso
- **Virar Tech Provider** da Meta — destrava D2 e D3
- **Conferir a fatura da Meta** depois dos testes, para saber o valor unitário real

---

## Entregue entre a .29 e a .32

| o quê | onde |
|---|---|
| Modelo de IA escolhido pela plataforma (e a aba Operação deixou de ser a porta dos fundos) | `/admin/modelo-de-ia` |
| Cadastro incorporado da Meta, ao lado da conexão manual | `/admin/cadastro-incorporado` + Conexões |
| Report interno no grupo: crédito acabando, número caído, resumo diário | `/admin/numero-de-avisos` |
| Parear o número de avisos na própria tela, com QR | `/admin/numero-de-avisos` |
| Empresas: o cliente que é organização, com contatos e negócios | `/app/empresas` |
| Trabalho parado: fila morta agrupada pela causa, com volta | `/admin/fila-morta` |
| Arquivo na campanha sem hospedagem pública (+ nome no PDF) | tela da campanha |
| Custo das mensagens da Meta por cliente | `/admin/custo-da-meta` |
| Todo aviso da Central declara como fecha, e um vigia aplica | Central |
| Segmentar campanha pela etapa do funil | tela da campanha |

---

## Bloco G — Aviso no grupo (entregue; o que sobra é operação)

O time comercial do cliente não vive na tela do CRM: ele trabalha num grupo de
WhatsApp. A passagem de bastão já registrava (Central, fila, timeline) e não
**chamava** ninguém. Agora chama.

**Como ficou.** O número é da PLATAFORMA — um só, marcado em
`/admin/numero-de-avisos`, e é lá também que se escolhe, **pelo nome**, o grupo
de cada empresa (guardado em `organizations.settings.grupo_de_avisos`). O recado
sai colado ao item de Central do handoff, e só quando ele é recém-aberto: os
dois motores (`performHumanHandoff` e `triggerHandoff`) deduplicam um contra o
outro, então uma conversa escalada duas vezes rende um recado, não dois.

⚠️ **Ponto único de falha assumido.** Se esse número cair, NENHUM cliente recebe
aviso. A contrapartida já está de pé: ele é uma sessão como as outras, entra no
vigia de `channel-health` e a tela do admin mostra a saúde dele em destaque.

| # | o que falta | tamanho | por quê |
|---|---|---|---|
| G1 | **Conectar o número pela própria tela do admin** (QR ali dentro) | médio | hoje conecta-se em Conexões, no tenant de quem opera, e só depois marca no painel — dois passos onde a cabeça de quem implanta enxerga um |
| G2 | **Aviso quando o número de avisos cai** chegando a quem OPERA | pequeno | o vigia abre o item na Central da organização dona do número; se ninguém abrir aquela Central, a queda continua invisível |
| G3 | **Grupo por agente**, e não só por empresa | médio | cliente com dois times (venda e suporte) quer bastão em grupos diferentes — só aparece quando acontecer |
| G4 | **Tirar o número de avisos do seletor de atendimento** | pequeno | ele continua listado em Conexões da org que o conectou (e precisa continuar: é por ali que se lê o QR e se reconecta), mas nada impede alguém de amarrar um agente nele por engano |
