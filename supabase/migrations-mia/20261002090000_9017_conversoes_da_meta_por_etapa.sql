-- 9017 · conversões da Meta por etapa do funil, e a volta dos leads de formulário
--
-- ── O que entra ─────────────────────────────────────────────────────────────
--
-- Até aqui a Meta só ficava sabendo da COMPRA (negócio ganho), e só de quem veio
-- de clique em anúncio para o WhatsApp. O Google Ads já tinha a régua por etapa
-- (`google_ads_conversion_rules`, migration 0436 do upstream). Esta migration dá
-- à Meta a mesma régua, em tabelas NOSSAS, ao lado (docs/fork/conversoes-da-meta.md):
--
--   · mia_conversoes_meta_regras   "quando um negócio ENTRAR nesta etapa, avise
--                                  este evento à Meta": o evento, o canal de
--                                  entrada e o valor que o evento leva
--   · mia_conversoes_meta_config   a chave POR EMPRESA "leads de formulário da
--                                  Meta voltam para a Meta", e desde quando
--   · fn_mia_solicitar_reenvio_conversao_meta   a porta do reenvio de um evento
--                                  de etapa recusado (a do upstream só conhece
--                                  `Purchase`, `QualifiedLead` e `Etapa:<uuid>`)
--
-- ── As travas, as mesmas do Google ──────────────────────────────────────────
--
--   1. Uma vez por negócio e evento. A chave do livro-razão
--      (`ad_conversion_dispatches`, único por organização + negócio + evento) é
--      `Meta:<evento>`, e não a etapa: o mesmo evento ligado em duas etapas só
--      sai na primeira, e sair e voltar à etapa não duplica.
--   2. Ligar uma regra não envia o passado. `configurada_em` é regravada pelo
--      gatilho quando a regra nasce, quando é LIGADA e quando troca de evento:
--      só o movimento de etapa posterior a ela envia.
--   3. O reenvio usa o retrato do primeiro envio (quando aconteceu e quanto
--      valia), que mora na linha do livro-razão.
--   4. Canal de entrada: todos, só WhatsApp (o negócio tem conversa vinculada) ou
--      só fora do WhatsApp. O mesmo vocabulário da regra do Google.
--
-- ── O valor do evento ───────────────────────────────────────────────────────
--
-- `modo_do_valor`: `sem_valor` (o padrão: o valor nasce vazio até alguém
-- configurar), `valor_fixo` (em centavos, na própria regra) ou
-- `valor_do_negocio` (o valor do negócio na hora; negócio sem valor envia o
-- evento de etapa sem valor). A compra continua exigindo valor, como sempre.
--
-- ── Os eventos ──────────────────────────────────────────────────────────────
--
-- A coluna guarda a NOSSA chave do evento (`novo_lead`, `lead_qualificado`,
-- `agendou`, `pediu_orcamento`, `iniciou_compra`). O nome técnico que vai para a
-- Meta mora num lugar só, no código (`lib/conversoes-meta/eventos.ts`): trocar o
-- nome técnico não reenvia o que já foi, porque a deduplicação é pela chave.
--
-- ── Leads de formulário ─────────────────────────────────────────────────────
--
-- O id do lead do formulário já é guardado na origem do negócio
-- (`crm_leads.source_metadata.meta_lead_id`, migration 9003). Com a chave
-- ligada, os eventos de etapa com regra e a venda também são informados para
-- esse lead, mesmo sem clique em anúncio de WhatsApp. `leads_de_formulario_desde`
-- é a trava de retroatividade da chave: ligar não envia o passado.
--
-- ── Quem lê e quem escreve ──────────────────────────────────────────────────
--
-- RLS por empresa, como as outras tabelas `mia_*`: gerente (ou acima) LÊ; toda
-- escrita é do servidor (a ação da tela e a ferramenta do MCP, que conferem
-- papel), pelo `service_role`. Nenhuma das duas guarda dado pessoal nem segredo:
-- a credencial da Meta continua em `ad_platform_connections`, do upstream.
--
-- ── A empresa de demonstração ───────────────────────────────────────────────
--
-- Regra pode ser gravada na empresa de demonstração; nada sai dela, porque a
-- conexão de conversões ligada não existe lá (gatilho da 9010 em
-- `ad_platform_connections`) e sem conexão o consumidor não envia. Provado em
-- tests/invariants/conversoes-da-meta-por-etapa.test.ts.
--
-- Nomes com prefixo `mia_`/`fn_mia_`/`trg_mia_`: nada do upstream é redefinido
-- (docs/FORK-MIA.md, regra 3).

