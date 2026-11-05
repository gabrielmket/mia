-- manifest: O RAIO-X DO CLIENTE ATIVO (.102, protótipo aprovado em 05/11/2026; docs/fork/raio-x-do-atendimento.md, seção 13). FORK MIA (.102): o raio-X ganha a FONTE "conversas da MIA", para empresa da MIA com assinatura ativa: nada é conectado e o leitor não é usado; o raio-X lê `conversations` e `messages` da própria organização, nos números escolhidos e no período escolhido, e o dono só autoriza pelo link (termo "cliente ativo" v1). Estende as tabelas da 9150 sem redefinir nada: `mia_raio_x.fonte` ('conexao', o padrão, que é a .101 sem mudança, ou 'conversas_da_mia') e `mia_raio_x.primeira_conversa_em` (a data da primeira conversa da conta, que limita o período); `mia_raio_x_aceites.email`, com o formato conferido e, quando há e-mail (todo aceite da .102, nas duas fontes), o nome completo (nome e sobrenome); e uma tabela NOVA, `mia_raio_x_numeros` (os números da conta escolhidos para a leitura: a referência ao canal, o rótulo, o telefone COMERCIAL e se é API oficial), só do servidor como as outras sete (RLS ligada SEM política e grants revogados de anon e authenticated). Nenhum objeto do upstream é tocado. Provado em tests/invariants/raio-x-do-atendimento.test.ts.
--
-- 9151 · o raio-X do cliente ativo
--
-- FORK MIA (.102). Só objetos NOSSOS (docs/FORK-MIA.md, regra 3), e só
-- ESTENDE a 9150: colunas novas com `add column if not exists`, constraints
-- novas dentro de `do` que confere o catálogo, uma tabela nova. Nada da 9150 é
-- redefinido. Idempotente.
--
-- O que NÃO mora aqui, de propósito: a regra de "empresa ativa", o filtro das
-- conversas (grupo, conversa interna, mensagem apagada, contato com pedido de
-- exclusão) e as contas do relatório. Estão em `lib/raio-x/` e têm teste de
-- unidade; o banco garante só o formato.

-- ── 1. a fonte do raio-X ────────────────────────────────────────────────────
alter table public.mia_raio_x
  add column if not exists fonte text not null default 'conexao';

-- A data da primeira conversa da conta nos números escolhidos (só na fonte
-- "conversas da MIA"): o período nunca começa antes dela.
alter table public.mia_raio_x
  add column if not exists primeira_conversa_em timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_fonte') then
    alter table public.mia_raio_x add constraint mia_raio_x_fonte check (fonte in ('conexao', 'conversas_da_mia'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_fonte_sem_sessao') then
    -- Na fonte "conversas da MIA" nada é conectado: o raio-X nunca tem sessão no leitor.
    alter table public.mia_raio_x add constraint mia_raio_x_fonte_sem_sessao
      check (fonte = 'conexao' or (sessao is null and conectado_em is null));
  end if;
end $$;

comment on column public.mia_raio_x.fonte is
  'MIA (9151): de onde vem as conversas. conexao = o WhatsApp do dono conectado ao leitor (a .101, quem ainda nao e cliente); conversas_da_mia = as conversas que a conta ja tem na MIA (cliente ativo): nada e conectado, o leitor nao e usado, e a leitura e de conversations e messages da propria organizacao, nos numeros de mia_raio_x_numeros.';
comment on column public.mia_raio_x.primeira_conversa_em is
  'MIA (9151): na fonte conversas_da_mia, quando a conta teve a primeira conversa nos numeros escolhidos. O periodo do raio-X nunca comeca antes dela.';

create index if not exists mia_raio_x_fonte_idx on public.mia_raio_x (fonte, situacao);

-- ── 2. o e-mail e o nome completo no aceite ─────────────────────────────────
alter table public.mia_raio_x_aceites
  add column if not exists email text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_aceites_email') then
    alter table public.mia_raio_x_aceites add constraint mia_raio_x_aceites_email
      check (email is null or (length(email) between 6 and 160 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_aceites_nome_completo') then
    -- Todo aceite da .102 tem e-mail; e quem tem e-mail tem o nome e o
    -- sobrenome. Os aceites da .101 (sem e-mail) ficam como foram gravados.
    alter table public.mia_raio_x_aceites add constraint mia_raio_x_aceites_nome_completo
      check (email is null or btrim(nome) ~ '[^[:space:]]+[[:space:]]+[^[:space:]]+');
  end if;
end $$;

comment on column public.mia_raio_x_aceites.email is
  'MIA (9151): o e-mail de quem aceitou o termo (a .102 pede nome completo e e-mail nas duas fontes). Nenhum e-mail e enviado a ele pelo raio-X. Fica com o aceite, que e a prova do consentimento.';

-- ── 3. os números da conta escolhidos para a leitura ────────────────────────
create table if not exists public.mia_raio_x_numeros (
  id                 uuid primary key default gen_random_uuid(),
  raio_x_id          uuid not null references public.mia_raio_x(id) on delete cascade,
  -- O canal da conta. Apagar o canal solta o número; o rótulo e o telefone ficam.
  channel_session_id uuid references public.channel_sessions(id) on delete set null,
  rotulo             text not null,
  -- O telefone COMERCIAL do número, em dígitos E.164. É dado da empresa, não
  -- de um cliente dela (o mesmo papel de `mia_raio_x.whatsapp`).
  telefone           text,
  -- O número está na API oficial do WhatsApp (entra: a leitura é do que já
  -- está na conta, não do aparelho).
  oficial            boolean not null default false,
  created_at         timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_numeros_rotulo') then
    alter table public.mia_raio_x_numeros add constraint mia_raio_x_numeros_rotulo check (length(btrim(rotulo)) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_numeros_telefone') then
    alter table public.mia_raio_x_numeros add constraint mia_raio_x_numeros_telefone
      check (telefone is null or telefone ~ '^[1-9][0-9]{9,14}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_numeros_unico') then
    alter table public.mia_raio_x_numeros add constraint mia_raio_x_numeros_unico unique (raio_x_id, channel_session_id);
  end if;
end $$;

comment on table public.mia_raio_x_numeros is
  'MIA (9151): os numeros da conta escolhidos para o raio-X da fonte conversas_da_mia: a referencia ao canal, o rotulo, o telefone comercial (digitos E.164, dado da empresa) e se e API oficial. Nenhum dado de cliente. Servidor apenas: RLS sem politica, grants revogados de anon e authenticated.';

create index if not exists mia_raio_x_numeros_raio_x_idx on public.mia_raio_x_numeros (raio_x_id);
create index if not exists mia_raio_x_numeros_canal_idx on public.mia_raio_x_numeros (channel_session_id) where channel_session_id is not null;

-- ── 4. só o servidor ────────────────────────────────────────────────────────
alter table public.mia_raio_x_numeros enable row level security;
revoke all on public.mia_raio_x_numeros from public, anon, authenticated;
grant select, insert, update, delete on public.mia_raio_x_numeros to service_role;

notify pgrst, 'reload schema';
