-- manifest: AS CONVERSÕES DO SITE (MIA-169, parte B da MIA-164; docs/fork/conversoes-da-meta.md, seção "Conversões do site"). Tabela NOSSA `mia_regras_de_conversao_do_site`, ao lado das regras por etapa do upstream (0436 do Google e 0524 da Meta), que não são tocadas: o CHECK da 0524 segue com os 5 eventos dele e a tela do cliente não muda. Uma linha diz "quando um negócio entrar nesta etapa ABERTA, mande este evento de SITE": na Meta um dos 4 eventos (`CompleteRegistration`, `StartTrial`, `Subscribe`, `Purchase`; CHECK NOSSO), na Google a ação de conversão (`google_acao_id`, só dígitos). Várias regras por etapa (a "Assinante" leva Subscribe, Purchase e a do Google), únicas por (org, etapa, evento) e (org, etapa, ação). `leva_valor` manda o valor do negócio. `enabled` NASCE FALSO. `configured_at` é a trava de retroatividade, regravada pelo gatilho NOSSO `trg_mia_marcar_configuracao_regra_do_site` quando a etapa, o destino ou o valor mudam ou a regra é religada (o mesmo contrato da trava da 0524): ligar não despeja o histórico do funil. FK composta para `crm_stages (organization_id, id)` com `on delete cascade`. A chave no livro-razão do upstream (`ad_conversion_dispatches`, sem mudança de schema) é `MetaEtapa:<id da regra>` ou `Etapa:<id da regra>`: o reenvio do upstream (`fn_solicitar_reenvio_conversao`) e os consumidores dele já aceitam, e o uuid é o da regra, não o da etapa, então não colide com as regras do upstream. RLS ligada sem policy e grants revogados de anon/authenticated, só `service_role` (como a 0213 e a 0524): nenhuma coluna guarda dado pessoal nem segredo; a credencial do site vem do ambiente. Aditiva e idempotente; nenhum objeto do upstream é redefinido. Provado em tests/invariants/regras-de-conversao-do-site.test.ts.
--
-- 9170 · as regras de conversão do site
--
-- O cadastro e a assinatura da MIA viram negócio no funil "MIA - SDR" da Time
-- (parte A, 9169). Cada passo da conta (cadastro concluído, teste, pagamento)
-- tem de chegar à Meta como EVENTO DE SITE, no dataset do site, e ao Google Ads
-- como importação de clique. O motor que manda é o de sempre (`lib/conversoes`):
-- esta tabela só diz o que cada etapa manda, com a chave própria no livro-razão.
--
-- Por que tabela NOSSA, e não abrir o CHECK da 0524: redefinir o CHECK do
-- upstream quebraria a próxima migration dele que o refizer (o nosso banco
-- teria linhas `StartTrial`), mudaria a tela de todo cliente, e os 4 eventos não
-- servem para lead de WhatsApp. E a 0524 tem uma regra por etapa; o pagamento
-- precisa de Subscribe, Purchase e a ação do Google na mesma etapa.

create table if not exists public.mia_regras_de_conversao_do_site (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stage_id uuid not null,
  plataforma text not null,
  evento_meta text,
  google_acao_id text,
  leva_valor boolean not null default false,
  enabled boolean not null default false,
  configured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mia_regras_do_site_plataforma
    check (plataforma in ('meta_ads', 'google_ads')),
  constraint mia_regras_do_site_evento_meta
    check (evento_meta is null or evento_meta in ('CompleteRegistration', 'StartTrial', 'Subscribe', 'Purchase')),
  constraint mia_regras_do_site_acao_do_google
    check (google_acao_id is null or google_acao_id ~ '^[1-9][0-9]{0,31}$'),
  constraint mia_regras_do_site_um_destino
    check (
      (plataforma = 'meta_ads' and evento_meta is not null and google_acao_id is null)
      or (plataforma = 'google_ads' and google_acao_id is not null and evento_meta is null)
    ),
  -- Purchase e Subscribe levam valor, moeda e o id do pedido na Meta: sem
  -- `leva_valor` o transporte recusaria todo envio.
  constraint mia_regras_do_site_valor_na_compra
    check (evento_meta is null or evento_meta not in ('Purchase', 'Subscribe') or leva_valor)
);