-- ── 1. o que cada etapa informa à Meta ──────────────────────────────────────
create table if not exists public.mia_conversoes_meta_regras (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  stage_id            uuid not null,
  -- A NOSSA chave do evento. O nome técnico mora no código, num lugar só.
  evento              text not null,
  -- Por onde o negócio precisa ter entrado: todos, whatsapp (tem conversa
  -- vinculada) ou outros (sem conversa).
  canal               text not null default 'todos',
  modo_do_valor       text not null default 'sem_valor',
  valor_fixo_centavos bigint,
  -- Nasce DESLIGADA: gravar a regra não faz dado nenhum sair.
  ligada              boolean not null default false,
  -- A trava de retroatividade: só o movimento de etapa posterior envia.
  configurada_em      timestamptz not null default now(),
  criada_em           timestamptz not null default now(),
  atualizada_em       timestamptz not null default now(),
  atualizada_por      uuid references auth.users(id) on delete set null,
  constraint mia_conversoes_meta_regras_evento_conhecido
    check (evento in ('novo_lead', 'lead_qualificado', 'agendou', 'pediu_orcamento', 'iniciou_compra')),
  constraint mia_conversoes_meta_regras_canal_conhecido
    check (canal in ('todos', 'whatsapp', 'outros')),
  constraint mia_conversoes_meta_regras_modo_conhecido
    check (modo_do_valor in ('sem_valor', 'valor_fixo', 'valor_do_negocio')),
  -- Valor fixo sem valor não é valor fixo; e valor zero ensinaria à Meta que o
  -- evento não vale nada.
  constraint mia_conversoes_meta_regras_valor_fixo_coerente
    check (
      (modo_do_valor = 'valor_fixo' and valor_fixo_centavos is not null and valor_fixo_centavos > 0)
      or (modo_do_valor <> 'valor_fixo' and valor_fixo_centavos is null)
    )
);

alter table public.mia_conversoes_meta_regras
  drop constraint if exists mia_conversoes_meta_regras_stage_org_fk;
alter table public.mia_conversoes_meta_regras
  add constraint mia_conversoes_meta_regras_stage_org_fk
  foreign key (organization_id, stage_id)
  references public.crm_stages (organization_id, id)
  on delete cascade;

create unique index if not exists uq_mia_conversoes_meta_regras_org_etapa
  on public.mia_conversoes_meta_regras (organization_id, stage_id);

comment on table public.mia_conversoes_meta_regras is
  'MIA (9017): qual evento cada etapa ABERTA do funil informa a Meta quando um negocio entra nela, com o canal de entrada e o valor do evento. A chave do livro-razao ad_conversion_dispatches e Meta:<evento>: uma vez por negocio e evento. Gerente le; so o servidor escreve.';
comment on column public.mia_conversoes_meta_regras.evento is
  'A chave do evento na casa (novo_lead, lead_qualificado, agendou, pediu_orcamento, iniciou_compra). O nome tecnico enviado a Meta mora em lib/conversoes-meta/eventos.ts.';
comment on column public.mia_conversoes_meta_regras.configurada_em is
  'Trava de retroatividade: so movimentos de etapa posteriores enviam. Regravada pelo gatilho quando a regra nasce, e LIGADA ou troca de evento ou de etapa.';
comment on column public.mia_conversoes_meta_regras.modo_do_valor is
  'sem_valor (padrao), valor_fixo (valor_fixo_centavos) ou valor_do_negocio (o valor do negocio na hora; sem valor, o evento sai sem valor).';

