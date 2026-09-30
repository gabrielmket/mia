-- 0247 — MIA Broadcast: a campanha e cada mensagem dela
--
-- A 0244 deu a carteira (crédito, preço, trava de saldo). Isto é o que gasta
-- esse crédito: uma CAMPANHA (o que vai ser enviado, para quem, por qual
-- número) e uma linha POR DESTINATÁRIO, que é onde mora a verdade.
--
-- ── Por que uma linha por destinatário, e não um contador ───────────────────
--
-- Um campo `enviadas: 1832` responde "quantas" e não responde a pergunta que
-- aparece no dia seguinte: "o fulano recebeu?". Sem a linha, também não há onde
-- pendurar o id que a Meta devolveu — e sem esse id o webhook de entrega não
-- tem em que casar o "entregue"/"lido"/"falhou" que chega depois.
--
-- A linha é ainda o que torna a COBRANÇA auditável: cada débito na carteira
-- aponta para uma destas linhas (`ref_kind='broadcast_message'`), e o índice
-- único da 0244 usa esse id. Contador não tem id.
--
-- ── O estado é do ENVIO, não da campanha ────────────────────────────────────
--
--   pendente  → ainda não saiu
--   enviada   → a Meta ACEITOU (é quando se cobra: é o que ela fatura)
--   entregue  → chegou no aparelho (webhook)
--   lida      → foi aberta (webhook)
--   falhou    → a Meta recusou, ou o envio estourou
--   estornada → falhou DEPOIS de cobrada, e o crédito voltou
--
-- ⚠️ `enviada` é o marco da cobrança, e não `entregue`. A Meta cobra o que
-- aceita; esperar a entrega para debitar deixaria o cliente com saldo que ele
-- não tem mais, e o débito dependendo de um webhook que pode não vir.
--
-- ── Cobrar em cima de QUAL preço ────────────────────────────────────────────
--
-- O preço vai gravado na linha (`preco_cents`), e não lido da tabela de preço
-- na hora de somar. Preço acordado muda; um relatório que multiplica o volume
-- de junho pelo preço de hoje reescreve o passado, e a conversa sobre a fatura
-- de junho vira discussão sobre o que estava combinado naquele mês.

create table if not exists public.broadcasts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  nome             text not null,
  -- Por onde sai. É a sessão do canal oficial: o número, a WABA e a credencial.
  channel_session_id uuid references public.channel_sessions(id) on delete set null,
  -- O template APROVADO, pelo par que a Meta usa para identificá-lo.
  template_name    text not null,
  template_language text not null,
  /**
   * Os valores das variáveis, por POSIÇÃO, quando são iguais para todo mundo.
   * O que muda por pessoa (o nome, por exemplo) sai do contato na hora do
   * envio — ver `broadcast_recipients.valores`.
   */
  valores_padrao   jsonb not null default '{}'::jsonb,
  status           text not null default 'rascunho',
  -- O preço acordado no momento em que a campanha foi DISPARADA. Ver o cabeçalho.
  preco_cents      integer,
  agendado_para    timestamptz,
  iniciado_em      timestamptz,
  concluido_em     timestamptz,
  /** Por que parou, quando parou sozinha (saldo, qualidade do número). */
  motivo_da_parada text,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint broadcasts_status_check check (status in (
    'rascunho',   -- sendo montada, ainda não cobra nada
    'agendada',   -- vai começar na hora marcada
    'enviando',
    'pausada',    -- parou e PODE continuar (saldo acabou, qualidade caiu)
    'concluida',
    'cancelada'
  )),
  constraint broadcasts_preco_check check (preco_cents is null or preco_cents >= 0)
);

comment on table public.broadcasts is
  'Campanha do MIA Broadcast: o que sera enviado, por qual numero, com qual template. O preco vai GRAVADO na campanha (preco_cents) porque preco acordado muda, e relatorio que multiplica volume antigo por preco de hoje reescreve o passado.';

comment on column public.broadcasts.status is
  'rascunho | agendada | enviando | pausada | concluida | cancelada. PAUSADA e diferente de cancelada: ela para e pode continuar (saldo acabou, qualidade do numero caiu), e motivo_da_parada diz qual dos dois.';

create index if not exists idx_broadcasts_org
  on public.broadcasts (organization_id, created_at desc);

