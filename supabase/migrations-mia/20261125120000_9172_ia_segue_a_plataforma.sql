-- manifest: A IA DE TODA EMPRESA SEGUE A DA PLATAFORMA (MIA-215; desenho na MIA-216). Toda empresa nascia com o padrão do produto do upstream (anthropic/claude-sonnet-5, de `fn_seed_org_llm_defaults`), e a troca em /admin/modelo-de-ia (`platform_ia`) não chegava a ela. Coluna NOSSA `organizations.ia_segue_a_plataforma` (`true` = o par da empresa é o de `platform_ia`; `false` = escolha própria, gravada pelo PATCH de /api/v1/ai/providers). Dois gatilhos NOSSOS mantêm a invariante "segue ⇒ `settings.llm.provider/default_model` = `platform_ia`": `trg_ia_segue_a_plataforma` (BEFORE INSERT OR UPDATE OF settings, ia_segue_a_plataforma em `organizations`; roda antes de `trg_seed_org_llm_defaults` pela ordem alfabética, então a empresa nova já nasce com o par da plataforma e o seed do upstream não faz nada; com molde de IA (9096) grava `false` e deixa o upstream copiar o molde; sem par na plataforma não faz nada; sessão de cliente não troca a coluna, 42501) e `trg_mia_platform_ia_propaga` (AFTER INSERT OR UPDATE OF provider, model_id em `platform_ia`: troca o par de toda empresa que segue e audita `ai.padrao_seguiu_a_plataforma` por empresa). Quando o par muda, `enabled_models` que não contém o modelo novo sai (vazio = todos), senão o turno recusaria o próprio padrão. CONSERTO (`fn_mia_ia_segue_a_plataforma_conserto`, uma vez só, enquanto o default da coluna ainda é `false`): passa a seguir quem está no padrão semeado da Anthropic sem credencial Anthropic ativa (A), quem já está no par da plataforma sem credencial ativa daquele provedor (B) e quem não tem provedor nenhum (C); uma linha `ai.padrao_passou_a_seguir_a_plataforma` por empresa, com o par de antes e o de depois. Quem escolheu outro par fica. Só depois o default vira `true`. `fn_seed_org_llm_defaults` NÃO é redefinida. Provado em tests/invariants/ia-segue-a-plataforma.test.ts.
--
-- 9172 · a IA de toda empresa segue a da plataforma
--
-- Nomes NOSSOS (`fn_mia_*`, `trg_ia_*`, `trg_mia_*`): estender, nunca redefinir
-- (docs/FORK-MIA.md, regra 3). Idempotente: `if not exists`, `create or replace`
-- só em função nossa, gatilhos recriados, e o conserto roda uma vez só.

-- ── 1. a coluna ─────────────────────────────────────────────────────────────
-- Nasce `false` para quem já existe: o conserto (4) decide quem passa a seguir,
-- e só depois (5) o default vira `true` para quem nascer daqui em diante.
alter table public.organizations
  add column if not exists ia_segue_a_plataforma boolean not null default false;

comment on column public.organizations.ia_segue_a_plataforma is
  'MIA (9172): true = o padrao de IA desta empresa (settings.llm.provider/default_model) e o de platform_ia, mantido pelos gatilhos trg_ia_segue_a_plataforma e trg_mia_platform_ia_propaga; false = escolha propria (o PATCH de /api/v1/ai/providers grava false). Default true para quem nasce depois da 9172; com molde de IA (9096) a empresa nova nasce false. Coluna e nao chave de settings porque o PATCH do upstream reescreve settings.llm inteiro. So o servidor muda.';

