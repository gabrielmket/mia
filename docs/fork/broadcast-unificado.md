# Broadcast unificado (1.21.0-mia.58)

Decisão do Gabriel em 29/09/2026: **um produto só**, chamado **Broadcast**, com a
experiência da tela de Campanhas do upstream como base. O que se une é a TELA, o
NOME e o MENU. Os dois motores continuam separados por baixo.

## O que existia

| | Campanhas (upstream, v1.43+) | Broadcast (fork, "MIA Broadcast" até a .56) |
|---|---|---|
| Tela | `/app/campaigns` (lista, `new`, `[id]`, `[id]/edit`, `settings`) | `/app/broadcast` (tudo numa tela) e `/app/broadcast/[id]` |
| Por onde sai | qualquer número da organização, texto livre | o número oficial da organização, só modelo aprovado |
| Ritmo | o do número (Conexões › Proteção de envio); a campanha só vai mais devagar | 50 por rodada do cron |
| Custo | nenhum por mensagem; o risco é o número ser bloqueado | preço por mensagem, debitado da carteira (`/app/settings/carteira`) |
| Estados | draft, preparing, ready, scheduled, running, paused, completed, cancelled, failed | rascunho, agendada, enviando, pausada, concluida, cancelada |
| Papel | manager (tela e API; RLS também) | manager (tela e API) |
| Módulo | nenhum: todo mundo tinha | `disparador` (`lib/modulos/vendaveis.ts`), vendido por empresa |
| Motor | cron `campaign-worker` → `lib/campanhas/rodada.ts` | cron `broadcast-worker` → `lib/broadcast/motor.ts` |
| Dados | `campaigns`, `campaign_recipients`, `campaign_suppressions`, `campaign_templates`, `campaign_channel_sessions` | `broadcasts`, `broadcast_recipients`, `tenant_wallet_ledger`, `tenant_broadcast_pricing` |

## Como a tela fica

1. **Menu**: um item só, "Broadcast", no hub do CRM ("O dia a dia da venda"),
   para manager ou acima, e só para quem tem o módulo `disparador`.
   "Campanhas" sai do menu, do hub e do ⌘K.
2. **Lista** (`/app/broadcast`), no molde da lista de Campanhas: título, dois
   quadros que dizem o que cada canal custa ("Número oficial": saldo e preço por
   mensagem; "Número por QR": sem custo por mensagem, risco de bloqueio), filtro
   de situação e de canal, e UMA lista com os disparos dos dois motores, do mais
   novo para o mais velho, cada um com o selo do canal e o estado.
3. **Novo disparo** (`/app/broadcast/novo`): a primeira pergunta é **por onde sai**.
   - *Número oficial (Meta)*: modelo aprovado, cobrado por mensagem do crédito.
     O formulário é o do Broadcast, em seções como o de Campanhas (informações,
     público, mensagem, custo). "Montar lista" cria o rascunho e mostra a
     conferência: quantos entram, quantos ficam de fora e por quê, o custo
     estimado; só então "Disparar agora".
   - *Número por QR*: texto livre, sem custo por mensagem, no ritmo do número,
     com o aviso do risco de bloqueio e a lista dos números por QR conectados. O
     botão leva ao formulário de Campanhas do upstream (`/app/campaigns/new`),
     intacto.
4. **Detalhe**: o disparo oficial abre em `/app/broadcast/[id]` (cabeçalho com
   nome, estado, modelo, custo e as ações do estado, e a lista de destinatários);
   o por QR abre no detalhe de Campanhas do upstream (`/app/campaigns/[id]`).
   Todas as telas de `/app/campaigns/*` ganham uma faixa "Broadcast › Número por
   QR" com a volta para a lista unificada.

## O que muda de rota e de menu

- `/app/campaigns` (a lista) **redireciona** para `/app/broadcast`. Quem chega por
  link salvo, pelo "← Campanhas" do detalhe ou pelo "Cancelar" do formulário cai
  na lista unificada.
- `/app/campaigns/new`, `[id]`, `[id]/edit` e `settings` **continuam existindo**,
  alcançadas de dentro do Broadcast.
- Rota nova: `/app/broadcast/novo`.

## A proposta a confirmar: o QR também atrás do módulo

Implementado assim, e isolado para trocar numa linha: `QR_EXIGE_O_MODULO` em
`lib/broadcast/canais-do-disparo.ts`.

- **Ligado (hoje)**: quem não tem o `disparador` não vê nenhum dos dois. As telas
  `/app/campaigns/*` voltam para o Broadcast, que diz "não contratado"; as rotas
  `/api/v1/campaigns*`, `campaign-templates` e `campaign-suppressions` recusam com
  403.
- **Desligado**: o Broadcast aparece para todo manager; sem o módulo, só o
  caminho por QR fica disponível, e o oficial aparece como "não contratado".

A trava fica na PORTA (tela e API), nunca no motor: campanha que já estava
enviando termina. Parar um envio no meio por causa de liberação comercial seria
o remédio pior que a doença, e é a mesma regra que o `broadcast-worker` já segue.

## O que não muda, e por quê

- **Os dois motores, as tabelas e as rotas do upstream.** Juntar motores faria
  toda fusão do upstream conflitar dentro de `lib/campanhas/`, que ele ainda
  muda toda semana. A unificação é de tela.
- **As telas de `/app/campaigns/*` por dentro.** O formulário e o detalhe do QR
  são os do upstream, sem uma linha nossa: melhoria dele entra de graça.
- **A chave do módulo.** Continua `disparador` (gravada em `organization_modules`).
- **A carteira** continua em Configurações › Créditos, só para o disparo oficial.

## Onde mora a diferença do fork

Arquivos nossos: `lib/broadcast/canais-do-disparo.ts`, `lib/broadcast/lista-unificada.ts`,
`lib/broadcast/acesso.ts`, `lib/modulos/recusa-por-recurso.ts`,
`components/broadcast/*`, `app/app/broadcast/**`, `app/app/campaigns/layout.tsx`,
o mapa `docs/architecture/broadcast-unificado.architecture.json` e as cercas
`tests/unit/broadcast-unificado.test.ts` e `tests/e2e/broadcast-unificado.spec.ts`.

Toques em arquivo do upstream, todos pequenos e com comentário "FORK MIA":
`app/app/campaigns/page.tsx` (o redirecionamento), `lib/auth/require-role.ts`
(a trava por módulo, uma chamada), `lib/navigation/catalogo.ts` (sai a entrada
Campanhas), `tests/unit/navegacao-completude.test.ts` (a porta das duas rotas),
`tests/unit/navegacao-registry.test.ts` (o hub do CRM sem Campanhas),
`lib/i18n/dicionario.ts` (espanhol, no bloco do fork) e `.github/workflows/e2e.yml`
(a spec nova).

## Para levar ao upstream (regra 6 do FORK-MIA)

O formulário de Campanhas oferece qualquer número, inclusive o que só entrega
modelo aprovado (o texto livre fora da janela de 24h é recusado depois, pelo
webhook). O filtro certo é pela capacidade `freeformOutsideWindow`, como a
prospecção já faz. Enquanto não volta de lá, o cartão "Número por QR" do
Broadcast lista os números certos pelo nome.