-- Fila de quem está para enviar: é por este índice que o motor pega o próximo
-- lote sem varrer campanha concluída.
create index if not exists idx_broadcasts_na_fila
  on public.broadcasts (status, agendado_para)
  where status in ('agendada', 'enviando');

alter table public.broadcasts enable row level security;

drop policy if exists broadcasts_select on public.broadcasts;
create policy broadcasts_select on public.broadcasts
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );

-- Criar e disparar campanha é decisão de gestão: cada mensagem custa dinheiro
-- do cliente, e quem atende não decide gastar.
drop policy if exists broadcasts_write on public.broadcasts;
create policy broadcasts_write on public.broadcasts
  for all to authenticated
  using (
    (organization_id in (select public.fn_user_org_ids()))
    and public.fn_role_at_least(organization_id, 'manager')
  )
  with check (
    (organization_id in (select public.fn_user_org_ids()))
    and public.fn_role_at_least(organization_id, 'manager')
  );

revoke all on public.broadcasts from anon;
grant select, insert, update, delete on public.broadcasts to authenticated;
grant select, insert, update on public.broadcasts to service_role;

-- ---- uma linha por destinatário -------------------------------------------

create table if not exists public.broadcast_recipients (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  broadcast_id     uuid not null references public.broadcasts(id) on delete cascade,
  contact_id       uuid references public.contacts(id) on delete set null,
  -- O telefone vai COPIADO, e não só referenciado: o contato pode ser anonimizado
  -- (LGPD) ou apagado, e o relatório de um disparo que já aconteceu não pode
  -- virar uma lista de linhas sem destinatário.
  phone_e164       text not null,
  /** O que muda por pessoa, por posição: {"1": "Gabriel"}. */
  valores          jsonb not null default '{}'::jsonb,
  status           text not null default 'pendente',
  /** O id da Meta. É por ele que o webhook casa entrega, leitura e falha. */
  external_id      text,
  erro             text,
  /** Quanto ESTA mensagem custou ao cliente. Nulo enquanto não foi cobrada. */
  preco_cents      integer,
  enviado_em       timestamptz,
  atualizado_em    timestamptz,
  created_at       timestamptz not null default now(),
  constraint broadcast_recipients_status_check check (status in (
    'pendente', 'enviada', 'entregue', 'lida', 'falhou', 'estornada'
  ))
);

comment on table public.broadcast_recipients is
  'Uma linha por destinatario. Um contador nao responde "o fulano recebeu?", nao tem onde pendurar o id da Meta (sem o qual o webhook de entrega nao casa com nada) e nao da id para o debito da carteira apontar.';

comment on column public.broadcast_recipients.phone_e164 is
  'COPIADO do contato de proposito: o contato pode ser anonimizado pela LGPD ou apagado, e o relatorio de um disparo que ja aconteceu nao pode virar lista de linhas sem destinatario.';

comment on column public.broadcast_recipients.preco_cents is
  'O que ESTA mensagem custou. Nulo = ainda nao cobrada. O debito na carteira aponta para esta linha por ref_id, e o indice unico da 0244 e o que impede cobrar duas vezes na retentativa.';

-- O MESMO contato não entra duas vezes na MESMA campanha. Sem isto, montar a
-- lista duas vezes (ou um clique duplo) cobraria o cliente duas vezes e mandaria
-- a mesma mensagem para a mesma pessoa — que é o que faz bloquear.
create unique index if not exists uq_broadcast_recipients_sem_repetido
  on public.broadcast_recipients (broadcast_id, phone_e164);

create index if not exists idx_broadcast_recipients_fila
  on public.broadcast_recipients (broadcast_id, status);

-- O webhook chega com o id da Meta e precisa achar a linha por ele.
create index if not exists idx_broadcast_recipients_external
  on public.broadcast_recipients (organization_id, external_id)
  where external_id is not null;

alter table public.broadcast_recipients enable row level security;

drop policy if exists broadcast_recipients_select on public.broadcast_recipients;
create policy broadcast_recipients_select on public.broadcast_recipients
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );

revoke all on public.broadcast_recipients from anon;
grant select on public.broadcast_recipients to authenticated;
-- A escrita é do MOTOR (service_role): quem monta a lista é a rota, quem marca
-- enviada/falhou é o worker. Nenhum dos dois é o navegador do cliente.
grant select, insert, update on public.broadcast_recipients to service_role;
