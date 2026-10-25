-- manifest: A JORNADA DE ASSINATURA, PARTE 1 (.90): o PLANO LIBERA MÓDULO. Tabela ao lado de `cobranca_planos` (do upstream, intocada): `mia_plano_modulos` guarda, por plano, os módulos vendáveis que ele liga (`disparador`, `email_marketing`, `crm_b2b`), o preço por mensagem do Broadcast, a frase e o selo do cartão da página de preços. O módulo do plano é PERGUNTADO, nunca copiado: `fn_mia_modulos_do_plano(org)` responde na hora pelo `plano_id` da assinatura (que o upstream só troca quando a troca vale: no teste na hora, subindo quando a diferença é paga, descendo na renovação), só com a cobrança LIGADA e só para empresa com assinatura (isenta não ganha módulo de plano); `crm_b2b` só vale com o módulo da instalação ligado. A liberação à mão (`organization_modules`, 0245) é a origem "pela Time" e não sai com troca de plano. Tirar módulo (ou mudar o preço por mensagem) de um plano que alguém assina é recusado no banco (`plano_com_assinantes`): arquiva e cria outro, como o preço do upstream. `mia_modulos_do_plano_registro` é o histórico do que ligou e desligou pelo plano em cada empresa, gravado por `fn_mia_seguir_o_plano(org, motivo)` sob trava por empresa (rodar de novo não repete). Tudo só do servidor (RLS ligada, sem política, sem anon nem authenticated), menos a pergunta, que a sessão faz pela própria empresa. Nenhum objeto do upstream é tocado; com a cobrança desligada, nada muda.
--
-- 9070 · o plano libera módulo
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `create table if
-- not exists`, `create or replace` e `drop trigger if exists`. Desenho em
-- docs/fork/jornada-de-assinatura.md.

-- ── 1. os módulos de cada plano ─────────────────────────────────────────────
create table if not exists public.mia_plano_modulos (
  plano_id uuid primary key references public.cobranca_planos(id) on delete cascade,
  -- As chaves vendáveis que um plano pode ligar (lib/planos-mia/catalogo.ts,
  -- `MODULOS_DO_PLANO`). O par TypeScript é vigiado por
  -- tests/unit/planos-mia-vocabulario.test.ts.
  modulos text[] not null default '{}'::text[],
  -- O preço de cada mensagem do Broadcast para quem está no plano, em centavos.
  -- Nulo = o plano não diz (vale o preço combinado com a empresa, se houver).
  preco_por_mensagem_cents integer,
  -- O que o cartão da página de preços mostra. Dado, nunca código.
  frase text,
  destaque boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint mia_plano_modulos_chaves
    check (modulos <@ array['disparador', 'email_marketing', 'crm_b2b']::text[]),
  constraint mia_plano_modulos_preco
    check (preco_por_mensagem_cents is null or preco_por_mensagem_cents between 0 and 100000),
  constraint mia_plano_modulos_frase
    check (frase is null or char_length(frase) <= 160)
);

comment on table public.mia_plano_modulos is
  'MIA (9070): o que cada plano de cobranca_planos liga alem dos limites do upstream: os modulos vendaveis, o preco por mensagem do Broadcast e o texto do cartao da pagina de precos. Tabela AO LADO: cobranca_planos e do upstream e nao muda. So o servidor le e escreve.';

alter table public.mia_plano_modulos enable row level security;
revoke all on public.mia_plano_modulos from anon, authenticated;
grant select, insert, update, delete on public.mia_plano_modulos to service_role;

-- ── 2. tirar módulo de plano assinado é recusado ─────────────────────────────
-- Mesmo motivo de o upstream travar o preço do plano assinado: não mudar o que
-- alguém comprou sem ele pedir. LIGAR um módulo num plano sempre pode (vale na
-- hora para as empresas dele). O preço por mensagem trava como o preço do plano.
create or replace function public.fn_mia_plano_modulos_trava_assinantes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plano uuid := coalesce(old.plano_id, new.plano_id);
  v_tira boolean;
begin
  if tg_op = 'DELETE' then
    v_tira := cardinality(old.modulos) > 0 or old.preco_por_mensagem_cents is not null;
  else
    v_tira := not (old.modulos <@ new.modulos)
              or new.preco_por_mensagem_cents is distinct from old.preco_por_mensagem_cents
              or new.plano_id is distinct from old.plano_id;
  end if;
  if v_tira and exists (
    select 1 from public.cobranca_assinaturas a
     where a.plano_id = v_plano or a.plano_agendado_id = v_plano or a.plano_troca_pendente_id = v_plano
  ) then
    raise exception 'plano_com_assinantes'
      using errcode = '23514',
            hint = 'Este plano tem assinantes: os modulos so crescem e o preco por mensagem nao muda. Arquive o plano e crie outro.';
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function public.fn_mia_plano_modulos_trava_assinantes() from public, anon, authenticated;

drop trigger if exists trg_mia_plano_modulos_trava_assinantes on public.mia_plano_modulos;
create trigger trg_mia_plano_modulos_trava_assinantes
  before update or delete on public.mia_plano_modulos
  for each row execute function public.fn_mia_plano_modulos_trava_assinantes();

drop trigger if exists trg_mia_plano_modulos_touch on public.mia_plano_modulos;
create trigger trg_mia_plano_modulos_touch
  before update on public.mia_plano_modulos
  for each row execute function public.fn_touch_updated_at();

