-- manifest: O RAIO-X DO ATENDIMENTO (.101, protótipo aprovado em 04/11/2026; docs/fork/raio-x-do-atendimento.md). Ferramenta da PLATAFORMA (só a Time usa): a Time cadastra o raio-X de uma empresa, que NÃO precisa ser cliente da MIA (`organization_id` opcional, liga depois), o dono abre o link de conexão sem login, aceita o termo e conecta o WhatsApp comercial; o sistema lê as conversas 1:1 dos últimos 30/60/90 dias, transcreve os áudios, e gera o relatório em RASCUNHO, que só vira link do dono depois da revisão da Time. Sete tabelas NOSSAS, todas só do servidor (RLS ligada SEM política e grants revogados de anon e authenticated, o molde de `mia_paineis_links`/9031): `mia_raio_x` (o cadastro, a situação, o hash do código do link de conexão, que vale 48 h, a sessão do leitor, o cursor da leitura, os prazos: desconectar 7 dias depois do relatório no diagnóstico único, apagar as conversas 30 dias depois; o teto de custo, padrão R$ 40); `mia_raio_x_aceites` (o aceite do termo: nome, data e hora, versão e o TEXTO inteiro aceito, com o hash); `mia_raio_x_conversas` (uma por cliente: a MARCA do chat por HMAC, nunca o telefone, a referência cifrada para baixar áudio, o número de ordem "Cliente 0187" e a análise do modelo de IA, sem texto de mensagem); `mia_raio_x_mensagens` (TRANSITÓRIA: o texto e a transcrição que a análise lê, apagados com a conversa 30 dias depois do relatório); `mia_raio_x_relatorios` (o relatório guardado: só números somados, rótulos, os 10 trechos anonimizados e as recomendações; a versão dos critérios da nota, a comparação com o anterior, rascunho ou revisado, o custo); `mia_raio_x_links` (o link do dono, molde da 9031: só o hash do token, validade, revogação, acessos sem identificar a pessoa) e `mia_raio_x_gastos` (o gasto de IA da PLATAFORMA por chamada, propósito `raio_x_analise` ou `raio_x_transcricao`, em dólar e em real). `fn_mia_raio_x_conversa` dá o número de ordem numa escrita só; `fn_mia_raio_x_link_acessado` conta o acesso ao link do dono; `fn_mia_raio_x_expurgar_conversas` apaga as conversas e as mensagens de um raio-X (o relatório fica). Execução só para service_role. Nenhum objeto do upstream é redefinido. Provado em tests/invariants/raio-x-do-atendimento.test.ts.
--
-- 9150 · o raio-X do atendimento
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `create table if
-- not exists`, as constraints dentro de `do` que conferem o catálogo, `create
-- index if not exists`, `drop trigger if exists`, `create or replace` só de
-- função nossa.
--
-- As contas (prazos, métricas, anonimização, comparação) moram em `lib/raio-x/`
-- e têm teste de unidade. Aqui mora só o que o banco garante.

