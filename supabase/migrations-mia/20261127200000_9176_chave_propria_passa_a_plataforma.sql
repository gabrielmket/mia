-- manifest: AS EMPRESAS DE CHAVE PRÓPRIA PASSAM À IA DA PLATAFORMA (MIA-337; desenho na MIA-285, ponto 1, opção A; decisões do Gabriel na MIA-335). Critério por DADO, nunca por id ou nome: empresa fora da demonstração, com `ia_segue_a_plataforma = false` e credencial `openai` ativa e validada. Para cada uma, `fn_mia_chave_propria_passa_a_plataforma` (uma vez só, guardada por `platform_ia.chaves_proprias_passaram_em`, gravada na mesma instrução): desativa as credenciais `openai` ativas (sem apagar e sem limpar `validated_at`; o resolvedor desce para a chave da instalação na chamada seguinte), passa a empresa a seguir a plataforma (o gatilho da 9172 grava o par de `platform_ia` em `settings.llm`, e a carga da versão da MIA-309 leva os agentes publicados ao mesmo par), põe o teto de `ai_budgets` em US$ 30 no mês (3000 centavos de dólar) no modo `avisar` (nunca `bloquear`) e grava uma linha `ai.chave_propria_passou_a_plataforma` com o par, o teto e as credenciais de antes, de onde sai a volta (docs/fork/ia-da-plataforma.md, seção 10). A typesafe (o Jev) fica ativa. Nada na versão publicada. Provado em tests/invariants/chave-propria-passa-a-plataforma.test.ts e na sonda 9176 do ensaio de banco.
--
-- 9176 · as empresas de chave própria passam à IA da plataforma
--
-- Nomes NOSSOS (`fn_mia_*`, coluna nova em `platform_ia`, que é nossa): estender,
-- nunca redefinir (docs/FORK-MIA.md, regra 3). Nada do upstream é redefinido:
-- só `update` e `insert` nas tabelas dele, pela migration.
-- Idempotente: `if not exists`, `create or replace` só em função nossa, e a
-- passagem roda uma vez só (seção 3).
--
-- Cada decisão do Gabriel (MIA-335) mora num trecho marcado com DECISÃO. Se a
-- resposta for outra, muda só aquele trecho.

-- ── 1. a marca de que já rodou ──────────────────────────────────────────────
-- Na linha única de `platform_ia` (nossa, só service_role), e não na auditoria:
-- a sessão de um membro consegue inserir em `api_audit_log` com
-- `organization_id` nulo (política do upstream), e uma marca que qualquer um
-- grava não guarda nada.
alter table public.platform_ia
  add column if not exists chaves_proprias_passaram_em timestamptz;

comment on column public.platform_ia.chaves_proprias_passaram_em is
  'MIA (9176): quando a 9176 passou as empresas de chave propria a IA da plataforma. Preenchida = a passagem ja rodou e nao roda de novo (o baseline roda a cada implantacao, e uma segunda passada puxaria quem escolheu chave propria depois). Nula = ainda nao rodou.';

-- ── 2. a passagem ───────────────────────────────────────────────────────────
create or replace function public.fn_mia_chave_propria_passa_a_plataforma()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  -- ── DECISÃO · as chaves que saem ──────────────────────────────────────────
  -- Só as da IA principal. A `typesafe` NÃO está aqui: o Jev delas segue na
  -- chave delas até o Jev nativo (desenho da MIA-285, ponto 2). Se o Gabriel
  -- decidir desligar o Jev, a `typesafe` entra nesta lista E a config do Jev
  -- (`settings.jev`) tem de ser desligada junto; só a lista não basta.
  c_provedores_que_saem constant text[] := array['openai'];

  -- ── DECISÃO · o teto de `ai_budgets` ──────────────────────────────────────
  -- `monthly_limit_cents` é centavo de DÓLAR (`pricing.ts` calcula em USD;
  -- `lib/agent-engine/edge/llm/orcamento.ts`). 3000 = US$ 30 no mês.
  -- O modo é `avisar`: abre o aviso ao passar do limiar e a IA SEGUE.
  -- `bloquear` é recusado logo abaixo.
  c_teto_cents constant integer := 3000;
  c_modo       constant text    := 'avisar';

  r            record;
  v_teto_antes jsonb;
  v_desligadas uuid[];
  v_provider   text;
  v_model      text;
  v_n          integer := 0;
