-- manifest: O CADASTRO DO /SIGNUP VIRA LEAD NO CRM DA TIME E ANDA NO FUNIL (MIA-168; docs/fork/jornada-de-assinatura.md, "O lead do cadastro"). Tabela NOSSA `mia_cadastro_na_time`, uma linha por cadastro (`user_id` único): o lead na org da Time (`organization_id`, `lead_id`), a empresa do cliente quando ela nasce (`empresa_cliente_id`), o que a medição precisa e o card não guarda (IP, navegador, `fbp`/`fbc` só com `consentimento = medicao`, os ids de clique do Google, a página sem a query, os `utm_*` em `origem`), o primeiro pagamento (`pedido_id`, `valor_cents`), o erro do CRM (`crm_erro`, como o do Raio-X) e os três momentos (`cadastro_concluido_em`, `teste_comecou_em`, `pagamento_confirmado_em`), que são a idempotência de quem move o card. Um gatilho NOSSO depois do insert em `mia_origem_da_empresa` (origem `cadastro`) emite `mia.cadastro.empresa_nasceu`, que o consumidor `lib/planos-mia/lead-do-cadastro.handler.ts` escuta; o `emit_event` vai num bloco que engole o erro, porque nunca pode impedir a empresa de nascer. A limpeza da LGPD (`fn_mia_cadastro_na_time_limpar`, invoker, só `service_role`) zera IP, navegador, `fbp`, `fbc`, os ids de clique e o `fbclid` passados 90 dias (`guardar_ate`), 7 dias depois do pagamento informado (a janela da Meta) ou com o contato anonimizado; fica o vínculo. RLS ligada sem política, só `service_role`. Só aditiva; nenhum objeto do upstream é tocado.
--
-- 9169 · o cadastro vira lead no CRM da Time
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3): a tabela, duas funções e um
-- gatilho na nossa `mia_origem_da_empresa` (9071). Idempotente: `if not
-- exists`, `create or replace` e `drop trigger if exists`.

create table if not exists public.mia_cadastro_na_time (
  id uuid primary key default gen_random_uuid(),
  -- A org da Time, dona do lead (a da fonte `CADASTRO_FONTE_DO_CRM`). Nula
  -- enquanto não há lead (sem a variável, sem a fonte, recusa).
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete cascade,
  -- A empresa do cliente: nula até o e-mail ser confirmado e ela nascer.
  empresa_cliente_id uuid references public.organizations(id) on delete set null,
  ip inet,
  navegador text,
  fbp text,
  fbc text,
  gclid text,
  gbraid text,
  wbraid text,
  consentimento text,
  pagina text,
  -- Os utm_* e o fbclid do link (o que a fonte recebeu), para refazer o lead
  -- quando a fonte faltou no envio do formulário.
  origem jsonb not null default '{}'::jsonb,
  pedido_id text,
  valor_cents integer,
  crm_erro text,
  cadastro_concluido_em timestamptz,
  teste_comecou_em timestamptz,
  pagamento_confirmado_em timestamptz,
  capturado_em timestamptz not null default now(),
  guardar_ate timestamptz not null default (now() + interval '90 days'),
  limpo_em timestamptz,
  constraint mia_cadastro_na_time_user_unico unique (user_id),
  constraint mia_cadastro_na_time_lead_unico unique (lead_id),
  constraint mia_cadastro_na_time_empresa_unica unique (empresa_cliente_id),
  constraint mia_cadastro_na_time_lead_com_org check (lead_id is null or organization_id is not null),
  constraint mia_cadastro_na_time_consentimento check (consentimento is null or consentimento in ('medicao', 'necessario')),
  constraint mia_cadastro_na_time_fbp_fbc_so_com_medicao check ((fbp is null and fbc is null) or consentimento = 'medicao'),
  constraint mia_cadastro_na_time_navegador check (navegador is null or char_length(navegador) <= 512),
  constraint mia_cadastro_na_time_tamanhos check (
    (fbp is null or char_length(fbp) <= 300)
    and (fbc is null or char_length(fbc) <= 300)
    and (gclid is null or char_length(gclid) <= 500)
    and (gbraid is null or char_length(gbraid) <= 500)
    and (wbraid is null or char_length(wbraid) <= 500)
    and (pagina is null or char_length(pagina) <= 500)
    and (pedido_id is null or char_length(pedido_id) <= 100)
    and (crm_erro is null or char_length(crm_erro) <= 120)
  ),
  constraint mia_cadastro_na_time_valor check (valor_cents is null or valor_cents > 0)
);

