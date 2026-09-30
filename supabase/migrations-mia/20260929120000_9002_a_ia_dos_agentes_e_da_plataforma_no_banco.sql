-- 9002 — a IA dos agentes é da plataforma também no banco, não só na tela
--
-- ── O buraco ────────────────────────────────────────────────────────────────
--
-- Na MIA, provedor, modelo e chave de IA dos agentes são escolha de quem opera a
-- plataforma (`lib/ai/custo-e-da-plataforma.ts`, `lib/ai/modelo-da-plataforma.ts`).
-- Até aqui só a TELA escondia isso. O banco não sabia de nada: as políticas do
-- upstream deixam o admin da empresa escrever em `ai_agent_versions`, `ai_agents`,
-- `ai_routers`, `ai_purpose_bindings` e `ai_provider_credentials`, e o PostgREST
-- é exposto ao navegador por construção (URL e anon key vão no bundle). Com o
-- próprio login, sem passar por rota nenhuma do Next, o admin da empresa podia:
--
--   · gravar uma versão com qualquer `provider`/`model`/`credential_id`/
--     `operator_model` e apontar `ai_agents.published_version_id` para ela —
--     pulando a função de publicar inteira;
--   · voltar o agente para uma versão antiga com o modelo de antes;
--   · escolher o modelo do classificador do roteador;
--   · criar o "modelo por ponto" da empresa (`ai_purpose_bindings`);
--   · trocar o `provider`/`base_url` da credencial que a PLATAFORMA cadastrou — o
--     que mandaria a nossa chave para um endereço escolhido por ele.
--
-- ── A trava ────────────────────────────────────────────────────────────────
--
-- Gatilhos NOSSOS, ao lado das políticas do upstream, nunca por cima delas
-- (docs/FORK-MIA.md, regra 3). Eles só agem quando TODAS estas são verdade:
--
--   1. quem escreve é um usuário logado — o papel da sessão é `authenticated`
--      (é o que o PostgREST faz com o JWT do usuário). O servidor (`service_role`)
--      e as conexões diretas do motor passam sem ser tocados: é por eles que as
--      rotas e o trabalho de fundo gravam, e a regra do lado de lá mora no código
--      (`lib/ai/trava-da-ia.ts`);
--   2. ele NÃO é admin da plataforma (`fn_is_platform_admin()`);
--   3. ele é membro da organização da linha. Quem não é membro a RLS já barra, e
--      deixar a recusa com ela preserva a mensagem que as catracas do upstream
--      medem ("row-level security").
--
-- O que a sessão de cliente passa a NÃO conseguir:
--
--   ai_agent_versions   mudar provider/model/credential_id/operator_model (nem
--                       mover a versão de agente ou de organização); criar versão
--                       cuja IA não seja a atual do agente ou o padrão da
--                       plataforma (`fn_mia_ia_permitida`)
--   ai_agents           mudar `model` ou `config.voice_model`; apontar
--                       `published_version_id` para versão de outro agente ou com
--                       IA não permitida
--   ai_routers          escolher `config.classifier_model`/`classifier_provider`
--                       (no insert o banco zera os dois: o roteador nasce no
--                       "Automático"; no update, trocar é recusado)
--   ai_purpose_bindings nenhuma escrita
--   ai_provider_credentials nenhuma escrita
--   organizations       mudar `settings.llm` (o padrão de IA da empresa)
--                       (hoje a RLS já só deixa a plataforma escrever aqui; o
--                       gatilho é a segunda porta, para o dia em que o upstream
--                       abrir a tabela a outro papel)
--
-- "IA permitida" = a IA atual do agente (a da versão no ar; sem ela, a da versão
-- mais nova) OU o par padrão da plataforma (`platform_ia`), sem modelo próprio
-- de Operador e com chave nula ou da própria organização.
--
-- ── Por que gatilho, e não revogar a escrita ────────────────────────────────
--
-- Revogar INSERT/UPDATE de `authenticated` fecharia tudo de uma vez, mas também
-- o que é legítimo e o upstream mede: `rbac-config-ia-canais` prova que o admin
-- da empresa reescreve o `system_prompt` pelo PostgREST. A regra da MIA é sobre
-- quatro colunas, não sobre a tabela.
--
-- ── Por que `security definer` e o papel lido de `current_setting('role')` ───
--
-- A regra precisa ler `platform_ia`, que não tem grant para `authenticated`, e a
-- versão no ar do agente. Dentro de uma função definer `current_user` é o dono,
-- mas o GUC `role` continua sendo o da sessão (medido: `postgres/authenticated`),
-- e o claim `role` do JWT também. Os dois juntos cobrem o PostgREST e uma função
-- definer do upstream chamada com o JWT do usuário.
--
-- EXECUTE sai de public/anon/authenticated: disparar gatilho não consulta
-- EXECUTE, e nenhuma destas é para ser chamada por RPC.
--
-- Idempotente: `create or replace` de funções nossas e `drop trigger if exists`.

