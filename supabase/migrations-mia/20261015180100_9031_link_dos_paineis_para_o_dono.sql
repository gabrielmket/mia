-- manifest: O LINK DOS PAINÉIS PARA O DONO DO NEGÓCIO (item 8, protótipo aprovado em 15/10/2026). Tabela NOVA nossa, `mia_paineis_links`: um endereço sem usuário nem senha (`/painel/<token>`) que abre os painéis prontos escolhidos de UMA empresa, só com números somados. Guarda o HASH do token (`token_hash`, HMAC-SHA256 em hex com o segredo do servidor; o token cru nunca é gravado e é derivado do id da linha no servidor, por isso "Copiar link" funciona a qualquer hora e "Renovar" mantém o endereço), a empresa, para quem é (rótulo livre de quem criou, até 120 caracteres), os painéis (subconjunto dos 12 prontos, sem repetição), o período (`escolhe` ou fixo em 7, 30, 90 dias ou este mês), se mostra valores em reais, o funil (opcional; nulo = o principal), a validade (`expires_at`, 90 dias por padrão), a revogação (`revoked_at`, `revoked_by`), o último acesso e quantos acessos (sem identificar a pessoa), quem criou e por onde (tela ou MCP de plataforma). Só o SERVIDOR lê e escreve: RLS ligada sem nenhuma política e grants revogados de anon e authenticated (o molde de `ad_tracking_links`, o rastreio, e de `crm_proposal_counters`); as telas passam por rotas que exigem gestor ou administrador e a página pública resolve o token pelo hash. Chave estrangeira composta para o funil (`(organization_id, pipeline_id)` em `crm_pipelines`, apagar o funil solta o link para o principal). Índice único no hash e índice por empresa. `fn_mia_paineis_link_acessado(id)` conta o acesso (mais um e a hora) numa escrita só, e só em link vivo; execução só para service_role. `fn_mia_lista_sem_repeticao` é a função imutável do CHECK dos painéis (o CHECK não aceita subconsulta). Nenhum objeto do upstream é redefinido. Provado em tests/invariants/link-dos-paineis-para-o-dono.test.ts.
--
-- 9031 · o link dos painéis para o dono do negócio
--
-- `mia`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `create
-- table if not exists`, as constraints dentro de `do` que conferem o catálogo,
-- `create index if not exists`, `drop trigger if exists`.
--
-- O token, o tamanho e a conta que o fecha estão em `lib/paineis/link.ts`. Aqui
-- mora só o que o banco garante.

create table if not exists public.mia_paineis_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  para_quem       text not null,
  paineis         text[] not null,
  periodo         text not null default 'escolhe',
  mostrar_valores boolean not null default true,
  pipeline_id     uuid,
  token_hash      text not null,
  expires_at      timestamptz not null default (now() + interval '90 days'),
  revoked_at      timestamptz,
  revoked_by      uuid references auth.users(id) on delete set null,
  last_used_at    timestamptz,
  acessos         integer not null default 0,
  created_by      uuid references auth.users(id) on delete set null,
  created_via     text not null default 'tela',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Lista sem repetição: o CHECK não aceita subconsulta, a função imutável aceita.
create or replace function public.fn_mia_lista_sem_repeticao(p_lista text[])
returns boolean
language sql
immutable
set search_path = ''
as $f$
  select coalesce(cardinality(p_lista), 0) = (select count(distinct x) from unnest(p_lista) x);
$f$;

comment on function public.fn_mia_lista_sem_repeticao(text[]) is
  'MIA (9031): a lista de texto nao repete valor? Usada no CHECK dos paineis do link do dono.';