comment on table public.mia_cadastro_na_time is
  'MIA (9169): cada cadastro do /signup como lead no CRM da Time (funil MIA - SDR). Os tres momentos (*_em) sao a idempotencia de quem move o card. IP, navegador, fbp, fbc e ids de clique sao so para a medicao (Meta e Google) e a limpeza os zera (fn_mia_cadastro_na_time_limpar). So o servidor le e escreve.';

create index if not exists mia_cadastro_na_time_a_limpar
  on public.mia_cadastro_na_time (guardar_ate)
  where limpo_em is null;

alter table public.mia_cadastro_na_time enable row level security;
revoke all on public.mia_cadastro_na_time from anon, authenticated;
grant select, insert, update, delete on public.mia_cadastro_na_time to service_role;

-- O nascimento da empresa do cadastro vira evento. Na org do CLIENTE (é dela o
-- fato); o consumidor roda com ela parada (a entrada paga nasce parada).
create or replace function public.fn_mia_cadastro_empresa_nasceu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origem = 'cadastro' then
    begin
      perform public.emit_event(
        'mia.cadastro.empresa_nasceu',
        'organization',
        new.organization_id,
        jsonb_build_object('organization_id', new.organization_id),
        '{}'::jsonb,
        new.organization_id
      );
    exception when others then
      -- O lead é informação: perder o evento aqui é melhor que impedir a
      -- empresa de nascer. A rodada da jornada (lib/planos-mia/rodada.ts) cura.
      raise warning 'mia_cadastro_na_time: evento nao emitido para % (%)', new.organization_id, sqlstate;
    end;
  end if;
  return null;
end;
$$;

revoke execute on function public.fn_mia_cadastro_empresa_nasceu() from public, anon, authenticated;

drop trigger if exists trg_mia_cadastro_empresa_nasceu on public.mia_origem_da_empresa;
create trigger trg_mia_cadastro_empresa_nasceu
  after insert on public.mia_origem_da_empresa
  for each row execute function public.fn_mia_cadastro_empresa_nasceu();

-- A limpeza da LGPD (finalidade: medição). Zera o que identifica o navegador e
-- o clique, e marca `limpo_em`; fica o vínculo (lead, empresa, momentos, valor).
-- Invoker: quem chama é a rodada da jornada, com o service_role.
create or replace function public.fn_mia_cadastro_na_time_limpar()
returns integer
language sql
security invoker
set search_path = ''
as $$
  with limpas as (
    update public.mia_cadastro_na_time c
       set ip = null,
           navegador = null,
           fbp = null,
           fbc = null,
           gclid = null,
           gbraid = null,
           wbraid = null,
           origem = c.origem - 'fbclid',
           limpo_em = now()
     where c.limpo_em is null
       and (
         c.guardar_ate <= now()
         or c.pagamento_confirmado_em <= now() - interval '7 days'
         or exists (
           select 1
             from public.crm_leads l
             join public.contacts ct on ct.id = l.contact_id
            where l.id = c.lead_id
              and ct.is_anonymized
         )
       )
    returning 1
  )
  select count(*)::integer from limpas;
$$;

revoke execute on function public.fn_mia_cadastro_na_time_limpar() from public, anon, authenticated;
grant execute on function public.fn_mia_cadastro_na_time_limpar() to service_role;

notify pgrst, 'reload schema';
