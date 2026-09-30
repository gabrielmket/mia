-- 9008 · a empresa com conta própria da Meta escolhe as Páginas dela
--
-- ── O que muda desde a 9004 ─────────────────────────────────────────────────
--
-- Na 9004 só o dono da plataforma atribuía Página, MESMO para a empresa que
-- conectou a própria conta da Meta em Configurações › Meta Ads. O pedido do
-- Gabriel: "quando o cliente conectar a conta dele, ele que tem que definir
-- qual página abrir ou se vai ter mais de uma página para puxar o formulário".
--
-- Da .64 em diante, cada dono de Página tem uma ORIGEM:
--
--   · `plataforma`     o dono da plataforma atribuiu (/admin/paginas-da-meta).
--                      É o único caminho de quem lê pela conexão emprestada, e
--                      é o que TRANSFERE ou corrige qualquer Página;
--   · `conta_propria`  a própria empresa assumiu, na aba Formulários de leads,
--                      uma Página que o token DELA alcança na Meta (a rota
--                      confere na Meta, na hora, antes de gravar).
--
-- ── A regra, garantida no banco ─────────────────────────────────────────────
--
-- A invariante da 9004 continua (uma Página, um dono; formulário ativo só de
-- Página da própria empresa). A 9008 acrescenta, para a origem `conta_propria`:
--
--   1. assumir nunca tira a Página de outra empresa. Inserir a Página que já
--      tem dono esbarra na chave primária (23505); um upsert ou update que
--      troque o dono com a origem `conta_propria` é recusado (42501). Trocar o
--      dono é só da plataforma, com a origem `plataforma`;
--   2. só assume quem tem conexão PRÓPRIA de Meta Ads (`ad_insights_connections`
--      da mesma empresa). Empresa que lê pela conexão emprestada continua como
--      na 9004: quem atribui é a plataforma.
--
-- Soltar (a empresa desmarca a Página) é `fn_mia_soltar_pagina_da_meta`, numa
-- transação só: desliga os formulários ativos dela naquela Página com o motivo
-- `pagina_solta` e apaga o dono. Só solta o que ela mesma assumiu; a Página
-- que a plataforma atribuiu continua sendo da plataforma soltar.
--
-- Por que a empresa não escreve direto (RLS): a conferência "o token dela
-- alcança esta Página na Meta" só existe no servidor, que é quem fala com a
-- Meta. A escrita segue pelo service_role das rotas, e os gatilhos acima valem
-- para qualquer caminho, inclusive ele.
--
-- Nomes com prefixo `mia_`/`fn_mia_`: estender, nunca redefinir (docs/FORK-MIA.md,
-- regra 3). Os gatilhos e a função da 9004 não são tocados.

-- ── a origem de cada dono ──────────────────────────────────────────────────
-- Tudo o que existe até aqui foi atribuído pela plataforma: o padrão conta a
-- história certa para as linhas antigas, sem backfill.
alter table public.mia_paginas_da_meta
  add column if not exists origem text not null default 'plataforma';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'mia_paginas_da_meta_origem'
       and conrelid = 'public.mia_paginas_da_meta'::regclass
  ) then
    alter table public.mia_paginas_da_meta
      add constraint mia_paginas_da_meta_origem
      check (origem in ('plataforma', 'conta_propria'));
  end if;
end $$;

comment on column public.mia_paginas_da_meta.origem is
  'MIA (9008): de onde veio o dono. plataforma = atribuida pelo dono da plataforma (/admin/paginas-da-meta), que tambem transfere; conta_propria = a empresa assumiu pela propria conexao de Meta Ads, conferida na Meta na hora.';

comment on table public.mia_paginas_da_meta is
  'MIA (9004, 9008): de qual empresa e cada Pagina da Meta. Uma Pagina, um dono (page_id e a chave). A plataforma atribui e transfere; a empresa com conta propria da Meta assume as Paginas que o token dela alcanca (origem conta_propria) e nunca a de outra empresa.';

