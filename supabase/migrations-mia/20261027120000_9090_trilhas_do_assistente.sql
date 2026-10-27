-- manifest: AS TRILHAS DO "ME MOSTRA COMO" (.93, o assistente ensina; protótipo aprovado em 26/10/2026, telas 1 e 2, decisões 8 a 11). Duas tabelas NOSSAS. `mia_assistente_trilhas`: onde cada PESSOA está em cada trilha (andando, pausada no passo N, feita), o passo mais longe a que chegou, quando começou (o "desde" das conferências, gravado pelo banco e não pelo navegador), quantas perguntas fez ao assistente em cada passo e quantos "Já fiz" não conferiram (os números juntados que a Time vê em /admin/assistente, sem texto nenhum), e `lembrada_em` (a trilha pausada é lembrada UMA vez no resumo da manhã: o gatilho zera a marca a cada pausa nova e a sessão não a escreve). A pessoa lê e grava só a própria linha pela sessão; gestor e administrador leem as da empresa; ninguém apaga pela sessão (o servidor apaga no "recomeçar" da demonstração e no MCP). `mia_assistente_trilhas_config`: por empresa, o "Me mostra como" ligado ou não, as trilhas desligadas e a recomendada no Início; a empresa lê, só o servidor grava (o MCP de plataforma). E `fn_mia_expurgar_trilhas_vencidas`: a linha parada há mais de um ano sai, chamada pelo cron do resumo da manhã. Travas do suporte somente leitura pela função do upstream. Nenhum objeto do upstream é redefinido. Provado em tests/invariants/trilhas-do-assistente.test.ts.
--
-- 9090 · as trilhas do "Me mostra como"
--
-- `mia`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `create
-- table if not exists`, constraints dentro de `do` que conferem o catálogo,
-- `create index if not exists`, `drop trigger/policy if exists`.
--
-- ── O que vira banco ────────────────────────────────────────────────────────
--
--   o progresso é da pessoa      a sessão lê e grava só a própria linha
--   "desde" é do banco           `comecou_em` nasce com a hora do banco
--   lembrar uma vez              `lembrada_em` zera a cada pausa nova, e só o
--                                servidor (o cron do resumo) a marca
--   a Time vê números            contagens por passo, nunca texto

