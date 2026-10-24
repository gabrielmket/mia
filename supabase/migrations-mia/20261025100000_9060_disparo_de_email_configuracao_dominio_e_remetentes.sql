-- manifest: O DISPARO DE E-MAIL MARKETING, PARTE 1 (item 11 do mapa, .89): a configuracao por empresa (`mia_email_config`: "responder para", rodape obrigatorio com razao social, CNPJ, endereco, motivo e privacidade, ritmo por hora, janela e dias uteis), o dominio verificado na Amazon SES (`mia_email_dominios`: um por empresa, os tokens DKIM, o subdominio de retorno, o resultado de cada um dos seis registros e o degrau do aquecimento de 14 dias) e os remetentes (`mia_email_remetentes`: nome de exibicao e a parte local do endereco, um padrao por empresa). O preco por e-mail entra em `tenant_broadcast_pricing.preco_por_email_cents` (tabela NOSSA; nulo = o padrao de R$ 0,02 do codigo). O modulo vendavel e a chave `email_marketing` em `organization_modules` (texto livre, sem DDL). As tres tabelas sao lidas por gestor ou administrador da propria empresa e escritas SO pelo servidor (as rotas conferem o papel). Nenhum objeto do upstream e tocado. Desenho em docs/fork/email-marketing.md.
--
-- 9060 · o disparo de e-mail: configuração, domínio e remetentes
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `if not exists`,
-- `drop policy if exists`, constraint nova só quando ainda não existe.

-- ── 1. a configuração da empresa ───────────────────────────────────────────
--
-- Uma linha por empresa. Ausência de linha = os padrões do protótipo aprovado
-- (300 por hora, das 8h às 19h, só em dias úteis), lidos pelo código. O rodapé
-- vazio TRAVA o envio: quem lê o e-mail tem de saber quem mandou e por quê.
create table if not exists public.mia_email_config (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- "Responder para": começa com o da marca da empresa (upstream v1.88, #3287).
  responder_para text,
  rodape_razao_social text,
  rodape_cnpj text,
  rodape_endereco text,
  rodape_motivo text,
  rodape_privacidade_url text,
  -- Sem página própria, a empresa pode adotar o texto padrão de privacidade do
  -- sistema (rascunho para revisão jurídica), mostrado na página de preferências.
  rodape_usar_privacidade_padrao boolean not null default false,
  ritmo_por_hora integer not null default 300,
  janela_inicio smallint not null default 8,
  janela_fim smallint not null default 19,
  so_dias_uteis boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint mia_email_config_ritmo check (ritmo_por_hora between 50 and 5000),
  constraint mia_email_config_janela check (
    janela_inicio between 0 and 23 and janela_fim between 1 and 24 and janela_fim > janela_inicio
  ),
  constraint mia_email_config_responder check (
    responder_para is null or responder_para ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  constraint mia_email_config_privacidade check (
    rodape_privacidade_url is null or rodape_privacidade_url ~* '^https://[^\s]+\.[^\s]+'
  )
);

comment on table public.mia_email_config is
  'MIA (9060): a configuracao do disparo de e-mail marketing da empresa: responder para, rodape obrigatorio (razao social, CNPJ, endereco, motivo, privacidade), ritmo por hora, janela e dias uteis no fuso da empresa. Sem linha valem os padroes do codigo (lib/email-marketing/regras.ts). Escrita so pelo servidor.';

-- ── 2. o domínio verificado na Amazon ──────────────────────────────────────
--
-- Um por empresa, e um domínio pertence a UMA empresa: a identidade mora na
-- conta da Amazon da plataforma, que é uma só para todos os clientes.
create table if not exists public.mia_email_dominios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dominio text not null,
  subdominio_de_retorno text not null default 'envio',
  regiao text not null default 'sa-east-1',
  identidade_criada_em timestamptz,
  -- Os três tokens que a Amazon devolve ao criar a identidade (DKIM fácil).
  dkim_tokens text[] not null default '{}'::text[],
  -- O resultado da última conferência de cada um dos seis registros:
  -- {"dkim1":true,"dkim2":true,"dkim3":true,"mx":true,"spf":true,"dmarc":false}.
  registros jsonb not null default '{}'::jsonb,
  verificado_em timestamptz,
  conferido_em timestamptz,
  erro_da_conferencia text,
  -- O aquecimento: o degrau de HOJE (0 = primeiro dia de envio, 200 e-mails) e o
  -- último dia (no fuso da empresa) em que houve envio. Só dia com envio conta.
  aquecimento_degrau smallint not null default 0,
  aquecimento_ultimo_dia date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mia_email_dominios_um_por_empresa unique (organization_id),
  constraint mia_email_dominios_formato check (
    dominio ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  ),
  constraint mia_email_dominios_subdominio check (
    subdominio_de_retorno ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'
  ),
  constraint mia_email_dominios_degrau check (aquecimento_degrau between 0 and 14)
);

create unique index if not exists uq_mia_email_dominios_dominio
  on public.mia_email_dominios (dominio);

comment on table public.mia_email_dominios is
  'MIA (9060): o dominio do remetente da empresa, verificado na Amazon SES (regiao sa-east-1): os tokens DKIM, o subdominio de retorno (MX e SPF), o resultado dos seis registros (3 DKIM, MX, SPF, DMARC) e o degrau do aquecimento (14 degraus de 200 a 20.000 por dia de envio). Sem os seis registros o envio trava. Um dominio por empresa e um dono por dominio. Escrita so pelo servidor.';

-- ── 3. os remetentes ───────────────────────────────────────────────────────
create table if not exists public.mia_email_remetentes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome_exibicao text not null,
  -- A parte antes do @. O domínio é o verificado da empresa.
  local text not null,
  padrao boolean not null default false,
  arquivado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint mia_email_remetentes_local check (local ~ '^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$'),
  constraint mia_email_remetentes_nome check (length(btrim(nome_exibicao)) between 1 and 120)
);

