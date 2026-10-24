-- manifest: O DISPARO DE E-MAIL MARKETING, PARTE 3 (.89): as CAMPANHAS. `mia_segmentos` (o recorte salvo pelo nome, com a base legal: guarda o FILTRO, nao a lista, e serve ao WhatsApp e ao e-mail), `mia_email_modelos` (modelos de campanha em blocos por segmento de negocio, como os de follow-up), `mia_email_campanhas` (rascunho, agendada, enviando, pausada, concluida, cancelada: remetente, assunto, pre-cabecalho, blocos, textos reserva, versao do conteudo e versao testada, recorte, base legal com LIA, ritmo, agendamento, plano dia a dia, preco congelado, a confirmacao em nome de quem confirmou), `mia_email_testes` (cada envio de teste, por versao), `mia_email_destinatarios` (uma linha por endereco: o hash, o estado, o motivo de ficar de fora, o lote, o id da Amazon, entrega, rejeicao, reclamacao, abertura medida so em quem consentiu, clique, e se ja foi cobrado), `mia_email_links` (os links congelados ao confirmar), `mia_email_cliques` (cada clique, com a marca de robo) e `mia_email_eventos` (os avisos da Amazon, idempotentes pelo id do aviso, sem endereco). Gestor ou administrador le; so o servidor escreve. Nenhum objeto do upstream e tocado.
--
-- 9062 · as campanhas de e-mail, os segmentos salvos e os modelos
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente.

-- ── 1. os segmentos salvos ─────────────────────────────────────────────────
--
-- Guarda o FILTRO, não a lista: a conta refaz na hora de usar. Por isso o nome
-- é genérico (`mia_segmentos`): o mesmo recorte serve ao WhatsApp e ao e-mail.
create table if not exists public.mia_segmentos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null,
  recorte jsonb not null default '{}'::jsonb,
  base_legal text not null default 'consent',
  lia_ref text,
  criado_por uuid references auth.users(id) on delete set null,
  arquivado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mia_segmentos_nome check (length(btrim(nome)) between 1 and 120),
  constraint mia_segmentos_base_legal check (base_legal in ('consent', 'legitimate_interest'))
);

create unique index if not exists uq_mia_segmentos_nome
  on public.mia_segmentos (organization_id, lower(nome))
  where arquivado_em is null;

comment on table public.mia_segmentos is
  'MIA (9062): recortes salvos pelo nome, com a base legal. Guarda o filtro (o das Campanhas do upstream mais empresa e campanha anterior), nao a lista: a conta refaz na hora de usar. Serve ao WhatsApp e ao e-mail. Escrita so pelo servidor.';

-- ── 2. os modelos de campanha ──────────────────────────────────────────────
create table if not exists public.mia_email_modelos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chave text not null,
  nome text not null,
  segmento_de_negocio text,
  assunto text not null default '',
  pre_cabecalho text not null default '',
  blocos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint mia_email_modelos_chave check (chave ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  constraint mia_email_modelos_nome check (length(btrim(nome)) between 1 and 120),
  constraint mia_email_modelos_blocos check (jsonb_typeof(blocos) = 'array'),
  constraint mia_email_modelos_unico unique (organization_id, chave)
);

comment on table public.mia_email_modelos is
  'MIA (9062): modelos de campanha de e-mail em blocos (titulo, texto, imagem, botao, divisor), por segmento de negocio. A campanha COPIA o modelo: mudar o modelo nao muda campanha nenhuma. Escrita so pelo servidor.';

