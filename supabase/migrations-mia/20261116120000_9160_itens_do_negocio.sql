-- manifest: O PRODUTO OU SERVIÇO NO NEGÓCIO (.109; docs/fork/produto-no-negocio.md). FORK MIA (.109): o negócio não dizia o que foi vendido: o valor era um número digitado e o relatório só enxergava produto quando havia Proposta. `mia_itens_do_negocio` guarda a lista do negócio, escolhida SÓ do catálogo de Produtos (`catalog_products`, o mesmo da Proposta): quantidade (1 a 99), desconto, e o PREÇO, o NOME e o CÓDIGO congelados no dia em que o item entra (mudar o catálogo depois não mexe em negócio fechado; produto apagado deixa o item com o nome de quando entrou, `on delete set null`). Um produto aparece uma vez por negócio (somar de novo aumenta a quantidade). `crm_leads.valor_a_mao` diz que alguém digitou o valor à mão e ele parou de somar os itens até alguém pedir "Usar a soma": nasce NULO nos negócios que já existem (não são tocados nem adivinhados, e a tela os trata como "negócio de antes dos itens") e FALSO nos novos (default). O valor continua em `value_cents`: quem soma é o servidor, ao gravar a lista. RLS: toda a equipe da empresa lê (o cartão do quadro mostra a linha do item), só o servidor escreve (a rota confere o papel, a empresa e o catálogo). Sem dado pessoal: nome e preço de produto, quantidades e ids (decisão de LGPD na doc: mesmo molde de `crm_proposal_items`). Nenhum objeto do upstream é redefinido: a coluna é acrescentada, a função de gatilho é nossa. Idempotente.
--
-- 9160 · os itens do negócio
--
-- FORK MIA (.109). Só objetos NOSSOS (docs/FORK-MIA.md, regra 3): uma tabela
-- nova, as constraints dela dentro de `do` que confere o catálogo, uma função de
-- gatilho com nome nosso (a empresa do item é a do negócio e a do produto), o
-- gatilho de `updated_at` com a função de sempre do upstream
-- (`fn_set_updated_at`, só CHAMADA) e uma coluna NOVA em `crm_leads`
-- (acrescentada, como `originated_by_user_id` e `revenue_kind` da 0243).