create or replace function public.fn_mia_marcar_configuracao_regra_meta()
returns trigger
language plpgsql
set search_path = public
as $f$
begin
  if tg_op = 'INSERT' then
    new.configurada_em := now();
  elsif new.stage_id is distinct from old.stage_id
     or new.evento is distinct from old.evento
     or (new.ligada and not old.ligada) then
    new.configurada_em := now();
  else
    new.configurada_em := old.configurada_em;
  end if;
  new.atualizada_em := now();
  return new;
end
$f$;

comment on function public.fn_mia_marcar_configuracao_regra_meta() is
  'MIA (9017): carimba configurada_em quando a regra de conversao da Meta nasce, e ligada ou troca de evento ou de etapa. E a trava que impede ligar uma regra de despejar o historico do funil na Meta.';

revoke all on function public.fn_mia_marcar_configuracao_regra_meta() from public;
revoke execute on function public.fn_mia_marcar_configuracao_regra_meta() from anon, authenticated;
grant execute on function public.fn_mia_marcar_configuracao_regra_meta() to service_role;

drop trigger if exists trg_mia_marcar_configuracao_regra_meta on public.mia_conversoes_meta_regras;
create trigger trg_mia_marcar_configuracao_regra_meta
  before insert or update on public.mia_conversoes_meta_regras
  for each row execute function public.fn_mia_marcar_configuracao_regra_meta();

-- ── 2. a chave por empresa: leads de formulário voltam para a Meta ──────────
create table if not exists public.mia_conversoes_meta_config (
  organization_id           uuid primary key references public.organizations(id) on delete cascade,
  leads_de_formulario       boolean not null default false,
  -- Desde quando a chave está ligada. Nulo com a chave desligada.
  leads_de_formulario_desde timestamptz,
  atualizada_em             timestamptz not null default now(),
  atualizada_por            uuid references auth.users(id) on delete set null
);

comment on table public.mia_conversoes_meta_config is
  'MIA (9017): a chave POR EMPRESA das conversoes da Meta. leads_de_formulario ligada: os eventos de etapa com regra e a venda tambem sao informados para o lead que veio de formulario da Meta, pelo id do lead guardado. Sem linha, ou desligada: lead de formulario nao volta para a Meta.';
comment on column public.mia_conversoes_meta_config.leads_de_formulario_desde is
  'Trava de retroatividade da chave: so o que acontecer depois de ligar e informado. Carimbada pelo gatilho ao ligar; nula com a chave desligada.';

create or replace function public.fn_mia_marcar_chave_de_formulario_meta()
returns trigger
language plpgsql
set search_path = public
as $f$
begin
  if not new.leads_de_formulario then
    new.leads_de_formulario_desde := null;
  elsif tg_op = 'INSERT' or not old.leads_de_formulario then
    new.leads_de_formulario_desde := now();
  else
    new.leads_de_formulario_desde := old.leads_de_formulario_desde;
  end if;
  new.atualizada_em := now();
  return new;
end
$f$;

comment on function public.fn_mia_marcar_chave_de_formulario_meta() is
  'MIA (9017): carimba leads_de_formulario_desde quando a chave e ligada, e a zera quando e desligada. Ligar a chave nao envia o passado.';

revoke all on function public.fn_mia_marcar_chave_de_formulario_meta() from public;
revoke execute on function public.fn_mia_marcar_chave_de_formulario_meta() from anon, authenticated;
grant execute on function public.fn_mia_marcar_chave_de_formulario_meta() to service_role;

drop trigger if exists trg_mia_marcar_chave_de_formulario_meta on public.mia_conversoes_meta_config;
create trigger trg_mia_marcar_chave_de_formulario_meta
  before insert or update on public.mia_conversoes_meta_config
  for each row execute function public.fn_mia_marcar_chave_de_formulario_meta();