-- ── 1. o raio-X ─────────────────────────────────────────────────────────────
create table if not exists public.mia_raio_x (
  id                    uuid primary key default gen_random_uuid(),
  empresa               text not null,
  segmento              text not null,
  -- O WhatsApp COMERCIAL da empresa, em dígitos E.164. É dado da empresa, não
  -- de um cliente dela, e é por ele que a Time reconhece "a mesma empresa".
  whatsapp              text not null,
  -- Quem autoriza (pessoa): nome e contato, para mandar o link.
  responsavel_nome      text,
  responsavel_contato   text,
  quem_atende           text not null default 'humano',
  periodo_dias          integer not null default 90,
  tipo                  text not null default 'unico',
  abre                  time not null default '08:00',
  fecha                 time not null default '18:00',
  sabado_ate            time default '13:00',
  -- A empresa da MIA, quando já é cliente. Apagar a empresa solta o raio-X.
  organization_id       uuid references public.organizations(id) on delete set null,
  teto_centavos         integer not null default 4000,
  situacao              text not null default 'aguardando',
  -- O link de conexão: só o hash do código; a versão muda a cada "gerar outro".
  conexao_codigo_hash   text,
  conexao_versao        integer not null default 1,
  conexao_expira_em     timestamptz,
  -- A sessão no leitor do raio-X (o contêiner próprio). Nasce no aceite.
  sessao                text,
  conectado_em          timestamptz,
  numero_conectado      text,
  -- O ciclo de leitura e análise: 1 no diagnóstico; o mensal soma um por mês.
  ciclo                 integer not null default 1,
  periodo_inicio        timestamptz,
  periodo_fim           timestamptz,
  competencia           date,
  -- O cursor e o andamento da leitura (jsonb: a forma está em lib/raio-x/leitura.ts).
  leitura               jsonb not null default '{}'::jsonb,
  leitura_concluida_em  timestamptz,
  analise               jsonb not null default '{}'::jsonb,
  -- A trava do agendador: duas chamadas do cron não andam o mesmo raio-X juntas.
  trava_ate             timestamptz,
  ultimo_relatorio_em   timestamptz,
  desconectar_em        timestamptz,
  desconectado_em       timestamptz,
  apagar_conversas_em   timestamptz,
  conversas_apagadas_em timestamptz,
  encerrado_em          timestamptz,
  encerrado_por         uuid references auth.users(id) on delete set null,
  criado_por            uuid references auth.users(id) on delete set null,
  criado_via            text not null default 'tela',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_empresa') then
    alter table public.mia_raio_x add constraint mia_raio_x_empresa check (length(btrim(empresa)) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_segmento') then
    alter table public.mia_raio_x add constraint mia_raio_x_segmento
      check (segmento in ('revenda_de_veiculos', 'clinica_odontologica', 'clinica_de_estetica', 'academia',
                          'imobiliaria', 'loja_e_varejo', 'outro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_whatsapp') then
    alter table public.mia_raio_x add constraint mia_raio_x_whatsapp check (whatsapp ~ '^[1-9][0-9]{9,14}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_quem_atende') then
    alter table public.mia_raio_x add constraint mia_raio_x_quem_atende check (quem_atende in ('humano', 'agente', 'misto'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_periodo') then
    alter table public.mia_raio_x add constraint mia_raio_x_periodo check (periodo_dias in (30, 60, 90));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_tipo') then
    alter table public.mia_raio_x add constraint mia_raio_x_tipo check (tipo in ('unico', 'mensal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_horario') then
    alter table public.mia_raio_x add constraint mia_raio_x_horario
      check (fecha > abre and (sabado_ate is null or sabado_ate > abre));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_teto') then
    alter table public.mia_raio_x add constraint mia_raio_x_teto check (teto_centavos between 500 and 50000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_situacao') then
    alter table public.mia_raio_x add constraint mia_raio_x_situacao
      check (situacao in ('aguardando', 'conectando', 'lendo', 'analisando', 'pronto', 'encerrado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_codigo_hash_formato') then
    -- Só o HMAC em hex: um código cru gravado por engano é recusado (23514).
    alter table public.mia_raio_x add constraint mia_raio_x_codigo_hash_formato
      check (conexao_codigo_hash is null or conexao_codigo_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_sessao_formato') then
    alter table public.mia_raio_x add constraint mia_raio_x_sessao_formato
      check (sessao is null or sessao ~ '^raiox_[0-9a-f]{12,32}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_criado_via') then
    alter table public.mia_raio_x add constraint mia_raio_x_criado_via check (criado_via in ('tela', 'mcp_plataforma'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_ciclo') then
    alter table public.mia_raio_x add constraint mia_raio_x_ciclo check (ciclo >= 1);
  end if;
end $$;

comment on table public.mia_raio_x is
  'MIA (9150): o raio-X do atendimento de uma empresa (ferramenta da plataforma; a empresa nao precisa ser cliente da MIA). O cadastro, a situacao, o link de conexao (so o hash, 48 h), a sessao do leitor, o cursor da leitura e os prazos (desconectar 7 dias depois do relatorio no diagnostico unico; apagar as conversas 30 dias depois). Servidor apenas: RLS sem politica, grants revogados de anon e authenticated.';
comment on column public.mia_raio_x.whatsapp is
  'MIA (9150): o WhatsApp COMERCIAL da empresa em digitos E.164. Dado da empresa, nao de cliente dela; e a chave de "mesma empresa" para comparar com o raio-X anterior (com organization_id, quando ligado).';
comment on column public.mia_raio_x.responsavel_nome is
  'MIA (9150): quem autoriza, como a Time cadastrou (pessoa). O nome de quem de fato aceitou o termo fica em mia_raio_x_aceites.';
comment on column public.mia_raio_x.conexao_codigo_hash is
  'MIA (9150): HMAC-SHA256 em hex do codigo de 8 letras do link de conexao (/raio-x/<codigo>). O codigo cru nunca e gravado; o servidor o deriva do id e de conexao_versao.';
comment on column public.mia_raio_x.leitura is
  'MIA (9150): o cursor da leitura (posicao da conversa, offset das mensagens, desde), a estabilizacao do historico que chega em partes depois do pareamento e o andamento (conversas e mensagens lidas). Sem telefone.';

create unique index if not exists mia_raio_x_codigo_idx
  on public.mia_raio_x (conexao_codigo_hash) where conexao_codigo_hash is not null;
create unique index if not exists mia_raio_x_sessao_idx
  on public.mia_raio_x (sessao) where sessao is not null;
create index if not exists mia_raio_x_whatsapp_idx on public.mia_raio_x (whatsapp, created_at desc);
create index if not exists mia_raio_x_org_idx on public.mia_raio_x (organization_id) where organization_id is not null;
create index if not exists mia_raio_x_situacao_idx on public.mia_raio_x (situacao, updated_at);

drop trigger if exists trg_mia_raio_x_touch on public.mia_raio_x;
create trigger trg_mia_raio_x_touch
  before update on public.mia_raio_x
  for each row execute function public.fn_set_updated_at();

-- ── 2. o aceite do termo ────────────────────────────────────────────────────
create table if not exists public.mia_raio_x_aceites (
  id           uuid primary key default gen_random_uuid(),
  raio_x_id    uuid not null references public.mia_raio_x(id) on delete cascade,
  nome         text not null,
  termo_versao text not null,
  -- O texto INTEIRO que a pessoa leu, com a empresa, o número e o período.
  termo_texto  text not null,
  termo_hash   text not null,
  aceito_em    timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_aceites_nome') then
    alter table public.mia_raio_x_aceites add constraint mia_raio_x_aceites_nome check (length(btrim(nome)) between 2 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_aceites_hash') then
    alter table public.mia_raio_x_aceites add constraint mia_raio_x_aceites_hash check (termo_hash ~ '^[0-9a-f]{64}$');
  end if;
end $$;

comment on table public.mia_raio_x_aceites is
  'MIA (9150): o aceite do termo do raio-X (decisao 6): nome de quem aceitou, data e hora, versao e o texto inteiro aceito (com o hash SHA-256). O dono e o controlador; a Time, a operadora. Servidor apenas.';

create index if not exists mia_raio_x_aceites_idx on public.mia_raio_x_aceites (raio_x_id, aceito_em desc);

-- ── 3. as conversas (uma por cliente) ───────────────────────────────────────
create table if not exists public.mia_raio_x_conversas (
  id              uuid primary key default gen_random_uuid(),
  raio_x_id       uuid not null references public.mia_raio_x(id) on delete cascade,
  -- HMAC do id do chat: o mesmo cliente tem a mesma marca nas leituras do raio-X.
  chat_marca      text not null,
  -- O id do chat e o nome de perfil, CIFRADOS (AES-GCM), só para baixar áudio
  -- e tirar o nome dos trechos. Apagados com a conversa.
  referencia      text,
  numero_ordem    integer not null,
  anuncio         boolean not null default false,
  ultima_em       timestamptz,
  -- O ciclo em que a análise do modelo foi feita (o mensal analisa de novo a cada mês).
  analise_ciclo   integer,
  analise         jsonb,
  fora_do_teto    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_conversas_marca') then
    alter table public.mia_raio_x_conversas add constraint mia_raio_x_conversas_marca check (chat_marca ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_conversas_unica') then
    alter table public.mia_raio_x_conversas add constraint mia_raio_x_conversas_unica unique (raio_x_id, chat_marca);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_conversas_ordem') then
    alter table public.mia_raio_x_conversas add constraint mia_raio_x_conversas_ordem unique (raio_x_id, numero_ordem);
  end if;
end $$;

comment on table public.mia_raio_x_conversas is
  'MIA (9150): uma conversa 1:1 lida pelo raio-X. O cliente e a marca (HMAC do chat) e o numero de ordem ("Cliente 0187"), nunca o telefone. A referencia cifrada (chat e nome de perfil) so serve para baixar audio e anonimizar os trechos, e some com a conversa 30 dias depois do relatorio. Servidor apenas.';

drop trigger if exists trg_mia_raio_x_conversas_touch on public.mia_raio_x_conversas;
create trigger trg_mia_raio_x_conversas_touch
  before update on public.mia_raio_x_conversas
  for each row execute function public.fn_set_updated_at();

-- ── 4. as mensagens (TRANSITÓRIAS) ──────────────────────────────────────────
create table if not exists public.mia_raio_x_mensagens (
  id              bigint generated always as identity primary key,
  raio_x_id       uuid not null references public.mia_raio_x(id) on delete cascade,
  conversa_id     uuid not null references public.mia_raio_x_conversas(id) on delete cascade,
  -- HMAC do id da mensagem: a leitura refeita não grava duas vezes.
  marca           text not null,
  da_loja         boolean not null,
  enviada_em      timestamptz not null,
  tipo            text not null,
  texto           text,
  segundos        integer,
  -- Só no áudio: o id da mensagem CIFRADO, para pedir o arquivo ao leitor.
  midia           text,
  transcricao     text not null default 'nao_se_aplica',
  anuncio         jsonb
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_mensagens_unica') then
    alter table public.mia_raio_x_mensagens add constraint mia_raio_x_mensagens_unica unique (raio_x_id, marca);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_mensagens_tipo') then
    alter table public.mia_raio_x_mensagens add constraint mia_raio_x_mensagens_tipo
      check (tipo in ('texto', 'audio', 'imagem', 'video', 'documento', 'figurinha', 'outro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_mensagens_transcricao') then
    alter table public.mia_raio_x_mensagens add constraint mia_raio_x_mensagens_transcricao
      check (transcricao in ('nao_se_aplica', 'pendente', 'feita', 'falhou', 'sem_servico', 'fora_do_teto'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_mensagens_midia_so_texto') then
    -- Foto, vídeo e documento são só CONTADOS: nunca guardam arquivo nem referência.
    alter table public.mia_raio_x_mensagens add constraint mia_raio_x_mensagens_midia_so_texto
      check (midia is null or tipo = 'audio');
  end if;
end $$;

comment on table public.mia_raio_x_mensagens is
  'MIA (9150): as mensagens lidas pelo raio-X, TRANSITORIAS: o texto (ou a transcricao do audio) que a analise le. Foto, video e documento so contam (sem arquivo). Apagadas com a conversa 30 dias depois do relatorio. Servidor apenas.';

create index if not exists mia_raio_x_mensagens_conversa_idx on public.mia_raio_x_mensagens (conversa_id, enviada_em);
create index if not exists mia_raio_x_mensagens_audio_idx
  on public.mia_raio_x_mensagens (raio_x_id, transcricao) where transcricao = 'pendente';

-- ── 5. o relatório (FICA) ───────────────────────────────────────────────────
create table if not exists public.mia_raio_x_relatorios (
  id                 uuid primary key default gen_random_uuid(),
  raio_x_id          uuid not null references public.mia_raio_x(id) on delete cascade,
  sequencia          integer not null,
  periodo_inicio     timestamptz not null,
  periodo_fim        timestamptz not null,
  competencia        date,
  situacao           text not null default 'rascunho',
  criterios_versao   text not null,
  dados              jsonb not null,
  comparacao         jsonb,
  anterior_id        uuid references public.mia_raio_x_relatorios(id) on delete set null,
  parcial            boolean not null default false,
  conversas          integer not null default 0,
  custo_usd_centavos numeric not null default 0,
  custo_centavos     numeric not null default 0,
  notas_da_time      text,
  revisado_por       uuid references auth.users(id) on delete set null,
  revisado_em        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_relatorios_sequencia') then
    alter table public.mia_raio_x_relatorios add constraint mia_raio_x_relatorios_sequencia unique (raio_x_id, sequencia);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_relatorios_situacao') then
    alter table public.mia_raio_x_relatorios add constraint mia_raio_x_relatorios_situacao check (situacao in ('rascunho', 'revisado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_relatorios_revisao') then
    -- Revisado tem quem revisou e quando; rascunho não tem.
    alter table public.mia_raio_x_relatorios add constraint mia_raio_x_relatorios_revisao
      check ((situacao = 'revisado') = (revisado_em is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_relatorios_periodo') then
    alter table public.mia_raio_x_relatorios add constraint mia_raio_x_relatorios_periodo check (periodo_fim > periodo_inicio);
  end if;
end $$;

comment on table public.mia_raio_x_relatorios is
  'MIA (9150): o relatorio do raio-X, que FICA guardado: so numeros somados, rotulos, os 10 trechos anonimizados (clientes por numero de ordem) e as recomendacoes. A versao dos criterios da nota, a comparacao com o anterior da mesma empresa, rascunho ou revisado (so o revisado gera link do dono) e o custo da analise (so para a Time). Servidor apenas.';

create index if not exists mia_raio_x_relatorios_raio_x_idx on public.mia_raio_x_relatorios (raio_x_id, sequencia desc);

drop trigger if exists trg_mia_raio_x_relatorios_touch on public.mia_raio_x_relatorios;
create trigger trg_mia_raio_x_relatorios_touch
  before update on public.mia_raio_x_relatorios
  for each row execute function public.fn_set_updated_at();

-- ── 6. o link do dono (molde da 9031) ───────────────────────────────────────
create table if not exists public.mia_raio_x_links (
  id           uuid primary key default gen_random_uuid(),
  relatorio_id uuid not null references public.mia_raio_x_relatorios(id) on delete cascade,
  token_hash   text not null,
  expires_at   timestamptz not null default (now() + interval '30 days'),
  revoked_at   timestamptz,
  revoked_by   uuid references auth.users(id) on delete set null,
  last_used_at timestamptz,
  acessos      integer not null default 0,
  created_by   uuid references auth.users(id) on delete set null,
  created_via  text not null default 'tela',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_links_token_hash_formato') then
    alter table public.mia_raio_x_links add constraint mia_raio_x_links_token_hash_formato check (token_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_links_validade') then
    alter table public.mia_raio_x_links add constraint mia_raio_x_links_validade check (expires_at > created_at);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_links_acessos') then
    alter table public.mia_raio_x_links add constraint mia_raio_x_links_acessos check (acessos >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_links_created_via') then
    alter table public.mia_raio_x_links add constraint mia_raio_x_links_created_via check (created_via in ('tela', 'mcp_plataforma'));
  end if;
end $$;

comment on table public.mia_raio_x_links is
  'MIA (9150): o link do relatorio para o dono (/raio-x/relatorio/<token>), molde da 9031: so o hash do token, validade, revogacao e quantos acessos (sem identificar a pessoa). Sem custo nem o bloco da MIA. Servidor apenas.';

create unique index if not exists mia_raio_x_links_token_hash_idx on public.mia_raio_x_links (token_hash);
create index if not exists mia_raio_x_links_relatorio_idx on public.mia_raio_x_links (relatorio_id, created_at desc);

drop trigger if exists trg_mia_raio_x_links_touch on public.mia_raio_x_links;
create trigger trg_mia_raio_x_links_touch
  before update on public.mia_raio_x_links
  for each row execute function public.fn_set_updated_at();

-- ── 7. o gasto de IA da plataforma ──────────────────────────────────────────
create table if not exists public.mia_raio_x_gastos (
  id                 uuid primary key default gen_random_uuid(),
  raio_x_id          uuid not null references public.mia_raio_x(id) on delete cascade,
  ciclo              integer not null default 1,
  proposito          text not null,
  modelo             text not null,
  tokens_entrada     integer not null default 0,
  tokens_saida       integer not null default 0,
  segundos_de_audio  integer not null default 0,
  custo_usd_centavos numeric not null,
  -- `true` = o provedor não informou o custo e ele saiu da tabela de preço (áudio).
  estimado           boolean not null default false,
  cotacao            numeric not null,
  custo_centavos     numeric not null,
  created_at         timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_gastos_proposito') then
    alter table public.mia_raio_x_gastos add constraint mia_raio_x_gastos_proposito
      check (proposito in ('raio_x_analise', 'raio_x_transcricao'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_raio_x_gastos_valores') then
    alter table public.mia_raio_x_gastos add constraint mia_raio_x_gastos_valores
      check (custo_usd_centavos >= 0 and custo_centavos >= 0 and cotacao > 0);
  end if;
end $$;

comment on table public.mia_raio_x_gastos is
  'MIA (9150): o gasto de IA da PLATAFORMA com cada raio-X, uma linha por chamada (proposito raio_x_analise ou raio_x_transcricao), em dolar e em real pela cotacao do dia. A soma em real e o que o teto do raio-X confere. Sem conteudo de conversa. Servidor apenas.';

create index if not exists mia_raio_x_gastos_idx on public.mia_raio_x_gastos (raio_x_id, ciclo);

-- ── 8. só o servidor ────────────────────────────────────────────────────────
-- Sem política nenhuma, a RLS nega tudo a quem não a ignora; os grants
-- revogados fazem a leitura pela sessão dar `permission denied`.
alter table public.mia_raio_x enable row level security;
alter table public.mia_raio_x_aceites enable row level security;
alter table public.mia_raio_x_conversas enable row level security;
alter table public.mia_raio_x_mensagens enable row level security;
alter table public.mia_raio_x_relatorios enable row level security;
alter table public.mia_raio_x_links enable row level security;
alter table public.mia_raio_x_gastos enable row level security;

revoke all on public.mia_raio_x from public, anon, authenticated;
revoke all on public.mia_raio_x_aceites from public, anon, authenticated;
revoke all on public.mia_raio_x_conversas from public, anon, authenticated;
revoke all on public.mia_raio_x_mensagens from public, anon, authenticated;
revoke all on public.mia_raio_x_relatorios from public, anon, authenticated;
revoke all on public.mia_raio_x_links from public, anon, authenticated;
revoke all on public.mia_raio_x_gastos from public, anon, authenticated;

grant select, insert, update, delete on public.mia_raio_x to service_role;
grant select, insert, update, delete on public.mia_raio_x_aceites to service_role;
grant select, insert, update, delete on public.mia_raio_x_conversas to service_role;
grant select, insert, update, delete on public.mia_raio_x_mensagens to service_role;
grant select, insert, update, delete on public.mia_raio_x_relatorios to service_role;
grant select, insert, update, delete on public.mia_raio_x_links to service_role;
grant select, insert, update, delete on public.mia_raio_x_gastos to service_role;
grant usage, select on sequence public.mia_raio_x_mensagens_id_seq to service_role;

-- ── 9. as funções (só a plataforma executa) ─────────────────────────────────

-- O número de ordem nasce numa escrita só: a próxima conversa de um raio-X é a
-- maior + 1. Devolve o id e o número (a conversa que já existia devolve os dela).
-- A trava por raio-X (`pg_advisory_xact_lock`) serializa duas leituras simultâneas.
create or replace function public.fn_mia_raio_x_conversa(p_raio_x uuid, p_marca text, p_referencia text, p_ultima_em timestamptz)
returns table (id uuid, numero_ordem integer)
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('mia_raio_x_conversa:' || p_raio_x::text, 0));
  return query
    with atualizada as (
      update public.mia_raio_x_conversas c
         set referencia = coalesce(p_referencia, c.referencia),
             ultima_em = greatest(c.ultima_em, p_ultima_em)
       where c.raio_x_id = p_raio_x and c.chat_marca = p_marca
      returning c.id, c.numero_ordem
    )
    select a.id, a.numero_ordem from atualizada a;
  if found then
    return;
  end if;
  return query
    with criada as (
      insert into public.mia_raio_x_conversas as n (raio_x_id, chat_marca, referencia, numero_ordem, ultima_em)
      select p_raio_x, p_marca, p_referencia,
             coalesce((select max(x.numero_ordem) from public.mia_raio_x_conversas x where x.raio_x_id = p_raio_x), 0) + 1,
             p_ultima_em
      returning n.id, n.numero_ordem
    )
    select k.id, k.numero_ordem from criada k;
end;
$$;

comment on function public.fn_mia_raio_x_conversa(uuid, text, text, timestamptz) is
  'MIA (9150): acha ou cria a conversa de um raio-X pela marca do chat e da o numero de ordem (o maior + 1, com trava por raio-X). Execucao so para service_role.';

revoke all on function public.fn_mia_raio_x_conversa(uuid, text, text, timestamptz) from public;
revoke execute on function public.fn_mia_raio_x_conversa(uuid, text, text, timestamptz) from anon, authenticated;
grant execute on function public.fn_mia_raio_x_conversa(uuid, text, text, timestamptz) to service_role;

-- O acesso ao link do dono: mais um e a hora, numa escrita só, e só em link vivo.
create or replace function public.fn_mia_raio_x_link_acessado(p_id uuid)
returns boolean
language sql
volatile
set search_path = ''
as $f$
  with marcado as (
    update public.mia_raio_x_links
       set acessos = acessos + 1,
           last_used_at = now()
     where id = p_id
       and revoked_at is null
       and expires_at > now()
    returning 1
  )
  select exists (select 1 from marcado);
$f$;

comment on function public.fn_mia_raio_x_link_acessado(uuid) is
  'MIA (9150): conta um acesso ao link do relatorio do raio-X (acessos + 1, last_used_at agora), so se o link estiver vivo. Execucao so para service_role.';

revoke all on function public.fn_mia_raio_x_link_acessado(uuid) from public;
revoke execute on function public.fn_mia_raio_x_link_acessado(uuid) from anon, authenticated;
grant execute on function public.fn_mia_raio_x_link_acessado(uuid) to service_role;

-- O prazo de 30 dias: apaga as mensagens e as conversas de um raio-X (a
-- referência cifrada vai junto) e carimba. O relatório, o aceite e o gasto FICAM.
-- Com `p_antes_de`, apaga só as mensagens anteriores a ele (o mensal, que segue
-- conectado), e as conversas ficam para o número de ordem continuar o mesmo.
create or replace function public.fn_mia_raio_x_expurgar_conversas(p_raio_x uuid, p_antes_de timestamptz default null)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_mensagens integer;
  v_conversas integer := 0;
begin
  if p_antes_de is null then
    delete from public.mia_raio_x_mensagens where raio_x_id = p_raio_x;
    get diagnostics v_mensagens = row_count;
    delete from public.mia_raio_x_conversas where raio_x_id = p_raio_x;
    get diagnostics v_conversas = row_count;
    update public.mia_raio_x
       set conversas_apagadas_em = now(),
           leitura = '{}'::jsonb,
           analise = '{}'::jsonb
     where id = p_raio_x;
  else
    delete from public.mia_raio_x_mensagens where raio_x_id = p_raio_x and enviada_em < p_antes_de;
    get diagnostics v_mensagens = row_count;
  end if;
  return jsonb_build_object('mensagens', v_mensagens, 'conversas', v_conversas);
end;
$$;

comment on function public.fn_mia_raio_x_expurgar_conversas(uuid, timestamptz) is
  'MIA (9150): apaga as mensagens e as conversas lidas de um raio-X (prazo de 30 dias; o relatorio, o aceite e o gasto ficam). Com p_antes_de, so as mensagens anteriores (o mensal). Execucao so para service_role.';

revoke all on function public.fn_mia_raio_x_expurgar_conversas(uuid, timestamptz) from public;
revoke execute on function public.fn_mia_raio_x_expurgar_conversas(uuid, timestamptz) from anon, authenticated;
grant execute on function public.fn_mia_raio_x_expurgar_conversas(uuid, timestamptz) to service_role;

notify pgrst, 'reload schema';
