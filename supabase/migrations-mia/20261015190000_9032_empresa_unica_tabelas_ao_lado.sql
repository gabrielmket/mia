-- manifest: EMPRESA ÚNICA, PARTE 1 DE 3 (item 7 do mapa de produção, protótipo aprovado pelo Gabriel em 15/10/2026). O cadastro de empresa passa a ser UM só, o do upstream (`companies` → `company_people` → `people` ← `contacts.person_id`, migration 0448 dele), e o que é só nosso mora AO LADO, nunca dentro: `mia_companies_extra` (1:1 com `companies`, chave `company_id` com `on delete cascade`: site, endereço em texto livre, observações, etiquetas e campos adicionais, as colunas de `crm_empresas` que o upstream não tem); `mia_companies_mescladas` (a lápide de fusão: a empresa que deixou de existir, para onde foi, quando e por quê, `mesclagem` ou `de_para`; o endereço antigo `/app/companies/<id>` cai na que ficou); `mia_companies_de_para` (o registro da cópia de `crm_empresas`, uma linha por empresa antiga, com o destino e COMO ela chegou: copiada com o mesmo id, casada pelo CNPJ, casada pelo nome ou lápide; é ele que faz a cópia da 9033 nunca repetir uma linha). Em `company_people` (tabela do upstream) entra a coluna NOSSA `papel` (vocabulário fechado, o mesmo do negócio: decisor, financeiro, usuario, influenciador, outro; constraint `company_people_mia_papel_check`) e o índice único parcial `company_people_mia_um_principal_uidx` (um contato principal por empresa, garantido pelo banco; antes dele, os principais repetidos que já existirem viram não principais, ficando o mais antigo). Duas funções puras de apoio (`fn_mia_cnpj_normalizado`, `fn_mia_cnpj_formatado`, `fn_mia_nome_de_empresa_comparavel`). RLS: as três tabelas são lidas por qualquer membro da organização; a escrita é só pelas funções da 9034 (security definer, papel conferido dentro) e pelo servidor; `authenticated` não tem privilégio de escrita, e as travas do suporte somente leitura entram por `fn_aplicar_travas_de_suporte()` (a função do upstream, chamada). Nenhuma tabela, função, gatilho ou policy do upstream é redefinida. Provado em tests/invariants/empresa-unica.test.ts.
--
-- 9032 · empresa única: o que é só nosso mora ao lado de `companies`
--
-- `mia`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3), e o porquê inteiro está
-- em docs/fork/empresa-unica.md. Idempotente: `if not exists` em tabela, coluna
-- e índice; constraint dentro de um `do` que confere o catálogo; `create or
-- replace` só de função nossa.
--
-- ── Por que tabela ao lado, e não colunas em `companies` ──────────────────
--
-- Coluna nossa numa tabela dele é o tipo de coisa que colide em silêncio: no dia
-- em que o upstream criar `companies.tags` ou `companies.site`, o `add column if
-- not exists` dele vira nada e as duas pontas passam a escrever no mesmo lugar
-- com regras diferentes. Ao lado, cada lado tem o seu, e a leitura junta os dois
-- num `select` só (o PostgREST embute `mia_companies_extra` pela chave).
--
-- A exceção é `company_people.papel`: o papel é da PESSOA DENTRO DA EMPRESA, o
-- mesmo grão do vínculo, e uma tabela ao lado de `company_people` teria de
-- repetir a chave (empresa, pessoa) que o vínculo já é. O nome é curto de
-- propósito e a constraint leva `mia` no nome.

-- ─── funções de apoio, puras ────────────────────────────────────────────────

