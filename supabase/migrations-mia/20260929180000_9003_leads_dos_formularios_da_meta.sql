-- 9003 · os leads dos formulários da Meta: a chave, o que importar, o histórico e a deduplicação
--
-- ── O que entra ─────────────────────────────────────────────────────────────
--
-- Os anúncios de cadastro instantâneo da Meta passam a entregar o lead no funil
-- (docs/fork/leads-da-meta.md). A rotina `app/api/v1/cron/leads-da-meta` lê, a
-- cada 5 minutos, os leads novos de cada formulário escolhido e os grava pela
-- mesma via da fonte de webhook (contato, negócio, `webhook_lead_captures`,
-- automações). Estas quatro tabelas são o estado dela:
--
--   · mia_leads_da_meta_config       a chave POR EMPRESA e quantos dias recuperar
--   · mia_leads_da_meta_formularios  o que importar, para qual funil/etapa, e até
--                                    onde já foi lido (a marca de leitura)
--   · mia_leads_da_meta_leituras     o histórico de cada leitura: sucesso, sem
--                                    novos, ou erro com o motivo (sistema vivo)
--   · mia_leads_da_meta_recebidos    a deduplicação pelo id do lead da Meta
--
-- ── Nenhuma guarda dado pessoal, e é de propósito ──────────────────────────
--
-- Nome, telefone, e-mail e respostas ficam onde a LGPD já alcança: `contacts`,
-- `crm_leads` e `webhook_lead_captures`. Aqui mora só o estado da rotina. Nem o id
-- do lead da Meta fica cru: `recebidos.chave_do_lead` é um hash dele. Com o id cru
-- e o token da empresa, alguém buscaria na Meta, por até 90 dias, o nome e o
-- telefone de quem pediu para ser anonimizado; com o hash, a deduplicação funciona
-- e a porta não existe. Por isso também nenhuma tem `contact_id`.
--
-- ── Quem lê e quem escreve ─────────────────────────────────────────────────
--
-- RLS por empresa. Gerente (ou acima) da organização LÊ; ninguém da sessão
-- escreve: toda escrita é das rotas (que conferem papel e módulo) e da rotina, pelo
-- `service_role`. Sem grant de escrita a `authenticated`, as travas do modo
-- somente leitura do suporte (9001) não têm o que travar aqui.
--
-- Nomes com prefixo `mia_`: estender, nunca redefinir (docs/FORK-MIA.md, regra 3).

-- ── a chave por empresa ────────────────────────────────────────────────────
create table if not exists public.mia_leads_da_meta_config (
  organization_id     uuid primary key references public.organizations(id) on delete cascade,
  ativo               boolean not null default false,
  -- Na PRIMEIRA leitura de um formulário, quantos dias para trás buscar. A Meta
  -- guarda 90; zero = só o que chegar daqui para a frente.
  dias_de_recuperacao smallint not null default 7,
  ativado_em          timestamptz,
  atualizado_em       timestamptz not null default now(),
  atualizado_por      uuid references auth.users(id) on delete set null,
  constraint mia_leads_da_meta_config_dias check (dias_de_recuperacao between 0 and 90)
);

comment on table public.mia_leads_da_meta_config is
  'MIA (9003): a chave POR EMPRESA da importacao dos leads dos formularios da Meta. Sem linha, ou ativo=false: a rotina nao le nada desta empresa.';

-- ── o que importar ─────────────────────────────────────────────────────────
create table if not exists public.mia_leads_da_meta_formularios (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  page_id           text not null,
  page_name         text,
  form_id           text not null,
  form_name         text,
  -- chave da pergunta na Meta -> o texto da pergunta, para a captação guardar o
  -- formulário com os rótulos originais. É o formulário, não a resposta.
  perguntas         jsonb not null default '{}'::jsonb,
  pipeline_id       uuid references public.crm_pipelines(id) on delete set null,
  stage_id          uuid references public.crm_stages(id) on delete set null,
  ativo             boolean not null default true,
  -- A marca de leitura: tudo criado na Meta antes dela já foi gravado. Só avança
  -- quando a leitura inteira deu certo.
  lido_ate          timestamptz,
  ultima_leitura_em timestamptz,
  ultimo_status     text,
  ultimo_motivo     text,
  ultimo_detalhe    text,
  importados_total  integer not null default 0,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  atualizado_por    uuid references auth.users(id) on delete set null,
  constraint mia_leads_da_meta_formularios_status
    check (ultimo_status is null or ultimo_status in ('sucesso', 'sem_novos', 'erro'))
);

create unique index if not exists uq_mia_leads_da_meta_formularios_org_form
  on public.mia_leads_da_meta_formularios (organization_id, form_id);

comment on table public.mia_leads_da_meta_formularios is
  'MIA (9003): os formularios da Meta que cada empresa importa, para qual funil/etapa, e ate onde ja foram lidos (lido_ate).';