-- ── quem escreve é o cliente? ───────────────────────────────────────────────
create or replace function public.fn_mia_escrita_de_cliente(p_org uuid)
returns boolean
language sql
stable
set search_path = public
as $f$
  select (coalesce(current_setting('role', true), '') = 'authenticated'
          or coalesce(auth.jwt() ->> 'role', '') = 'authenticated')
     and not public.fn_is_platform_admin()
     and p_org in (select public.fn_user_org_ids());
$f$;

comment on function public.fn_mia_escrita_de_cliente(uuid) is
  'MIA (9002): verdadeiro quando quem escreve e usuario logado (papel authenticated), nao e admin da plataforma e e membro da organizacao. E a condicao em que as travas da IA dos agentes agem.';

revoke all on function public.fn_mia_escrita_de_cliente(uuid) from public;
revoke execute on function public.fn_mia_escrita_de_cliente(uuid) from anon, authenticated;

-- ── a IA que uma versão pode ter ────────────────────────────────────────────
create or replace function public.fn_mia_ia_permitida(
  p_org uuid,
  p_agent uuid,
  p_provider text,
  p_model text,
  p_credential uuid,
  p_operator_model text
)
returns boolean
language plpgsql
stable
set search_path = public
as $f$
declare
  v_provider text;
  v_model text;
  v_credential uuid;
  v_operator text;
  v_achou boolean := false;
  v_par_provider text;
  v_par_model text;
begin
  -- 1. a IA atual do agente: a da versão no ar ...
  select v.provider, v.model, v.credential_id, v.operator_model
    into v_provider, v_model, v_credential, v_operator
    from public.ai_agents a
    join public.ai_agent_versions v
      on v.id = a.published_version_id and v.organization_id = a.organization_id
   where a.id = p_agent and a.organization_id = p_org;
  v_achou := found;

  -- ... e, sem versão no ar, a da versão mais nova.
  if not v_achou then
    select v.provider, v.model, v.credential_id, v.operator_model
      into v_provider, v_model, v_credential, v_operator
      from public.ai_agent_versions v
     where v.agent_id = p_agent and v.organization_id = p_org
     order by v.version_number desc
     limit 1;
    v_achou := found;
  end if;

  if v_achou
     and v_provider is not distinct from p_provider
     and v_model is not distinct from p_model
     and v_credential is not distinct from p_credential
     and v_operator is not distinct from p_operator_model then
    return true;
  end if;

  -- 2. o par padrão da plataforma, sem Operador próprio e com chave nula ou da
  --    própria organização (toda chave de organização é cadastrada pela
  --    plataforma: a escrita em ai_provider_credentials também fica travada).
  select pi.provider, pi.model_id into v_par_provider, v_par_model
    from public.platform_ia pi
   where pi.id = 1;

  return v_par_provider is not null
     and v_par_provider = p_provider
     and v_par_model = p_model
     and p_operator_model is null
     and (p_credential is null
          or exists (select 1 from public.ai_provider_credentials c
                      where c.id = p_credential and c.organization_id = p_org));
end
$f$;