-- ── 3. a pergunta: o que o plano desta empresa liga agora ───────────────────
-- Vazio quando: a cobrança está desligada; a empresa não tem assinatura
-- (isenta); o plano não tem linha aqui; ou quem pergunta não é da empresa.
-- `crm_b2b` só entra com o módulo da instalação ligado. Lê `plano_id`, nunca o
-- agendado: é o upstream quem decide quando a troca vale, e o módulo segue.
-- `auth.uid()` nulo = o servidor (service_role); a sessão só pergunta da
-- própria empresa (fn_user_org_ids), ou é admin de plataforma.
create or replace function public.fn_mia_modulos_do_plano(p_org uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select array(
        select m.modulo
          from unnest(pm.modulos) as m(modulo)
         where m.modulo <> 'crm_b2b'
            or exists (select 1 from public.platform_config c
                        where c.chave = 'MODULO_CRM_B2B' and c.valor = 'ligado')
         order by m.modulo)
       from public.cobranca_assinaturas a
       join public.mia_plano_modulos pm on pm.plano_id = a.plano_id
      where a.organization_id = p_org
        and public.fn_cobranca_ligada()
        and (auth.uid() is null
             or p_org in (select public.fn_user_org_ids())
             or public.fn_is_platform_admin())),
    '{}'::text[]);
$$;

revoke execute on function public.fn_mia_modulos_do_plano(uuid) from public, anon;
grant execute on function public.fn_mia_modulos_do_plano(uuid) to authenticated, service_role;

-- ── 4. o histórico do que ligou e desligou pelo plano ───────────────────────
create table if not exists public.mia_modulos_do_plano_registro (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  modulo text not null,
  acao text not null,
  plano_id uuid references public.cobranca_planos(id) on delete set null,
  -- De onde veio a mudança: `releitura`, `troca`, `renovacao`, `plano_editado`,
  -- `atribuicao`, `rodada`... (lib/planos-mia/seguir-o-plano.ts).
  motivo text not null,
  em timestamptz not null default now(),
  constraint mia_modulos_do_plano_registro_modulo
    check (modulo in ('disparador', 'email_marketing', 'crm_b2b')),
  constraint mia_modulos_do_plano_registro_acao
    check (acao in ('ligou', 'desligou')),
  constraint mia_modulos_do_plano_registro_motivo
    check (char_length(motivo) between 1 and 60)
);

comment on table public.mia_modulos_do_plano_registro is
  'MIA (9070): o historico, por empresa, do modulo que LIGOU ou DESLIGOU pelo plano (a origem "pelo plano"). A ultima linha de cada modulo diz o que a empresa ja sabe; quem decide se o modulo vale e fn_mia_modulos_do_plano, na hora. Gravada so por fn_mia_seguir_o_plano. Desligar nao apaga dado de ninguem.';

create index if not exists idx_mia_modulos_do_plano_registro_org
  on public.mia_modulos_do_plano_registro (organization_id, modulo, em desc, id desc);

alter table public.mia_modulos_do_plano_registro enable row level security;
revoke all on public.mia_modulos_do_plano_registro from anon, authenticated;
grant select, insert on public.mia_modulos_do_plano_registro to service_role;
grant usage, select on sequence public.mia_modulos_do_plano_registro_id_seq to service_role;

-- ── 5. seguir o plano: grava a diferença entre o que vale e o que foi dito ───
-- Devolve as mudanças (`[{"modulo":..,"acao":"ligou"|"desligou"}]`) para quem
-- chama avisar a empresa. Trava por empresa: dois ganchos ao mesmo tempo (o
-- aviso do provedor e a rodada de 6 h) não gravam a mesma mudança duas vezes.
create or replace function public.fn_mia_seguir_o_plano(p_org uuid, p_motivo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_desejados text[];
  v_plano uuid;
  v_mudancas jsonb;
begin
  if p_motivo is null or char_length(p_motivo) not between 1 and 60 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 9070));
  v_desejados := public.fn_mia_modulos_do_plano(p_org);
  select a.plano_id into v_plano from public.cobranca_assinaturas a where a.organization_id = p_org;

  with ultimo as (
    select distinct on (r.modulo) r.modulo, r.acao
      from public.mia_modulos_do_plano_registro r
     where r.organization_id = p_org
     order by r.modulo, r.em desc, r.id desc
  ), mudancas as (
    select d.m as modulo, 'ligou'::text as acao
      from unnest(v_desejados) as d(m)
     where not exists (select 1 from ultimo u where u.modulo = d.m and u.acao = 'ligou')
    union all
    select u.modulo, 'desligou'::text
      from ultimo u
     where u.acao = 'ligou' and not (u.modulo = any (v_desejados))
  ), gravadas as (
    insert into public.mia_modulos_do_plano_registro (organization_id, modulo, acao, plano_id, motivo)
    select p_org, x.modulo, x.acao, v_plano, p_motivo from mudancas x
    returning modulo, acao
  )
  select coalesce(jsonb_agg(jsonb_build_object('modulo', g.modulo, 'acao', g.acao) order by g.modulo), '[]'::jsonb)
    into v_mudancas
    from gravadas g;

  return v_mudancas;
end;
$$;

revoke execute on function public.fn_mia_seguir_o_plano(uuid, text) from public, anon, authenticated;
grant execute on function public.fn_mia_seguir_o_plano(uuid, text) to service_role;

notify pgrst, 'reload schema';