-- Só os dígitos, e só quando são 14. É a mesma régua de `normalizeCnpj` do
-- upstream menos a recusa de sequência repetida, que a tela faz antes.
create or replace function public.fn_mia_cnpj_normalizado(p_cnpj text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when length(d) = 14 then d end
    from (select regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g') as d) x
$$;

-- `00.000.000/0000-00`, como o upstream guarda em `companies.cnpj`.
create or replace function public.fn_mia_cnpj_formatado(p_cnpj text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when d is null then null
              else substr(d, 1, 2) || '.' || substr(d, 3, 3) || '.' || substr(d, 6, 3) || '/'
                   || substr(d, 9, 4) || '-' || substr(d, 13, 2) end
    from (select public.fn_mia_cnpj_normalizado(p_cnpj) as d) x
$$;

-- O nome sem caixa, sem acento e sem pontuação. Serve à cópia da 9033 (casar a
-- empresa dos dois cadastros quando nenhuma tem CNPJ) e só a ela: a régua do
-- agente e da importação continua em `lib/empresas/achar-ou-criar.ts`.
create or replace function public.fn_mia_nome_de_empresa_comparavel(p_nome text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(
           translate(lower(coalesce(p_nome, '')),
                     'áàâãäåéèêëíìîïóòôõöúùûüýÿçñ',
                     'aaaaaaeeeeiiiiooooouuuuyycn'),
           '[^a-z0-9]+', ' ', 'g')), '')
$$;

revoke all on function public.fn_mia_cnpj_normalizado(text) from public, anon;
revoke all on function public.fn_mia_cnpj_formatado(text) from public, anon;
revoke all on function public.fn_mia_nome_de_empresa_comparavel(text) from public, anon;
grant execute on function public.fn_mia_cnpj_normalizado(text) to authenticated, service_role;
grant execute on function public.fn_mia_cnpj_formatado(text) to authenticated, service_role;
grant execute on function public.fn_mia_nome_de_empresa_comparavel(text) to authenticated, service_role;

-- ─── o que é só nosso, ao lado de `companies` ───────────────────────────────

create table if not exists public.mia_companies_extra (
  company_id uuid primary key references public.companies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site text,
  -- O endereço como a pessoa escreveu, numa linha. O da Receita mora nas sete
  -- colunas de `companies` (rua, número, ...), e a ficha mostra os dois.
  endereco text,
  observacoes text,
  tags text[] not null default '{}'::text[],
  -- As DEFINIÇÕES continuam em `crm_pipelines.settings.fields`, o mesmo lugar
  -- do contato e do negócio (0262).
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.mia_companies_extra is
  'MIA (9032): o que a empresa tem so no nosso cadastro (site, endereco em texto livre, observacoes, etiquetas, campos adicionais), ao lado de companies (do upstream), 1:1 pela chave. Sem linha = sem nada disso. Escrita so por fn_mia_gravar_empresa e pelo servidor.';

create index if not exists idx_mia_companies_extra_org
  on public.mia_companies_extra (organization_id);

-- A organização da linha é a da empresa: chave estrangeira não confere isso
-- sozinha, e uma linha de outra organização pendurada numa empresa vazaria pela
-- leitura embutida.
create or replace function public.fn_mia_companies_extra_mesma_organizacao()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.companies where id = new.company_id;
  if v_org is null or v_org is distinct from new.organization_id then
    raise exception using errcode = '23514', message = 'mia_companies_extra: organization_id deve ser o da empresa';
  end if;
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.fn_mia_companies_extra_mesma_organizacao() from public;
revoke execute on function public.fn_mia_companies_extra_mesma_organizacao() from anon, authenticated;

drop trigger if exists trg_mia_companies_extra_mesma_organizacao on public.mia_companies_extra;
create trigger trg_mia_companies_extra_mesma_organizacao
  before insert or update on public.mia_companies_extra
  for each row execute function public.fn_mia_companies_extra_mesma_organizacao();

-- ─── a lápide: a empresa que deixou de existir e para onde foi ──────────────

create table if not exists public.mia_companies_mescladas (
  -- O id da empresa que saiu de `companies`. Sem chave estrangeira: ele já não
  -- existe lá, e é justamente essa a pergunta que a linha responde.
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mesclada_com uuid references public.companies(id) on delete set null,
  mesclada_em timestamptz not null default now(),
  -- `mesclagem`: alguém juntou as duas (tela, rota). `de_para`: a cópia da 9033
  -- achou a mesma empresa nos dois cadastros e ficou com a do upstream.
  motivo text not null,
  nome text,
  cnpj text,
  dados jsonb not null default '{}'::jsonb,
  mesclada_por uuid references auth.users(id) on delete set null,
  constraint mia_companies_mescladas_motivo_check check (motivo in ('mesclagem', 'de_para'))
);

comment on table public.mia_companies_mescladas is
  'MIA (9032): a lapide de fusao de empresas. A perdedora sai de companies e fica aqui (nome, cnpj, os dados de quando saiu), com a empresa que ficou. O endereco antigo da ficha cai na que ficou. Escrita so por fn_mesclar_empresas e pela copia da 9033.';

create index if not exists idx_mia_companies_mescladas_org
  on public.mia_companies_mescladas (organization_id, mesclada_com);

-- ─── o registro da cópia de `crm_empresas` ──────────────────────────────────

create table if not exists public.mia_companies_de_para (
  -- O id em `crm_empresas`. Sem chave estrangeira: a tabela velha se aposenta na
  -- entrega 5, e este registro tem de sobreviver a ela.
  crm_empresa_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  como text not null,
  em timestamptz not null default now(),
  constraint mia_companies_de_para_como_check
    check (como in ('copiada', 'casada_por_cnpj', 'casada_por_nome', 'lapide'))
);

comment on table public.mia_companies_de_para is
  'MIA (9032): de onde veio cada empresa do cadastro antigo (crm_empresas) e para onde foi em companies: copiada (mesmo id), casada_por_cnpj, casada_por_nome ou lapide (ja era fusao antiga). E o que faz a copia da 9033 nunca repetir uma linha, em nenhuma passada do baseline.';

create index if not exists idx_mia_companies_de_para_org
  on public.mia_companies_de_para (organization_id, company_id);

-- ─── o papel da pessoa na empresa, no vínculo do upstream ───────────────────

alter table public.company_people
  add column if not exists papel text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_people_mia_papel_check') then
    alter table public.company_people
      add constraint company_people_mia_papel_check
      check (papel is null or papel in ('decisor', 'financeiro', 'usuario', 'influenciador', 'outro'));
  end if;
end $$;

comment on column public.company_people.papel is
  'MIA (9032): o papel desta pessoa NESTA empresa, vocabulario fechado e o mesmo do papel num negocio (lib/cartoes/papel.ts): decisor, financeiro, usuario, influenciador, outro. Nulo = nao informado. is_decision_maker (do upstream) acompanha: decisor = true. Dado pessoal profissional: some na anonimizacao (9034).';

-- Um contato principal por empresa (decisão do protótipo). Os repetidos que já
-- existirem ficam com o mais antigo antes do índice nascer.
update public.company_people cp
   set is_primary = false
  from (
    select id, row_number() over (partition by company_id order by created_at, id) as ordem
      from public.company_people
     where is_primary
  ) x
 where x.id = cp.id
   and x.ordem > 1;

create unique index if not exists company_people_mia_um_principal_uidx
  on public.company_people (company_id)
  where is_primary;

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.mia_companies_extra enable row level security;
alter table public.mia_companies_mescladas enable row level security;
alter table public.mia_companies_de_para enable row level security;

drop policy if exists mia_companies_extra_select on public.mia_companies_extra;
create policy mia_companies_extra_select on public.mia_companies_extra
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists mia_companies_mescladas_select on public.mia_companies_mescladas;
create policy mia_companies_mescladas_select on public.mia_companies_mescladas
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists mia_companies_de_para_select on public.mia_companies_de_para;
create policy mia_companies_de_para_select on public.mia_companies_de_para
  for select using (organization_id in (select public.fn_user_org_ids()));

-- A escrita é das funções da 9034 (definer, papel conferido dentro) e do
-- servidor. O default ACL do Supabase dá ALL a toda tabela nova; tirar é o que
-- faz o contrato dizer a verdade (e `fn_aplicar_travas_de_suporte` lê isto).
revoke all on public.mia_companies_extra from anon, authenticated;
revoke all on public.mia_companies_mescladas from anon, authenticated;
revoke all on public.mia_companies_de_para from anon, authenticated;
grant select on public.mia_companies_extra to authenticated;
grant select on public.mia_companies_mescladas to authenticated;
grant select on public.mia_companies_de_para to authenticated;
grant all on public.mia_companies_extra to service_role;
grant all on public.mia_companies_mescladas to service_role;
grant all on public.mia_companies_de_para to service_role;

do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

notify pgrst, 'reload schema';