-- ── 3. RLS: gerente lê a própria empresa; só o servidor escreve ─────────────
alter table public.mia_conversoes_meta_regras enable row level security;
alter table public.mia_conversoes_meta_config enable row level security;

drop policy if exists mia_conversoes_meta_regras_select on public.mia_conversoes_meta_regras;
create policy mia_conversoes_meta_regras_select on public.mia_conversoes_meta_regras
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_conversoes_meta_config_select on public.mia_conversoes_meta_config;
create policy mia_conversoes_meta_config_select on public.mia_conversoes_meta_config
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- O default ACL do Supabase dá ALL a anon e authenticated em toda tabela nova;
-- o `grant select` sozinho não o desfaz (lição da 9001).
revoke all on public.mia_conversoes_meta_regras from anon, authenticated;
revoke all on public.mia_conversoes_meta_config from anon, authenticated;

grant select on public.mia_conversoes_meta_regras to authenticated;
grant select on public.mia_conversoes_meta_config to authenticated;

grant select, insert, update, delete on public.mia_conversoes_meta_regras to service_role;
grant select, insert, update, delete on public.mia_conversoes_meta_config to service_role;

-- ── 4. o reenvio de um evento de etapa da Meta ──────────────────────────────
--
-- Ao lado de `fn_solicitar_reenvio_conversao` (do upstream), que só conhece
-- `Purchase`, `QualifiedLead` e `Etapa:<uuid>`. As mesmas exigências, mais duas
-- da Meta: só reenvia o que tem o RETRATO (quando aconteceu) e foi de fato um
-- evento (linha que diz "anterior à regra" ou "formulário desligado" não é
-- pendência, é decisão), e evento com mais de 7 dias não volta, porque a Meta o
-- recusa de qualquer jeito.
--
-- O tipo do evento emitido é NOSSO (`conversao_meta.retry_requested`): com o
-- do upstream, o consumidor de venda dele leria um nome que não conhece como se
-- fosse o reenvio de uma compra.
create or replace function public.fn_mia_solicitar_reenvio_conversao_meta(p_org uuid, p_lead uuid, p_event text)
returns boolean
language plpgsql
set search_path = public
as $f$
declare
  v_linha public.ad_conversion_dispatches%rowtype;
begin
  if p_event is null or p_event !~ '^Meta:[a-z_]{3,40}$' then
    return false;
  end if;

  select * into v_linha from public.ad_conversion_dispatches
   where organization_id = p_org and lead_id = p_lead and event_name = p_event
     for update;
  if not found or v_linha.status = 'sent' then
    return false;
  end if;

  if v_linha.event_occurred_at is null
     or v_linha.reason in ('anterior_a_regra', 'anterior_a_chave', 'formulario_desligado') then
    return false;
  end if;

  if v_linha.event_occurred_at < now() - interval '7 days' then
    return false;
  end if;

  if exists (
    select 1 from public.event_log
     where organization_id = p_org and entity_id = p_lead
       and event_type = 'conversao_meta.retry_requested'
       and status in ('pending', 'processing')
       and payload ->> 'event_name' = p_event
  ) then
    return false;
  end if;

  perform public.emit_event('conversao_meta.retry_requested', 'crm_lead', p_lead,
    jsonb_build_object('event_name', p_event), '{}'::jsonb, p_org);

  update public.ad_conversion_dispatches
     set reason = 'reprocessamento_solicitado', attempted_at = now()
   where id = v_linha.id and organization_id = p_org;

  return true;
end
$f$;

comment on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) is
  'MIA (9017): agenda o reenvio de um evento de etapa da Meta (Meta:<evento>) que nao foi enviado. So reenvia o que tem retrato do primeiro envio, que foi de fato um evento e que tem ate 7 dias; nao duplica pedido pendente. Emite conversao_meta.retry_requested. So o service_role executa.';

revoke all on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) from public;
revoke execute on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) from anon, authenticated;
grant execute on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) to service_role;

-- Tabelas e função novas: o PostgREST precisa reler o schema para enxergá-las.
notify pgrst, 'reload schema';