-- ── 3. as campanhas ────────────────────────────────────────────────────────
create table if not exists public.mia_email_campanhas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null,
  status text not null default 'rascunho',
  remetente_id uuid references public.mia_email_remetentes(id) on delete set null,
  assunto text not null default '',
  pre_cabecalho text not null default '',
  blocos jsonb not null default '[]'::jsonb,
  -- O texto reserva de cada variável que depende de cadastro. Vazio = quem não
  -- tem o dado fica de fora (motivo visível na conferência).
  reservas jsonb not null default '{}'::jsonb,
  -- Toda mudança de conteúdo soma 1; o envio só libera com teste da versão atual.
  versao integer not null default 1,
  teste_versao integer,
  recorte jsonb not null default '{}'::jsonb,
  segmento_id uuid references public.mia_segmentos(id) on delete set null,
  base_legal text not null default 'consent',
  lia_ref text,
  -- Nulo = o da configuração. A campanha pode ir mais devagar, nunca mais rápido.
  ritmo_por_hora integer,
  so_dias_uteis boolean,
  agendada_para timestamptz,
  -- O que a tela mostrou na confirmação: dias, horários e quantidades.
  plano jsonb,
  total_previsto integer,
  -- O preço CONGELADO na confirmação: mudar o preço depois não muda a campanha.
  preco_cents integer,
  custo_previsto_cents bigint,
  confirmada_por uuid references auth.users(id) on delete set null,
  confirmada_em timestamptz,
  -- A declaração da base legal, com o texto que a pessoa marcou.
  declaracao_base_legal text,
  motivo_da_pausa text,
  pausada_em timestamptz,
  iniciada_em timestamptz,
  concluida_em timestamptz,
  cancelada_em timestamptz,
  origem text not null default 'tela',
  criada_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mia_email_campanhas_status check (
    status in ('rascunho', 'agendada', 'enviando', 'pausada', 'concluida', 'cancelada')
  ),
  constraint mia_email_campanhas_nome check (length(btrim(nome)) between 1 and 120),
  constraint mia_email_campanhas_base_legal check (base_legal in ('consent', 'legitimate_interest')),
  -- A régua das Campanhas do upstream: interesse legítimo sem a LIA não sai.
  constraint mia_email_campanhas_lia check (
    base_legal <> 'legitimate_interest' or status in ('rascunho', 'cancelada')
    or length(btrim(coalesce(lia_ref, ''))) > 0
  ),
  -- Fora do rascunho, alguém confirmou, com a declaração registrada.
  constraint mia_email_campanhas_confirmada check (
    status in ('rascunho', 'cancelada')
    or (confirmada_por is not null and confirmada_em is not null and declaracao_base_legal is not null)
  ),
  constraint mia_email_campanhas_ritmo check (ritmo_por_hora is null or ritmo_por_hora between 50 and 5000),
  constraint mia_email_campanhas_blocos check (jsonb_typeof(blocos) = 'array'),
  constraint mia_email_campanhas_origem check (origem in ('tela', 'mcp'))
);

create index if not exists idx_mia_email_campanhas_org
  on public.mia_email_campanhas (organization_id, created_at desc);
create index if not exists idx_mia_email_campanhas_fila
  on public.mia_email_campanhas (status, agendada_para)
  where status in ('agendada', 'enviando');

comment on table public.mia_email_campanhas is
  'MIA (9062): as campanhas de e-mail marketing. Nasce rascunho; sai so com dominio verificado, rodape completo, teste da versao atual, base legal declarada em nome de quem confirmou e saldo que cubra. O MCP de plataforma cria rascunho e manda teste, nunca dispara. Escrita so pelo servidor.';

-- ── 4. os testes ───────────────────────────────────────────────────────────
create table if not exists public.mia_email_testes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campanha_id uuid not null references public.mia_email_campanhas(id) on delete cascade,
  versao integer not null,
  -- Endereços da EQUIPE (até 5), escolhidos por quem testa. Não são contatos.
  para text[] not null,
  enviado_por uuid references auth.users(id) on delete set null,
  enviado_em timestamptz not null default now(),
  resultado jsonb not null default '{}'::jsonb,
  constraint mia_email_testes_para check (cardinality(para) between 1 and 5)
);

create index if not exists idx_mia_email_testes_campanha
  on public.mia_email_testes (campanha_id, enviado_em desc);

comment on table public.mia_email_testes is
  'MIA (9062): cada envio de teste de uma campanha, por versao do conteudo. Ate 5 enderecos, [TESTE] no assunto, sem cobrar. Na empresa de demonstracao nao nasce (9064). Escrita so pelo servidor.';