create table if not exists public.mia_assistente_trilhas (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  -- O id da trilha no catálogo (lib/assistente/trilhas/catalogo.ts).
  trilha               text not null,
  -- andando, pausada ou feita.
  situacao             text not null default 'andando',
  -- O passo em que a pessoa está (0 = o primeiro).
  passo                integer not null default 0,
  -- O passo mais longe a que ela chegou: "em que passo param", para a Time.
  passo_max            integer not null default 0,
  comecou_em           timestamptz not null default now(),
  pausou_em            timestamptz,
  feita_em             timestamptz,
  -- Quando o resumo da manhã lembrou desta pausa (uma vez por pausa).
  lembrada_em          timestamptz,
  -- Quantas vezes começou (o "Fazer de novo" conta).
  vezes                integer not null default 1,
  -- {"3": 2}: duas perguntas ao assistente durante o passo 4. Só a contagem.
  perguntas_no_passo   jsonb not null default '{}'::jsonb,
  -- {"3": 1}: um "Já fiz por outro caminho" que não conferiu no passo 4.
  ja_fiz_sem_conferir  jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.mia_assistente_trilhas is
  'MIA (9090): onde cada pessoa esta em cada trilha do "Me mostra como" do assistente (andando, pausada no passo N, feita), com o passo mais longe, quando comecou (o "desde" das conferencias), as perguntas por passo e os "Ja fiz" que nao conferiram (so contagens). A pessoa le e grava a propria linha pela sessao; gestor e administrador leem as da empresa; ninguem apaga pela sessao. lembrada_em: o resumo da manha lembra a pausa uma vez (o gatilho zera a cada pausa nova).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_trilhas_trilha') then
    alter table public.mia_assistente_trilhas
      add constraint mia_assistente_trilhas_trilha check (trilha ~ '^[a-z][a-z0-9_]{1,39}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_trilhas_situacao') then
    alter table public.mia_assistente_trilhas
      add constraint mia_assistente_trilhas_situacao check (situacao in ('andando', 'pausada', 'feita'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_trilhas_passo') then
    alter table public.mia_assistente_trilhas
      add constraint mia_assistente_trilhas_passo
      check (passo between 0 and 49 and passo_max between 0 and 49 and vezes between 1 and 10000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_trilhas_contagens') then
    alter table public.mia_assistente_trilhas
      add constraint mia_assistente_trilhas_contagens
      check (
        jsonb_typeof(perguntas_no_passo) = 'object' and octet_length(perguntas_no_passo::text) <= 2000
        and jsonb_typeof(ja_fiz_sem_conferir) = 'object' and octet_length(ja_fiz_sem_conferir::text) <= 2000
      );
  end if;
  -- Feita tem a data; pausada tem a data.
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_trilhas_datas') then
    alter table public.mia_assistente_trilhas
      add constraint mia_assistente_trilhas_datas
      check ((situacao <> 'feita' or feita_em is not null) and (situacao <> 'pausada' or pausou_em is not null));
  end if;
end $$;

-- Uma linha por pessoa e trilha: começar de novo reaproveita a linha.
create unique index if not exists mia_assistente_trilhas_uma_por_pessoa_idx
  on public.mia_assistente_trilhas (organization_id, user_id, trilha);
create index if not exists mia_assistente_trilhas_org_idx
  on public.mia_assistente_trilhas (organization_id, trilha);
-- As pausadas que o resumo da manhã ainda não lembrou.
create index if not exists mia_assistente_trilhas_pausadas_idx
  on public.mia_assistente_trilhas (organization_id, user_id)
  where situacao = 'pausada' and lembrada_em is null;

-- ── a linha é da própria pessoa, e o "desde" é do banco ─────────────────────
--
-- Pela sessão: quem grava é sempre a própria pessoa; a empresa, a pessoa e a
-- trilha não mudam depois; `comecou_em` e `created_at` nascem com a hora do
-- banco; e `lembrada_em` não é da sessão: ela só zera quando a trilha é pausada
-- de novo (lembrar uma vez POR PAUSA). O servidor (o cron do resumo) é quem marca.
create or replace function public.fn_mia_trilha_da_pessoa()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $f$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.user_id := auth.uid();
      new.comecou_em := now();
      new.lembrada_em := null;
      new.created_at := now();
    end if;
    new.updated_at := now();
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.user_id is distinct from old.user_id
     or new.trilha is distinct from old.trilha
     or new.created_at is distinct from old.created_at then
    raise exception 'trilha_imutavel'
      using errcode = '23514',
            detail = 'A empresa, a pessoa e a trilha de uma linha de progresso não mudam.';
  end if;

  if auth.uid() is not null then
    -- Começar de novo é a sessão voltando a "andando" do passo 0: a hora é do banco.
    if new.vezes is distinct from old.vezes then
      new.comecou_em := now();
    else
      new.comecou_em := old.comecou_em;
    end if;
    if new.situacao = 'pausada' and old.situacao is distinct from 'pausada' then
      new.lembrada_em := null;
    else
      new.lembrada_em := old.lembrada_em;
    end if;
  elsif new.situacao = 'pausada' and old.situacao is distinct from 'pausada' then
    new.lembrada_em := null;
  end if;

  new.updated_at := now();
  return new;
end
$f$;

comment on function public.fn_mia_trilha_da_pessoa() is
  'MIA (9090): a linha de progresso da trilha e da propria pessoa (a sessao grava com auth.uid()), empresa/pessoa/trilha nao mudam (23514), comecou_em e created_at sao do banco, e lembrada_em zera a cada pausa nova e nao e escrita pela sessao (o resumo da manha lembra uma vez por pausa).';

revoke all on function public.fn_mia_trilha_da_pessoa() from public;
revoke execute on function public.fn_mia_trilha_da_pessoa() from anon, authenticated;

drop trigger if exists trg_mia_trilha_da_pessoa on public.mia_assistente_trilhas;
create trigger trg_mia_trilha_da_pessoa
  before insert or update on public.mia_assistente_trilhas
  for each row execute function public.fn_mia_trilha_da_pessoa();

alter table public.mia_assistente_trilhas enable row level security;

revoke all on table public.mia_assistente_trilhas from public, anon, authenticated;
grant select, insert, update on table public.mia_assistente_trilhas to authenticated;
grant all on table public.mia_assistente_trilhas to service_role;

drop policy if exists "mia_assistente_trilhas_select" on public.mia_assistente_trilhas;
drop policy if exists "mia_assistente_trilhas_insert" on public.mia_assistente_trilhas;
drop policy if exists "mia_assistente_trilhas_update" on public.mia_assistente_trilhas;
create policy "mia_assistente_trilhas_select" on public.mia_assistente_trilhas
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and (user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager'))
  );
create policy "mia_assistente_trilhas_insert" on public.mia_assistente_trilhas
  for insert with check (
    organization_id in (select public.fn_user_org_ids())
    and user_id = auth.uid()
  );
create policy "mia_assistente_trilhas_update" on public.mia_assistente_trilhas
  for update using (
    organization_id in (select public.fn_user_org_ids())
    and user_id = auth.uid()
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and user_id = auth.uid()
  );

-- ── a configuração das trilhas numa empresa ─────────────────────────────────

create table if not exists public.mia_assistente_trilhas_config (
  organization_id  uuid primary key references public.organizations(id) on delete cascade,
  -- O "Me mostra como" (o destaque na tela). Desligado, o assistente só explica.
  me_mostra_como   boolean not null default true,
  -- As trilhas que esta empresa não vê (ids do catálogo).
  desligadas       text[] not null default '{}'::text[],
  -- A trilha que o Início recomenda; sem ela, a primeira que falta, na ordem.
  recomendada      text,
  updated_by       uuid references auth.users(id) on delete set null,
  updated_at       timestamptz not null default now()
);

comment on table public.mia_assistente_trilhas_config is
  'MIA (9090): as trilhas do assistente numa empresa: o "Me mostra como" ligado ou nao, as trilhas desligadas e a recomendada no Inicio. A empresa le pela sessao; so o servidor grava (o MCP de plataforma, plataforma_configurar_trilhas e plataforma_configurar_assistente). Sem linha: tudo ligado, recomendada a primeira que falta.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_trilhas_config_desligadas') then
    alter table public.mia_assistente_trilhas_config
      add constraint mia_assistente_trilhas_config_desligadas check (cardinality(desligadas) <= 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_trilhas_config_recomendada') then
    alter table public.mia_assistente_trilhas_config
      add constraint mia_assistente_trilhas_config_recomendada
      check (recomendada is null or recomendada ~ '^[a-z][a-z0-9_]{1,39}$');
  end if;
end $$;

alter table public.mia_assistente_trilhas_config enable row level security;

revoke all on table public.mia_assistente_trilhas_config from public, anon, authenticated;
grant select on table public.mia_assistente_trilhas_config to authenticated;
grant all on table public.mia_assistente_trilhas_config to service_role;

drop policy if exists "mia_assistente_trilhas_config_select" on public.mia_assistente_trilhas_config;
create policy "mia_assistente_trilhas_config_select" on public.mia_assistente_trilhas_config
  for select using (organization_id in (select public.fn_user_org_ids()));

-- ── a retenção ──────────────────────────────────────────────────────────────
--
-- A linha parada há mais de um ano (`p_dias`, piso de 90) sai, em lotes. É o
-- progresso de uma pessoa da equipe, sem texto de conversa; um ano basta para a
-- Time ver onde os clientes travam. Chamada pelo cron do resumo da manhã.
create or replace function public.fn_mia_expurgar_trilhas_vencidas(
  p_dias integer default 365,
  p_limite integer default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  v_dias integer := greatest(coalesce(p_dias, 365), 90);
  v_limite integer := least(greatest(coalesce(p_limite, 5000), 1), 50000);
  v_trilhas integer := 0;
begin
  with velhas as (
    select id from public.mia_assistente_trilhas
     where updated_at < now() - make_interval(days => v_dias)
     order by updated_at
     limit v_limite
  )
  delete from public.mia_assistente_trilhas t
   using velhas v
   where t.id = v.id;
  get diagnostics v_trilhas = row_count;
  return jsonb_build_object('trilhas', v_trilhas, 'retencao_dias', v_dias);
end
$f$;

comment on function public.fn_mia_expurgar_trilhas_vencidas(integer, integer) is
  'MIA (9090): a retencao das trilhas do assistente. Apaga, em lotes, o progresso parado ha mais de p_dias (365 por padrao, piso de 90). Chamada pelo cron do resumo da manha. So o servidor executa.';

revoke all on function public.fn_mia_expurgar_trilhas_vencidas(integer, integer) from public;
revoke execute on function public.fn_mia_expurgar_trilhas_vencidas(integer, integer) from anon, authenticated;
grant execute on function public.fn_mia_expurgar_trilhas_vencidas(integer, integer) to service_role;

-- ── as travas do suporte somente leitura ────────────────────────────────────
--
-- A regra é a do upstream (0274): tabela com RLS, `organization_id` e escrita
-- para `authenticated` ganha as três políticas restritivas.
do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

notify pgrst, 'reload schema';
