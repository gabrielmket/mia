-- manifest: A CHAVE DA COEXISTÊNCIA POR EMPRESA (S3 da coexistência; docs/fork/coexistencia.md). FORK MIA: o botão "Conectar pelo app WhatsApp Business" da tela do canal oficial só aparece para a empresa que a plataforma liberou. `mia_coexistencia_da_empresa` tem uma linha por empresa liberada ou desligada (`ligada`, quem mudou e quando); sem linha é desligada, e é assim que toda empresa nasce. Desligar não derruba número já conectado: só esconde o botão. Quem liga e desliga é o administrador de plataforma, pela tela /admin/meta ou pelo MCP de plataforma (`plataforma_ligar_coexistencia`). RLS: a equipe da empresa lê a própria linha; só o servidor escreve. Nenhum objeto do upstream é tocado. Idempotente.
--
-- 9164 · a chave da coexistência, por empresa
--
-- FORK MIA (S3 da coexistência). Só objetos NOSSOS (docs/FORK-MIA.md, regra 3):
-- uma tabela nova e as policies dela. A 9163 fica reservada ao corte do
-- histórico importado nos relatórios do fork (decisão D3, ainda aberta).

create table if not exists public.mia_coexistencia_da_empresa (
  organization_id  uuid primary key references public.organizations(id) on delete cascade,
  ligada           boolean not null default false,
  -- Quem mudou por último. `set null`: a pessoa sair da plataforma não apaga a chave.
  mudada_por       uuid references auth.users(id) on delete set null,
  mudada_em        timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

comment on table public.mia_coexistencia_da_empresa is
  'MIA (9164): a chave da coexistencia do WhatsApp por empresa (docs/fork/coexistencia.md). Sem linha = desligada, como toda empresa nasce. Ligada mostra o botao Conectar pelo app WhatsApp Business na tela do canal oficial; desligar nao derruba numero ja conectado. Quem muda e o administrador de plataforma (tela /admin/meta ou MCP). A equipe le a propria linha; so o servidor escreve.';

-- ── RLS: a equipe lê a própria chave; só o servidor escreve ──────────────────
alter table public.mia_coexistencia_da_empresa enable row level security;

drop policy if exists mia_coexistencia_da_empresa_select on public.mia_coexistencia_da_empresa;
create policy mia_coexistencia_da_empresa_select on public.mia_coexistencia_da_empresa
  for select to authenticated
  using (public.fn_is_platform_admin() or organization_id in (select public.fn_user_org_ids()));

-- O default ACL do Supabase dá ALL a anon e authenticated em toda tabela nova;
-- o `grant select` sozinho não o desfaz (lição da 9001).
revoke all on public.mia_coexistencia_da_empresa from public, anon, authenticated;
grant select on public.mia_coexistencia_da_empresa to authenticated;
grant select, insert, update, delete on public.mia_coexistencia_da_empresa to service_role;

notify pgrst, 'reload schema';