alter table public.mia_regras_de_conversao_do_site
  drop constraint if exists mia_regras_do_site_etapa_da_org_fk;
alter table public.mia_regras_de_conversao_do_site
  add constraint mia_regras_do_site_etapa_da_org_fk
  foreign key (organization_id, stage_id)
  references public.crm_stages (organization_id, id)
  on delete cascade;

create unique index if not exists mia_regras_do_site_meta_uk
  on public.mia_regras_de_conversao_do_site (organization_id, stage_id, evento_meta)
  where plataforma = 'meta_ads';
create unique index if not exists mia_regras_do_site_google_uk
  on public.mia_regras_de_conversao_do_site (organization_id, stage_id, google_acao_id)
  where plataforma = 'google_ads';
create index if not exists mia_regras_do_site_etapa_idx
  on public.mia_regras_de_conversao_do_site (organization_id, stage_id);

comment on table public.mia_regras_de_conversao_do_site is
  'MIA (9170): o evento de SITE que cada etapa aberta manda à Meta (CompleteRegistration, StartTrial, Subscribe, Purchase) ou ao Google Ads (a ação de conversão). A chave no livro-razão ad_conversion_dispatches é MetaEtapa:<id da regra> ou Etapa:<id da regra>. Nasce desligada. Server-side only: RLS sem policy e grants revogados de anon/authenticated.';
comment on column public.mia_regras_de_conversao_do_site.configured_at is
  'MIA (9170): trava de retroatividade, só movimentos de etapa posteriores enviam. Regravada pelo gatilho quando a etapa, o destino ou o valor mudam, ou quando a regra é religada.';
comment on column public.mia_regras_de_conversao_do_site.leva_valor is
  'MIA (9170): true = o evento leva o valor do negócio (value, currency e order_id na Meta; conversionValue no Google). Sem valor no negócio, o envio fica pendente com o motivo sem_valor.';

alter table public.mia_regras_de_conversao_do_site enable row level security;
revoke all on public.mia_regras_de_conversao_do_site from anon, authenticated;
grant select, insert, update, delete on public.mia_regras_de_conversao_do_site to service_role;

drop trigger if exists trg_mia_regras_do_site_updated_at on public.mia_regras_de_conversao_do_site;
create trigger trg_mia_regras_do_site_updated_at
  before update on public.mia_regras_de_conversao_do_site
  for each row execute function public.fn_set_updated_at();

-- A trava de retroatividade, com o contrato da `fn_marcar_configuracao_regra_meta`
-- da 0524 (que não é tocada): função NOSSA, ao lado.
create or replace function public.fn_mia_marcar_configuracao_regra_do_site()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.configured_at := coalesce(new.configured_at, now());
  elsif new.stage_id is distinct from old.stage_id
     or new.plataforma is distinct from old.plataforma
     or new.evento_meta is distinct from old.evento_meta
     or new.google_acao_id is distinct from old.google_acao_id
     or new.leva_valor is distinct from old.leva_valor
     or (new.enabled and not old.enabled) then
    new.configured_at := now();
  else
    new.configured_at := old.configured_at;
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_mia_marcar_configuracao_regra_do_site() from public, anon, authenticated;
grant execute on function public.fn_mia_marcar_configuracao_regra_do_site() to service_role;

drop trigger if exists trg_mia_marcar_configuracao_regra_do_site on public.mia_regras_de_conversao_do_site;
create trigger trg_mia_marcar_configuracao_regra_do_site
  before insert or update on public.mia_regras_de_conversao_do_site
  for each row execute function public.fn_mia_marcar_configuracao_regra_do_site();

notify pgrst, 'reload schema';