-- ── 5. os destinatários ────────────────────────────────────────────────────
create table if not exists public.mia_email_destinatarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campanha_id uuid not null references public.mia_email_campanhas(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  -- COPIADO do contato na confirmação: é para onde o e-mail vai. A anonimização
  -- (9064) o apaga; o hash fica, e é ele que faz o "uma vez só" por endereço.
  email text,
  email_hash text not null,
  status text not null default 'pendente',
  -- Por que ficou de fora (os dez motivos da conferência) ou por que falhou.
  motivo text,
  lote_id uuid,
  tentativas smallint not null default 0,
  ses_message_id text,
  -- Abertura só é medida em quem consentiu com o aviso de medição.
  medir_abertura boolean not null default false,
  enviado_em timestamptz,
  entregue_em timestamptz,
  rejeitado_em timestamptz,
  rejeicao_tipo text,
  reclamacao_em timestamptz,
  primeira_abertura_em timestamptz,
  aberturas integer not null default 0,
  primeiro_clique_em timestamptz,
  -- Saiu da lista por um link DESTE e-mail (rodapé, botão do Gmail ou página).
  descadastrado_em timestamptz,
  cobrado boolean not null default false,
  cobrado_cents integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mia_email_destinatarios_status check (
    status in ('pendente', 'enviando', 'enviado', 'entregue', 'rejeitado', 'reclamacao', 'pulado', 'falhou')
  ),
  constraint mia_email_destinatarios_rejeicao check (
    rejeicao_tipo is null or rejeicao_tipo in ('permanente', 'temporaria')
  ),
  constraint mia_email_destinatarios_um_por_endereco unique (campanha_id, email_hash)
);

create unique index if not exists uq_mia_email_destinatarios_mensagem
  on public.mia_email_destinatarios (ses_message_id)
  where ses_message_id is not null;
create index if not exists idx_mia_email_destinatarios_fila
  on public.mia_email_destinatarios (campanha_id, status, created_at);
create index if not exists idx_mia_email_destinatarios_hash
  on public.mia_email_destinatarios (organization_id, email_hash, created_at desc);
create index if not exists idx_mia_email_destinatarios_contato
  on public.mia_email_destinatarios (organization_id, contact_id);

comment on table public.mia_email_destinatarios is
  'MIA (9062): um endereco por campanha. Estado do envio, motivo de ficar de fora, lote, id da Amazon, entrega, rejeicao (permanente ou temporaria), reclamacao, abertura (estimativa, so em quem consentiu com o aviso de medicao) e clique, e se ja foi cobrado (por lote, fn_mia_email_cobrar). O endereco copiado sai na anonimizacao; o hash fica. Escrita so pelo servidor.';

-- ── 6. os links e os cliques ───────────────────────────────────────────────
create table if not exists public.mia_email_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campanha_id uuid not null references public.mia_email_campanhas(id) on delete cascade,
  ordem integer not null,
  url text not null,
  rotulo text,
  created_at timestamptz not null default now(),
  constraint mia_email_links_url check (url ~* '^https?://'),
  constraint mia_email_links_ordem unique (campanha_id, ordem)
);

comment on table public.mia_email_links is
  'MIA (9062): os links da campanha, congelados na confirmacao. O e-mail leva um link de passagem medido para cada um. Escrita so pelo servidor.';

create table if not exists public.mia_email_cliques (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  destinatario_id uuid not null references public.mia_email_destinatarios(id) on delete cascade,
  link_id uuid not null references public.mia_email_links(id) on delete cascade,
  clicado_em timestamptz not null default now(),
  -- O robô de segurança abre todos os links no primeiro minuto depois de
  -- entregue. O clique fica (é o que aconteceu), e sai da conta.
  robo boolean not null default false
);

create index if not exists idx_mia_email_cliques_destinatario
  on public.mia_email_cliques (destinatario_id, clicado_em);
create index if not exists idx_mia_email_cliques_link
  on public.mia_email_cliques (link_id);

comment on table public.mia_email_cliques is
  'MIA (9062): cada clique num link de campanha, pelo link de passagem. robo = clique do robo de seguranca (todos os links no primeiro minuto depois de entregue, ou agente de robo conhecido), fora das contas. Sem dado de pessoa alem do vinculo com o destinatario. Escrita so pelo servidor.';

-- ── 7. os avisos da Amazon ─────────────────────────────────────────────────
create table if not exists public.mia_email_eventos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  destinatario_id uuid references public.mia_email_destinatarios(id) on delete set null,
  tipo text not null,
  -- O id do aviso: a Amazon entrega o mesmo aviso mais de uma vez.
  aviso_id text not null,
  ocorrido_em timestamptz not null,
  -- Só a classificação (tipo e subtipo da rejeição, tipo da reclamação). Nunca o
  -- endereço nem o texto de diagnóstico, que costuma repetir o endereço.
  detalhe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint mia_email_eventos_tipo check (tipo in ('entrega', 'rejeicao', 'reclamacao')),
  constraint mia_email_eventos_aviso unique (aviso_id)
);