create unique index if not exists uq_mia_email_remetentes_local
  on public.mia_email_remetentes (organization_id, local)
  where arquivado_em is null;

create unique index if not exists uq_mia_email_remetentes_padrao
  on public.mia_email_remetentes (organization_id)
  where padrao and arquivado_em is null;

comment on table public.mia_email_remetentes is
  'MIA (9060): os remetentes do e-mail marketing da empresa (nome de exibicao e parte local, sempre no dominio verificado). Um padrao por empresa. Arquivar em vez de apagar: campanha antiga continua dizendo de quem saiu. Escrita so pelo servidor.';

-- ── 4. o preço por e-mail ──────────────────────────────────────────────────
--
-- Nulo = o padrão de R$ 0,02 por e-mail aceito pela Amazon (decisão do dono do
-- produto em 24/10/2026), definido no código. Zero é cortesia, digitada como tal.
alter table public.tenant_broadcast_pricing
  add column if not exists preco_por_email_cents integer;

do $f$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'tenant_broadcast_pricing_preco_por_email_check'
       and conrelid = 'public.tenant_broadcast_pricing'::regclass
  ) then
    alter table public.tenant_broadcast_pricing
      add constraint tenant_broadcast_pricing_preco_por_email_check
      check (preco_por_email_cents is null or (preco_por_email_cents >= 0 and preco_por_email_cents <= 100000));
  end if;
end
$f$;

comment on column public.tenant_broadcast_pricing.preco_por_email_cents is
  'MIA (9060): centavos por e-mail de marketing ACEITO pela Amazon SES, debitado da mesma carteira. Nulo = o padrao do codigo (R$ 0,02). O teste nao cobra; a rejeicao nao estorna.';

-- ── 5. o relógio de atualização ────────────────────────────────────────────
drop trigger if exists trg_mia_email_config_updated_at on public.mia_email_config;
create trigger trg_mia_email_config_updated_at
  before update on public.mia_email_config
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_mia_email_dominios_updated_at on public.mia_email_dominios;
create trigger trg_mia_email_dominios_updated_at
  before update on public.mia_email_dominios
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_mia_email_remetentes_updated_at on public.mia_email_remetentes;
create trigger trg_mia_email_remetentes_updated_at
  before update on public.mia_email_remetentes
  for each row execute function public.fn_set_updated_at();

-- ── 6. RLS: gestor ou administrador lê a da própria empresa; só o servidor escreve
alter table public.mia_email_config enable row level security;
alter table public.mia_email_dominios enable row level security;
alter table public.mia_email_remetentes enable row level security;

drop policy if exists mia_email_config_select on public.mia_email_config;
create policy mia_email_config_select on public.mia_email_config
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_email_dominios_select on public.mia_email_dominios;
create policy mia_email_dominios_select on public.mia_email_dominios
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_email_remetentes_select on public.mia_email_remetentes;
create policy mia_email_remetentes_select on public.mia_email_remetentes
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.mia_email_config from anon, authenticated;
revoke all on public.mia_email_dominios from anon, authenticated;
revoke all on public.mia_email_remetentes from anon, authenticated;
grant select on public.mia_email_config to authenticated;
grant select on public.mia_email_dominios to authenticated;
grant select on public.mia_email_remetentes to authenticated;
grant all on public.mia_email_config to service_role;
grant all on public.mia_email_dominios to service_role;
grant all on public.mia_email_remetentes to service_role;