create table if not exists public.mia_itens_do_negocio (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  lead_id               uuid not null references public.crm_leads(id) on delete cascade,
  -- O produto do catálogo. Apagar o produto solta a referência e o item fica com
  -- o nome e o preço de quando entrou: o negócio fechado não muda.
  product_id            uuid references public.catalog_products(id) on delete set null,
  -- Congelados na entrada (o "preço do dia").
  nome                  text not null,
  codigo                text,
  preco_unitario_cents  bigint not null,
  moeda                 text not null default 'BRL',
  -- Do negócio.
  quantidade            integer not null default 1,
  desconto_cents        bigint not null default 0,
  -- fractional indexing, igual position_in_stage: NUNCA int (CLAUDE.md).
  position              numeric not null default 1000,
  created_by_user_id    uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_itens_do_negocio_quantidade') then
    alter table public.mia_itens_do_negocio add constraint mia_itens_do_negocio_quantidade
      check (quantidade between 1 and 99);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_itens_do_negocio_preco') then
    alter table public.mia_itens_do_negocio add constraint mia_itens_do_negocio_preco
      check (preco_unitario_cents >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_itens_do_negocio_desconto') then
    -- O desconto nunca passa do valor do item: o item não fica negativo.
    alter table public.mia_itens_do_negocio add constraint mia_itens_do_negocio_desconto
      check (desconto_cents >= 0 and desconto_cents <= preco_unitario_cents * quantidade);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_itens_do_negocio_nome') then
    alter table public.mia_itens_do_negocio add constraint mia_itens_do_negocio_nome
      check (length(btrim(nome)) between 1 and 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_itens_do_negocio_moeda') then
    alter table public.mia_itens_do_negocio add constraint mia_itens_do_negocio_moeda
      check (moeda ~ '^[A-Z]{3}$');
  end if;
end $$;

comment on table public.mia_itens_do_negocio is
  'MIA (9160): o que o negocio vendeu (docs/fork/produto-no-negocio.md). Cada linha e um produto do catalogo (catalog_products) com quantidade (1 a 99) e desconto do negocio, e com preco, nome e codigo CONGELADOS na entrada: mudar o catalogo depois nao mexe no negocio. Produto apagado deixa o item com o nome de quando entrou. O valor do negocio (crm_leads.value_cents) e a soma destes itens e dos itens da proposta enviada, a nao ser que crm_leads.valor_a_mao. Toda a equipe da empresa le; so o servidor escreve.';

-- Um produto aparece uma vez por negócio: somar de novo aumenta a quantidade.
create unique index if not exists mia_itens_do_negocio_produto_uidx
  on public.mia_itens_do_negocio (lead_id, product_id)
  where product_id is not null;
create index if not exists mia_itens_do_negocio_lead_idx
  on public.mia_itens_do_negocio (organization_id, lead_id, position);
create index if not exists mia_itens_do_negocio_produto_idx
  on public.mia_itens_do_negocio (organization_id, product_id)
  where product_id is not null;

-- ── a empresa do item é a do negócio e a do produto ─────────────────────────
-- A escrita é do servidor (service_role, que ignora RLS): sem esta trava, um item
-- com organization_id = A podia apontar para negócio ou produto de B. O mesmo
-- desenho de `fn_verificar_org_do_item_da_proposta` (0464), com nome nosso.
create or replace function public.fn_mia_item_do_negocio_coerente()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.crm_leads where id = new.lead_id;
  if v_org is distinct from new.organization_id then
    raise exception 'mia_item_do_negocio_org_do_negocio' using errcode = '23514';
  end if;
  if new.product_id is not null then
    select organization_id into v_org from public.catalog_products where id = new.product_id;
    if v_org is distinct from new.organization_id then
      raise exception 'mia_item_do_negocio_org_do_produto' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- Função de gatilho: não é RPC, mas nasce com EXECUTE para public e anon como
-- qualquer função em public (CLAUDE.md, Migrations item 9).
revoke execute on function public.fn_mia_item_do_negocio_coerente() from public, anon;

drop trigger if exists trg_mia_itens_do_negocio_coerente on public.mia_itens_do_negocio;
create trigger trg_mia_itens_do_negocio_coerente
  before insert or update of organization_id, lead_id, product_id on public.mia_itens_do_negocio
  for each row execute function public.fn_mia_item_do_negocio_coerente();

drop trigger if exists trg_mia_itens_do_negocio_touch on public.mia_itens_do_negocio;
create trigger trg_mia_itens_do_negocio_touch
  before update on public.mia_itens_do_negocio
  for each row execute function public.fn_set_updated_at();

-- ── RLS: toda a equipe da empresa lê; só o servidor escreve ────────────────
alter table public.mia_itens_do_negocio enable row level security;

drop policy if exists mia_itens_do_negocio_select on public.mia_itens_do_negocio;
create policy mia_itens_do_negocio_select on public.mia_itens_do_negocio
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or organization_id in (select public.fn_user_org_ids())
  );

-- O default ACL do Supabase dá ALL a anon e authenticated em toda tabela nova;
-- o `grant select` sozinho não o desfaz (lição da 9001).
revoke all on public.mia_itens_do_negocio from public, anon, authenticated;
grant select on public.mia_itens_do_negocio to authenticated;
grant select, insert, update, delete on public.mia_itens_do_negocio to service_role;

-- ── o valor digitado à mão ───────────────────────────────────────────────────
-- Acrescentada SEM default primeiro: os negócios que já existem ficam NULOS
-- ("de antes dos itens"), sem nenhuma linha reescrita. O default FALSO vale só
-- para o que nascer daqui em diante. Rodar de novo não muda nada.
alter table public.crm_leads
  add column if not exists valor_a_mao boolean;
alter table public.crm_leads
  alter column valor_a_mao set default false;

comment on column public.crm_leads.valor_a_mao is
  'MIA (9160): true = alguem digitou o valor do negocio a mao e ele parou de somar os itens (mia_itens_do_negocio) ate alguem pedir "Usar a soma". false = o valor e a soma. NULL = negocio de antes dos itens, que nao foi tocado: vale o value_cents que ja tinha. Quem grava e a rota dos itens; o resto do sistema continua lendo value_cents.';

notify pgrst, 'reload schema';