revoke all on function public.fn_mia_lista_sem_repeticao(text[]) from public;
revoke execute on function public.fn_mia_lista_sem_repeticao(text[]) from anon;
grant execute on function public.fn_mia_lista_sem_repeticao(text[]) to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_links_para_quem') then
    alter table public.mia_paineis_links
      add constraint mia_paineis_links_para_quem
      check (length(btrim(para_quem)) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_links_paineis') then
    -- Os 12 prontos (lib/paineis/catalogo.ts), sem repetir, ao menos um.
    alter table public.mia_paineis_links
      add constraint mia_paineis_links_paineis
      check (
        cardinality(paineis) between 1 and 12
        and paineis <@ array['resultado', 'meta', 'funil', 'origem', 'perdas', 'atendimento',
                             'resposta', 'agenda', 'followup', 'anuncios', 'previsao', 'assuntos']::text[]
        and public.fn_mia_lista_sem_repeticao(paineis)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_links_periodo') then
    alter table public.mia_paineis_links
      add constraint mia_paineis_links_periodo
      check (periodo in ('escolhe', '7', '30', '90', 'mes'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_links_token_hash_formato') then
    -- Só o HMAC em hex: um token cru gravado por engano é recusado (23514).
    alter table public.mia_paineis_links
      add constraint mia_paineis_links_token_hash_formato
      check (token_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_links_acessos') then
    alter table public.mia_paineis_links
      add constraint mia_paineis_links_acessos check (acessos >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_links_validade') then
    alter table public.mia_paineis_links
      add constraint mia_paineis_links_validade
      check (expires_at > created_at);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_links_created_via') then
    alter table public.mia_paineis_links
      add constraint mia_paineis_links_created_via
      check (created_via in ('tela', 'mcp_plataforma'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mia_paineis_links_funil_da_empresa') then
    -- O funil é da MESMA empresa, e apagar o funil solta o link para o principal.
    alter table public.mia_paineis_links
      add constraint mia_paineis_links_funil_da_empresa
      foreign key (organization_id, pipeline_id)
      references public.crm_pipelines (organization_id, id)
      on delete set null (pipeline_id);
  end if;
end $$;

comment on table public.mia_paineis_links is
  'MIA (9031): os links dos paineis prontos para o dono do negocio (/painel/<token>). So numeros somados, sem nome de cliente final nem de pessoa da equipe. Guarda so o hash do token. Servidor apenas: RLS sem politica, grants revogados de anon e authenticated.';
comment on column public.mia_paineis_links.token_hash is
  'MIA (9031): HMAC-SHA256 em hex do token do endereco, com o segredo do servidor (lib/paineis/link.ts). O token cru nunca e gravado; o servidor o deriva do id para copiar de novo.';
comment on column public.mia_paineis_links.para_quem is
  'MIA (9031): rotulo livre de quem criou, para se organizar ("Dono da clinica"). Nao aparece na pagina publica.';
comment on column public.mia_paineis_links.periodo is
  'MIA (9031): escolhe (a pessoa escolhe entre 7, 30, 90 dias e este mes) ou fixo num deles.';
comment on column public.mia_paineis_links.acessos is
  'MIA (9031): quantas vezes a pagina abriu com dado (previa de WhatsApp e afins nao contam). Sem identificar a pessoa: nem IP nem navegador sao guardados.';

create unique index if not exists mia_paineis_links_token_hash_idx
  on public.mia_paineis_links (token_hash);

create index if not exists mia_paineis_links_org_idx
  on public.mia_paineis_links (organization_id, created_at desc);

drop trigger if exists trg_mia_paineis_links_touch on public.mia_paineis_links;
create trigger trg_mia_paineis_links_touch
  before update on public.mia_paineis_links
  for each row execute function public.fn_set_updated_at();

-- Só o servidor. Sem política nenhuma, a RLS nega tudo a quem não a ignora; os
-- grants revogados fazem a leitura pela sessão dar `permission denied` (o
-- contrato mais estreito), e não zero linhas.
alter table public.mia_paineis_links enable row level security;
revoke all on public.mia_paineis_links from public, anon, authenticated;
grant select, insert, update, delete on public.mia_paineis_links to service_role;

-- O ACESSO: conta mais um e carimba a hora, numa escrita só (o PostgREST não
-- soma coluna). Só conta link vivo: vencido ou revogado não é acesso, é a página
-- de "não está disponível". Só a plataforma executa: quem chama é a página
-- pública, depois de resolver o token pelo hash.
create or replace function public.fn_mia_paineis_link_acessado(p_id uuid)
returns boolean
language sql
volatile
set search_path = ''
as $f$
  with marcado as (
    update public.mia_paineis_links
       set acessos = acessos + 1,
           last_used_at = now()
     where id = p_id
       and revoked_at is null
       and expires_at > now()
    returning 1
  )
  select exists (select 1 from marcado);
$f$;

comment on function public.fn_mia_paineis_link_acessado(uuid) is
  'MIA (9031): conta um acesso ao link do dono (acessos + 1, last_used_at agora), so se o link estiver vivo. Execucao so para service_role.';

revoke all on function public.fn_mia_paineis_link_acessado(uuid) from public;
revoke execute on function public.fn_mia_paineis_link_acessado(uuid) from anon, authenticated;
grant execute on function public.fn_mia_paineis_link_acessado(uuid) to service_role;

notify pgrst, 'reload schema';
