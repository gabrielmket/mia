-- manifest: O RAIO-X GRÁTIS POR CADASTRO (.106, protótipo aprovado em 06/11/2026; docs/fork/raio-x-do-atendimento.md, seção 16). FORK MIA (.106): quem quer o raio-X do próprio atendimento se cadastra sozinho (o formulário do site iamia.com.br ou a página /raio-x/gratis do sistema), recebe a PRIMEIRA análise grátis direto no e-mail, sem a revisão da Time, e entra numa área própria sem senha (e-mail + código de 6 números). As próximas análises são avulsa ou mensal, pagas pelo Asaas. Estende a 9150 e a 9151 sem redefinir nada do upstream: `mia_raio_x` ganha `conta_id` (a conta de quem se cadastrou), `origem` ('time', o padrão, que é o raio-X de sempre, com revisão; ou 'cadastro'), `gratis`, `sem_historico_em` (a leitura fechou com 0 conversas: a grátis NÃO conta) e `entregue_em` (o relatório foi mandado para a pessoa); as CHECKs `mia_raio_x_criado_via` e `mia_raio_x_links_created_via` (nossas, da 9150) passam a aceitar 'cadastro' (o relatório do cadastro gera sozinho o link do dono, que vai ao lead da Time). Quatro tabelas NOVAS, todas só do servidor como as outras oito (RLS ligada SEM política e grants revogados de anon e authenticated): `mia_raio_x_contas` (quem se cadastrou: e-mail único em minúsculas, nome completo, o WhatsApp da pessoa em dígitos, a referência ao negócio no CRM da Time e ao cliente no Asaas); `mia_raio_x_codigos_de_acesso` (o código de 6 números da entrada sem senha: só o HASH, 15 minutos, as tentativas); `mia_raio_x_pedidos` (a nova análise pedida na área: avulsa ou mensal, o valor, a situação e as referências do Asaas); `mia_raio_x_precos` (o preço de cada tipo; nasce VAZIA, e sem preço não há venda: o pedido vira interesse). A regra da grátis (uma por número analisado, pelas duas grafias do nono dígito, e uma por conta) é do código (`lib/raio-x/cadastro.ts`); o banco segura a mesma grafia e a mesma conta com dois índices únicos parciais. Provado em tests/invariants/raio-x-por-cadastro.test.ts.
--
-- 9152 · o raio-X grátis por cadastro
--
-- FORK MIA (.106). Só objetos NOSSOS (docs/FORK-MIA.md, regra 3), e só
-- ESTENDE a 9150/9151: colunas novas com `add column if not exists`,
-- constraints novas dentro de `do` que confere o catálogo, tabelas novas.
-- A única constraint trocada é a `mia_raio_x_criado_via`, que é NOSSA (9150):
-- sai e volta com 'cadastro', e só quando ainda não aceita. Idempotente.
--
-- O que NÃO mora aqui, de propósito: a regra da grátis pelas duas grafias do
-- nono dígito, o código de acesso (gerar, conferir, as 5 tentativas), o
-- cookie da área, o lead no CRM da Time e o pagamento. Estão em
-- `lib/raio-x/` e têm teste de unidade; o banco garante o formato.

