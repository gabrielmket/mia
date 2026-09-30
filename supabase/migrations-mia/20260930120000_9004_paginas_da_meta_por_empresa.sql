-- 9004 · cada Página da Meta é de UMA empresa, e quem decide é a plataforma
--
-- ── O buraco que isto fecha ─────────────────────────────────────────────────
--
-- Na .60 a tela Configurações › Formulários da Meta listava TODAS as Páginas que
-- o token alcança. O token que existe é o da agência (o usuário do sistema do
-- Gerenciador da Time Company), e ele enxerga as Páginas de vários clientes. Com
-- esse token colado numa empresa, o admin dela via as Páginas dos outros e podia
-- escolher o formulário de uma delas: os leads do vizinho nasceriam no funil dele.
--
-- ── A regra ─────────────────────────────────────────────────────────────────
--
--   · cada Página tem no máximo UM dono (`page_id` é a chave primária);
--   · quem atribui é o dono da plataforma (/admin/paginas-da-meta, service_role);
--   · a empresa só vê e só configura formulário de Página dela;
--   · Página sem dono não aparece para empresa nenhuma.
--
-- ── Garantido no banco, não só na tela ─────────────────────────────────────
--
-- A invariante: **todo formulário ATIVO é de uma Página atribuída à MESMA
-- empresa.** Dois gatilhos a mantêm, um de cada lado:
--
--   1. em `mia_leads_da_meta_formularios`, antes de gravar: formulário ativo de
--      Página que não é da empresa é RECUSADO (42501), venha de onde vier;
--   2. em `mia_paginas_da_meta`, depois de atribuir, trocar ou retirar o dono:
--      os formulários ativos de OUTRAS empresas naquela Página são desligados,
--      com o motivo gravado para a tela delas mostrar.
--
-- Desligar é sempre permitido (formulário inativo não é lido). E a rotina confere
-- a mesma coisa de novo no código, antes de chamar a Meta (lib/leads-da-meta/paginas.ts).
--
-- ── A conexão da plataforma ─────────────────────────────────────────────────
--
-- Só a Time Company tem conexão de leitura (`ad_insights_connections`, a de
-- Configurações › Meta Ads). Uma empresa cliente sem conexão própria não teria
-- como ler os leads da Página dela. `mia_meta_conexao_da_plataforma` diz QUAL
-- empresa empresta a conexão, e ela só é usada para as Páginas atribuídas à
-- empresa que lê: nunca lista, nem lê, Página de outra. Linha única, RLS ligada
-- e zero policies (como `platform_ia`, `platform_meta`): só o servidor lê.
--
-- Nomes com prefixo `mia_`: estender, nunca redefinir (docs/FORK-MIA.md, regra 3).

-- ── o dono de cada Página ──────────────────────────────────────────────────
create table if not exists public.mia_paginas_da_meta (
  page_id         text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- O nome como a Meta devolveu na hora da atribuição. É o que a tela mostra
  -- antes de consultar a Meta, e o que sobra quando a Página some do token.
  page_name       text,
  atribuida_em    timestamptz not null default now(),
  atribuida_por   uuid references auth.users(id) on delete set null,
  constraint mia_paginas_da_meta_page_id check (page_id ~ '^[0-9]{1,30}$')
);

create index if not exists idx_mia_paginas_da_meta_org
  on public.mia_paginas_da_meta (organization_id);

comment on table public.mia_paginas_da_meta is
  'MIA (9004): de qual empresa e cada Pagina da Meta. Uma Pagina, um dono (page_id e a chave). Quem atribui e o dono da plataforma; a empresa so ve e so importa formulario de Pagina dela.';

-- ── a conexão que a plataforma empresta ────────────────────────────────────
create table if not exists public.mia_meta_conexao_da_plataforma (
  id                      smallint primary key default 1,
  -- A empresa cuja conexão de Meta Ads (Configurações › Meta Ads) lê as Páginas
  -- atribuídas a quem não tem conexão própria. Não é dado de uma empresa: é
  -- configuração da instalação, por isso não se chama `organization_id`.
  organizacao_da_conexao  uuid references public.organizations(id) on delete set null,
  atualizado_em           timestamptz not null default now(),
  atualizado_por          uuid references auth.users(id) on delete set null,
  constraint mia_meta_conexao_da_plataforma_singleton check (id = 1)
);

comment on table public.mia_meta_conexao_da_plataforma is
  'MIA (9004): qual empresa empresta a conexao de Meta Ads para ler as Paginas atribuidas a quem nao tem conexao propria. Linha unica id=1; so o servidor le. Usada so para Pagina atribuida a empresa que le.';

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.mia_paginas_da_meta enable row level security;
alter table public.mia_meta_conexao_da_plataforma enable row level security;

-- Gerente (ou acima) lê as Páginas da PRÓPRIA empresa; a plataforma lê todas.
drop policy if exists mia_paginas_da_meta_select on public.mia_paginas_da_meta;
create policy mia_paginas_da_meta_select on public.mia_paginas_da_meta
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- A conexão da plataforma: zero policies, de propósito.

