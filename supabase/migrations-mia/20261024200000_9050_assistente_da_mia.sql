-- manifest: O ASSISTENTE DA MIA (.88, protótipo aprovado em 24/10/2026; fase 1 da spec do upstream #2860, o "agente interno": chat de leitura). Seis peças NOSSAS: `mia_assistente_config` (por empresa: ligado, os papéis que usam, o limite de perguntas por pessoa por dia, 50 por padrão, e o padrão do resumo da manhã; só o servidor grava), `mia_assistente_conhecimento` (a base própria da empresa, "como trabalhamos aqui", por título sem duplicar; o administrador escreve), `mia_assistente_conversas` e `mia_assistente_mensagens` (o histórico de cada pessoa: cada uma vê só o seu, e o administrador vê só as PERGUNTAS que ficaram sem resposta, sem o resto da conversa; a mensagem guarda as fontes, os botões e os contatos que ela cita, para a LGPD alcançar), `mia_assistente_preferencias` (o resumo da manhã de cada pessoa, desligado até ela ligar) e `mia_chamados` (erro, dúvida ou pedido para a Time Company, com o contexto que o assistente juntou, o print opcional no bucket privado `mia-assistente`, a situação Novo/Em análise/Resolvido e a resposta; quem abriu e o administrador da empresa leem, só a plataforma responde; o gatilho `fn_mia_chamado_nasce` carimba a empresa de demonstração, cujo chamado não sai). O print que nada mais aponta vai para a fila de remoção do upstream (`fn_mia_chamado_print_sai`). As tabelas com escrita da sessão entram nas travas do suporte somente leitura pela função do upstream (`fn_aplicar_travas_de_suporte`). Nenhum objeto do upstream é redefinido. Provado em tests/invariants/assistente-da-mia.test.ts.
--
-- 9050 · o assistente da MIA
--
-- `mia`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `create
-- table if not exists`, constraints dentro de `do` que conferem o catálogo,
-- `create index if not exists`, `drop trigger/policy if exists`.
--
-- ── A regra que o produto inteiro depende ───────────────────────────────────
--
-- O assistente NÃO tem acesso próprio. O turno lê o CRM com o cliente da SESSÃO
-- de quem perguntou (lib/assistente/turno.ts), e a RLS de cada tabela de origem
-- filtra como filtra nas telas. Estas tabelas guardam só o que é DO assistente:
-- o histórico, a configuração e os chamados. Nenhuma delas abre leitura de
-- dado do CRM a ninguém.
--
-- ── Quem vê e quem faz (as 18 regras do protótipo) ──────────────────────────
--
--   histórico        cada pessoa, o seu; o administrador, só as perguntas sem
--                    resposta (a pergunta, nunca a resposta nem o resto)
--   base própria     todos leem (o assistente usa nas respostas de todos); o
--                    administrador escreve
--   configuração     todos leem a da sua empresa; quem grava é o servidor (a
--                    tela do administrador e o MCP de plataforma)
--   chamado          quem abriu e o administrador da empresa leem; quem abre é
--                    a pessoa; quem responde é só a plataforma (service_role)
--   resumo da manhã  cada pessoa liga o seu; quem escreve o resumo é o cron

-- ── 1. a configuração da empresa ────────────────────────────────────────────

create table if not exists public.mia_assistente_config (
  organization_id              uuid primary key references public.organizations(id) on delete cascade,
  ligado                       boolean not null default true,
  papeis                       text[] not null default array['viewer', 'agent', 'manager', 'admin']::text[],
  perguntas_por_pessoa_por_dia integer not null default 50,
  resumo_da_manha_padrao       boolean not null default false,
  updated_by                   uuid references auth.users(id) on delete set null,
  updated_at                   timestamptz not null default now()
);

comment on table public.mia_assistente_config is
  'MIA (9050): o assistente da MIA numa empresa. Sem linha vale o padrao (ligado, todos os papeis, 50 perguntas por pessoa por dia, resumo da manha desligado). Le quem e da empresa; grava so o servidor (a tela do administrador e plataforma_configurar_assistente).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_config_limite') then
    alter table public.mia_assistente_config
      add constraint mia_assistente_config_limite check (perguntas_por_pessoa_por_dia between 1 and 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_config_papeis') then
    alter table public.mia_assistente_config
      add constraint mia_assistente_config_papeis
      check (papeis <@ array['viewer', 'agent', 'manager', 'admin']::text[]);
  end if;
end $$;

-- ── 2. a base própria da empresa ────────────────────────────────────────────

create table if not exists public.mia_assistente_conhecimento (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  titulo          text not null,
  texto           text not null,
  ativo           boolean not null default true,
  criado_via      text not null default 'tela',
  created_by      uuid references auth.users(id) on delete set null,
  updated_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.mia_assistente_conhecimento is
  'MIA (9050): a base propria da empresa para o assistente ("como trabalhamos aqui", ex.: "proposta acima de R$ 10 mil passa pela gestora"). Um titulo por empresa, sem duplicar. Todos da empresa leem; o administrador escreve; a implantacao garante por plataforma_garantir_conhecimento_do_assistente.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_conhecimento_titulo') then
    alter table public.mia_assistente_conhecimento
      add constraint mia_assistente_conhecimento_titulo check (length(btrim(titulo)) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_conhecimento_texto') then
    alter table public.mia_assistente_conhecimento
      add constraint mia_assistente_conhecimento_texto check (length(btrim(texto)) between 1 and 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_conhecimento_via') then
    alter table public.mia_assistente_conhecimento
      add constraint mia_assistente_conhecimento_via check (criado_via in ('tela', 'mcp_plataforma'));
  end if;
end $$;

create unique index if not exists mia_assistente_conhecimento_titulo_idx
  on public.mia_assistente_conhecimento (organization_id, lower(btrim(titulo)));

-- ── 3. as conversas e as mensagens de cada pessoa ───────────────────────────

create table if not exists public.mia_assistente_conversas (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  titulo          text not null,
  origem          text not null default 'pergunta',
  created_at      timestamptz not null default now(),
  ultima_em       timestamptz not null default now()
);

comment on table public.mia_assistente_conversas is
  'MIA (9050): uma conversa de uma pessoa com o assistente da MIA. origem = pergunta (aberta por ela), resumo_da_manha (o plano do dia que o cron escreve) ou chamado (a resposta da Time a um chamado sem conversa). Cada pessoa ve so as suas. Guardada por 90 dias (fn_mia_expurgar_assistente_vencido, 9051).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_conversas_org_id_key') then
    alter table public.mia_assistente_conversas
      add constraint mia_assistente_conversas_org_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_conversas_titulo') then
    alter table public.mia_assistente_conversas
      add constraint mia_assistente_conversas_titulo check (length(btrim(titulo)) between 1 and 160);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_conversas_origem') then
    alter table public.mia_assistente_conversas
      add constraint mia_assistente_conversas_origem check (origem in ('pergunta', 'resumo_da_manha', 'chamado'));
  end if;
end $$;

create index if not exists mia_assistente_conversas_pessoa_idx
  on public.mia_assistente_conversas (organization_id, user_id, ultima_em desc);

create table if not exists public.mia_assistente_mensagens (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversa_id     uuid not null,
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- pergunta (a pessoa), resposta (o assistente), resumo_da_manha (o cron) e
  -- resposta_do_chamado (a Time Company, pela plataforma).
  tipo            text not null,
  texto           text not null,
  -- Idempotência do clique duplo: a mesma pergunta não paga duas chamadas.
  turn_id         uuid,
  -- Em que tela a pessoa estava (o caminho, nunca a query string).
  tela            text,
  -- "De onde veio": as fontes que as ferramentas do turno de fato leram.
  fontes          text[] not null default '{}'::text[],
  -- Os botões da resposta ("Me leva lá", "Pedir à pessoa", "Mandar ao suporte").
  acoes           jsonb not null default '[]'::jsonb,
  -- A pergunta que o assistente não soube responder: a única coisa do
  -- histórico de alguém que o administrador enxerga.
  sem_resposta    boolean not null default false,
  erro            text,
  -- Os contatos que a pergunta ou a resposta citam (LGPD, 9051): é o que deixa
  -- a anonimização e o acesso do titular alcançarem o histórico.
  contatos        uuid[] not null default '{}'::uuid[],
  llm_call_id     uuid,
  created_at      timestamptz not null default now()
);

comment on table public.mia_assistente_mensagens is
  'MIA (9050): cada mensagem de uma conversa com o assistente. tipo = pergunta | resposta | resumo_da_manha | resposta_do_chamado. fontes = o que as ferramentas do turno leram (o "de onde veio"); acoes = os botoes; contatos = os contatos citados, para a anonimizacao e o acesso do titular (9051). A pessoa ve as suas; o administrador ve so as perguntas com sem_resposta. Guardada por 90 dias.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_mensagens_conversa') then
    alter table public.mia_assistente_mensagens
      add constraint mia_assistente_mensagens_conversa
      foreign key (organization_id, conversa_id)
      references public.mia_assistente_conversas (organization_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_mensagens_tipo') then
    alter table public.mia_assistente_mensagens
      add constraint mia_assistente_mensagens_tipo
      check (tipo in ('pergunta', 'resposta', 'resumo_da_manha', 'resposta_do_chamado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_mensagens_texto') then
    alter table public.mia_assistente_mensagens
      add constraint mia_assistente_mensagens_texto check (length(texto) between 1 and 20000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_mensagens_acoes') then
    alter table public.mia_assistente_mensagens
      add constraint mia_assistente_mensagens_acoes check (jsonb_typeof(acoes) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_assistente_mensagens_turno') then
    alter table public.mia_assistente_mensagens
      add constraint mia_assistente_mensagens_turno unique (organization_id, user_id, turn_id, tipo);
  end if;
end $$;

create index if not exists mia_assistente_mensagens_conversa_idx
  on public.mia_assistente_mensagens (conversa_id, created_at);
-- O limite do dia conta as perguntas de hoje de uma pessoa.
create index if not exists mia_assistente_mensagens_do_dia_idx
  on public.mia_assistente_mensagens (organization_id, user_id, created_at desc)
  where tipo = 'pergunta';
create index if not exists mia_assistente_mensagens_sem_resposta_idx
  on public.mia_assistente_mensagens (organization_id, created_at desc)
  where sem_resposta;
create index if not exists mia_assistente_mensagens_contatos_idx
  on public.mia_assistente_mensagens using gin (contatos);
create index if not exists mia_assistente_mensagens_vencidas_idx
  on public.mia_assistente_mensagens (created_at);

-- ── 4. o resumo da manhã de cada pessoa ─────────────────────────────────────

create table if not exists public.mia_assistente_preferencias (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  resumo_da_manha  boolean not null,
  -- O dia (no fuso da empresa) do último resumo escrito: a trava de um por dia.
  ultimo_resumo_em date,
  updated_at       timestamptz not null default now(),
  primary key (organization_id, user_id)
);

comment on table public.mia_assistente_preferencias is
  'MIA (9050): o resumo da manha de cada pessoa. Sem linha vale o padrao da empresa (mia_assistente_config.resumo_da_manha_padrao, desligado). ultimo_resumo_em e a trava de um resumo por dia, gravada pelo cron.';

-- ── 5. os chamados para a Time Company ──────────────────────────────────────

create sequence if not exists public.mia_chamados_numero_seq start with 1001;

create table if not exists public.mia_chamados (
  id              uuid primary key default gen_random_uuid(),
  numero          bigint not null default nextval('public.mia_chamados_numero_seq'),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  tipo            text not null,
  texto           text not null,
  -- tela, hora, versão, navegador, mensagem do sistema: o que o assistente
  -- juntou. Nunca telefone, e-mail ou documento de contato.
  contexto        jsonb not null default '{}'::jsonb,
  print_path      text,
  situacao        text not null default 'novo',
  resposta        text,
  respondido_por  uuid references auth.users(id) on delete set null,
  respondido_em   timestamptz,
  -- Empresa de demonstração: o chamado fica no assistente e não sai para a Time.
  demonstracao    boolean not null default false,
  conversa_id     uuid references public.mia_assistente_conversas(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.mia_chamados is
  'MIA (9050): erro, duvida ou pedido para a Time Company, aberto pelo assistente da MIA. contexto = tela, hora, versao, navegador e mensagem do sistema; print_path = o print opcional no bucket privado mia-assistente. situacao novo | em_analise | resolvido; a resposta chega a quem abriu no assistente e no e-mail. Quem abriu e o administrador da empresa leem; so a plataforma responde. Na empresa de demonstracao (demonstracao = true) o chamado nao sai.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_chamados_numero_key') then
    alter table public.mia_chamados add constraint mia_chamados_numero_key unique (numero);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_chamados_tipo') then
    alter table public.mia_chamados
      add constraint mia_chamados_tipo check (tipo in ('erro', 'duvida', 'pedido'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_chamados_texto') then
    alter table public.mia_chamados
      add constraint mia_chamados_texto check (length(btrim(texto)) between 3 and 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_chamados_contexto') then
    alter table public.mia_chamados
      add constraint mia_chamados_contexto
      check (jsonb_typeof(contexto) = 'object' and octet_length(contexto::text) <= 16000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_chamados_situacao') then
    alter table public.mia_chamados
      add constraint mia_chamados_situacao check (situacao in ('novo', 'em_analise', 'resolvido'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_chamados_resposta') then
    alter table public.mia_chamados
      add constraint mia_chamados_resposta check (resposta is null or length(resposta) between 1 and 8000);
  end if;
  -- O print mora na pasta da empresa: `<org>/<chamado>/<arquivo>`.
  if not exists (select 1 from pg_constraint where conname = 'mia_chamados_print_da_empresa') then
    alter table public.mia_chamados
      add constraint mia_chamados_print_da_empresa
      check (print_path is null or split_part(print_path, '/', 1) = organization_id::text);
  end if;
end $$;

create index if not exists mia_chamados_org_idx on public.mia_chamados (organization_id, created_at desc);
create index if not exists mia_chamados_pessoa_idx on public.mia_chamados (organization_id, user_id, created_at desc);
create index if not exists mia_chamados_fila_idx on public.mia_chamados (situacao, created_at desc) where not demonstracao;

-- ── 6. o chamado nasce como a plataforma espera ─────────────────────────────
--
-- Pela sessão, quem abre é a própria pessoa, e o chamado nasce "novo", sem
-- resposta e sem print (o print entra pelo servidor, depois de guardado). A
-- marca de demonstração não vem do pedido: vem da empresa. Sem isto, um pedido
-- direto ao PostgREST abriria um chamado "respondido" ou tiraria a marca de
-- demonstração do chamado da empresa fictícia.
create or replace function public.fn_mia_chamado_nasce()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  new.demonstracao := coalesce(
    (select o.demonstracao from public.organizations o where o.id = new.organization_id),
    false
  );
  if auth.uid() is not null then
    new.user_id := auth.uid();
    new.situacao := 'novo';
    new.resposta := null;
    new.respondido_por := null;
    new.respondido_em := null;
    new.print_path := null;
    -- O número é da sequência, nunca do pedido: um número escolhido à mão
    -- colidiria, mais tarde, com o de outra empresa.
    new.numero := nextval('public.mia_chamados_numero_seq');
    new.created_at := now();
    new.updated_at := now();
  end if;
  return new;
end
$f$;

comment on function public.fn_mia_chamado_nasce() is
  'MIA (9050): o chamado aberto pela sessao nasce da propria pessoa, novo, sem resposta e sem print; a marca de demonstracao sai da empresa, nunca do pedido.';

revoke all on function public.fn_mia_chamado_nasce() from public;
revoke execute on function public.fn_mia_chamado_nasce() from anon, authenticated;

drop trigger if exists trg_mia_chamado_nasce on public.mia_chamados;
create trigger trg_mia_chamado_nasce
  before insert on public.mia_chamados
  for each row execute function public.fn_mia_chamado_nasce();

-- O print que nada mais aponta vai para a fila de remoção do upstream
-- (`storage_redaction_queue`, a mesma da 9018): o chamado apagado (retenção) ou
-- o print trocado. Organização sendo apagada: a fila referencia a organização,
-- e os arquivos saem com o espaço dela.
create or replace function public.fn_mia_chamado_print_sai()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  if old.print_path is null then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.print_path is not distinct from old.print_path then
    return new;
  end if;
  if not exists (select 1 from public.organizations g where g.id = old.organization_id) then
    return old;
  end if;
  insert into public.storage_redaction_queue (organization_id, bucket, object_path)
  values (old.organization_id, 'mia-assistente', old.print_path)
  on conflict (bucket, object_path) do update
    set status = 'pending',
        attempts = 0,
        enqueued_at = now(),
        processed_at = null,
        error_message = null
    where storage_redaction_queue.status in ('deleted', 'skipped');
  return case when tg_op = 'DELETE' then old else new end;
end
$f$;

comment on function public.fn_mia_chamado_print_sai() is
  'MIA (9050): o print de um chamado que saiu (retencao) ou foi trocado entra em storage_redaction_queue com o bucket mia-assistente.';

revoke all on function public.fn_mia_chamado_print_sai() from public;
revoke execute on function public.fn_mia_chamado_print_sai() from anon, authenticated;

drop trigger if exists trg_mia_chamado_print_sai on public.mia_chamados;
create trigger trg_mia_chamado_print_sai
  after delete or update of print_path on public.mia_chamados
  for each row execute function public.fn_mia_chamado_print_sai();

-- ── 7. a área privada dos prints ────────────────────────────────────────────
--
-- Sem policy em `storage.objects`, como `mia-obrigacoes` e `internal-media`: só
-- o servidor (service_role) lê e grava; a tela recebe link assinado. 10 MB: é
-- um print de tela.
insert into storage.buckets (id, name, public, file_size_limit)
values ('mia-assistente', 'mia-assistente', false, 10485760)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- ── 8. permissões e RLS ─────────────────────────────────────────────────────

alter table public.mia_assistente_config enable row level security;
alter table public.mia_assistente_conhecimento enable row level security;
alter table public.mia_assistente_conversas enable row level security;
alter table public.mia_assistente_mensagens enable row level security;
alter table public.mia_assistente_preferencias enable row level security;
alter table public.mia_chamados enable row level security;

revoke all on table public.mia_assistente_config from public, anon, authenticated;
revoke all on table public.mia_assistente_conhecimento from public, anon, authenticated;
revoke all on table public.mia_assistente_conversas from public, anon, authenticated;
revoke all on table public.mia_assistente_mensagens from public, anon, authenticated;
revoke all on table public.mia_assistente_preferencias from public, anon, authenticated;
revoke all on table public.mia_chamados from public, anon, authenticated;
revoke all on sequence public.mia_chamados_numero_seq from public, anon, authenticated;

-- A configuração: só leitura pela sessão.
grant select on table public.mia_assistente_config to authenticated;
-- A base própria: o administrador escreve pela sessão (a RLS decide quem).
grant select, insert, update, delete on table public.mia_assistente_conhecimento to authenticated;
-- O histórico: a pessoa cria o seu e marca a pergunta sem resposta. Ninguém
-- apaga pela sessão: o limite do dia conta as perguntas, e a retenção é do
-- servidor.
grant select, insert on table public.mia_assistente_conversas to authenticated;
grant update (titulo, ultima_em) on table public.mia_assistente_conversas to authenticated;
grant select, insert on table public.mia_assistente_mensagens to authenticated;
grant update (sem_resposta, contatos) on table public.mia_assistente_mensagens to authenticated;
-- O resumo da manhã: a pessoa liga e desliga o seu; a trava do dia é do cron.
grant select, insert on table public.mia_assistente_preferencias to authenticated;
grant update (resumo_da_manha, updated_at) on table public.mia_assistente_preferencias to authenticated;
-- O chamado: a pessoa abre; responder é da plataforma. O insert é da tabela
-- inteira (é o que faz as travas do suporte a alcançarem), e quem decide o que
-- nasce é o gatilho `fn_mia_chamado_nasce`: autor, número, situação, resposta e
-- print não vêm do pedido.
grant select, insert on table public.mia_chamados to authenticated;
grant usage on sequence public.mia_chamados_numero_seq to authenticated;

grant all on table public.mia_assistente_config to service_role;
grant all on table public.mia_assistente_conhecimento to service_role;
grant all on table public.mia_assistente_conversas to service_role;
grant all on table public.mia_assistente_mensagens to service_role;
grant all on table public.mia_assistente_preferencias to service_role;
grant all on table public.mia_chamados to service_role;
grant all on sequence public.mia_chamados_numero_seq to service_role;

drop policy if exists "mia_assistente_config_select" on public.mia_assistente_config;
create policy "mia_assistente_config_select" on public.mia_assistente_config
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "mia_assistente_conhecimento_select" on public.mia_assistente_conhecimento;
drop policy if exists "mia_assistente_conhecimento_insert" on public.mia_assistente_conhecimento;
drop policy if exists "mia_assistente_conhecimento_update" on public.mia_assistente_conhecimento;
drop policy if exists "mia_assistente_conhecimento_delete" on public.mia_assistente_conhecimento;
create policy "mia_assistente_conhecimento_select" on public.mia_assistente_conhecimento
  for select using (organization_id in (select public.fn_user_org_ids()));
create policy "mia_assistente_conhecimento_insert" on public.mia_assistente_conhecimento
  for insert with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );
create policy "mia_assistente_conhecimento_update" on public.mia_assistente_conhecimento
  for update using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );
create policy "mia_assistente_conhecimento_delete" on public.mia_assistente_conhecimento
  for delete using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

drop policy if exists "mia_assistente_conversas_select" on public.mia_assistente_conversas;
drop policy if exists "mia_assistente_conversas_insert" on public.mia_assistente_conversas;
drop policy if exists "mia_assistente_conversas_update" on public.mia_assistente_conversas;
create policy "mia_assistente_conversas_select" on public.mia_assistente_conversas
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and user_id = auth.uid()
  );
create policy "mia_assistente_conversas_insert" on public.mia_assistente_conversas
  for insert with check (
    organization_id in (select public.fn_user_org_ids())
    and user_id = auth.uid()
    and origem = 'pergunta'
  );
create policy "mia_assistente_conversas_update" on public.mia_assistente_conversas
  for update using (
    organization_id in (select public.fn_user_org_ids())
    and user_id = auth.uid()
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and user_id = auth.uid()
  );

drop policy if exists "mia_assistente_mensagens_select" on public.mia_assistente_mensagens;
drop policy if exists "mia_assistente_mensagens_sem_resposta" on public.mia_assistente_mensagens;
drop policy if exists "mia_assistente_mensagens_insert" on public.mia_assistente_mensagens;
drop policy if exists "mia_assistente_mensagens_update" on public.mia_assistente_mensagens;
create policy "mia_assistente_mensagens_select" on public.mia_assistente_mensagens
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and user_id = auth.uid()
  );
-- O administrador vê a PERGUNTA sem resposta, e só ela: a linha da resposta e
-- as outras perguntas da pessoa continuam só dela.
create policy "mia_assistente_mensagens_sem_resposta" on public.mia_assistente_mensagens
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and tipo = 'pergunta'
    and sem_resposta
    and public.fn_role_at_least(organization_id, 'admin')
  );
create policy "mia_assistente_mensagens_insert" on public.mia_assistente_mensagens
  for insert with check (
    organization_id in (select public.fn_user_org_ids())
    and user_id = auth.uid()
    and tipo in ('pergunta', 'resposta')
    and exists (
      select 1 from public.mia_assistente_conversas c
       where c.id = conversa_id
         and c.organization_id = mia_assistente_mensagens.organization_id
         and c.user_id = auth.uid()
    )
  );
create policy "mia_assistente_mensagens_update" on public.mia_assistente_mensagens
  for update using (
    organization_id in (select public.fn_user_org_ids())
    and user_id = auth.uid()
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and user_id = auth.uid()
  );

drop policy if exists "mia_assistente_preferencias_select" on public.mia_assistente_preferencias;
drop policy if exists "mia_assistente_preferencias_insert" on public.mia_assistente_preferencias;
drop policy if exists "mia_assistente_preferencias_update" on public.mia_assistente_preferencias;
create policy "mia_assistente_preferencias_select" on public.mia_assistente_preferencias
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and user_id = auth.uid()
  );
create policy "mia_assistente_preferencias_insert" on public.mia_assistente_preferencias
  for insert with check (
    organization_id in (select public.fn_user_org_ids())
    and user_id = auth.uid()
  );
create policy "mia_assistente_preferencias_update" on public.mia_assistente_preferencias
  for update using (
    organization_id in (select public.fn_user_org_ids())
    and user_id = auth.uid()
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and user_id = auth.uid()
  );

drop policy if exists "mia_chamados_select" on public.mia_chamados;
drop policy if exists "mia_chamados_insert" on public.mia_chamados;
create policy "mia_chamados_select" on public.mia_chamados
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and (user_id = auth.uid() or public.fn_role_at_least(organization_id, 'admin'))
  );
create policy "mia_chamados_insert" on public.mia_chamados
  for insert with check (
    organization_id in (select public.fn_user_org_ids())
    and (conversa_id is null or exists (
      select 1 from public.mia_assistente_conversas c
       where c.id = conversa_id
         and c.organization_id = mia_chamados.organization_id
         and c.user_id = auth.uid()
    ))
  );

-- ── 9. as travas do suporte somente leitura ─────────────────────────────────
--
-- A regra é a do upstream (0274): tabela com RLS, `organization_id` e escrita
-- para `authenticated` ganha as três políticas restritivas; a de só leitura
-- (`mia_assistente_config`) fica sem nenhuma.
do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

notify pgrst, 'reload schema';