-- ── 2. o par dentro de settings ─────────────────────────────────────────────
-- A única forma de pôr um par em `settings.llm`: troca provedor e modelo juntos,
-- preserva o resto de `settings` e de `llm`, e tira `enabled_models` quando a
-- lista não tem o modelo novo (`run-model-call.ts` recusaria o próprio padrão).
create or replace function public.fn_mia_llm_com_o_par(p_settings jsonb, p_provider text, p_model text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_set(
    coalesce(p_settings, '{}'::jsonb),
    '{llm}',
    (case when jsonb_typeof(p_settings -> 'llm') = 'object' then p_settings -> 'llm' else '{}'::jsonb end
       - case
           when jsonb_typeof(p_settings -> 'llm' -> 'enabled_models') = 'array'
            and jsonb_array_length(p_settings -> 'llm' -> 'enabled_models') > 0
            and not ((p_settings -> 'llm' -> 'enabled_models') ? p_model)
           then 'enabled_models'
           else ''
         end)
      || jsonb_build_object('provider', p_provider, 'default_model', p_model),
    true);
$$;

comment on function public.fn_mia_llm_com_o_par(jsonb, text, text) is
  'MIA (9172): settings com o par (provider, default_model) em settings.llm, o resto preservado; enabled_models sem o modelo novo sai (vazio = todos).';

revoke execute on function public.fn_mia_llm_com_o_par(jsonb, text, text) from public, anon, authenticated;

-- ── 3a. quem segue fica no par da plataforma ────────────────────────────────
create or replace function public.fn_mia_ia_segue_a_plataforma()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text;
  v_model    text;
begin
  -- A sessão de cliente não decide se a empresa segue a plataforma. E não é
  -- corrigida aqui: o `trg_mia_trava_ia_organizacao` (9002) recusa a troca do
  -- par, e corrigir antes dele esconderia a recusa.
  if tg_op = 'UPDATE' and public.fn_mia_escrita_de_cliente(new.id) then
    if new.ia_segue_a_plataforma is distinct from old.ia_segue_a_plataforma then
      raise exception 'ia_da_plataforma: quem decide se a empresa segue a IA da plataforma é a plataforma'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if not new.ia_segue_a_plataforma then
    return new;
  end if;

  -- Empresa nova com molde de IA (9096): vence o molde, que o upstream copia
  -- logo depois (`fn_seed_org_llm_defaults`). A escolha é de quem montou o molde.
  if tg_op = 'INSERT' and public.fn_llm_do_molde_de_ia() is not null then
    new.ia_segue_a_plataforma := false;
    return new;
  end if;

  select p.provider, p.model_id into v_provider, v_model
    from public.platform_ia p
   where p.id = 1;
  -- Ninguém escolheu na plataforma (CI, instalação nova): nada muda, e o seed
  -- do upstream segue como antes. A empresa continua seguindo, e recebe o par
  -- quando a plataforma escolher.
  if v_provider is null or v_model is null then
    return new;
  end if;

  if (new.settings -> 'llm' ->> 'provider') is distinct from v_provider
     or (new.settings -> 'llm' ->> 'default_model') is distinct from v_model then
    new.settings := public.fn_mia_llm_com_o_par(new.settings, v_provider, v_model);
  end if;
  return new;
end;
$$;

comment on function public.fn_mia_ia_segue_a_plataforma() is
  'MIA (9172): gatilho BEFORE de organizations. Quem segue a plataforma (ia_segue_a_plataforma) fica com o par de platform_ia em settings.llm, por qualquer caminho de escrita; empresa nova com molde de IA nasce false; sessao de cliente nao troca a coluna (42501).';

revoke execute on function public.fn_mia_ia_segue_a_plataforma() from public, anon, authenticated;

-- `trg_ia_…` vem antes de `trg_mia_…`, `trg_organizacao_…` e `trg_seed_…` na
-- ordem alfabética dos BEFORE de `organizations`: o seed do upstream já recebe
-- o `default_model` preenchido e não faz nada.
drop trigger if exists trg_ia_segue_a_plataforma on public.organizations;
create trigger trg_ia_segue_a_plataforma
  before insert or update of settings, ia_segue_a_plataforma on public.organizations
  for each row execute function public.fn_mia_ia_segue_a_plataforma();

-- ── 3b. trocar na plataforma troca em todas que seguem ──────────────────────
create or replace function public.fn_mia_platform_ia_propaga()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Par vazio ("automático") não apaga o par de ninguém: as empresas ficam no
  -- último que a plataforma escolheu. A rota recusa esvaziar com quem segue.
  if new.provider is null or new.model_id is null then
    return null;
  end if;

  with alvo as (
    select o.id,
           o.settings -> 'llm' ->> 'provider'      as provider_antes,
           o.settings -> 'llm' ->> 'default_model' as modelo_antes
      from public.organizations o
     where o.ia_segue_a_plataforma
       and ((o.settings -> 'llm' ->> 'provider') is distinct from new.provider
            or (o.settings -> 'llm' ->> 'default_model') is distinct from new.model_id)
  ),
  mudou as (
    update public.organizations o
       set settings = public.fn_mia_llm_com_o_par(o.settings, new.provider, new.model_id)
      from alvo
     where o.id = alvo.id
    returning o.id, alvo.provider_antes, alvo.modelo_antes,
              o.settings -> 'llm' ->> 'provider' as provider_depois,
              o.settings -> 'llm' ->> 'default_model' as modelo_depois
  )
  insert into public.api_audit_log
    (organization_id, action, resource_type, resource_id, bypassed_rls, metadata)
  select m.id, 'ai.padrao_seguiu_a_plataforma', 'organization', m.id, true,
         jsonb_build_object(
           'antes', jsonb_build_object('provider', m.provider_antes, 'default_model', m.modelo_antes),
           'depois', jsonb_build_object('provider', m.provider_depois, 'default_model', m.modelo_depois),
           'por', new.updated_by)
    from mudou m;
  return null;
end;
$$;

comment on function public.fn_mia_platform_ia_propaga() is
  'MIA (9172): gatilho AFTER de platform_ia. Troca o par de toda empresa com ia_segue_a_plataforma e audita ai.padrao_seguiu_a_plataforma por empresa alterada. Par vazio nao muda ninguem.';

revoke execute on function public.fn_mia_platform_ia_propaga() from public, anon, authenticated;

drop trigger if exists trg_mia_platform_ia_propaga on public.platform_ia;
create trigger trg_mia_platform_ia_propaga
  after insert or update of provider, model_id on public.platform_ia
  for each row execute function public.fn_mia_platform_ia_propaga();

-- ── 4. o conserto das empresas que já existem ───────────────────────────────
-- A condição é por DADO, nunca por id ou nome de empresa:
--   A · o padrão semeado da Anthropic e nenhuma credencial Anthropic ATIVA
--       (validada ou não: quem tentou cadastrar chave própria escolheu);
--   B · já no par da plataforma e nenhuma credencial ativa daquele provedor;
--   C · nenhum provedor em `settings.llm` (ninguém escolheu nada).
-- Quem escolheu outro par fica. O gatilho 3a troca o par na mesma instrução, e
-- cada empresa alterada ganha uma linha de auditoria com o antes e o depois.
-- Rodar de novo não muda nada nem audita (`not ia_segue_a_plataforma`).
create or replace function public.fn_mia_ia_segue_a_plataforma_conserto()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text;
  v_model    text;
  v_n        integer;
begin
  select p.provider, p.model_id into v_provider, v_model
    from public.platform_ia p
   where p.id = 1;

  with candidatas as (
    select o.id,
           o.settings -> 'llm' ->> 'provider'      as provider_antes,
           o.settings -> 'llm' ->> 'default_model' as modelo_antes,
           case
             when coalesce(btrim(o.settings -> 'llm' ->> 'provider'), '') = '' then 'C'
             when o.settings -> 'llm' ->> 'provider' = 'anthropic'
              and o.settings -> 'llm' ->> 'default_model' in (
                    'claude-sonnet-5', 'anthropic/claude-sonnet-5', 'claude-sonnet-4-6',
                    coalesce((select m.model_id from public.ai_models m
                               where m.provider = 'anthropic' and m.is_default_for_provider
                                 and m.deprecated_at is null limit 1), 'claude-sonnet-5'))
              and not exists (select 1 from public.ai_provider_credentials c
                               where c.organization_id = o.id
                                 and c.provider = 'anthropic'
                                 and c.is_active)
               then 'A'
             when v_provider is not null
              and o.settings -> 'llm' ->> 'provider' = v_provider
              and o.settings -> 'llm' ->> 'default_model' = v_model
              and not exists (select 1 from public.ai_provider_credentials c
                               where c.organization_id = o.id
                                 and c.provider = v_provider
                                 and c.is_active)
               then 'B'
           end as condicao
      from public.organizations o
     where not o.ia_segue_a_plataforma
  ),
  mudou as (
    update public.organizations o
       set ia_segue_a_plataforma = true
      from candidatas c
     where o.id = c.id
       and c.condicao is not null
    returning o.id, c.condicao, c.provider_antes, c.modelo_antes,
              o.settings -> 'llm' ->> 'provider' as provider_depois,
              o.settings -> 'llm' ->> 'default_model' as modelo_depois
  ),
  auditadas as (
    insert into public.api_audit_log
      (organization_id, action, resource_type, resource_id, bypassed_rls, metadata)
    select m.id, 'ai.padrao_passou_a_seguir_a_plataforma', 'organization', m.id, true,
           jsonb_build_object(
             'antes', jsonb_build_object('provider', m.provider_antes, 'default_model', m.modelo_antes),
             'depois', jsonb_build_object('provider', m.provider_depois, 'default_model', m.modelo_depois),
             'migration', '9172',
             'condicao', m.condicao)
      from mudou m
    returning 1
  )
  select count(*) into v_n from auditadas;
  return v_n;
end;
$$;

comment on function public.fn_mia_ia_segue_a_plataforma_conserto() is
  'MIA (9172): passa a seguir a plataforma quem esta no padrao semeado da Anthropic sem credencial Anthropic ativa (A), quem ja esta no par da plataforma sem credencial ativa daquele provedor (B) e quem nao tem provedor (C); audita ai.padrao_passou_a_seguir_a_plataforma por empresa. Devolve quantas mudaram. Idempotente. Chamada uma vez pela 9172.';

revoke execute on function public.fn_mia_ia_segue_a_plataforma_conserto() from public, anon, authenticated;

-- Uma vez só: enquanto o default da coluna ainda é `false` (o passo 5 não
-- rodou). O baseline roda a cada implantação, e uma segunda passada puxaria de
-- volta quem virou escolha própria depois.
do $$
begin
  if (select c.column_default
        from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name = 'organizations'
         and c.column_name = 'ia_segue_a_plataforma') is distinct from 'true' then
    perform public.fn_mia_ia_segue_a_plataforma_conserto();
  end if;
end $$;

-- ── 5. quem nasce daqui em diante segue ─────────────────────────────────────
-- Depois do conserto, nunca antes: senão as empresas com escolha própria
-- também passariam a seguir.
alter table public.organizations
  alter column ia_segue_a_plataforma set default true;

notify pgrst, 'reload schema';