-- ── o histórico de cada leitura ────────────────────────────────────────────
create table if not exists public.mia_leads_da_meta_leituras (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  formulario_id   uuid not null references public.mia_leads_da_meta_formularios(id) on delete cascade,
  iniciada_em     timestamptz not null default now(),
  terminada_em    timestamptz not null default now(),
  status          text not null,
  novos           integer not null default 0,
  repetidos       integer not null default 0,
  recusados       integer not null default 0,
  motivo          text,
  detalhe         text,
  janela_de       timestamptz,
  janela_ate      timestamptz,
  -- Leituras seguidas com o MESMO desfecho que não é sucesso (sem novos, o mesmo
  -- erro) viram uma linha só com o contador: o histórico fica legível e não vira
  -- 288 linhas de "sem novos" por dia.
  repeticoes      integer not null default 1,
  constraint mia_leads_da_meta_leituras_status check (status in ('sucesso', 'sem_novos', 'erro'))
);

create index if not exists idx_mia_leads_da_meta_leituras_form
  on public.mia_leads_da_meta_leituras (organization_id, formulario_id, terminada_em desc);
create index if not exists idx_mia_leads_da_meta_leituras_poda
  on public.mia_leads_da_meta_leituras (terminada_em);

comment on table public.mia_leads_da_meta_leituras is
  'MIA (9003): o historico de cada leitura dos formularios da Meta (sucesso, sem novos, erro com motivo). Podado pela propria rotina depois de 30 dias.';

-- ── a deduplicação ─────────────────────────────────────────────────────────
create table if not exists public.mia_leads_da_meta_recebidos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- sha-256 do id do lead na Meta, nunca o id cru (ver o cabeçalho).
  chave_do_lead   text not null,
  formulario_id   uuid references public.mia_leads_da_meta_formularios(id) on delete set null,
  form_id         text,
  page_id         text,
  ad_id           text,
  adset_id        text,
  campaign_id     text,
  criado_na_meta  timestamptz,
  desfecho        text not null,
  crm_lead_id     uuid references public.crm_leads(id) on delete set null,
  recebido_em     timestamptz not null default now(),
  constraint mia_leads_da_meta_recebidos_desfecho check (desfecho in ('criado', 'repetido', 'recusado'))
);

create unique index if not exists uq_mia_leads_da_meta_recebidos_org_chave
  on public.mia_leads_da_meta_recebidos (organization_id, chave_do_lead);
create index if not exists idx_mia_leads_da_meta_recebidos_poda
  on public.mia_leads_da_meta_recebidos (recebido_em);

comment on table public.mia_leads_da_meta_recebidos is
  'MIA (9003): cada lead da Meta ja processado (criado, repetido, recusado), pelo hash do id. Deduplica as leituras sobrepostas. Podado depois de 120 dias (a Meta so devolve 90).';

-- ── RLS: gerente lê a própria empresa; só o servidor escreve ───────────────
alter table public.mia_leads_da_meta_config enable row level security;
alter table public.mia_leads_da_meta_formularios enable row level security;
alter table public.mia_leads_da_meta_leituras enable row level security;
alter table public.mia_leads_da_meta_recebidos enable row level security;

drop policy if exists mia_leads_da_meta_config_select on public.mia_leads_da_meta_config;
create policy mia_leads_da_meta_config_select on public.mia_leads_da_meta_config
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_leads_da_meta_formularios_select on public.mia_leads_da_meta_formularios;
create policy mia_leads_da_meta_formularios_select on public.mia_leads_da_meta_formularios
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_leads_da_meta_leituras_select on public.mia_leads_da_meta_leituras;
create policy mia_leads_da_meta_leituras_select on public.mia_leads_da_meta_leituras
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_leads_da_meta_recebidos_select on public.mia_leads_da_meta_recebidos;
create policy mia_leads_da_meta_recebidos_select on public.mia_leads_da_meta_recebidos
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- O default ACL do Supabase dá ALL a anon e authenticated em toda tabela nova;
-- o `grant select` sozinho não o desfaz (lição da 9001).
revoke all on public.mia_leads_da_meta_config from anon, authenticated;
revoke all on public.mia_leads_da_meta_formularios from anon, authenticated;
revoke all on public.mia_leads_da_meta_leituras from anon, authenticated;
revoke all on public.mia_leads_da_meta_recebidos from anon, authenticated;

grant select on public.mia_leads_da_meta_config to authenticated;
grant select on public.mia_leads_da_meta_formularios to authenticated;
grant select on public.mia_leads_da_meta_leituras to authenticated;
grant select on public.mia_leads_da_meta_recebidos to authenticated;

grant select, insert, update, delete on public.mia_leads_da_meta_config to service_role;
grant select, insert, update, delete on public.mia_leads_da_meta_formularios to service_role;
grant select, insert, update, delete on public.mia_leads_da_meta_leituras to service_role;
grant select, insert, update, delete on public.mia_leads_da_meta_recebidos to service_role;