create index if not exists idx_mia_email_eventos_destinatario
  on public.mia_email_eventos (destinatario_id);

comment on table public.mia_email_eventos is
  'MIA (9062): os avisos da Amazon SES (entrega, rejeicao, reclamacao), recebidos pela rota publica com assinatura conferida, idempotentes pelo id do aviso. Guarda so a classificacao, nunca o endereco. Escrita so pelo servidor.';

-- ── 8. o relógio de atualização ────────────────────────────────────────────
drop trigger if exists trg_mia_segmentos_updated_at on public.mia_segmentos;
create trigger trg_mia_segmentos_updated_at
  before update on public.mia_segmentos
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_mia_email_modelos_updated_at on public.mia_email_modelos;
create trigger trg_mia_email_modelos_updated_at
  before update on public.mia_email_modelos
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_mia_email_campanhas_updated_at on public.mia_email_campanhas;
create trigger trg_mia_email_campanhas_updated_at
  before update on public.mia_email_campanhas
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_mia_email_destinatarios_updated_at on public.mia_email_destinatarios;
create trigger trg_mia_email_destinatarios_updated_at
  before update on public.mia_email_destinatarios
  for each row execute function public.fn_set_updated_at();

-- ── 9. RLS: gestor ou administrador lê o da própria empresa; só o servidor escreve
alter table public.mia_segmentos enable row level security;
alter table public.mia_email_modelos enable row level security;
alter table public.mia_email_campanhas enable row level security;
alter table public.mia_email_testes enable row level security;
alter table public.mia_email_destinatarios enable row level security;
alter table public.mia_email_links enable row level security;
alter table public.mia_email_cliques enable row level security;
alter table public.mia_email_eventos enable row level security;

drop policy if exists mia_segmentos_select on public.mia_segmentos;
create policy mia_segmentos_select on public.mia_segmentos
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_email_modelos_select on public.mia_email_modelos;
create policy mia_email_modelos_select on public.mia_email_modelos
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_email_campanhas_select on public.mia_email_campanhas;
create policy mia_email_campanhas_select on public.mia_email_campanhas
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_email_testes_select on public.mia_email_testes;
create policy mia_email_testes_select on public.mia_email_testes
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_email_destinatarios_select on public.mia_email_destinatarios;
create policy mia_email_destinatarios_select on public.mia_email_destinatarios
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_email_links_select on public.mia_email_links;
create policy mia_email_links_select on public.mia_email_links
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_email_cliques_select on public.mia_email_cliques;
create policy mia_email_cliques_select on public.mia_email_cliques
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_email_eventos_select on public.mia_email_eventos;
create policy mia_email_eventos_select on public.mia_email_eventos
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.mia_segmentos from anon, authenticated;
revoke all on public.mia_email_modelos from anon, authenticated;
revoke all on public.mia_email_campanhas from anon, authenticated;
revoke all on public.mia_email_testes from anon, authenticated;
revoke all on public.mia_email_destinatarios from anon, authenticated;
revoke all on public.mia_email_links from anon, authenticated;
revoke all on public.mia_email_cliques from anon, authenticated;
revoke all on public.mia_email_eventos from anon, authenticated;
grant select on public.mia_segmentos to authenticated;
grant select on public.mia_email_modelos to authenticated;
grant select on public.mia_email_campanhas to authenticated;
grant select on public.mia_email_testes to authenticated;
grant select on public.mia_email_destinatarios to authenticated;
grant select on public.mia_email_links to authenticated;
grant select on public.mia_email_cliques to authenticated;
grant select on public.mia_email_eventos to authenticated;
grant all on public.mia_segmentos to service_role;
grant all on public.mia_email_modelos to service_role;
grant all on public.mia_email_campanhas to service_role;
grant all on public.mia_email_testes to service_role;
grant all on public.mia_email_destinatarios to service_role;
grant all on public.mia_email_links to service_role;
grant all on public.mia_email_cliques to service_role;
grant all on public.mia_email_eventos to service_role;
