-- manifest: O MONTADOR DE RELATÓRIOS (item 9 do mapa de produção, protótipo aprovado em 15/10/2026 sem comentário), a parte que GUARDA. Quatro tabelas NOSSAS: `mia_relatorios` (o relatório salvo: fonte, medida, até dois agrupamentos, filtros, período, comparação e visualização, mais quem criou, se é compartilhado com a equipe, de qual pronto ou de qual relatório é cópia, por onde nasceu e uma chave natural para quem garante sem duplicar), `mia_paineis_usuario` (o painel montado pela pessoa, com o período do painel) e `mia_paineis_usuario_itens` (cada relatório do painel, salvo ou pronto, com tamanho P/M/G, período próprio e posição fracionária), `mia_relatorios_exportacoes` (o registro de cada planilha exportada: quem, quando, o quê, quantas linhas; só gestor e administrador leem e gravam, e ninguém altera nem apaga) e `mia_relatorios_da_empresa` (o funil dos relatórios prontos da empresa, que a implantação liga). RLS conforme as decisões do protótipo: todo membro cria os próprios; o relatório só da pessoa não aparece para ninguém mais (nem para o administrador); o compartilhado aparece para a equipe; só gestor e administrador compartilham (gatilho `fn_mia_relatorios_quem_compartilha`, que recusa com 42501 a passagem de "só meu" para "compartilhado" vinda de quem não é gestor); quem criou e o administrador editam e apagam o compartilhado, os outros copiam. Dono e empresa não mudam depois de criados. Chaves estrangeiras compostas por empresa (o item do painel e a cópia nunca cruzam empresa). Nenhum objeto do upstream é redefinido. Provado em tests/invariants/montador-de-relatorios.test.ts.
--
-- 9040 · os relatórios salvos, os painéis do usuário e o registro das exportações
--
-- `mia`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `create
-- table if not exists`, as constraints dentro de `do` que conferem o catálogo,
-- `create index if not exists`, `drop trigger/policy if exists`.
--
-- ── O que é de quem (as decisões do protótipo, "Quem vê e quem faz") ────────
--
--   criar            todo membro, os próprios ("criar não muda nada para ninguém")
--   compartilhar     gestor e administrador ("compartilhar muda o que a equipe
--                    inteira olha")
--   editar e apagar  o compartilhado: quem criou e o administrador; os outros
--                    veem e copiam ("evita que alguém mude, sem querer, o número
--                    que a equipe acompanha")
--   ver              o próprio e o compartilhado; o "só para mim" de outra pessoa
--                    não aparece para ninguém
--   exportar         gestor e administrador, e cada exportação fica registrada
--
-- O NÚMERO que cada um vê dentro de um relatório não mora aqui: é o motor
-- (`fn_mia_relatorio`, 9030), `security invoker`, que conta só o que a RLS de
-- cada tabela de origem deixa a pessoa ver no CRM. Um relatório compartilhado
-- aberto pelo atendente mostra os números dele.
--
-- ── O relatório PRONTO ──────────────────────────────────────────────────────
--
-- Os doze prontos são referência da plataforma e moram no código
-- (`lib/relatorios/prontos.ts`), não aqui: "o original não muda e continua
-- igual para todos". Copiar um pronto grava uma linha em `mia_relatorios` com
-- `pronto_de`; o item de painel pode apontar para um pronto pela chave.

-- ── 1. o relatório salvo ────────────────────────────────────────────────────

create table if not exists public.mia_relatorios (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome            text not null,
  fonte           text not null,
  medida          text not null,
  dim1            text,
  dim2            text,
  filtros         jsonb not null default '{}'::jsonb,
  periodo         text not null default '30',
  de              date,
  ate             date,
  comparar        boolean not null default false,
  visualizacao    text not null default 'barras',
  pronto_de       text,
  copiado_de      uuid,
  compartilhado   boolean not null default false,
  chave           text,
  criado_via      text not null default 'tela',
  created_by      uuid references auth.users(id) on delete set null,
  updated_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.mia_relatorios is
  'MIA (9040): os relatorios do montador (item 9). A configuracao (fonte, medida, agrupamentos, filtros, periodo, comparacao, visualizacao) que o motor fn_mia_relatorio calcula. Quem criou, se e compartilhado com a equipe, de qual pronto (pronto_de) ou relatorio (copiado_de) e copia. RLS: o proprio e o compartilhado; so gestor e administrador compartilham; o compartilhado, so quem criou e o administrador editam.';
comment on column public.mia_relatorios.filtros is
  'MIA (9040): os filtros como o motor os recebe: um valor por chave, ou uma lista de valores (qualquer um deles passa); "__sem" pede a ausencia ("Sem responsavel").';
comment on column public.mia_relatorios.chave is
  'MIA (9040): a chave natural de quem GARANTE (o MCP de plataforma, a semente da demonstracao): rodar de novo atualiza a mesma linha em vez de duplicar. Nula no relatorio feito na tela.';
comment on column public.mia_relatorios.pronto_de is
  'MIA (9040): a chave do relatorio pronto (lib/relatorios/prontos.ts) de que este e copia. O pronto em si nao muda.';

-- A configuração bate com o catálogo do motor? Imutável (o catálogo é uma
-- constante), para caber no CHECK. O motor confere de novo a cada conta; aqui
-- é para nunca gravar um relatório que nem abre.
create or replace function public.fn_mia_relatorio_config_valida(
  p_fonte text,
  p_medida text,
  p_dim1 text,
  p_dim2 text,
  p_filtros jsonb
) returns boolean
language sql
immutable
set search_path = ''
as $f$
  with c as (select public.fn_mia_relatorio_catalogo() -> p_fonte as f)
  select coalesce((
    select c.f is not null
       and left(coalesce(p_fonte, '_'), 1) <> '_'
       and (c.f -> 'medidas') ? p_medida
       and p_medida not in ('chegaram', 'sem_prob')
       and (p_dim1 is null or (c.f -> 'dims') ? p_dim1)
       and (p_dim2 is null or (p_dim1 is not null and p_dim2 <> p_dim1 and (c.f -> 'dims') ? p_dim2))
       and jsonb_typeof(coalesce(p_filtros, '{}'::jsonb)) = 'object'
       and not exists (
         select 1 from jsonb_object_keys(coalesce(p_filtros, '{}'::jsonb)) k
          where not (c.f -> 'filtros') ? k
       )
    from c
  ), false);
$f$;

comment on function public.fn_mia_relatorio_config_valida(text, text, text, text, jsonb) is
  'MIA (9040): a configuracao de um relatorio salvo cabe no catalogo do motor (fn_mia_relatorio_catalogo)? Usada no CHECK de mia_relatorios. chegaram e sem_prob nao sao medida de relatorio: o funil pede chegaram sozinho, e sem_prob e conta auxiliar da previsao.';

revoke all on function public.fn_mia_relatorio_config_valida(text, text, text, text, jsonb) from public;
revoke execute on function public.fn_mia_relatorio_config_valida(text, text, text, text, jsonb) from anon;
grant execute on function public.fn_mia_relatorio_config_valida(text, text, text, text, jsonb) to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_org_id_key') then
    alter table public.mia_relatorios
      add constraint mia_relatorios_org_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_nome') then
    alter table public.mia_relatorios
      add constraint mia_relatorios_nome check (length(btrim(nome)) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_config') then
    alter table public.mia_relatorios
      add constraint mia_relatorios_config
      check (public.fn_mia_relatorio_config_valida(fonte, medida, dim1, dim2, filtros));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_periodo') then
    alter table public.mia_relatorios
      add constraint mia_relatorios_periodo
      check (periodo in ('hoje', '7', '30', '90', 'mes', 'mesp', 'pers')
             and (periodo <> 'pers' or (de is not null and ate is not null)));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_visualizacao') then
    alter table public.mia_relatorios
      add constraint mia_relatorios_visualizacao
      check (visualizacao in ('barras', 'linha', 'rosca', 'numero', 'funil', 'tabela'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_pronto_de') then
    alter table public.mia_relatorios
      add constraint mia_relatorios_pronto_de
      check (pronto_de is null
             or pronto_de = any (array['resultado', 'meta', 'funil', 'origem', 'perdas', 'atendimento',
                                       'resposta', 'agenda', 'followup', 'anuncios', 'previsao', 'assuntos']));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_criado_via') then
    alter table public.mia_relatorios
      add constraint mia_relatorios_criado_via
      check (criado_via in ('tela', 'mcp_plataforma', 'demonstracao'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_chave') then
    alter table public.mia_relatorios
      add constraint mia_relatorios_chave
      check (chave is null or chave ~ '^[a-z0-9][a-z0-9:_-]{0,79}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_copiado_de_da_empresa') then
    -- A cópia aponta para um relatório da MESMA empresa; apagar o original
    -- solta a cópia (ela é dela agora).
    alter table public.mia_relatorios
      add constraint mia_relatorios_copiado_de_da_empresa
      foreign key (organization_id, copiado_de)
      references public.mia_relatorios (organization_id, id)
      on delete set null (copiado_de);
  end if;
end $$;

create unique index if not exists mia_relatorios_chave_idx
  on public.mia_relatorios (organization_id, chave) where chave is not null;
create index if not exists mia_relatorios_org_idx
  on public.mia_relatorios (organization_id, updated_at desc);
create index if not exists mia_relatorios_dono_idx
  on public.mia_relatorios (organization_id, created_by);

-- ── 2. o painel do usuário e os itens dele ──────────────────────────────────

create table if not exists public.mia_paineis_usuario (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome            text not null,
  periodo         text not null default '30',
  compartilhado   boolean not null default false,
  chave           text,
  criado_via      text not null default 'tela',
  created_by      uuid references auth.users(id) on delete set null,
  updated_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.mia_paineis_usuario is
  'MIA (9040): o painel montado pela pessoa: relatorios salvos e prontos lado a lado (mia_paineis_usuario_itens), com o periodo do painel. As mesmas regras do relatorio: so gestor e administrador compartilham; o compartilhado, so quem criou e o administrador editam.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_usuario_org_id_key') then
    alter table public.mia_paineis_usuario
      add constraint mia_paineis_usuario_org_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_usuario_nome') then
    alter table public.mia_paineis_usuario
      add constraint mia_paineis_usuario_nome check (length(btrim(nome)) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_usuario_periodo') then
    alter table public.mia_paineis_usuario
      add constraint mia_paineis_usuario_periodo check (periodo in ('7', '30', '90', 'mes', 'mesp'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_usuario_criado_via') then
    alter table public.mia_paineis_usuario
      add constraint mia_paineis_usuario_criado_via
      check (criado_via in ('tela', 'mcp_plataforma', 'demonstracao'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_usuario_chave') then
    alter table public.mia_paineis_usuario
      add constraint mia_paineis_usuario_chave
      check (chave is null or chave ~ '^[a-z0-9][a-z0-9:_-]{0,79}$');
  end if;
end $$;

create unique index if not exists mia_paineis_usuario_chave_idx
  on public.mia_paineis_usuario (organization_id, chave) where chave is not null;
create index if not exists mia_paineis_usuario_org_idx
  on public.mia_paineis_usuario (organization_id, updated_at desc);

create table if not exists public.mia_paineis_usuario_itens (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  painel_id       uuid not null,
  relatorio_id    uuid,
  pronto          text,
  tamanho         text not null default 'M',
  periodo_proprio boolean not null default false,
  -- Indexação fracionária, como `position_in_stage` (CLAUDE.md): reordenar é
  -- gravar UM item, nunca renumerar a lista.
  posicao         numeric not null,
  created_at      timestamptz not null default now()
);

comment on table public.mia_paineis_usuario_itens is
  'MIA (9040): cada relatorio de um painel do usuario: um salvo (relatorio_id) ou um pronto (pronto), com tamanho P (um quarto da linha), M (metade) ou G (a linha inteira), periodo proprio (nao segue o periodo do painel) e posicao fracionaria.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_usuario_itens_painel') then
    alter table public.mia_paineis_usuario_itens
      add constraint mia_paineis_usuario_itens_painel
      foreign key (organization_id, painel_id)
      references public.mia_paineis_usuario (organization_id, id)
      on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_usuario_itens_relatorio') then
    -- Apagar o relatório tira-o dos painéis.
    alter table public.mia_paineis_usuario_itens
      add constraint mia_paineis_usuario_itens_relatorio
      foreign key (organization_id, relatorio_id)
      references public.mia_relatorios (organization_id, id)
      on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_usuario_itens_um_alvo') then
    alter table public.mia_paineis_usuario_itens
      add constraint mia_paineis_usuario_itens_um_alvo
      check (num_nonnulls(relatorio_id, pronto) = 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_usuario_itens_pronto') then
    alter table public.mia_paineis_usuario_itens
      add constraint mia_paineis_usuario_itens_pronto
      check (pronto is null
             or pronto = any (array['resultado', 'meta', 'funil', 'origem', 'perdas', 'atendimento',
                                    'resposta', 'agenda', 'followup', 'anuncios', 'previsao', 'assuntos']));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_usuario_itens_tamanho') then
    alter table public.mia_paineis_usuario_itens
      add constraint mia_paineis_usuario_itens_tamanho check (tamanho in ('P', 'M', 'G'));
  end if;
end $$;

-- O mesmo relatório não entra duas vezes no mesmo painel.
create unique index if not exists mia_paineis_usuario_itens_unico_idx
  on public.mia_paineis_usuario_itens (painel_id, coalesce(relatorio_id::text, pronto));
create index if not exists mia_paineis_usuario_itens_ordem_idx
  on public.mia_paineis_usuario_itens (painel_id, posicao);
create index if not exists mia_paineis_usuario_itens_relatorio_idx
  on public.mia_paineis_usuario_itens (relatorio_id) where relatorio_id is not null;

-- ── 3. o registro das exportações ───────────────────────────────────────────

create table if not exists public.mia_relatorios_exportacoes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  tipo            text not null,
  relatorio_id    uuid,
  pronto          text,
  relatorio_nome  text not null,
  grupo           text,
  fonte           text not null,
  linhas          integer not null,
  separador       text not null,
  criado_via      text not null default 'tela',
  created_at      timestamptz not null default now()
);

comment on table public.mia_relatorios_exportacoes is
  'MIA (9040): cada planilha exportada do montador: quem (user_id), quando, o que (relatorio, e o grupo quando e a lista por tras de um numero), quantas linhas e o separador. So gestor e administrador leem e gravam; ninguem altera nem apaga (append-only).';
comment on column public.mia_relatorios_exportacoes.grupo is
  'MIA (9040): o rotulo do grupo da lista exportada ("Meta", "Preco", o nome de uma etapa). Nulo na planilha do relatorio (numeros somados).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_exportacoes_tipo') then
    alter table public.mia_relatorios_exportacoes
      add constraint mia_relatorios_exportacoes_tipo check (tipo in ('relatorio', 'lista'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_exportacoes_nome') then
    alter table public.mia_relatorios_exportacoes
      add constraint mia_relatorios_exportacoes_nome
      check (length(btrim(relatorio_nome)) between 1 and 200 and (grupo is null or length(grupo) <= 200));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_exportacoes_linhas') then
    alter table public.mia_relatorios_exportacoes
      add constraint mia_relatorios_exportacoes_linhas check (linhas >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_exportacoes_separador') then
    alter table public.mia_relatorios_exportacoes
      add constraint mia_relatorios_exportacoes_separador check (separador in (';', ','));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_exportacoes_fonte') then
    alter table public.mia_relatorios_exportacoes
      add constraint mia_relatorios_exportacoes_fonte
      check (fonte in ('negocios', 'conversas', 'contatos', 'agenda', 'followup', 'obrigacoes', 'anuncios'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_exportacoes_criado_via') then
    alter table public.mia_relatorios_exportacoes
      add constraint mia_relatorios_exportacoes_criado_via check (criado_via in ('tela', 'mcp_plataforma'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_exportacoes_relatorio') then
    alter table public.mia_relatorios_exportacoes
      add constraint mia_relatorios_exportacoes_relatorio
      foreign key (organization_id, relatorio_id)
      references public.mia_relatorios (organization_id, id)
      on delete set null (relatorio_id);
  end if;
end $$;

create index if not exists mia_relatorios_exportacoes_org_idx
  on public.mia_relatorios_exportacoes (organization_id, created_at desc);

-- ── 4. o funil dos relatórios prontos ───────────────────────────────────────

create table if not exists public.mia_relatorios_da_empresa (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  pipeline_id     uuid,
  updated_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now()
);

comment on table public.mia_relatorios_da_empresa is
  'MIA (9040): a preferencia da empresa para os relatorios prontos: o funil a que eles se ligam (a implantacao liga ao funil do segmento). Sem linha, ou com o funil apagado, vale o funil principal.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_relatorios_da_empresa_funil') then
    alter table public.mia_relatorios_da_empresa
      add constraint mia_relatorios_da_empresa_funil
      foreign key (organization_id, pipeline_id)
      references public.crm_pipelines (organization_id, id)
      on delete set null (pipeline_id);
  end if;
end $$;

-- ── 5. os gatilhos ──────────────────────────────────────────────────────────

drop trigger if exists trg_mia_relatorios_touch on public.mia_relatorios;
create trigger trg_mia_relatorios_touch
  before update on public.mia_relatorios
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_mia_paineis_usuario_touch on public.mia_paineis_usuario;
create trigger trg_mia_paineis_usuario_touch
  before update on public.mia_paineis_usuario
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_mia_relatorios_da_empresa_touch on public.mia_relatorios_da_empresa;
create trigger trg_mia_relatorios_da_empresa_touch
  before update on public.mia_relatorios_da_empresa
  for each row execute function public.fn_set_updated_at();

-- Quem compartilha, e o que não muda. Vale para o relatório e para o painel
-- (as duas tabelas têm as mesmas colunas de autoria).
--
-- - Na sessão de alguém, o dono é quem cria: `created_by` vira `auth.uid()`.
-- - A passagem de "só meu" para "compartilhado" é de gestor e administrador
--   (42501 para os outros). Quem já está compartilhado e é editado por quem
--   criou ou pelo administrador continua compartilhado sem perguntar de novo.
-- - Empresa e dono não mudam depois de criados.
-- - A plataforma (`service_role`, sem `auth.uid()`: o MCP e a semente) grava o
--   dono que resolveu no servidor.
create or replace function public.fn_mia_relatorios_quem_compartilha()
returns trigger
language plpgsql
set search_path = ''
as $f$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else
    if new.organization_id is distinct from old.organization_id then
      raise exception 'a_empresa_nao_muda' using errcode = '42501';
    end if;
    if new.created_by is distinct from old.created_by then
      raise exception 'o_dono_nao_muda' using errcode = '42501';
    end if;
    if auth.uid() is not null then
      new.updated_by := auth.uid();
    end if;
  end if;
  if new.compartilhado
     and (tg_op = 'INSERT' or not old.compartilhado)
     and auth.uid() is not null
     and not public.fn_role_at_least(new.organization_id, 'manager') then
    raise exception 'compartilhar_e_de_gestor_ou_administrador' using errcode = '42501';
  end if;
  return new;
end;
$f$;

comment on function public.fn_mia_relatorios_quem_compartilha() is
  'MIA (9040): gatilho de mia_relatorios e mia_paineis_usuario. Na sessao, o dono e quem cria; so gestor e administrador passam de "so meu" para "compartilhado" (42501 para os outros); empresa e dono nao mudam depois de criados.';

revoke all on function public.fn_mia_relatorios_quem_compartilha() from public;
revoke execute on function public.fn_mia_relatorios_quem_compartilha() from anon, authenticated;

drop trigger if exists trg_mia_relatorios_quem_compartilha on public.mia_relatorios;
create trigger trg_mia_relatorios_quem_compartilha
  before insert or update on public.mia_relatorios
  for each row execute function public.fn_mia_relatorios_quem_compartilha();

drop trigger if exists trg_mia_paineis_usuario_quem_compartilha on public.mia_paineis_usuario;
create trigger trg_mia_paineis_usuario_quem_compartilha
  before insert or update on public.mia_paineis_usuario
  for each row execute function public.fn_mia_relatorios_quem_compartilha();

-- ── 6. RLS ──────────────────────────────────────────────────────────────────

alter table public.mia_relatorios enable row level security;
alter table public.mia_paineis_usuario enable row level security;
alter table public.mia_paineis_usuario_itens enable row level security;
alter table public.mia_relatorios_exportacoes enable row level security;
alter table public.mia_relatorios_da_empresa enable row level security;

revoke all on table public.mia_relatorios from public, anon, authenticated;
revoke all on table public.mia_paineis_usuario from public, anon, authenticated;
revoke all on table public.mia_paineis_usuario_itens from public, anon, authenticated;
revoke all on table public.mia_relatorios_exportacoes from public, anon, authenticated;
revoke all on table public.mia_relatorios_da_empresa from public, anon, authenticated;

grant select, insert, update, delete on table public.mia_relatorios to authenticated;
grant select, insert, update, delete on table public.mia_paineis_usuario to authenticated;
grant select, insert, update, delete on table public.mia_paineis_usuario_itens to authenticated;
-- O registro é só de acréscimo: ninguém altera nem apaga uma exportação.
grant select, insert on table public.mia_relatorios_exportacoes to authenticated;
grant select, insert, update on table public.mia_relatorios_da_empresa to authenticated;

grant all on table public.mia_relatorios to service_role;
grant all on table public.mia_paineis_usuario to service_role;
grant all on table public.mia_paineis_usuario_itens to service_role;
grant all on table public.mia_relatorios_exportacoes to service_role;
grant all on table public.mia_relatorios_da_empresa to service_role;

-- O relatório: o próprio e o compartilhado.
drop policy if exists "mia_relatorios_select" on public.mia_relatorios;
drop policy if exists "mia_relatorios_insert" on public.mia_relatorios;
drop policy if exists "mia_relatorios_update" on public.mia_relatorios;
drop policy if exists "mia_relatorios_delete" on public.mia_relatorios;
create policy "mia_relatorios_select" on public.mia_relatorios
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and (created_by = auth.uid() or compartilhado)
  );
create policy "mia_relatorios_insert" on public.mia_relatorios
  for insert with check (
    organization_id in (select public.fn_user_org_ids())
    and created_by = auth.uid()
  );
create policy "mia_relatorios_update" on public.mia_relatorios
  for update using (
    organization_id in (select public.fn_user_org_ids())
    and (created_by = auth.uid()
         or (compartilhado and public.fn_role_at_least(organization_id, 'admin')))
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and (created_by = auth.uid() or public.fn_role_at_least(organization_id, 'admin'))
  );
create policy "mia_relatorios_delete" on public.mia_relatorios
  for delete using (
    organization_id in (select public.fn_user_org_ids())
    and (created_by = auth.uid()
         or (compartilhado and public.fn_role_at_least(organization_id, 'admin')))
  );

-- O painel: as mesmas regras.
drop policy if exists "mia_paineis_usuario_select" on public.mia_paineis_usuario;
drop policy if exists "mia_paineis_usuario_insert" on public.mia_paineis_usuario;
drop policy if exists "mia_paineis_usuario_update" on public.mia_paineis_usuario;
drop policy if exists "mia_paineis_usuario_delete" on public.mia_paineis_usuario;
create policy "mia_paineis_usuario_select" on public.mia_paineis_usuario
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and (created_by = auth.uid() or compartilhado)
  );
create policy "mia_paineis_usuario_insert" on public.mia_paineis_usuario
  for insert with check (
    organization_id in (select public.fn_user_org_ids())
    and created_by = auth.uid()
  );
create policy "mia_paineis_usuario_update" on public.mia_paineis_usuario
  for update using (
    organization_id in (select public.fn_user_org_ids())
    and (created_by = auth.uid()
         or (compartilhado and public.fn_role_at_least(organization_id, 'admin')))
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and (created_by = auth.uid() or public.fn_role_at_least(organization_id, 'admin'))
  );
create policy "mia_paineis_usuario_delete" on public.mia_paineis_usuario
  for delete using (
    organization_id in (select public.fn_user_org_ids())
    and (created_by = auth.uid()
         or (compartilhado and public.fn_role_at_least(organization_id, 'admin')))
  );

-- Os itens seguem o painel. O `exists` roda com a RLS de quem pergunta: quem
-- não vê o painel não vê os itens; quem não edita o painel não mexe neles; e
-- só entra no painel o relatório que a pessoa enxerga.
drop policy if exists "mia_paineis_usuario_itens_select" on public.mia_paineis_usuario_itens;
drop policy if exists "mia_paineis_usuario_itens_escrita" on public.mia_paineis_usuario_itens;
create policy "mia_paineis_usuario_itens_select" on public.mia_paineis_usuario_itens
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and exists (select 1 from public.mia_paineis_usuario p where p.id = mia_paineis_usuario_itens.painel_id)
  );
create policy "mia_paineis_usuario_itens_escrita" on public.mia_paineis_usuario_itens
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and exists (
      select 1 from public.mia_paineis_usuario p
       where p.id = mia_paineis_usuario_itens.painel_id
         and (p.created_by = auth.uid()
              or (p.compartilhado and public.fn_role_at_least(p.organization_id, 'admin'))))
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and exists (
      select 1 from public.mia_paineis_usuario p
       where p.id = mia_paineis_usuario_itens.painel_id
         and (p.created_by = auth.uid()
              or (p.compartilhado and public.fn_role_at_least(p.organization_id, 'admin'))))
    and (relatorio_id is null
         or exists (select 1 from public.mia_relatorios r where r.id = mia_paineis_usuario_itens.relatorio_id))
  );

-- O registro das exportações: gestor e administrador, e cada um grava a sua.
drop policy if exists "mia_relatorios_exportacoes_select" on public.mia_relatorios_exportacoes;
drop policy if exists "mia_relatorios_exportacoes_insert" on public.mia_relatorios_exportacoes;
create policy "mia_relatorios_exportacoes_select" on public.mia_relatorios_exportacoes
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
  );
create policy "mia_relatorios_exportacoes_insert" on public.mia_relatorios_exportacoes
  for insert with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
    and user_id = auth.uid()
  );

-- O funil dos prontos: todo membro lê; gestor e administrador escolhem.
drop policy if exists "mia_relatorios_da_empresa_select" on public.mia_relatorios_da_empresa;
drop policy if exists "mia_relatorios_da_empresa_escrita" on public.mia_relatorios_da_empresa;
create policy "mia_relatorios_da_empresa_select" on public.mia_relatorios_da_empresa
  for select using (organization_id in (select public.fn_user_org_ids()));
create policy "mia_relatorios_da_empresa_escrita" on public.mia_relatorios_da_empresa
  for all using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
  ) with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
  );

notify pgrst, 'reload schema';