comment on function public.fn_mia_ia_permitida(uuid, uuid, text, text, uuid, text) is
  'MIA (9002): a IA que uma sessao de cliente pode gravar numa versao de agente — a atual do agente (versao no ar; sem ela, a mais nova) ou o par padrao da plataforma (platform_ia).';

revoke all on function public.fn_mia_ia_permitida(uuid, uuid, text, text, uuid, text) from public;
revoke execute on function public.fn_mia_ia_permitida(uuid, uuid, text, text, uuid, text) from anon, authenticated;

-- ── ai_agent_versions ───────────────────────────────────────────────────────
create or replace function public.fn_mia_trava_ia_versao()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  if not public.fn_mia_escrita_de_cliente(new.organization_id) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.provider is distinct from old.provider
       or new.model is distinct from old.model
       or new.credential_id is distinct from old.credential_id
       or new.operator_model is distinct from old.operator_model
       or new.agent_id is distinct from old.agent_id
       or new.organization_id is distinct from old.organization_id then
      raise exception 'ia_da_plataforma: provedor, modelo e chave de IA do agente são escolhidos pela plataforma'
        using errcode = '42501',
              hint = 'Esta sessão pode editar o resto da versão; a IA dela não muda por aqui.';
    end if;
    return new;
  end if;

  if not public.fn_mia_ia_permitida(new.organization_id, new.agent_id, new.provider,
                                    new.model, new.credential_id, new.operator_model) then
    raise exception 'ia_da_plataforma: a versão nova tem de usar a IA atual do agente ou a padrão da plataforma'
      using errcode = '42501',
            hint = 'Provedor, modelo e chave de IA são escolhidos pela plataforma.';
  end if;
  return new;
end
$f$;

revoke all on function public.fn_mia_trava_ia_versao() from public;
revoke execute on function public.fn_mia_trava_ia_versao() from anon, authenticated;

drop trigger if exists trg_mia_trava_ia_versao on public.ai_agent_versions;
create trigger trg_mia_trava_ia_versao
  before insert or update on public.ai_agent_versions
  for each row
  execute function public.fn_mia_trava_ia_versao();

-- ── ai_agents ───────────────────────────────────────────────────────────────
create or replace function public.fn_mia_trava_ia_agente()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_agent uuid;
  v_provider text;
  v_model text;
  v_credential uuid;
  v_operator text;
begin
  if not public.fn_mia_escrita_de_cliente(new.organization_id) then
    return new;
  end if;

  if new.model is distinct from old.model
     or (new.config -> 'voice_model') is distinct from (old.config -> 'voice_model') then
    raise exception 'ia_da_plataforma: o modelo do agente é escolhido pela plataforma'
      using errcode = '42501';
  end if;

  -- Tirar do ar (ponteiro nulo) não troca IA nenhuma. Apontar para uma versão é
  -- publicar, e publicar é onde a IA muda de verdade.
  if new.published_version_id is distinct from old.published_version_id
     and new.published_version_id is not null then
    select v.agent_id, v.provider, v.model, v.credential_id, v.operator_model
      into v_agent, v_provider, v_model, v_credential, v_operator
      from public.ai_agent_versions v
     where v.id = new.published_version_id and v.organization_id = new.organization_id;
    if not found or v_agent is distinct from new.id then
      raise exception 'ia_da_plataforma: a versão no ar tem de ser deste agente'
        using errcode = '42501';
    end if;
    -- Lido ANTES do update: dentro do gatilho BEFORE a linha de ai_agents ainda
    -- tem o ponteiro antigo, então "a IA atual" é a da versão que está no ar.
    if not public.fn_mia_ia_permitida(new.organization_id, new.id, v_provider, v_model,
                                      v_credential, v_operator) then
      raise exception 'ia_da_plataforma: a versão escolhida usa uma IA que não é a atual do agente nem a padrão da plataforma'
        using errcode = '42501',
              hint = 'Quem troca a IA de um agente é a plataforma.';
    end if;
  end if;
  return new;
end
$f$;

