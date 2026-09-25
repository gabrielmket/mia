-- 0243 — metas comerciais: quem originou, que tipo de receita é, e o alvo do mês
--
-- O CRM sabia QUANTO uma oportunidade vale e QUEM é o dono dela. Faltavam três
-- coisas para fechar o mês sem planilha à parte:
--
--  1. QUEM ORIGINOU. O card tem um dono (quem fecha). Quando o SDR marca a
--     reunião e o closer fecha, o crédito da venda fica inteiro com o closer, e
--     a participação do SDR vira planilha paralela — que é exatamente o que
--     este CRM existe para matar.
--  2. QUE TIPO DE RECEITA É. Mensalidade e projeto avulso somam igual num total
--     que decide comissão e projeção, e não deveriam: R$ 10 mil recorrentes e
--     R$ 10 mil de setup valem coisas diferentes para o negócio.
--  3. O ALVO. Sem meta gravada, "quanto falta" é conta de cabeça, e acompanhar
--     progresso exige alguém montando o número toda segunda-feira.
--
-- As três entram aqui. O cálculo do progresso NÃO: ele é derivado das mesmas
-- linhas de `crm_leads` que já existem (doutrina DIRC — o que se calcula não se
-- guarda), e vive em `lib/crm/metas/`.

-- ---- 1. o card ganha origem e natureza da receita ---------------------------

alter table public.crm_leads
  add column if not exists originated_by_user_id uuid references auth.users(id) on delete set null;

comment on column public.crm_leads.originated_by_user_id is
  'Quem ORIGINOU a oportunidade (o SDR que marcou a reunião), quando não é a mesma pessoa que fecha (owner_user_id). NULL = originada pelo próprio dono, ou origem não registrada. Existe para a meta de participação do SDR sair do mesmo lugar onde a venda é registrada, em vez de uma planilha paralela.';

alter table public.crm_leads
  add column if not exists revenue_kind text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_leads_revenue_kind_enum') then
    alter table public.crm_leads
      add constraint crm_leads_revenue_kind_enum
      check (revenue_kind is null or revenue_kind in ('recorrente', 'avulso'));
  end if;
end $$;

comment on column public.crm_leads.revenue_kind is
  'recorrente = mensalidade/assinatura; avulso = projeto, setup, venda única. NULL = não classificada, e a tela DIZ isso em vez de escolher um lado — somar uma venda não classificada como avulsa inventaria a divisão que o relatório existe para mostrar.';

alter table public.crm_leads
  add column if not exists recurring_months integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_leads_recurring_months_check') then
    alter table public.crm_leads
      add constraint crm_leads_recurring_months_check
      check (recurring_months is null or (recurring_months > 0 and recurring_months <= 120));
  end if;
end $$;

comment on column public.crm_leads.recurring_months is
  'Duração do contrato em meses, para receita recorrente. Com ela, `value_cents` (a mensalidade) vira valor de contrato e receita anual sem ninguém multiplicar na mão. NULL em receita avulsa, e em recorrente sem prazo definido.';

create index if not exists idx_crm_leads_originado_por
  on public.crm_leads (organization_id, originated_by_user_id, closed_at)
  where originated_by_user_id is not null;

-- ---- 2. a meta do mês -------------------------------------------------------
--
-- Uma linha por (organização, mês, métrica, quem). "Quem" é a organização
-- inteira (user_id e agent_id nulos), uma PESSOA, ou um AGENTE de IA — porque a
-- meta de reunião marcada vale tanto para o SDR quanto para a Mia.

create table if not exists public.sales_targets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  -- Sempre o dia 1: mês é a unidade de meta comercial, e guardar o dia exato
  -- criaria duas metas "de setembro" que não se encontram.
  periodo          date not null,
  metrica          text not null,
  alvo_cents       bigint,
  alvo_quantidade  integer,
  user_id          uuid references auth.users(id) on delete cascade,
  agent_id         uuid,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sales_targets_metrica_enum check (metrica in (
    'reunioes',            -- atividade: reuniões marcadas no mês
    'receita_total',       -- tudo que foi ganho
    'receita_recorrente',  -- só mensalidade
    'receita_avulsa',      -- só projeto/setup
    'receita_originada'    -- a participação de quem ORIGINOU (a meta do SDR)
  )),
  -- Meta de dinheiro tem alvo em centavos; meta de atividade, em quantidade.
  -- Uma linha com os dois (ou com nenhum) não tem como ser exibida nem cobrada.
  constraint sales_targets_alvo_coerente check (
    (metrica = 'reunioes' and alvo_quantidade is not null and alvo_cents is null)
    or (metrica <> 'reunioes' and alvo_cents is not null and alvo_quantidade is null)
  ),
  constraint sales_targets_alvo_positivo check (
    coalesce(alvo_cents, 1) > 0 and coalesce(alvo_quantidade, 1) > 0
  ),
  -- Pessoa OU agente, nunca os dois: a meta é de um responsável só.
  constraint sales_targets_um_responsavel check (user_id is null or agent_id is null),
  constraint sales_targets_periodo_no_dia_1 check (extract(day from periodo) = 1)
);

comment on table public.sales_targets is
  'A meta de cada mês, por métrica e por responsável (organização inteira, uma pessoa, ou um agente de IA). O PROGRESSO não mora aqui: é derivado de crm_leads e de agendamentos, na leitura — o que se calcula não se guarda, senão a meta e a realidade divergem em silêncio.';

-- Índice único com as colunas nuláveis normalizadas: sem o coalesce, o Postgres
-- trata cada NULL como distinto e a mesma meta pode ser cadastrada duas vezes.
create unique index if not exists idx_sales_targets_unica
  on public.sales_targets (
    organization_id,
    periodo,
    metrica,
    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(agent_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists idx_sales_targets_org_periodo
  on public.sales_targets (organization_id, periodo desc);

alter table public.sales_targets enable row level security;

drop policy if exists "sales_targets_select" on public.sales_targets;
create policy "sales_targets_select" on public.sales_targets
  for select using (organization_id in (select fn_user_org_ids()));

-- Escrever meta é decisão de gestão: manager+ define, o time acompanha.
drop policy if exists "sales_targets_write" on public.sales_targets;
create policy "sales_targets_write" on public.sales_targets
  for all using (
    organization_id in (select fn_user_org_ids())
    and fn_role_at_least(organization_id, 'manager')
  )
  with check (
    organization_id in (select fn_user_org_ids())
    and fn_role_at_least(organization_id, 'manager')
  );

revoke all on public.sales_targets from anon;
grant select, insert, update, delete on public.sales_targets to authenticated, service_role;

drop trigger if exists trg_sales_targets_touch on public.sales_targets;
create trigger trg_sales_targets_touch
  before update on public.sales_targets
  for each row execute function public.fn_set_updated_at();

notify pgrst, 'reload schema';