-- ── 1. a conta de quem se cadastrou ─────────────────────────────────────────
create table if not exists public.mia_raio_x_contas (
  id                 uuid primary key default gen_random_uuid(),
  -- O e-mail é a identidade da área (entrada sem senha): único e em minúsculas.
  email              text not null,
  -- O nome completo de quem pediu (nome e sobrenome), o mesmo do aceite.
  nome               text not null,
  -- O WhatsApp da PESSOA (para a equipe falar com ela), em dígitos E.164. Não é
  -- o número analisado (esse fica em `mia_raio_x.whatsapp`).
  telefone           text not null,
  -- O negócio no CRM da Time Company (a fonte de formulário "Site · pedido de
  -- Raio-X"). Apagar o negócio solta a referência; o próximo aviso cria de novo.
  crm_lead_id        uuid references public.crm_leads(id) on delete set null,
  crm_enviado_em     timestamptz,
  -- O motivo curto quando o lead não entrou (sem_fonte, fonte_inexistente,
  -- recusado, falhou). Nunca texto livre nem dado da pessoa.
  crm_erro           text,
  -- O cliente no Asaas (cus_...), quando a pessoa pediu uma análise paga.
  asaas_cliente_id   text,
  ultimo_acesso_em   timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_contas_email') then
    alter table public.mia_raio_x_contas add constraint mia_raio_x_contas_email
      check (email = lower(btrim(email)) and length(email) between 6 and 160 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_contas_email_unico') then
    alter table public.mia_raio_x_contas add constraint mia_raio_x_contas_email_unico unique (email);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_contas_nome') then
    -- Nome completo: duas palavras ou mais (a mesma régua do aceite da 9151).
    alter table public.mia_raio_x_contas add constraint mia_raio_x_contas_nome
      check (length(btrim(nome)) between 3 and 120 and btrim(nome) ~ '[^[:space:]]+[[:space:]]+[^[:space:]]+');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_contas_telefone') then
    alter table public.mia_raio_x_contas add constraint mia_raio_x_contas_telefone check (telefone ~ '^[1-9][0-9]{9,14}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_contas_crm_erro') then
    alter table public.mia_raio_x_contas add constraint mia_raio_x_contas_crm_erro
      check (crm_erro is null or crm_erro in ('sem_fonte', 'fonte_inexistente', 'recusado', 'falhou'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_contas_asaas') then
    alter table public.mia_raio_x_contas add constraint mia_raio_x_contas_asaas
      check (asaas_cliente_id is null or asaas_cliente_id ~ '^[A-Za-z0-9_-]{3,64}$');
  end if;
end $$;

comment on table public.mia_raio_x_contas is
  'MIA (9152): quem se cadastrou no raio-X gratis (o formulario do site ou /raio-x/gratis): e-mail unico em minusculas (a identidade da area, entrada sem senha por codigo no e-mail), nome completo, o WhatsApp da pessoa em digitos (nao e o numero analisado), a referencia ao negocio no CRM da Time e ao cliente no Asaas. Servidor apenas: RLS sem politica, grants revogados de anon e authenticated.';
comment on column public.mia_raio_x_contas.telefone is
  'MIA (9152): o WhatsApp da PESSOA que pediu o raio-X, para a equipe da Time falar com ela. Digitos E.164. O numero analisado (o comercial) fica em mia_raio_x.whatsapp.';

drop trigger if exists trg_mia_raio_x_contas_touch on public.mia_raio_x_contas;
create trigger trg_mia_raio_x_contas_touch
  before update on public.mia_raio_x_contas
  for each row execute function public.fn_set_updated_at();

create index if not exists mia_raio_x_contas_asaas_idx on public.mia_raio_x_contas (asaas_cliente_id) where asaas_cliente_id is not null;

-- ── 2. o raio-X do cadastro ─────────────────────────────────────────────────
alter table public.mia_raio_x
  add column if not exists conta_id uuid references public.mia_raio_x_contas(id) on delete set null;
-- 'time' = o raio-X de sempre (a Time cria no Admin ou no MCP, com revisão);
-- 'cadastro' = a pessoa se cadastrou sozinha, e o relatório sai direto para ela.
alter table public.mia_raio_x
  add column if not exists origem text not null default 'time';
alter table public.mia_raio_x
  add column if not exists gratis boolean not null default false;
-- A leitura fechou com 0 conversas: sem relatório, e a grátis NÃO conta.
alter table public.mia_raio_x
  add column if not exists sem_historico_em timestamptz;
-- O relatório do cadastro foi mandado para a pessoa (e-mail, aviso à Time, lead).
alter table public.mia_raio_x
  add column if not exists entregue_em timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_origem') then
    alter table public.mia_raio_x add constraint mia_raio_x_origem check (origem in ('time', 'cadastro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_gratis_do_cadastro') then
    -- Só o cadastro tem grátis; o raio-X da Time nunca é marcado assim.
    alter table public.mia_raio_x add constraint mia_raio_x_gratis_do_cadastro check (not gratis or origem = 'cadastro');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_cadastro_pela_conexao') then
    -- Quem se cadastra ainda não é cliente: o raio-X dele é sempre pela conexão.
    alter table public.mia_raio_x add constraint mia_raio_x_cadastro_pela_conexao check (origem = 'time' or fonte = 'conexao');
  end if;
  -- A CHECK do canal de criação é NOSSA (9150): troca só se ainda não aceita 'cadastro'.
  if exists (
    select 1 from pg_constraint
     where conname = 'mia_raio_x_criado_via'
       and conrelid = 'public.mia_raio_x'::regclass
       and pg_get_constraintdef(oid) not like '%cadastro%'
  ) then
    alter table public.mia_raio_x drop constraint mia_raio_x_criado_via;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_criado_via') then
    alter table public.mia_raio_x add constraint mia_raio_x_criado_via check (criado_via in ('tela', 'mcp_plataforma', 'cadastro'));
  end if;
  -- O link do dono do relatório do cadastro nasce sozinho (o que vai ao lead da
  -- Time): a CHECK do canal do link também é NOSSA (9150) e ganha 'cadastro'.
  if exists (
    select 1 from pg_constraint
     where conname = 'mia_raio_x_links_created_via'
       and conrelid = 'public.mia_raio_x_links'::regclass
       and pg_get_constraintdef(oid) not like '%cadastro%'
  ) then
    alter table public.mia_raio_x_links drop constraint mia_raio_x_links_created_via;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_links_created_via') then
    alter table public.mia_raio_x_links add constraint mia_raio_x_links_created_via check (created_via in ('tela', 'mcp_plataforma', 'cadastro'));
  end if;
end $$;

comment on column public.mia_raio_x.origem is
  'MIA (9152): de onde veio o raio-X. time = a Time criou (Admin ou MCP), e o relatorio sai em rascunho para revisao; cadastro = a pessoa se cadastrou sozinha (site ou /raio-x/gratis), e o relatorio sai revisado, direto para ela (a Time e avisada).';
comment on column public.mia_raio_x.gratis is
  'MIA (9152): a primeira analise gratis do cadastro. Uma por numero analisado (as duas grafias do nono digito, conferidas no codigo) e uma por conta. Com sem_historico_em preenchido, nao conta.';
comment on column public.mia_raio_x.sem_historico_em is
  'MIA (9152): a leitura fechou com 0 conversas (o WhatsApp nao mandou o historico). Nao ha relatorio, o raio-X e encerrado, e a analise gratis nao e gasta: a pessoa pode cadastrar o mesmo numero de novo.';

-- Uma grátis viva por conta e por número (a mesma grafia; a outra grafia do
-- nono dígito é conferida no código). A corrida de dois cadastros iguais cai
-- aqui (23505).
create unique index if not exists mia_raio_x_gratis_por_conta_idx
  on public.mia_raio_x (conta_id) where gratis and sem_historico_em is null;
create unique index if not exists mia_raio_x_gratis_por_numero_idx
  on public.mia_raio_x (whatsapp) where gratis and sem_historico_em is null;
create index if not exists mia_raio_x_conta_idx on public.mia_raio_x (conta_id, created_at) where conta_id is not null;

-- ── 3. o código de acesso da área (entrada sem senha) ───────────────────────
create table if not exists public.mia_raio_x_codigos_de_acesso (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references public.mia_raio_x_contas(id) on delete cascade,
  -- Só o HMAC em hex do código de 6 números: o código nunca é gravado.
  codigo_hash   text not null,
  expira_em     timestamptz not null,
  tentativas    integer not null default 0,
  usado_em      timestamptz,
  created_at    timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_codigos_hash') then
    alter table public.mia_raio_x_codigos_de_acesso add constraint mia_raio_x_codigos_hash check (codigo_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_codigos_tentativas') then
    alter table public.mia_raio_x_codigos_de_acesso add constraint mia_raio_x_codigos_tentativas check (tentativas between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_codigos_validade') then
    alter table public.mia_raio_x_codigos_de_acesso add constraint mia_raio_x_codigos_validade check (expira_em > created_at);
  end if;
end $$;

comment on table public.mia_raio_x_codigos_de_acesso is
  'MIA (9152): o codigo de 6 numeros mandado ao e-mail da conta para entrar na area do raio-X, sem senha. So o hash (HMAC), 15 minutos, 5 tentativas (conferidas no codigo). Servidor apenas.';

create index if not exists mia_raio_x_codigos_conta_idx on public.mia_raio_x_codigos_de_acesso (conta_id, created_at desc);

-- ── 4. os pedidos de nova análise ───────────────────────────────────────────
create table if not exists public.mia_raio_x_pedidos (
  id                    uuid primary key default gen_random_uuid(),
  conta_id              uuid references public.mia_raio_x_contas(id) on delete set null,
  -- O raio-X de onde a pessoa pediu (o anterior) e o que nasceu do pedido (nulo até pagar).
  anterior_id           uuid references public.mia_raio_x(id) on delete set null,
  raio_x_id             uuid references public.mia_raio_x(id) on delete set null,
  -- O número a analisar (o mesmo do anterior), em dígitos E.164: dado da empresa.
  whatsapp              text not null,
  tipo                  text not null,
  valor_centavos        integer,
  situacao              text not null default 'interesse',
  asaas_cobranca_id     text,
  asaas_assinatura_id   text,
  link_pagamento        text,
  -- O código curto da falha ao criar a cobrança (nunca texto do Asaas).
  erro                  text,
  pago_em               timestamptz,
  cancelado_em          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_pedidos_tipo') then
    alter table public.mia_raio_x_pedidos add constraint mia_raio_x_pedidos_tipo check (tipo in ('avulsa', 'mensal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_pedidos_situacao') then
    alter table public.mia_raio_x_pedidos add constraint mia_raio_x_pedidos_situacao
      check (situacao in ('interesse', 'aguardando', 'pago', 'cancelado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_pedidos_valor') then
    alter table public.mia_raio_x_pedidos add constraint mia_raio_x_pedidos_valor
      check (valor_centavos is null or valor_centavos between 0 and 10000000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_pedidos_aguardando_tem_valor') then
    -- Cobrança criada tem valor: o "interesse" é o pedido sem preço.
    alter table public.mia_raio_x_pedidos add constraint mia_raio_x_pedidos_aguardando_tem_valor
      check (situacao not in ('aguardando', 'pago') or valor_centavos is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_pedidos_pago_em') then
    alter table public.mia_raio_x_pedidos add constraint mia_raio_x_pedidos_pago_em check (situacao <> 'pago' or pago_em is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_pedidos_whatsapp') then
    alter table public.mia_raio_x_pedidos add constraint mia_raio_x_pedidos_whatsapp check (whatsapp ~ '^[1-9][0-9]{9,14}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_pedidos_link') then
    alter table public.mia_raio_x_pedidos add constraint mia_raio_x_pedidos_link check (link_pagamento is null or link_pagamento ~ '^https?://');
  end if;
end $$;

comment on table public.mia_raio_x_pedidos is
  'MIA (9152): a nova analise pedida na area do raio-X: avulsa (cobranca unica) ou mensal (assinatura). Sem preco ativo o pedido e interesse (a equipe fala com a pessoa); com preco, a cobranca e criada no Asaas da MIA (externalReference raiox-pedido:<id>) e o aviso do Asaas acorda a releitura. Pago: nasce o raio-X do pedido. Servidor apenas.';

drop trigger if exists trg_mia_raio_x_pedidos_touch on public.mia_raio_x_pedidos;
create trigger trg_mia_raio_x_pedidos_touch
  before update on public.mia_raio_x_pedidos
  for each row execute function public.fn_set_updated_at();

create index if not exists mia_raio_x_pedidos_conta_idx on public.mia_raio_x_pedidos (conta_id, created_at desc);
create index if not exists mia_raio_x_pedidos_aguardando_idx on public.mia_raio_x_pedidos (situacao) where situacao = 'aguardando';

-- ── 5. os preços (nasce vazia: sem preço, sem venda) ────────────────────────
create table if not exists public.mia_raio_x_precos (
  tipo            text primary key,
  valor_centavos  integer not null,
  ativo           boolean not null default true,
  atualizado_por  uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_precos_tipo') then
    alter table public.mia_raio_x_precos add constraint mia_raio_x_precos_tipo check (tipo in ('avulsa', 'mensal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_precos_valor') then
    -- O Asaas não cobra menos de R$ 5.
    alter table public.mia_raio_x_precos add constraint mia_raio_x_precos_valor check (valor_centavos between 500 and 1000000);
  end if;
end $$;

comment on table public.mia_raio_x_precos is
  'MIA (9152): o preco da nova analise do raio-X, por tipo (avulsa, mensal). Nasce VAZIA: sem preco ativo nao ha venda, e o pedido vira interesse. Definido no Admin (Raio-X) e no MCP (plataforma_precos_do_raio_x). Servidor apenas.';

drop trigger if exists trg_mia_raio_x_precos_touch on public.mia_raio_x_precos;
create trigger trg_mia_raio_x_precos_touch
  before update on public.mia_raio_x_precos
  for each row execute function public.fn_set_updated_at();

-- ── 6. só o servidor ────────────────────────────────────────────────────────
alter table public.mia_raio_x_contas enable row level security;
alter table public.mia_raio_x_codigos_de_acesso enable row level security;
alter table public.mia_raio_x_pedidos enable row level security;
alter table public.mia_raio_x_precos enable row level security;

revoke all on public.mia_raio_x_contas from public, anon, authenticated;
revoke all on public.mia_raio_x_codigos_de_acesso from public, anon, authenticated;
revoke all on public.mia_raio_x_pedidos from public, anon, authenticated;
revoke all on public.mia_raio_x_precos from public, anon, authenticated;

grant select, insert, update, delete on public.mia_raio_x_contas to service_role;
grant select, insert, update, delete on public.mia_raio_x_codigos_de_acesso to service_role;
grant select, insert, update, delete on public.mia_raio_x_pedidos to service_role;
grant select, insert, update, delete on public.mia_raio_x_precos to service_role;

notify pgrst, 'reload schema';