revoke all on function public.fn_mia_trava_ia_agente() from public;
revoke execute on function public.fn_mia_trava_ia_agente() from anon, authenticated;

drop trigger if exists trg_mia_trava_ia_agente on public.ai_agents;
create trigger trg_mia_trava_ia_agente
  before update on public.ai_agents
  for each row
  execute function public.fn_mia_trava_ia_agente();

-- ── ai_routers ──────────────────────────────────────────────────────────────
create or replace function public.fn_mia_trava_ia_roteador()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  if not public.fn_mia_escrita_de_cliente(new.organization_id) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Roteador de cliente nasce no "Automático": o classificador usa o que a
    -- plataforma escolheu (painel de provedores, senão o padrão da organização).
    -- Aqui o banco APAGA o que vier em vez de recusar, e não é descuido: o
    -- default da coluna `config` do upstream já traz um `classifier_model`
    -- fixo, então um insert que nem cita o classificador chegaria com modelo, e
    -- recusar derrubaria o roteador por um valor que ninguém escolheu.
    new.config := coalesce(new.config, '{}'::jsonb)
                  || jsonb_build_object('classifier_model', null, 'classifier_provider', null);
    return new;
  end if;

  if (new.config -> 'classifier_model') is distinct from (old.config -> 'classifier_model')
     or (new.config -> 'classifier_provider') is distinct from (old.config -> 'classifier_provider') then
    raise exception 'ia_da_plataforma: o modelo do classificador do roteador é escolhido pela plataforma'
      using errcode = '42501';
  end if;
  return new;
end
$f$;

revoke all on function public.fn_mia_trava_ia_roteador() from public;
revoke execute on function public.fn_mia_trava_ia_roteador() from anon, authenticated;

drop trigger if exists trg_mia_trava_ia_roteador on public.ai_routers;
create trigger trg_mia_trava_ia_roteador
  before insert or update on public.ai_routers
  for each row
  execute function public.fn_mia_trava_ia_roteador();

-- ── ai_purpose_bindings e ai_provider_credentials: só a plataforma escreve ───
create or replace function public.fn_mia_trava_ia_so_plataforma()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_org uuid;
begin
  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  if public.fn_mia_escrita_de_cliente(v_org) then
    raise exception 'ia_da_plataforma: % é configurado pela plataforma', tg_table_name
      using errcode = '42501',
            hint = 'Chave e modelo de IA desta instalação são escolhidos por quem opera a plataforma.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$f$;

revoke all on function public.fn_mia_trava_ia_so_plataforma() from public;
revoke execute on function public.fn_mia_trava_ia_so_plataforma() from anon, authenticated;

drop trigger if exists trg_mia_trava_ia_binding on public.ai_purpose_bindings;
create trigger trg_mia_trava_ia_binding
  before insert or update or delete on public.ai_purpose_bindings
  for each row
  execute function public.fn_mia_trava_ia_so_plataforma();

drop trigger if exists trg_mia_trava_ia_credencial on public.ai_provider_credentials;
create trigger trg_mia_trava_ia_credencial
  before insert or update or delete on public.ai_provider_credentials
  for each row
  execute function public.fn_mia_trava_ia_so_plataforma();

-- ── organizations.settings.llm ──────────────────────────────────────────────
create or replace function public.fn_mia_trava_ia_organizacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  if not public.fn_mia_escrita_de_cliente(new.id) then
    return new;
  end if;
  if (new.settings -> 'llm') is distinct from (old.settings -> 'llm') then
    raise exception 'ia_da_plataforma: o padrão de IA da empresa é escolhido pela plataforma'
      using errcode = '42501';
  end if;
  return new;
end
$f$;

revoke all on function public.fn_mia_trava_ia_organizacao() from public;
revoke execute on function public.fn_mia_trava_ia_organizacao() from anon, authenticated;

drop trigger if exists trg_mia_trava_ia_organizacao on public.organizations;
create trigger trg_mia_trava_ia_organizacao
  before update on public.organizations
  for each row
  when (new.settings is distinct from old.settings)
  execute function public.fn_mia_trava_ia_organizacao();