-- O default ACL do Supabase dá ALL a anon e authenticated em toda tabela nova;
-- o `grant select` sozinho não o desfaz (lição da 9001).
revoke all on public.mia_paginas_da_meta from anon, authenticated;
revoke all on public.mia_meta_conexao_da_plataforma from anon, authenticated;

grant select on public.mia_paginas_da_meta to authenticated;

grant select, insert, update, delete on public.mia_paginas_da_meta to service_role;
grant select, insert, update on public.mia_meta_conexao_da_plataforma to service_role;

-- ── gatilho 1: formulário ativo só de Página da própria empresa ────────────
create or replace function public.fn_mia_formulario_da_meta_so_da_pagina_da_empresa()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  -- Desligar é sempre permitido: formulário inativo não é lido por ninguém.
  if not new.ativo then
    return new;
  end if;

  if not exists (
    select 1
      from public.mia_paginas_da_meta p
     where p.page_id = new.page_id
       and p.organization_id = new.organization_id
  ) then
    raise exception 'MIA: a Pagina % da Meta nao e desta empresa', new.page_id
      using errcode = '42501',
            hint = 'Quem administra a plataforma atribui cada Pagina a uma empresa (/admin/paginas-da-meta).';
  end if;

  return new;
end
$f$;

comment on function public.fn_mia_formulario_da_meta_so_da_pagina_da_empresa() is
  'MIA (9004): recusa formulario ATIVO de Pagina que nao e da mesma empresa (mia_paginas_da_meta). Desligar e sempre permitido.';

revoke all on function public.fn_mia_formulario_da_meta_so_da_pagina_da_empresa() from public;
revoke execute on function public.fn_mia_formulario_da_meta_so_da_pagina_da_empresa() from anon, authenticated;

-- `update of` e não `update`: a rotina grava a última leitura do formulário a
-- cada 5 minutos, e isso não muda nem a empresa, nem a Página, nem a chave.
drop trigger if exists trg_mia_formulario_da_meta_so_da_pagina_da_empresa
  on public.mia_leads_da_meta_formularios;
create trigger trg_mia_formulario_da_meta_so_da_pagina_da_empresa
  before insert or update of organization_id, page_id, ativo
  on public.mia_leads_da_meta_formularios
  for each row
  execute function public.fn_mia_formulario_da_meta_so_da_pagina_da_empresa();

-- ── gatilho 2: a Página mudou de dono, os formulários dos outros desligam ──
create or replace function public.fn_mia_pagina_da_meta_mudou_de_dono()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_pagina text;
  v_dono uuid;
begin
  if tg_op = 'DELETE' then
    v_pagina := old.page_id;
    v_dono := null;
  else
    v_pagina := new.page_id;
    v_dono := new.organization_id;
  end if;

  update public.mia_leads_da_meta_formularios f
     set ativo = false,
         ultimo_status = 'erro',
         ultimo_motivo = 'pagina_nao_e_da_empresa',
         ultimo_detalhe = null,
         atualizado_em = now()
   where f.page_id = v_pagina
     and f.ativo
     and (v_dono is null or f.organization_id <> v_dono);

  return null;
end
$f$;

comment on function public.fn_mia_pagina_da_meta_mudou_de_dono() is
  'MIA (9004): quando uma Pagina da Meta ganha, troca ou perde o dono, desliga os formularios ativos das OUTRAS empresas nela, com o motivo gravado.';

revoke all on function public.fn_mia_pagina_da_meta_mudou_de_dono() from public;
revoke execute on function public.fn_mia_pagina_da_meta_mudou_de_dono() from anon, authenticated;

drop trigger if exists trg_mia_pagina_da_meta_mudou_de_dono on public.mia_paginas_da_meta;
create trigger trg_mia_pagina_da_meta_mudou_de_dono
  after insert or update of organization_id or delete
  on public.mia_paginas_da_meta
  for each row
  execute function public.fn_mia_pagina_da_meta_mudou_de_dono();

-- ── o que já existia antes desta migration ─────────────────────────────────
--
-- Formulário ativo da .60 cuja Página ainda não é da empresa dele fica
-- DESLIGADO, com o motivo à vista na tela. Sem isto a invariante valeria só para
-- o que for gravado daqui para a frente. Quando a plataforma atribuir a Página, o
-- admin da empresa liga o formulário de novo e a leitura continua de onde parou
-- (`lido_ate` não é tocado). Idempotente: depois da primeira vez não sobra linha
-- que case, e a reaplicação do baseline a cada deploy não muda nada.
update public.mia_leads_da_meta_formularios f
   set ativo = false,
       ultimo_status = 'erro',
       ultimo_motivo = 'pagina_nao_e_da_empresa',
       ultimo_detalhe = null,
       atualizado_em = now()
 where f.ativo
   and not exists (
     select 1
       from public.mia_paginas_da_meta p
      where p.page_id = f.page_id
        and p.organization_id = f.organization_id
   );
