-- manifest: O RETRATO DO "O QUE FALTA" (.91, jornada de assinatura; fase 3 da spec do upstream #2860, "auditoria do tenant com retrato guardado"). Uma tabela NOSSA, `mia_assistente_retratos` (o `config_snapshots` do desenho do upstream, com o prefixo mia_): a cada rodada do "o que falta" de uma empresa nova (a mesma régua do checklist do MCP, `plataforma_ver_implantacao`, no rótulo do cliente), o servidor guarda quantos itens faltam, quantos estão preenchidos, quantos o assistente pode completar, quantos precisam de confirmação e quantos não se aplicam, com a coluna de cada item. É o que mostra "ao entrar faltavam N, agora faltam M" e o que diz quando a empresa ZEROU (o bloco sai do Início). Só guarda quando algo mudou desde o último retrato. Sem dado pessoal: só a chave de cada item e a coluna dele. Leitura de gestor em diante; a sessão do administrador grava (o gatilho `fn_mia_retrato_nasce` carimba a hora e quem calculou); ninguém altera nem apaga pela sessão. Travas do suporte somente leitura pela função do upstream. Nenhum objeto do upstream é redefinido. Provado em tests/invariants/primeiros-passos-do-assistente.test.ts.
--
-- 9081 · o retrato do "o que falta"
--
-- `mia`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente.

create table if not exists public.mia_assistente_retratos (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  rodada_em          timestamptz not null default now(),
  faltam             integer not null,
  total              integer not null,
  preenchido         integer not null default 0,
  posso_completar    integer not null default 0,
  preciso_confirmar  integer not null default 0,
  nao_se_aplica      integer not null default 0,
  -- A coluna de cada item: [{ "chave": "whatsapp", "coluna": "preciso_confirmar" }].
  itens              jsonb not null default '[]'::jsonb,
  calculado_por      uuid references auth.users(id) on delete set null,
  origem             text not null default 'tela'
);

comment on table public.mia_assistente_retratos is
  'MIA (9081): o retrato de cada rodada do "o que falta" de uma empresa nova (a regua do checklist do MCP no rotulo do cliente). faltam = itens que nao estao preenchidos; itens = a coluna de cada item, sem dado pessoal. Mostra a evolucao ("ao entrar faltavam N, agora faltam M") e diz quando a empresa zerou. Gestor em diante le; o administrador grava pela sessao; ninguem altera nem apaga pela sessao.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_retratos_contas') then
    alter table public.mia_assistente_retratos
      add constraint mia_assistente_retratos_contas
      check (
        total between 0 and 200
        and faltam between 0 and total
        and preenchido >= 0 and posso_completar >= 0 and preciso_confirmar >= 0 and nao_se_aplica >= 0
        and preenchido + posso_completar + preciso_confirmar = total
        and posso_completar + preciso_confirmar = faltam
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_retratos_itens') then
    alter table public.mia_assistente_retratos
      add constraint mia_assistente_retratos_itens
      check (jsonb_typeof(itens) = 'array' and octet_length(itens::text) <= 16000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_retratos_origem') then
    alter table public.mia_assistente_retratos
      add constraint mia_assistente_retratos_origem check (origem in ('tela', 'assistente'));
  end if;
end $$;

create index if not exists mia_assistente_retratos_org_idx
  on public.mia_assistente_retratos (organization_id, rodada_em desc);

-- Pela sessão, a hora e quem calculou não vêm do pedido.
create or replace function public.fn_mia_retrato_nasce()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $f$
begin
  if auth.uid() is not null then
    new.calculado_por := auth.uid();
    new.rodada_em := now();
  end if;
  return new;
end
$f$;

comment on function public.fn_mia_retrato_nasce() is
  'MIA (9081): o retrato gravado pela sessao leva a hora do banco e quem calculou, nunca o que veio no pedido.';

revoke all on function public.fn_mia_retrato_nasce() from public;
revoke execute on function public.fn_mia_retrato_nasce() from anon, authenticated;

drop trigger if exists trg_mia_retrato_nasce on public.mia_assistente_retratos;
create trigger trg_mia_retrato_nasce
  before insert on public.mia_assistente_retratos
  for each row execute function public.fn_mia_retrato_nasce();

alter table public.mia_assistente_retratos enable row level security;

revoke all on table public.mia_assistente_retratos from public, anon, authenticated;
grant select, insert on table public.mia_assistente_retratos to authenticated;
grant all on table public.mia_assistente_retratos to service_role;

drop policy if exists "mia_assistente_retratos_select" on public.mia_assistente_retratos;
drop policy if exists "mia_assistente_retratos_insert" on public.mia_assistente_retratos;
create policy "mia_assistente_retratos_select" on public.mia_assistente_retratos
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
  );
-- O retrato é a régua do administrador (é ele que enxerga a empresa inteira,
-- inclusive o plano): gestor lê a evolução, mas não grava a dele.
create policy "mia_assistente_retratos_insert" on public.mia_assistente_retratos
  for insert with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

notify pgrst, 'reload schema';
