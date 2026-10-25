-- manifest: A JORNADA DE ASSINATURA, PARTE 2 (.90): a ORIGEM DA EMPRESA, gravada no nascimento. `organizations` (do upstream) não guarda por onde a empresa entrou, e a tela das empresas que entraram sozinhas (Admin › Empresas do cadastro) precisa separar quem se cadastrou de quem a Time implantou. Tabela ao lado, `mia_origem_da_empresa` (uma linha por empresa: `cadastro` ou `implantacao`), preenchida por um gatilho NOSSO depois do insert em `organizations` (`trg_mia_origem_da_empresa`): empresa criada por admin de plataforma (painel, `fn_create_tenant_with_owner`, MCP `plataforma_criar_cliente`) ou sem autor é `implantacao`; criada pela própria pessoa (`/signup`, aprovação do pedido, recuperação) é `cadastro` — a mesma régua de quem nasce isento em `fn_trial_na_criacao_da_org` (0679). O MCP grava `implantacao` por extenso também. As empresas que já existem entram como `implantacao` (decisão do Gabriel, 25/10/2026). O gatilho nunca derruba a criação da empresa: a origem é informação. Só do servidor (RLS ligada, sem política). Nenhum objeto do upstream é redefinido.
--
-- 9071 · a origem da empresa
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3): o gatilho é pendurado ao lado
-- dos do upstream em `organizations`, como `trg_contacts_anonimizado_limpa_mia`.
-- Idempotente: `create table if not exists`, `on conflict do nothing`,
-- `create or replace` e `drop trigger if exists`.

create table if not exists public.mia_origem_da_empresa (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  origem text not null,
  registrada_em timestamptz not null default now(),
  constraint mia_origem_da_empresa_origem check (origem in ('cadastro', 'implantacao'))
);

comment on table public.mia_origem_da_empresa is
  'MIA (9071): por onde a empresa nasceu. cadastro = a propria pessoa (signup, pedido aprovado); implantacao = a Time (painel, MCP, demonstracao) ou empresa anterior a 9071. Gravada no nascimento pelo gatilho trg_mia_origem_da_empresa. So o servidor le e escreve.';

alter table public.mia_origem_da_empresa enable row level security;
revoke all on public.mia_origem_da_empresa from anon, authenticated;
grant select, insert, update on public.mia_origem_da_empresa to service_role;

-- As que já existem entram como implantação. ANTES do gatilho, para a
-- reaplicação também não mexer em nada (on conflict do nothing).
insert into public.mia_origem_da_empresa (organization_id, origem)
select o.id, 'implantacao' from public.organizations o
on conflict (organization_id) do nothing;

create or replace function public.fn_mia_origem_da_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.mia_origem_da_empresa (organization_id, origem)
    values (
      new.id,
      case
        when new.created_by is null then 'implantacao'
        when exists (select 1 from public.platform_admins pa
                      where pa.user_id = new.created_by and pa.revoked_at is null) then 'implantacao'
        else 'cadastro'
      end
    )
    on conflict (organization_id) do nothing;
  exception when others then
    -- A origem é informação: perder uma linha aqui é melhor que impedir a
    -- empresa de nascer. A tela mostra "origem desconhecida".
    raise warning 'mia_origem_da_empresa: origem nao gravada para % (%)', new.id, sqlstate;
  end;
  return null;
end;
$$;

revoke execute on function public.fn_mia_origem_da_empresa() from public, anon, authenticated;

drop trigger if exists trg_mia_origem_da_empresa on public.organizations;
create trigger trg_mia_origem_da_empresa
  after insert on public.organizations
  for each row execute function public.fn_mia_origem_da_empresa();

notify pgrst, 'reload schema';