-- ── gatilho 3: assumir pela conta própria ──────────────────────────────────
create or replace function public.fn_mia_pagina_da_meta_pela_conta_propria()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  -- A plataforma atribui e transfere sem esta conferência (9004).
  if new.origem is distinct from 'conta_propria' then
    return new;
  end if;

  -- Assumir não toma a Página de ninguém: trocar o dono é só da plataforma.
  if tg_op = 'UPDATE' and old.organization_id is distinct from new.organization_id then
    raise exception 'MIA: esta Pagina da Meta ja esta ligada a outra empresa da plataforma'
      using errcode = '42501',
            hint = 'So quem administra a plataforma transfere uma Pagina (/admin/paginas-da-meta).';
  end if;

  -- Só assume quem tem a PRÓPRIA conexão de Meta Ads.
  if not exists (
    select 1
      from public.ad_insights_connections c
     where c.organization_id = new.organization_id
       and c.platform = 'meta_ads'
  ) then
    raise exception 'MIA: a empresa nao tem conexao propria de Meta Ads para assumir a Pagina %', new.page_id
      using errcode = '42501',
            hint = 'Sem conexao propria, quem atribui a Pagina e o dono da plataforma.';
  end if;

  return new;
end
$f$;

comment on function public.fn_mia_pagina_da_meta_pela_conta_propria() is
  'MIA (9008): dono com origem conta_propria so nasce para empresa com conexao propria de Meta Ads, e nunca toma a Pagina de outra empresa (trocar o dono e so da plataforma).';

revoke all on function public.fn_mia_pagina_da_meta_pela_conta_propria() from public;
revoke execute on function public.fn_mia_pagina_da_meta_pela_conta_propria() from anon, authenticated;

drop trigger if exists trg_mia_pagina_da_meta_pela_conta_propria on public.mia_paginas_da_meta;
create trigger trg_mia_pagina_da_meta_pela_conta_propria
  before insert or update of organization_id, origem
  on public.mia_paginas_da_meta
  for each row
  execute function public.fn_mia_pagina_da_meta_pela_conta_propria();

-- ── soltar: a empresa desmarca a Página que assumiu ────────────────────────
--
-- Numa transação: os formulários ATIVOS da empresa naquela Página desligam com
-- o motivo `pagina_solta` (e o aviso de falha deles zera, como no desligar da
-- rota), e o dono sai. O gatilho 2 da 9004 dispara no delete e não acha mais
-- formulário ativo: o motivo que fica é este, e não "não é da empresa".
--
-- Devolve `{solta: true, formularios: [ids]}` ou `{solta: false, motivo}`:
--   `nao_e_da_empresa`           a Página não tem dono, ou o dono é outra empresa;
--   `atribuida_pela_plataforma`  quem atribuiu foi a plataforma, e só ela solta.
create or replace function public.fn_mia_soltar_pagina_da_meta(
  p_organization_id uuid,
  p_page_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_origem text;
  v_formularios uuid[];
begin
  select p.origem
    into v_origem
    from public.mia_paginas_da_meta p
   where p.page_id = p_page_id
     and p.organization_id = p_organization_id
   for update;

  if not found then
    return jsonb_build_object('solta', false, 'motivo', 'nao_e_da_empresa');
  end if;
  if v_origem <> 'conta_propria' then
    return jsonb_build_object('solta', false, 'motivo', 'atribuida_pela_plataforma');
  end if;

  with desligados as (
    update public.mia_leads_da_meta_formularios f
       set ativo = false,
           ultimo_status = 'erro',
           ultimo_motivo = 'pagina_solta',
           ultimo_detalhe = null,
           falhas_seguidas = 0,
           aviso_de_falha_motivo = null,
           aviso_de_falha_em = null,
           atualizado_em = now()
     where f.organization_id = p_organization_id
       and f.page_id = p_page_id
       and f.ativo
    returning f.id
  )
  select coalesce(array_agg(d.id), '{}'::uuid[]) into v_formularios from desligados d;

  delete from public.mia_paginas_da_meta p
   where p.page_id = p_page_id
     and p.organization_id = p_organization_id;

  return jsonb_build_object('solta', true, 'formularios', to_jsonb(v_formularios));
end
$f$;

comment on function public.fn_mia_soltar_pagina_da_meta(uuid, text) is
  'MIA (9008): a empresa solta a Pagina da Meta que ela mesma assumiu (origem conta_propria): desliga os formularios ativos dela ali com o motivo pagina_solta e apaga o dono, na mesma transacao. Pagina atribuida pela plataforma nao e solta por aqui. Execucao so para service_role.';

revoke all on function public.fn_mia_soltar_pagina_da_meta(uuid, text) from public;
revoke execute on function public.fn_mia_soltar_pagina_da_meta(uuid, text) from anon, authenticated;
grant execute on function public.fn_mia_soltar_pagina_da_meta(uuid, text) to service_role;
