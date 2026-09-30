-- 0255 — EMPRESAS: o cliente que é uma organização, não uma pessoa
--
-- O CRM só conhecia PESSOA. Numa venda B2B quem compra é a empresa: três
-- contatos do mesmo cliente viravam três fichas sem parentesco, o histórico de
-- uma negociação ficava preso ao telefone de quem respondeu naquele dia, e
-- "quanto já vendemos para essa empresa" não tinha como ser perguntado.
--
-- ── Por que tabela própria, e não um campo de texto no contato ──────────────
--
-- Campo de texto responde "qual o nome da empresa dele" e mais nada. Ele é
-- digitado de novo a cada contato, então "Padaria do Zé", "Padaria do Ze" e
-- "PADARIA DO ZÉ" convivem — e nenhuma pergunta agregada funciona em cima
-- disso. O vínculo é o que permite abrir a empresa e ver as pessoas, as
-- conversas e os negócios dela juntos, que é a razão de existir da aba.
--
-- ── O vínculo está em DOIS lugares, e é de propósito ────────────────────────
--
-- `contacts.empresa_id`   — de quem essa pessoa é.
-- `crm_leads.empresa_id`  — de quem é ESTA negociação.
--
-- Parece redundante e não é: o negócio pode ser com uma empresa enquanto quem
-- fala é o contato de uma outra (o contador, o marido, o sócio que indicou), e
-- a pessoa pode trocar de emprego sem que a negociação antiga mude de dono.
-- Derivar o segundo do primeiro reescreveria o passado toda vez que alguém
-- trocasse de empresa.
--
-- ── `on delete set null` nos dois ───────────────────────────────────────────
--
-- Apagar uma empresa NÃO pode apagar contato nem negócio: seria a perda mais
-- cara possível para o comprador de um CRM, disparada por um clique numa tela
-- de cadastro. A empresa some, as pessoas e o histórico ficam, sem vínculo.

create table if not exists public.crm_empresas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null,
  -- Documento SEM máscara e SEM validação de dígito: quem cadastra está com o
  -- cliente na linha, e recusar um CNPJ digitado com um dígito trocado pararia
  -- o cadastro inteiro por causa do campo menos urgente da ficha.
  cnpj text,
  site text,
  telefone text,
  email text,
  endereco text,
  -- O que não cabe em campo nenhum. Toda ficha de CRM tem esse canto, e sem ele
  -- a informação vai para o nome da empresa ("Padaria do Zé - só fala manhã").
  observacoes text,
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references auth.users(id) on delete set null,
  constraint crm_empresas_nome_nao_vazio check (length(btrim(nome)) > 0)
);

comment on table public.crm_empresas is
  'A empresa como cliente (venda B2B): agrupa contatos e negocios sob um CNPJ so. Apagar uma empresa NAO apaga contato nem negocio — o vinculo vira null.';

-- Nome é como se procura, e a busca é sempre "começa com" ou "contém", sem
-- ligar para maiúscula. Índice por (org, lower(nome)) serve a ordenação e à
-- lista; a busca por trecho usa ilike e cai em varredura dentro da org, que a
-- esta escala é barato e não merece pg_trgm ainda.
create index if not exists idx_crm_empresas_org_nome
  on public.crm_empresas (organization_id, lower(nome));

-- Mesmo CNPJ duas vezes na mesma organização é quase sempre cadastro duplicado
-- — e duplicata é o defeito que mata a pergunta "quanto vendemos para eles".
-- Parcial: CNPJ é opcional, e `null` não pode colidir com `null`.
create unique index if not exists uq_crm_empresas_org_cnpj
  on public.crm_empresas (organization_id, cnpj)
  where cnpj is not null and btrim(cnpj) <> '';

alter table public.contacts
  add column if not exists empresa_id uuid references public.crm_empresas(id) on delete set null;

alter table public.crm_leads
  add column if not exists empresa_id uuid references public.crm_empresas(id) on delete set null;

-- "Quem são as pessoas desta empresa" e "quais negócios são dela" são as duas
-- perguntas que a tela da empresa faz. Sem índice, as duas viram varredura da
-- tabela inteira do tenant a cada abertura de ficha.
create index if not exists idx_contacts_empresa
  on public.contacts (organization_id, empresa_id)
  where empresa_id is not null;

create index if not exists idx_crm_leads_empresa
  on public.crm_leads (organization_id, empresa_id)
  where empresa_id is not null;

alter table public.crm_empresas enable row level security;

drop policy if exists "crm_empresas_select" on public.crm_empresas;
drop policy if exists "crm_empresas_escrita" on public.crm_empresas;

-- Leitura para toda a organização (inclusive `viewer`): a lista de clientes é
-- informação de operação, e esconder dela quem atende faria o atendente
-- perguntar ao cliente o nome da própria empresa.
create policy "crm_empresas_select" on public.crm_empresas
  for select using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()))
  );

-- Escrita a partir de `agent` — o mesmo degrau de quem cria lead. Uma política
-- por verbo não acrescentaria nada aqui: empresa não tem dono, então não há a
-- distinção "meus x de todos" que obriga `crm_leads` a separar os quatro.
create policy "crm_empresas_escrita" on public.crm_empresas
  for all using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  ) with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );

notify pgrst, 'reload schema';
