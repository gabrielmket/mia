-- manifest: O PLANO DIZ QUANTOS AGENTES DE IA A EMPRESA CRIA (MIA-250; desenho na MIA-258). `mia_plano_modulos` (9070, tabela NOSSA ao lado de `cobranca_planos`) ganha `max_agentes` (1 a 1000; nulo = sem limite, o valor de todo plano hoje: nada muda até alguém pôr teto). `fn_mia_limite_de_agentes(org)` (definer, stable, só `service_role`) responde o teto pela mesma régua de `fn_limite_do_plano` do upstream: nulo com a cobrança desligada, com a empresa sem assinatura (isenta), com o plano sem linha nossa ou sem teto; senão o `max_agentes` do `plano_id` da assinatura (nunca o agendado, D-3). O gatilho NOSSO `trg_mia_trava_agentes_do_plano` (BEFORE INSERT OR UPDATE OF archived_at, organization_id em `ai_agents`), no molde de `fn_trava_canais_do_plano`, levanta `PT402` com a mensagem `limite_do_plano:agentes:<teto>` e o DETAIL `{recurso, limite, em_uso}` quando a empresa já tem o teto em agentes não arquivados (qualquer tipo e estado: rascunho, publicado, pausado, desligado; arquivado, versão e roteador não contam). Guarda de transição: no UPDATE, agente que já estava fora do arquivo e não mudou de empresa sai antes de contar (editar agente de empresa acima do teto nunca vira PT402); desarquivar e trocar de empresa contam. Trava consultiva por empresa `hashtextextended(org, 2283)` (2281 canais, 2282 assentos, 2284 já usada): dois inserts ao mesmo tempo não passam do teto. A trava de assinantes da 9070 NÃO muda: o teto de agentes pode mudar em plano assinado, como pessoas e números no upstream, e vale na hora só para criar. Nada é arquivado sozinho. Nenhum objeto do upstream é tocado. Provado em tests/invariants/limite-de-agentes-do-plano.test.ts. Desenho em docs/fork/jornada-de-assinatura.md.
--
-- 9174 · o plano diz quantos agentes de IA a empresa cria
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `add column if
-- not exists`, a constraint dentro de um `do` que confere antes, `create or
-- replace` só em função nossa e `drop trigger if exists`.

-- ── 1. a coluna ao lado dos módulos e dos preços ────────────────────────────
alter table public.mia_plano_modulos
  add column if not exists max_agentes integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'mia_plano_modulos_max_agentes'
       and conrelid = 'public.mia_plano_modulos'::regclass
  ) then
    alter table public.mia_plano_modulos
      add constraint mia_plano_modulos_max_agentes
      check (max_agentes is null or max_agentes between 1 and 1000);
  end if;
end $$;

comment on column public.mia_plano_modulos.max_agentes is
  'MIA (9174): quantos agentes de IA nao arquivados a empresa do plano pode ter (qualquer tipo e estado). Nulo = sem limite. Pode mudar em plano assinado: vale na hora, so para criar (trg_mia_trava_agentes_do_plano). Quem ja passa do teto fica com os agentes; so nao cria, nao duplica e nao desarquiva.';

-- ── 2. o teto da empresa ────────────────────────────────────────────────────
-- A mesma régua de `fn_limite_do_plano` (0583): a chave da cobrança, a
-- assinatura (sem linha = isenta) e o `plano_id` (o agendado só vale quando vira
-- o atual). Plano sem linha nossa = sem teto.
create or replace function public.fn_mia_limite_de_agentes(p_org uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limite integer;
begin
  if not public.fn_cobranca_ligada() then
    return null;
  end if;
  select m.max_agentes into v_limite
    from public.cobranca_assinaturas a
    join public.mia_plano_modulos m on m.plano_id = a.plano_id
   where a.organization_id = p_org;
  return v_limite;
end;
$$;

revoke execute on function public.fn_mia_limite_de_agentes(uuid) from public, anon, authenticated;
grant execute on function public.fn_mia_limite_de_agentes(uuid) to service_role;

comment on function public.fn_mia_limite_de_agentes(uuid) is
  'MIA (9174): o teto de agentes de IA da empresa. Nulo = sem limite: cobranca desligada, empresa sem assinatura (isenta), plano sem linha em mia_plano_modulos ou sem max_agentes. Vale o plano_id, nunca o agendado. So o servidor chama.';

-- ── 3. a trava ──────────────────────────────────────────────────────────────
-- No molde de `fn_trava_canais_do_plano` (0583). A guarda de transição NÃO é
-- intercambiável com o `a.id <> new.id` da contagem: numa empresa que já está
-- ACIMA do teto (plano reduzido, cobrança ligada sobre empresas existentes), os
-- OUTROS agentes já somam o teto, e só a guarda impede que renomear ou editar um
-- agente vire PT402. O `a.id <> new.id` serve a quem entra de verdade
-- (desarquivar, trocar de empresa): não conta o próprio.
create or replace function public.fn_mia_trava_agentes_do_plano()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limite integer;
  v_em_uso integer;
begin
  if new.archived_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.archived_at is null
       and new.organization_id is not distinct from old.organization_id then
      return new;
    end if;
  end if;

  v_limite := public.fn_mia_limite_de_agentes(new.organization_id);
  if v_limite is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, 2283));

  select count(*) into v_em_uso
    from public.ai_agents a
   where a.organization_id = new.organization_id
     and a.archived_at is null
     and a.id <> new.id;

  if v_em_uso >= v_limite then
    raise exception 'limite_do_plano:agentes:%', v_limite
      using errcode = 'PT402',
            detail = jsonb_build_object('recurso', 'agentes', 'limite', v_limite, 'em_uso', v_em_uso)::text;
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_mia_trava_agentes_do_plano() from public, anon, authenticated;

comment on function public.fn_mia_trava_agentes_do_plano() is
  'MIA (9174): recusa (PT402, limite_do_plano:agentes:<teto>) o agente que nasce, desarquiva ou muda de empresa quando a empresa ja tem o teto do plano em agentes nao arquivados. Editar agente que ja estava fora do arquivo nunca conta.';

drop trigger if exists trg_mia_trava_agentes_do_plano on public.ai_agents;
create trigger trg_mia_trava_agentes_do_plano
  before insert or update of archived_at, organization_id
  on public.ai_agents
  for each row execute function public.fn_mia_trava_agentes_do_plano();

comment on table public.mia_plano_modulos is
  'MIA (9070, 9110, 9174): o que cada plano de cobranca_planos liga alem dos limites do upstream: os modulos vendaveis, o preco por mensagem do Broadcast, o preco por e-mail de marketing, o teto de agentes de IA e o texto do cartao da pagina de precos. Tabela AO LADO: cobranca_planos e do upstream e nao muda. So o servidor le e escreve.';

notify pgrst, 'reload schema';
