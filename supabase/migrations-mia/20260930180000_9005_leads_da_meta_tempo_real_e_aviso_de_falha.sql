-- 9005 · leads da Meta: o aviso em tempo real, o telefone em pergunta própria e o aviso quando a leitura para
--
-- ── O que entra ─────────────────────────────────────────────────────────────
--
-- Três passos da importação dos leads dos formulários da Meta
-- (docs/fork/leads-da-meta.md). Nenhuma tabela nova: só colunas nas tabelas
-- NOSSAS da 9003 e um índice parcial na Central de avisos.
--
--   1. TEMPO REAL. A Meta avisa o app (webhook `leadgen`, rota
--      `app/api/v1/webhooks/leads-da-meta`) quando alguém preenche o
--      formulário, e o lead entra em segundos pela MESMA via da leitura a cada 5
--      minutos, que continua como rede de segurança. Para a Meta avisar, a
--      Página tem de estar assinada no app (`subscribed_apps` com o campo
--      `leadgen`), e isso pode ser recusado por permissão: o formulário guarda o
--      resultado da assinatura para a tela dizer o motivo, e quando o último
--      aviso da Meta chegou. `recebidos.via` diz por qual caminho cada lead
--      entrou primeiro.
--
--   2. O TELEFONE EM PERGUNTA PRÓPRIA. Formulário como o da Construtora Delta pergunta
--      o celular numa pergunta criada por eles (`celular:_(ddd_+_número)`) e
--      não no campo padrão `phone_number`. O sistema passa a reconhecer
--      sozinho, e quando errar o administrador escolhe qual pergunta é o
--      telefone, o nome e o e-mail. Guarda-se a CHAVE da pergunta, nunca a
--      resposta.
--
--   3. O AVISO QUANDO A LEITURA PARA. Três falhas seguidas (token vencido,
--      permissão retirada, Página removida) viram UM aviso na Central para os
--      administradores, com o motivo e o que fazer, e o aviso some sozinho
--      quando a leitura volta. `falhas_seguidas` conta; `aviso_de_falha_motivo`
--      é o "já avisei deste problema", que impede repetir a cada 5 minutos.
--
-- ── Nenhuma coluna guarda dado pessoal ─────────────────────────────────────
--
-- Como na 9003: chave de pergunta, estado da assinatura, contador e motivo são
-- estado da rotina. Nome, telefone e respostas continuam em `contacts`,
-- `crm_leads` e `webhook_lead_captures`, que a LGPD já alcança.
--
-- ── Quem lê e quem escreve ─────────────────────────────────────────────────
--
-- As colunas herdam a RLS e os grants da 9003: gerente lê a própria empresa,
-- só o servidor escreve.
--
-- Nomes com prefixo `mia_`: estender, nunca redefinir (docs/FORK-MIA.md, regra 3).

-- ── 1. o tempo real ────────────────────────────────────────────────────────
alter table public.mia_leads_da_meta_formularios
  -- `assinado`: a Página está assinada no app para o campo `leadgen`.
  -- `recusado`: a Meta recusou assinar; o motivo diz o que falta. Nulo: ainda
  -- não tentado (formulário de antes da .62), e a rotina tenta sozinha.
  add column if not exists tempo_real text
    check (tempo_real is null or tempo_real in ('assinado', 'recusado')),
  add column if not exists tempo_real_motivo text,
  add column if not exists tempo_real_detalhe text,
  add column if not exists tempo_real_em timestamptz,
  -- Quando o último lead deste formulário chegou pelo aviso da Meta. É o que
  -- mostra que o tempo real FUNCIONA, e não só que a assinatura foi aceita.
  add column if not exists ultimo_aviso_da_meta_em timestamptz;

alter table public.mia_leads_da_meta_recebidos
  -- Por qual caminho o lead entrou primeiro. O outro caminho o acha já
  -- importado pela mesma chave, e não grava nada.
  add column if not exists via text not null default 'consulta'
    check (via in ('consulta', 'tempo_real'));

-- ── 2. qual pergunta é o telefone, o nome e o e-mail ───────────────────────
alter table public.mia_leads_da_meta_formularios
  -- A CHAVE da pergunta na Meta (`celular:_(ddd_+_número)`), escolhida pelo
  -- administrador. Nulo: automático.
  add column if not exists campo_telefone text,
  add column if not exists campo_nome text,
  add column if not exists campo_email text;

-- ── 3. o aviso quando a leitura falha seguidas vezes ───────────────────────
alter table public.mia_leads_da_meta_formularios
  -- Leituras com erro seguidas. Volta a zero na primeira que dá certo.
  add column if not exists falhas_seguidas integer not null default 0,
  -- O motivo que já foi avisado e quando. Enquanto o problema for o mesmo,
  -- ninguém é avisado de novo; some quando a leitura volta.
  add column if not exists aviso_de_falha_motivo text,
  add column if not exists aviso_de_falha_em timestamptz;

comment on column public.mia_leads_da_meta_formularios.falhas_seguidas is
  'MIA (9005): leituras com erro seguidas deste formulario. Tres (ou doze, se o motivo passa sozinho) viram UM aviso na Central para os administradores.';

-- UM aviso aberto por formulário, garantido no banco: duas rodadas ao mesmo
-- tempo (o relógio e o "Ler agora") não avisam duas vezes. Índice NOSSO numa
-- tabela do upstream, ao lado dos dele (`agent_inbox_routing_unique` é o mesmo
-- desenho): estende, não redefine. `ack` conta como aberto: quem viu o aviso e
-- não resolveu o problema continua com ele.
create unique index if not exists uq_mia_aviso_de_leitura_da_meta_aberto
  on public.agent_inbox_items (organization_id, ref_id)
  where ref_kind = 'mia_leads_da_meta_formulario' and status <> 'resolved';