begin
  -- Nunca `bloquear` por migration: a escada da tela exige passar por `avisar`
  -- e a carência de 72h (`lib/ai/budget/mudanca-do-teto.ts`), e parar a IA de
  -- uma empresa é decisão de pessoa.
  if c_modo not in ('off', 'avisar') then
    raise exception 'MIA (9176): o modo do teto tem de ser off ou avisar, nunca %', c_modo;
  end if;

  for r in
    -- ── DECISÃO · quem passa (o critério) ───────────────────────────────────
    -- Por DADO, nunca por id ou nome (o repositório é público):
    --   · fora da demonstração;
    --   · com escolha própria (`ia_segue_a_plataforma = false`);
    --   · com credencial `openai` ativa E validada, a que o resolvedor usaria.
    -- Contado em produção em 27/11/2026, só leitura: 4 empresas.
    -- "Uma a uma" ou "alguma de fora" muda este `select`.
    select o.id,
           o.settings -> 'llm' ->> 'provider'      as provider_antes,
           o.settings -> 'llm' ->> 'default_model' as modelo_antes,
           o.settings -> 'llm' -> 'enabled_models' as modelos_antes
      from public.organizations o
     where not o.demonstracao
       and not o.ia_segue_a_plataforma
       and exists (select 1
                     from public.ai_provider_credentials c
                    where c.organization_id = o.id
                      and c.provider = 'openai'
                      and c.is_active
                      and c.validated_at is not null)
     order by o.id
  loop
    -- (a) O teto de antes, para a volta. `null` = a empresa não tinha linha.
    select jsonb_build_object(
             'monthly_limit_cents', b.monthly_limit_cents,
             'enforcement_mode', b.enforcement_mode,
             'alarm_threshold_pct', b.alarm_threshold_pct,
             'enforcement_effective_at', b.enforcement_effective_at)
      into v_teto_antes
      from public.ai_budgets b
     where b.organization_id = r.id;

    -- (b) As chaves da IA principal se desativam: sem apagar (a FK da versão
    --     publicada é `on delete restrict`) e sem limpar `validated_at`, para
    --     a volta ser só religar. Todas as ativas, validadas ou não: uma não
    --     validada que alguém validasse depois voltaria a ganhar da instalação.
    with desligadas as (
      update public.ai_provider_credentials c
         set is_active = false,
             updated_at = now()
       where c.organization_id = r.id
         and c.provider = any (c_provedores_que_saem)
         and c.is_active
      returning c.id
    )
    select coalesce(array_agg(d.id order by d.id), '{}'::uuid[]) into v_desligadas
      from desligadas d;

    -- (c) Passa a seguir a plataforma. O gatilho `trg_ia_segue_a_plataforma`
    --     (9172) grava o par de `platform_ia` em `settings.llm` nesta mesma
    --     instrução; sem par na plataforma, o par fica e chega quando ela
    --     escolher. A versão publicada não muda (o gatilho do upstream recusa,
    --     e não precisa): a carga da versão (MIA-309) lê o par da plataforma
    --     para quem segue e zera a credencial da versão.
    update public.organizations o
       set ia_segue_a_plataforma = true
     where o.id = r.id
    returning o.settings -> 'llm' ->> 'provider', o.settings -> 'llm' ->> 'default_model'
      into v_provider, v_model;

    -- (d) O teto. Com linha, troca o teto e o modo e deixa o limiar; saindo de
    --     `bloquear`, zera a data da carência (a regra do desarme). Sem linha,
    --     nasce com o teto explícito, nunca o `DEFAULT 5000` da coluna.
    if v_teto_antes is not null then
      update public.ai_budgets b
         set monthly_limit_cents = c_teto_cents,
             enforcement_mode = c_modo,
             enforcement_effective_at = case when b.enforcement_mode = 'bloquear' then null
                                             else b.enforcement_effective_at end,
             updated_at = now()
       where b.organization_id = r.id;
    else
      insert into public.ai_budgets (organization_id, monthly_limit_cents, enforcement_mode)
      values (r.id, c_teto_cents, c_modo);
    end if;

    -- (e) A auditoria: uma linha por empresa, só ids e configuração (nunca nome
    --     de empresa, chave ou gasto). É dela que sai a volta.
    insert into public.api_audit_log
      (organization_id, action, resource_type, resource_id, bypassed_rls, metadata)
    values (r.id, 'ai.chave_propria_passou_a_plataforma', 'organization', r.id, true,
            jsonb_build_object(
              'migration', '9176',
              'antes', jsonb_build_object('provider', r.provider_antes,
                                          'default_model', r.modelo_antes,
                                          'enabled_models', r.modelos_antes),
              'depois', jsonb_build_object('provider', v_provider, 'default_model', v_model),
              'teto_antes', v_teto_antes,
              'teto_depois', jsonb_build_object('monthly_limit_cents', c_teto_cents,
                                                'enforcement_mode', c_modo),
              'credenciais_desativadas', to_jsonb(v_desligadas)));

    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

comment on function public.fn_mia_chave_propria_passa_a_plataforma() is
  'MIA (9176): passa a IA da plataforma as empresas fora da demonstracao, com ia_segue_a_plataforma = false e credencial openai ativa e validada. Por empresa: desativa as credenciais openai ativas (sem apagar, validated_at fica), ia_segue_a_plataforma = true (o gatilho da 9172 grava o par de platform_ia), teto de ai_budgets em 3000 centavos de dolar no modo avisar, e uma linha ai.chave_propria_passou_a_plataforma com o par, o teto e as credenciais de antes (a volta le dela). A typesafe fica. Devolve quantas passaram. Idempotente pelo criterio; chamada uma vez pela 9176 (platform_ia.chaves_proprias_passaram_em).';

revoke execute on function public.fn_mia_chave_propria_passa_a_plataforma() from public, anon, authenticated;

-- ── 3. uma vez só ───────────────────────────────────────────────────────────
-- A mesma ideia da guarda da 9172: o baseline roda a cada implantação, e uma
-- segunda passada puxaria de volta quem escolher chave própria depois. A marca
-- é gravada no MESMO bloco da passagem: se a passagem falhar, nada fica, nem a
-- marca, e a implantação seguinte tenta de novo.
do $$
begin
  if (select p.chaves_proprias_passaram_em from public.platform_ia p where p.id = 1) is null then
    perform public.fn_mia_chave_propria_passa_a_plataforma();
    -- Só a coluna nova: o gatilho de propagação da 9172 é `update of provider,
    -- model_id` e não roda; no `insert` (instalação nova, sem par) ele não muda ninguém.
    insert into public.platform_ia (id, chaves_proprias_passaram_em)
    values (1, now())
    on conflict (id) do update
      set chaves_proprias_passaram_em = excluded.chaves_proprias_passaram_em;
  end if;
end $$;

notify pgrst, 'reload schema';
