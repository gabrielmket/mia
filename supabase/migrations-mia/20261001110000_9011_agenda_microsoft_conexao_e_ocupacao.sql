-- 9011 · agenda do Microsoft 365, entrega 1: conexão e ocupação
--
-- ── O que esta migration faz ────────────────────────────────────────────────
--
-- Quem atende conecta a agenda do Outlook (conta de trabalho do Microsoft 365
-- ou pessoal outlook.com), escolhe quais agendas de lá ocupam os horários dela,
-- e os eventos dessas agendas passam a bloquear a marcação aqui: pela tela,
-- pelo encaixe e pela IA. O desenho inteiro está em docs/fork/agenda-microsoft.md.
--
-- ── Por que tabelas NOSSAS, e não as do Google do upstream ─────────────────
--
-- Três leitores do motor do Google olham `calendar_connections` sem filtrar o
-- provedor (a renovação de token, a reserva do destino e a escolha). Uma conexão
-- Microsoft ali seria renovada no endereço do Google e publicada pela API do
-- Google. E o CHECK do provedor só aceita 'google_calendar': alargá-lo seria
-- redefinir uma constraint dele (regra 3 do docs/FORK-MIA.md). Então a conta
-- Microsoft mora ao lado, com o mesmo vocabulário:
--
--   mia_microsoft_oauth_da_plataforma   o app da instalação (espelha platform_google_oauth)
--   mia_agenda_microsoft_conexoes       a conta de cada pessoa (espelha calendar_connections)
--   mia_agenda_microsoft_calendarios    as agendas da conta, fontes e destino (espelha calendar_connection_calendars)
--   mia_agenda_microsoft_eventos        a ocupação vinda do Outlook, SEM título (espelha calendar_external_events)
--
-- ── Como a ocupação chega aos leitores dele sem mexer no SQL dele ──────────
--
-- As três leituras nossas devolvem AS MESMAS COLUNAS das dele, e o código soma
-- as duas (lib/agenda-mia/ocupacao.ts):
--
--   fn_mia_agenda_ocupacao_microsoft_do_dono  ↔ fn_agenda_ocupacao_google_do_dono
--   fn_mia_agenda_conexoes_microsoft_do_dono  ↔ fn_agenda_conexoes_google_do_dono
--   fn_mia_agenda_cobertura_microsoft         ↔ fn_google_coverage
--
-- ── Um destino por pessoa, entre Google e Microsoft ────────────────────────
--
-- A regra dele é "um destino entre todas as contas". Ela passa a valer entre os
-- provedores por gatilhos NOSSOS (extensão, nunca redefinição):
--
--   · gravar um destino Google (a escolha da pessoa) apaga o destino Microsoft;
--   · o destino AUTOMÁTICO do primeiro catálogo do Google (gravado pelo servidor,
--     sem sessão) não toma o lugar de um destino Microsoft que a pessoa já tem;
--   · a escolha pela tela da MIA (`fn_mia_agenda_selecao`) grava os dois lados
--     numa transação só.
--
-- Nomes com prefixo `mia_`/`fn_mia_`: nada do upstream é tocado.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · o app da Microsoft desta instalação
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.mia_microsoft_oauth_da_plataforma (
  id smallint primary key default 1,
  client_id text,
  client_secret_encrypted bytea,
  -- A Microsoft não deixa o segredo durar mais de 24 meses. A data é informada
  -- por quem cadastra, e a tela avisa 30 dias antes: segredo vencido derruba a
  -- renovação de todas as agendas da instalação de uma vez.
  segredo_vence_em date,
  -- `common` aceita conta de trabalho e pessoal. Um id de tenant restringe a uma
  -- empresa só.
  tenant text not null default 'common',
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint mia_microsoft_oauth_da_plataforma_linha_unica check (id = 1),
  constraint mia_microsoft_oauth_da_plataforma_tenant check (tenant ~ '^[A-Za-z0-9._-]{1,100}$')
);

comment on table public.mia_microsoft_oauth_da_plataforma is
  'MIA (9011): o app do Microsoft Entra DESTA INSTALACAO (linha unica), para a agenda do Outlook. So o servidor le: RLS ligada sem policies. O segredo e cifrado por fn_encrypt_oauth e nunca volta a tela.';

alter table public.mia_microsoft_oauth_da_plataforma enable row level security;
revoke all on public.mia_microsoft_oauth_da_plataforma from anon, authenticated;
grant select, insert, update on public.mia_microsoft_oauth_da_plataforma to service_role;

drop trigger if exists trg_mia_microsoft_oauth_da_plataforma_updated_at on public.mia_microsoft_oauth_da_plataforma;
create trigger trg_mia_microsoft_oauth_da_plataforma_updated_at
  before update on public.mia_microsoft_oauth_da_plataforma
  for each row execute function public.fn_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · a conta Microsoft de cada pessoa
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.mia_agenda_microsoft_conexoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- O e-mail da conta (mail ou userPrincipalName do /me). É da própria pessoa
  -- da equipe, não de contato.
  conta_email text not null,
  -- O id estável do usuário na Microsoft (`oid`). É a chave: o e-mail pode mudar.
  microsoft_user_id text not null,
  -- 'pessoal' quando o tenant é o das contas pessoais da Microsoft.
  tipo_de_conta text not null default 'trabalho',
  tenant_id text,
  access_token_cifrado bytea,
  refresh_token_cifrado bytea,
  token_expira_em timestamptz,
  escopos text[] not null default array[]::text[],
  -- Os mesmos sete valores de calendar_connections.status (SITUACOES_DA_CONEXAO).
  status text not null default 'connecting',
  ultima_leitura_em timestamptz,
  ultimo_erro text,
  revisao_da_escolha bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mia_agenda_microsoft_conexoes_tipo check (tipo_de_conta in ('trabalho','pessoal')),
  constraint mia_agenda_microsoft_conexoes_status check (status in (
    'connecting','healthy','token_expired','scope_missing','disconnected','rate_limited','error'
  ))
);

create unique index if not exists mia_agenda_microsoft_conexoes_conta_key
  on public.mia_agenda_microsoft_conexoes (organization_id, user_id, microsoft_user_id);
create index if not exists mia_agenda_microsoft_conexoes_renovacao_idx
  on public.mia_agenda_microsoft_conexoes (token_expira_em)
  where status in ('healthy','rate_limited') and token_expira_em is not null;

comment on table public.mia_agenda_microsoft_conexoes is
  'MIA (9011): a conta Microsoft (Outlook) que UMA pessoa conectou. Espelha calendar_connections do upstream, que so aceita o Google. Tokens cifrados por fn_encrypt_oauth; so o servidor escreve.';

drop trigger if exists trg_mia_agenda_microsoft_conexoes_updated_at on public.mia_agenda_microsoft_conexoes;
create trigger trg_mia_agenda_microsoft_conexoes_updated_at
  before update on public.mia_agenda_microsoft_conexoes
  for each row execute function public.fn_set_updated_at();

alter table public.mia_agenda_microsoft_conexoes enable row level security;
drop policy if exists mia_agenda_microsoft_conexoes_dono_ou_gerente on public.mia_agenda_microsoft_conexoes;
create policy mia_agenda_microsoft_conexoes_dono_ou_gerente on public.mia_agenda_microsoft_conexoes
  for select using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and (user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager')))
  );
revoke all on public.mia_agenda_microsoft_conexoes from anon, authenticated;
-- Coluna a coluna: os tokens, mesmo cifrados, não saem pela sessão.
grant select (id, organization_id, user_id, conta_email, tipo_de_conta, status, token_expira_em,
              ultima_leitura_em, ultimo_erro, revisao_da_escolha, created_at, updated_at)
  on public.mia_agenda_microsoft_conexoes to authenticated;
grant select, insert, update, delete on public.mia_agenda_microsoft_conexoes to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · as agendas da conta: o que ocupa, e qual recebe
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.mia_agenda_microsoft_calendarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conexao_id uuid not null references public.mia_agenda_microsoft_conexoes(id) on delete cascade,
  calendario_externo_id text not null,
  nome text not null,
  -- O calendário padrão da caixa (isDefaultCalendar). Só nele a Graph v1.0 dá
  -- leitura incremental (delta); os outros são lidos inteiros a cada rodada.
  padrao boolean not null default false,
  -- No vocabulário de papéis do Google DE PROPÓSITO: é o que a tela e as regras
  -- dele já entendem. owner = da própria pessoa com escrita; writer = com
  -- escrita; reader = só leitura (não pode ser destino).
  papel text not null default 'reader',
  disponivel boolean not null default true,
  catalogo_conferido_em timestamptz,
  conta_como_ocupado boolean not null default false,
  destino boolean not null default false,
  -- allowedOnlineMeetingProviders do calendário (teamsForBusiness etc.).
  reunioes_permitidas text[] not null default array[]::text[],
  fuso text,
  -- A leitura: reserva (claim), cursor da rodada, deltaLink e cobertura.
  reserva_token uuid,
  reserva_epoca bigint not null default 0,
  reserva_ate timestamptz,
  proxima_leitura_em timestamptz not null default now(),
  ultima_leitura_em timestamptz,
  erro_de_leitura text,
  cursor_da_leitura jsonb,
  delta_link text,
  cobertura jsonb,
  -- As notificações da Graph (assinatura por calendário).
  assinatura_id text,
  assinatura_expira_em timestamptz,
  assinatura_segredo_hash text,
  assinatura_erro text,
  ultima_notificacao_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mia_agenda_microsoft_calendarios_papel check (papel in ('owner','writer','reader'))
);

create unique index if not exists mia_agenda_microsoft_calendarios_key
  on public.mia_agenda_microsoft_calendarios (organization_id, conexao_id, calendario_externo_id);
create unique index if not exists mia_agenda_microsoft_calendarios_um_destino_key
  on public.mia_agenda_microsoft_calendarios (conexao_id)
  where destino;
create unique index if not exists mia_agenda_microsoft_calendarios_assinatura_key
  on public.mia_agenda_microsoft_calendarios (assinatura_id)
  where assinatura_id is not null;
create index if not exists mia_agenda_microsoft_calendarios_a_ler_idx
  on public.mia_agenda_microsoft_calendarios (proxima_leitura_em)
  where disponivel;

comment on table public.mia_agenda_microsoft_calendarios is
  'MIA (9011): as agendas dentro de uma conta Microsoft conectada, e o que cada uma faz: ocupar horario (conta_como_ocupado) e/ou receber o que marcamos (destino). Espelha calendar_connection_calendars do upstream. Um destino por pessoa, entre Google e Microsoft.';

drop trigger if exists trg_mia_agenda_microsoft_calendarios_updated_at on public.mia_agenda_microsoft_calendarios;
create trigger trg_mia_agenda_microsoft_calendarios_updated_at
  before update on public.mia_agenda_microsoft_calendarios
  for each row execute function public.fn_set_updated_at();

alter table public.mia_agenda_microsoft_calendarios enable row level security;
drop policy if exists mia_agenda_microsoft_calendarios_dono_ou_gerente on public.mia_agenda_microsoft_calendarios;
create policy mia_agenda_microsoft_calendarios_dono_ou_gerente on public.mia_agenda_microsoft_calendarios
  for select using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and exists (
          select 1 from public.mia_agenda_microsoft_conexoes c
           where c.id = conexao_id
             and (c.user_id = auth.uid() or public.fn_role_at_least(c.organization_id, 'manager'))
        ))
  );
revoke all on public.mia_agenda_microsoft_calendarios from anon, authenticated;
grant select (id, organization_id, conexao_id, calendario_externo_id, nome, padrao, papel, disponivel,
              catalogo_conferido_em, conta_como_ocupado, destino, reunioes_permitidas, fuso,
              ultima_leitura_em, erro_de_leitura, cobertura, assinatura_expira_em, assinatura_erro,
              ultima_notificacao_em, created_at, updated_at)
  on public.mia_agenda_microsoft_calendarios to authenticated;
grant select, insert, update, delete on public.mia_agenda_microsoft_calendarios to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · a ocupação vinda do Outlook (sem título, sem descrição, sem convidado)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.mia_agenda_microsoft_eventos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conexao_id uuid not null references public.mia_agenda_microsoft_conexoes(id) on delete cascade,
  calendario_externo_id text not null,
  evento_externo_id text not null,
  inicio timestamptz,
  fim timestamptz,
  dia_inteiro boolean not null default false,
  situacao text not null default 'confirmed',
  transparencia text not null default 'opaque',
  atualizado_la_em timestamptz,
  geracao uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mia_agenda_microsoft_eventos_situacao check (situacao in ('confirmed','tentative','cancelled')),
  constraint mia_agenda_microsoft_eventos_transparencia check (transparencia in ('opaque','transparent')),
  constraint mia_agenda_microsoft_eventos_periodo check (
    situacao = 'cancelled' or (inicio is not null and fim is not null and fim > inicio)
  )
);

create unique index if not exists mia_agenda_microsoft_eventos_key
  on public.mia_agenda_microsoft_eventos (organization_id, conexao_id, calendario_externo_id, evento_externo_id);
create index if not exists mia_agenda_microsoft_eventos_ocupam_idx
  on public.mia_agenda_microsoft_eventos (organization_id, conexao_id, inicio)
  where situacao <> 'cancelled' and transparencia = 'opaque';

comment on table public.mia_agenda_microsoft_eventos is
  'MIA (9011): espelho, somente leitura, do que ja existe nas agendas do Outlook conectadas. So ocupacao (inicio, fim, situacao, transparencia): o titulo, a descricao e os convidados do evento pessoal nunca sao guardados. Espelha calendar_external_events do upstream.';

drop trigger if exists trg_mia_agenda_microsoft_eventos_updated_at on public.mia_agenda_microsoft_eventos;
create trigger trg_mia_agenda_microsoft_eventos_updated_at
  before update on public.mia_agenda_microsoft_eventos
  for each row execute function public.fn_set_updated_at();

alter table public.mia_agenda_microsoft_eventos enable row level security;
drop policy if exists mia_agenda_microsoft_eventos_da_empresa on public.mia_agenda_microsoft_eventos;
create policy mia_agenda_microsoft_eventos_da_empresa on public.mia_agenda_microsoft_eventos
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
revoke all on public.mia_agenda_microsoft_eventos from anon, authenticated;
grant select (id, organization_id, conexao_id, calendario_externo_id, evento_externo_id, inicio, fim,
              dia_inteiro, situacao, transparencia, atualizado_la_em, created_at, updated_at)
  on public.mia_agenda_microsoft_eventos to authenticated;
grant select, insert, update, delete on public.mia_agenda_microsoft_eventos to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · o catálogo: todas as agendas da conta, com o que cada uma permite
-- ═══════════════════════════════════════════════════════════════════════════
-- Ausência só depois de todas as páginas recebidas (quem chama manda a lista
-- inteira). A primeira vez de quem ainda não tem destino em lugar NENHUM marca a
-- agenda padrão como fonte e destino, como o primeiro catálogo do Google faz.
create or replace function public.fn_mia_agenda_microsoft_catalogo(
  p_org uuid, p_conexao uuid, p_itens jsonb, p_revisao text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  conn public.mia_agenda_microsoft_conexoes;
  it jsonb;
  primeira boolean;
begin
  select * into conn from public.mia_agenda_microsoft_conexoes
   where organization_id = p_org and id = p_conexao;
  if not found then
    raise exception 'microsoft_conexao_indisponivel' using errcode = 'P0002';
  end if;
  perform 1 from public.user_organizations
   where organization_id = p_org and user_id = conn.user_id and revoked_at is null
   for update;
  if not found then
    raise exception 'microsoft_dono_indisponivel' using errcode = '42501';
  end if;
  select * into conn from public.mia_agenda_microsoft_conexoes
   where organization_id = p_org and id = p_conexao for update;
  if conn.status <> 'healthy' then
    raise exception 'microsoft_conexao_indisponivel' using errcode = '42501';
  end if;
  if conn.revisao_da_escolha::text is distinct from p_revisao then
    raise exception 'microsoft_escolha_desatualizada' using errcode = '40001';
  end if;

  primeira := conn.revisao_da_escolha = 0
    and not exists (
      select 1 from public.mia_agenda_microsoft_calendarios k
        join public.mia_agenda_microsoft_conexoes c
          on c.organization_id = k.organization_id and c.id = k.conexao_id
       where k.organization_id = p_org and c.user_id = conn.user_id and k.destino)
    and not exists (
      select 1 from public.calendar_connection_calendars k
        join public.calendar_connections c
          on c.organization_id = k.organization_id and c.id = k.connection_id
       where k.organization_id = p_org and c.user_id = conn.user_id and k.is_destination);

  for it in select value from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    insert into public.mia_agenda_microsoft_calendarios (
      organization_id, conexao_id, calendario_externo_id, nome, padrao, papel, disponivel,
      catalogo_conferido_em, reunioes_permitidas, fuso, conta_como_ocupado, destino
    ) values (
      p_org, p_conexao, it->>'id',
      coalesce(nullif(btrim(it->>'nome'), ''), it->>'id'),
      coalesce((it->>'padrao')::boolean, false),
      case when it->>'papel' in ('owner','writer','reader') then it->>'papel' else 'reader' end,
      true, now(),
      coalesce(array(select jsonb_array_elements_text(coalesce(it->'reunioes', '[]'::jsonb))), array[]::text[]),
      nullif(btrim(it->>'fuso'), ''),
      primeira and coalesce((it->>'padrao')::boolean, false),
      false
    )
    on conflict (organization_id, conexao_id, calendario_externo_id) do update set
      nome = excluded.nome,
      padrao = excluded.padrao,
      papel = excluded.papel,
      disponivel = true,
      catalogo_conferido_em = excluded.catalogo_conferido_em,
      reunioes_permitidas = excluded.reunioes_permitidas,
      fuso = coalesce(excluded.fuso, mia_agenda_microsoft_calendarios.fuso),
      proxima_leitura_em = now();
  end loop;

  update public.mia_agenda_microsoft_calendarios
     set disponivel = false, catalogo_conferido_em = now()
   where organization_id = p_org and conexao_id = p_conexao
     and not exists (
       select 1 from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) v
        where v->>'id' = calendario_externo_id);

  -- Só destino com escrita: calendário só-leitura nunca recebe compromisso.
  if primeira then
    update public.mia_agenda_microsoft_calendarios
       set destino = true
     where organization_id = p_org and conexao_id = p_conexao
       and padrao and disponivel and papel in ('owner','writer');
  end if;

  update public.mia_agenda_microsoft_conexoes
     set revisao_da_escolha = revisao_da_escolha + 1
   where organization_id = p_org and id = p_conexao;
end
$$;

comment on function public.fn_mia_agenda_microsoft_catalogo(uuid, uuid, jsonb, text) is
  'MIA (9011): grava o catalogo de agendas de uma conta Microsoft (lista inteira, com papel e reunioes permitidas). Primeira vez de quem nao tem destino em lugar nenhum: a agenda padrao vira fonte e destino. Execucao so para service_role.';
revoke all on function public.fn_mia_agenda_microsoft_catalogo(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_catalogo(uuid, uuid, jsonb, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · o evento do Outlook que é compromisso nosso (anti-eco)
-- ═══════════════════════════════════════════════════════════════════════════
-- Na 9011 ainda não publicamos nada no Outlook, então nenhum evento é nosso. A
-- 9012 (publicação) redefine esta função — que é NOSSA — para olhar o vínculo.
create or replace function public.fn_mia_agenda_microsoft_evento_e_compromisso(
  p_org uuid, p_conexao uuid, p_calendario text, p_evento text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select false;
$$;
revoke all on function public.fn_mia_agenda_microsoft_evento_e_compromisso(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_evento_e_compromisso(uuid, uuid, text, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · a leitura de um calendário: reserva, página, erro, recomeço
-- ═══════════════════════════════════════════════════════════════════════════
-- O mesmo contrato de fn_google_calendar (upstream 0225), sobre as nossas
-- tabelas. Duas diferenças, as duas da Microsoft:
--   · `delta`: só o calendário padrão tem leitura incremental na Graph v1.0. Os
--     outros fazem sempre a leitura completa da janela, e a rodada termina sem
--     deltaLink (e não é erro).
--   · o vínculo com compromisso nosso é resolvido por
--     fn_mia_agenda_microsoft_evento_e_compromisso (a 9012 dá corpo a ela).
create or replace function public.fn_mia_agenda_microsoft_calendario(
  p_org uuid, p_id uuid, p_acao text, p_args jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.mia_agenda_microsoft_calendarios;
  cur jsonb;
  it jsonb;
  ger uuid;
  completa boolean;
  proxima text;
begin
  select * into k from public.mia_agenda_microsoft_calendarios
   where organization_id = p_org and id = p_id for update;
  if not found then
    raise exception 'microsoft_calendario_inexistente' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.mia_agenda_microsoft_conexoes c
      join public.user_organizations m on m.organization_id = c.organization_id and m.user_id = c.user_id
     where c.organization_id = p_org and c.id = k.conexao_id and m.revoked_at is null and c.status = 'healthy'
  ) then
    raise exception 'microsoft_conexao_indisponivel' using errcode = '42501';
  end if;

  if p_acao = 'claim' then
    if k.reserva_ate > clock_timestamp() or not k.disponivel then
      return null;
    end if;
    cur := k.cursor_da_leitura;
    if cur is null then
      completa := not k.padrao
        or k.delta_link is null
        or k.cobertura is null
        or (k.cobertura->>'completed_at')::timestamptz < now() - interval '24 hours';
      cur := jsonb_build_object(
        'generation', gen_random_uuid(),
        'mode', case when completa then 'full' else 'incremental' end,
        'delta', k.padrao,
        'base', case when completa then null else k.delta_link end,
        'page', null,
        'window_start', case when completa then now() - interval '1 day'
                             else (k.cobertura->>'window_start')::timestamptz end,
        'window_end', case when completa then now() + interval '90 days'
                           else (k.cobertura->>'window_end')::timestamptz end
      );
    end if;
    update public.mia_agenda_microsoft_calendarios
       set reserva_token = gen_random_uuid(),
           reserva_epoca = reserva_epoca + 1,
           reserva_ate = clock_timestamp() + interval '90 seconds',
           cursor_da_leitura = cur
     where organization_id = p_org and id = p_id
     returning * into k;
  else
    if k.reserva_token is distinct from (p_args->'claim'->>'token')::uuid
       or k.reserva_epoca::text is distinct from p_args->'claim'->>'epoch'
       or k.reserva_ate is null or k.reserva_ate <= clock_timestamp()
       or (p_args ? 'cursor' and k.cursor_da_leitura is distinct from p_args->'cursor') then
      raise exception 'microsoft_stale' using errcode = '40001';
    end if;

    if p_acao = 'renew' then
      update public.mia_agenda_microsoft_calendarios
         set reserva_ate = clock_timestamp() + interval '90 seconds'
       where organization_id = p_org and id = p_id
       returning * into k;
    elsif p_acao = 'release' then
      update public.mia_agenda_microsoft_calendarios
         set reserva_token = null, reserva_ate = null
       where organization_id = p_org and id = p_id;
      return 'true'::jsonb;
    elsif p_acao = 'error' then
      update public.mia_agenda_microsoft_calendarios
         set erro_de_leitura = left(p_args->>'message', 200),
             proxima_leitura_em = now() + interval '15 minutes'
       where organization_id = p_org and id = p_id;
      return 'true'::jsonb;
    elsif p_acao = 'reset' then
      update public.mia_agenda_microsoft_calendarios
         set delta_link = null, cursor_da_leitura = null,
             erro_de_leitura = 'A ocupação está desatualizada. Reconstruindo a leitura.',
             proxima_leitura_em = now()
       where organization_id = p_org and id = p_id;
      return 'true'::jsonb;
    elsif p_acao = 'item' then
      it := p_args->'item';
      ger := (k.cursor_da_leitura->>'generation')::uuid;
      if public.fn_mia_agenda_microsoft_evento_e_compromisso(
           p_org, k.conexao_id, k.calendario_externo_id, it->>'evento_externo_id') then
        delete from public.mia_agenda_microsoft_eventos
         where organization_id = p_org and conexao_id = k.conexao_id
           and calendario_externo_id = k.calendario_externo_id
           and evento_externo_id = it->>'evento_externo_id';
        return jsonb_build_object('vinculado', true);
      end if;
      -- Apagado ou cancelado lá: sai da ocupação. Não guarda lápide: a delta
      -- também anuncia exclusões de FORA da janela, e elas nunca estiveram aqui.
      if it->>'situacao' = 'cancelled' then
        delete from public.mia_agenda_microsoft_eventos
         where organization_id = p_org and conexao_id = k.conexao_id
           and calendario_externo_id = k.calendario_externo_id
           and evento_externo_id = it->>'evento_externo_id';
        return jsonb_build_object('vinculado', false);
      end if;
      insert into public.mia_agenda_microsoft_eventos (
        organization_id, conexao_id, calendario_externo_id, evento_externo_id, inicio, fim,
        dia_inteiro, situacao, transparencia, atualizado_la_em, geracao
      ) values (
        p_org, k.conexao_id, k.calendario_externo_id, it->>'evento_externo_id',
        (it->>'inicio')::timestamptz, (it->>'fim')::timestamptz,
        coalesce((it->>'dia_inteiro')::boolean, false),
        coalesce(it->>'situacao', 'confirmed'),
        coalesce(it->>'transparencia', 'opaque'),
        (it->>'atualizado_la_em')::timestamptz,
        ger
      )
      on conflict (organization_id, conexao_id, calendario_externo_id, evento_externo_id) do update set
        inicio = coalesce(excluded.inicio, mia_agenda_microsoft_eventos.inicio),
        fim = coalesce(excluded.fim, mia_agenda_microsoft_eventos.fim),
        dia_inteiro = excluded.dia_inteiro,
        situacao = excluded.situacao,
        transparencia = excluded.transparencia,
        atualizado_la_em = excluded.atualizado_la_em,
        geracao = excluded.geracao;
      return jsonb_build_object('vinculado', false);
    elsif p_acao = 'page' then
      proxima := nullif(p_args->>'next_page', '');
      if proxima is not null then
        if proxima = k.cursor_da_leitura->>'page' then
          raise exception 'microsoft_cursor_sem_progresso' using errcode = '22023';
        end if;
        update public.mia_agenda_microsoft_calendarios
           set cursor_da_leitura = jsonb_set(cursor_da_leitura, '{page}', to_jsonb(proxima)),
               proxima_leitura_em = now()
         where organization_id = p_org and id = p_id
         returning * into k;
      else
        if coalesce((k.cursor_da_leitura->>'delta')::boolean, false)
           and coalesce(p_args->>'delta_link', '') = '' then
          raise exception 'microsoft_checkpoint_ausente' using errcode = '22023';
        end if;
        -- Leitura completa: o que não apareceu nesta geração, dentro da janela,
        -- deixou de existir lá.
        if k.cursor_da_leitura->>'mode' = 'full' then
          delete from public.mia_agenda_microsoft_eventos
           where organization_id = p_org and conexao_id = k.conexao_id
             and calendario_externo_id = k.calendario_externo_id
             and geracao is distinct from (k.cursor_da_leitura->>'generation')::uuid
             and (situacao = 'cancelled'
                  or (inicio < (k.cursor_da_leitura->>'window_end')::timestamptz
                      and fim > (k.cursor_da_leitura->>'window_start')::timestamptz));
        end if;
        update public.mia_agenda_microsoft_calendarios
           set delta_link = case when coalesce((cursor_da_leitura->>'delta')::boolean, false)
                                 then p_args->>'delta_link' else null end,
               cobertura = case when cursor_da_leitura->>'mode' = 'full'
                                then jsonb_build_object(
                                       'generation', cursor_da_leitura->'generation',
                                       'window_start', cursor_da_leitura->'window_start',
                                       'window_end', cursor_da_leitura->'window_end',
                                       'completed_at', now())
                                else cobertura end,
               cursor_da_leitura = null,
               ultima_leitura_em = now(),
               erro_de_leitura = null,
               proxima_leitura_em = now() + interval '15 minutes'
         where organization_id = p_org and id = p_id
         returning * into k;
        update public.mia_agenda_microsoft_conexoes
           set ultima_leitura_em = now(), ultimo_erro = null
         where organization_id = p_org and id = k.conexao_id;
      end if;
    else
      raise exception 'microsoft_acao_invalida' using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object(
    'id', k.id, 'organization_id', k.organization_id, 'conexao_id', k.conexao_id,
    'calendario_externo_id', k.calendario_externo_id, 'padrao', k.padrao, 'fuso', k.fuso,
    'cursor', k.cursor_da_leitura,
    'claim', jsonb_build_object('token', k.reserva_token, 'epoch', k.reserva_epoca::text, 'lease_until', k.reserva_ate)
  );
end
$$;

comment on function public.fn_mia_agenda_microsoft_calendario(uuid, uuid, text, jsonb) is
  'MIA (9011): a leitura de um calendario do Outlook, com o contrato de fn_google_calendar do upstream (reserva de 90 s, cursor retomavel, geracao, cobertura, recomeco). Leitura completa apaga o que nao reapareceu na janela. Execucao so para service_role.';
revoke all on function public.fn_mia_agenda_microsoft_calendario(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_calendario(uuid, uuid, text, jsonb) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8 · as três leituras com as colunas das do Google
-- ═══════════════════════════════════════════════════════════════════════════
-- FALHA ABERTO na ausência de catálogo, como fn_google_counts_for_conflicts: o
-- evento só deixa de contar quando alguém DECLAROU que aquela agenda não ocupa.
create or replace function public.fn_mia_agenda_ocupacao_microsoft_do_dono(
  p_org uuid, p_owner uuid, p_de timestamptz, p_ate timestamptz
)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  transparency text,
  status text,
  connection_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select e.inicio, e.fim, e.transparencia, e.situacao, c.status
    from public.mia_agenda_microsoft_eventos e
    join public.mia_agenda_microsoft_conexoes c
      on c.organization_id = e.organization_id and c.id = e.conexao_id
   where (auth.uid() is null
          or p_org in (select public.fn_user_org_ids())
          or public.fn_is_platform_admin())
     and e.organization_id = p_org
     and c.user_id = p_owner
     and e.situacao <> 'cancelled'
     and not exists (
       select 1 from public.mia_agenda_microsoft_calendarios k
        where k.organization_id = e.organization_id and k.conexao_id = e.conexao_id
          and k.calendario_externo_id = e.calendario_externo_id and not k.conta_como_ocupado)
     -- Cruzamento ESTRITO, a régua de `colide`: encostar não é ocupar.
     and e.inicio < p_ate
     and e.fim > p_de;
$$;
comment on function public.fn_mia_agenda_ocupacao_microsoft_do_dono(uuid, uuid, timestamptz, timestamptz) is
  'MIA (9011): a ocupacao do Outlook de um dono numa janela, com as MESMAS cinco colunas de fn_agenda_ocupacao_google_do_dono (upstream 0260), para o codigo somar as duas. So ocupacao, nunca titulo.';
revoke all on function public.fn_mia_agenda_ocupacao_microsoft_do_dono(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.fn_mia_agenda_ocupacao_microsoft_do_dono(uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.fn_mia_agenda_conexoes_microsoft_do_dono(p_org uuid, p_owner uuid)
returns table (
  status text,
  last_sync_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.status, c.ultima_leitura_em
    from public.mia_agenda_microsoft_conexoes c
   where (auth.uid() is null
          or p_org in (select public.fn_user_org_ids())
          or public.fn_is_platform_admin())
     and c.organization_id = p_org
     and c.user_id = p_owner;
$$;
comment on function public.fn_mia_agenda_conexoes_microsoft_do_dono(uuid, uuid) is
  'MIA (9011): a situacao das contas Microsoft de um dono, com as colunas de fn_agenda_conexoes_google_do_dono (upstream), para "tem agenda que nunca foi lida" valer tambem para o Outlook.';
revoke all on function public.fn_mia_agenda_conexoes_microsoft_do_dono(uuid, uuid) from public, anon;
grant execute on function public.fn_mia_agenda_conexoes_microsoft_do_dono(uuid, uuid) to authenticated, service_role;

create or replace function public.fn_mia_agenda_cobertura_microsoft(
  p_org uuid, p_owner uuid, p_start timestamptz, p_end timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is not null and p_org not in (select public.fn_user_org_ids()) then true
    else exists (
      select 1 from public.mia_agenda_microsoft_calendarios k
        join public.mia_agenda_microsoft_conexoes c
          on c.organization_id = k.organization_id and c.id = k.conexao_id
       where k.organization_id = p_org and c.user_id = p_owner and k.conta_como_ocupado
         and (not k.disponivel or c.status <> 'healthy' or k.cobertura is null
              or k.erro_de_leitura is not null or k.ultima_leitura_em is null
              or k.ultima_leitura_em < now() - interval '30 minutes'
              or (k.cobertura->>'window_start')::timestamptz > p_start
              or (k.cobertura->>'window_end')::timestamptz < p_end))
  end;
$$;
comment on function public.fn_mia_agenda_cobertura_microsoft(uuid, uuid, timestamptz, timestamptz) is
  'MIA (9011): verdadeiro quando alguma agenda do Outlook que conta como ocupado nao foi lida por inteiro e recentemente naquele periodo (a mesma regra de fn_google_coverage do upstream). Vira o aviso de cobertura parcial; nao bloqueia a oferta.';
revoke all on function public.fn_mia_agenda_cobertura_microsoft(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.fn_mia_agenda_cobertura_microsoft(uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9 · um destino por pessoa, entre Google e Microsoft
-- ═══════════════════════════════════════════════════════════════════════════
-- (a) O destino AUTOMÁTICO do Google (o primeiro catálogo dele, gravado pelo
--     servidor sem sessão) não toma o lugar de um destino Microsoft que a pessoa
--     já tem. A escolha da pessoa (com sessão) passa.
create or replace function public.fn_mia_destino_google_automatico_respeita_o_da_microsoft()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.is_destination then
      return new;
    end if;
  end if;
  if new.is_destination and auth.uid() is null
     and exists (
       select 1 from public.mia_agenda_microsoft_calendarios k
         join public.mia_agenda_microsoft_conexoes mc
           on mc.organization_id = k.organization_id and mc.id = k.conexao_id
         join public.calendar_connections gc
           on gc.organization_id = new.organization_id and gc.id = new.connection_id
        where k.organization_id = new.organization_id and mc.user_id = gc.user_id and k.destino)
  then
    new.is_destination := false;
  end if;
  return new;
end
$$;
revoke all on function public.fn_mia_destino_google_automatico_respeita_o_da_microsoft() from public, anon, authenticated;

drop trigger if exists trg_mia_destino_google_automatico_respeita_o_da_microsoft on public.calendar_connection_calendars;
create trigger trg_mia_destino_google_automatico_respeita_o_da_microsoft
  before insert or update of is_destination on public.calendar_connection_calendars
  for each row
  when (new.is_destination)
  execute function public.fn_mia_destino_google_automatico_respeita_o_da_microsoft();

-- (b) Destino Google gravado (por qualquer caminho que passou pela regra acima)
--     apaga o destino Microsoft da mesma pessoa.
create or replace function public.fn_mia_destino_google_apaga_o_da_microsoft()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mia_agenda_microsoft_calendarios k
     set destino = false
    from public.mia_agenda_microsoft_conexoes mc, public.calendar_connections gc
   where k.organization_id = new.organization_id
     and mc.organization_id = k.organization_id and mc.id = k.conexao_id
     and gc.organization_id = new.organization_id and gc.id = new.connection_id
     and mc.user_id = gc.user_id
     and k.destino;
  return null;
end
$$;
revoke all on function public.fn_mia_destino_google_apaga_o_da_microsoft() from public, anon, authenticated;

drop trigger if exists trg_mia_destino_google_apaga_o_da_microsoft on public.calendar_connection_calendars;
create trigger trg_mia_destino_google_apaga_o_da_microsoft
  after insert or update of is_destination on public.calendar_connection_calendars
  for each row
  when (new.is_destination)
  execute function public.fn_mia_destino_google_apaga_o_da_microsoft();

-- (c) Do lado Microsoft: um destino por pessoa entre as contas Microsoft dela, e
--     destino Microsoft apaga o destino Google. Só destino com escrita.
create or replace function public.fn_mia_destino_microsoft_unico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dono uuid;
begin
  if new.papel not in ('owner','writer') or not new.disponivel then
    raise exception 'microsoft_destino_sem_escrita' using errcode = '23514';
  end if;
  select user_id into dono from public.mia_agenda_microsoft_conexoes
   where organization_id = new.organization_id and id = new.conexao_id;

  update public.mia_agenda_microsoft_calendarios k
     set destino = false
    from public.mia_agenda_microsoft_conexoes mc
   where k.organization_id = new.organization_id
     and mc.organization_id = k.organization_id and mc.id = k.conexao_id
     and mc.user_id = dono and k.id <> new.id and k.destino;

  update public.calendar_connection_calendars k
     set is_destination = false
    from public.calendar_connections gc
   where k.organization_id = new.organization_id
     and gc.organization_id = k.organization_id and gc.id = k.connection_id
     and gc.user_id = dono and k.is_destination;
  return null;
end
$$;
revoke all on function public.fn_mia_destino_microsoft_unico() from public, anon, authenticated;

drop trigger if exists trg_mia_destino_microsoft_unico on public.mia_agenda_microsoft_calendarios;
create trigger trg_mia_destino_microsoft_unico
  after insert or update of destino on public.mia_agenda_microsoft_calendarios
  for each row
  when (new.destino)
  execute function public.fn_mia_destino_microsoft_unico();

-- ═══════════════════════════════════════════════════════════════════════════
-- 10 · a escolha: fontes e UM destino, Google e Microsoft juntos
-- ═══════════════════════════════════════════════════════════════════════════
-- Chamada pela sessão da pessoa (auth.uid()). As revisões das DUAS listas são
-- conferidas antes de gravar: quem salvou uma tela velha recebe 40001 e relê.
-- Destino Google: a escolha é gravada pela fn_google_selection DELE (as regras
-- dele valem inteiras) e o lado Microsoft só atualiza fontes e zera o destino.
-- Destino Microsoft: o lado Google recebe só as fontes, sem destino, e a revisão
-- dele sobe para a tela dele saber que mudou.
create or replace function public.fn_mia_agenda_selecao(
  p_org uuid,
  p_revisoes jsonb,
  p_fontes_google uuid[],
  p_fontes_microsoft uuid[],
  p_destino_provedor text,
  p_destino uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ator uuid := auth.uid();
  esperado jsonb;
  atual jsonb;
begin
  if ator is null or not public.fn_role_at_least(p_org, 'agent') or not public.fn_support_write_allowed(p_org) then
    raise exception 'agenda_selecao_proibida' using errcode = '42501';
  end if;
  perform 1 from public.user_organizations
   where organization_id = p_org and user_id = ator and revoked_at is null
   for update;
  if not found then
    raise exception 'agenda_dono_indisponivel' using errcode = '42501';
  end if;
  if p_destino_provedor not in ('google','microsoft') or p_destino is null then
    raise exception 'agenda_destino_indisponivel' using errcode = '42501';
  end if;

  -- As revisões do lado Microsoft.
  select coalesce(jsonb_agg(value order by value->>'connection_id'), '[]'::jsonb) into esperado
    from jsonb_array_elements(coalesce(p_revisoes->'microsoft', '[]'::jsonb));
  select coalesce(jsonb_agg(jsonb_build_object('connection_id', id, 'revision', revisao_da_escolha::text) order by id::text), '[]'::jsonb)
    into atual
    from public.mia_agenda_microsoft_conexoes
   where organization_id = p_org and user_id = ator and status <> 'disconnected';
  if atual is distinct from esperado then
    raise exception 'agenda_selecao_desatualizada' using errcode = '40001';
  end if;

  -- As fontes Microsoft: agendas da própria pessoa, legíveis.
  if exists (
    select 1 from unnest(coalesce(p_fontes_microsoft, array[]::uuid[])) f(id)
     where not exists (
       select 1 from public.mia_agenda_microsoft_calendarios k
         join public.mia_agenda_microsoft_conexoes c on c.organization_id = k.organization_id and c.id = k.conexao_id
        where k.organization_id = p_org and k.id = f.id and c.user_id = ator and c.status = 'healthy' and k.disponivel)
  ) then
    raise exception 'agenda_fonte_indisponivel' using errcode = '42501';
  end if;

  if p_destino_provedor = 'google' then
    -- Tudo do lado Google pelas regras dele, inclusive a conferência de revisão.
    perform public.fn_google_selection(p_org, coalesce(p_revisoes->'google', '[]'::jsonb),
                                       coalesce(p_fontes_google, array[]::uuid[]), p_destino);
    update public.mia_agenda_microsoft_calendarios k
       set destino = false,
           conta_como_ocupado = k.id = any(coalesce(p_fontes_microsoft, array[]::uuid[])),
           proxima_leitura_em = now()
      from public.mia_agenda_microsoft_conexoes c
     where k.organization_id = p_org and c.organization_id = p_org and c.id = k.conexao_id and c.user_id = ator;
  else
    -- As revisões do lado Google (o mesmo formato que a fn_google_selection confere).
    select coalesce(jsonb_agg(value order by value->>'connection_id'), '[]'::jsonb) into esperado
      from jsonb_array_elements(coalesce(p_revisoes->'google', '[]'::jsonb));
    select coalesce(jsonb_agg(jsonb_build_object('connection_id', id, 'revision', calendar_selection_revision::text) order by id::text), '[]'::jsonb)
      into atual
      from public.calendar_connections
     where organization_id = p_org and user_id = ator and provider = 'google_calendar';
    if atual is distinct from esperado then
      raise exception 'agenda_selecao_desatualizada' using errcode = '40001';
    end if;
    if not exists (
      select 1 from public.mia_agenda_microsoft_calendarios k
        join public.mia_agenda_microsoft_conexoes c on c.organization_id = k.organization_id and c.id = k.conexao_id
       where k.organization_id = p_org and k.id = p_destino and c.user_id = ator and c.status = 'healthy'
         and k.disponivel and k.papel in ('owner','writer')
    ) then
      raise exception 'agenda_destino_indisponivel' using errcode = '42501';
    end if;
    if exists (
      select 1 from unnest(coalesce(p_fontes_google, array[]::uuid[])) f(id)
       where not exists (
         select 1 from public.calendar_connection_calendars k
           join public.calendar_connections c on c.organization_id = k.organization_id and c.id = k.connection_id
          where k.organization_id = p_org and k.id = f.id and c.user_id = ator and c.status = 'healthy' and k.available
            and k.access_role in ('owner','writer','reader','writerWithoutPrivateAccess'))
    ) then
      raise exception 'agenda_fonte_indisponivel' using errcode = '42501';
    end if;

    update public.calendar_connection_calendars k
       set is_destination = false,
           counts_for_conflicts = k.id = any(coalesce(p_fontes_google, array[]::uuid[])),
           sync_next_attempt_at = now()
      from public.calendar_connections c
     where k.organization_id = p_org and c.organization_id = p_org and k.connection_id = c.id and c.user_id = ator;
    update public.calendar_connections
       set calendar_selection_revision = calendar_selection_revision + 1
     where organization_id = p_org and user_id = ator and provider = 'google_calendar';

    update public.mia_agenda_microsoft_calendarios k
       set destino = false
      from public.mia_agenda_microsoft_conexoes c
     where k.organization_id = p_org and c.organization_id = p_org and c.id = k.conexao_id
       and c.user_id = ator and k.destino and k.id <> p_destino;
    update public.mia_agenda_microsoft_calendarios k
       set destino = k.id = p_destino,
           conta_como_ocupado = k.id = any(coalesce(p_fontes_microsoft, array[]::uuid[])),
           proxima_leitura_em = now()
      from public.mia_agenda_microsoft_conexoes c
     where k.organization_id = p_org and c.organization_id = p_org and c.id = k.conexao_id and c.user_id = ator;
  end if;

  update public.mia_agenda_microsoft_conexoes
     set revisao_da_escolha = revisao_da_escolha + 1
   where organization_id = p_org and user_id = ator and status <> 'disconnected';
end
$$;
comment on function public.fn_mia_agenda_selecao(uuid, jsonb, uuid[], uuid[], text, uuid) is
  'MIA (9011): a escolha das agendas da pessoa, Google e Microsoft juntos: fontes (o que ocupa) e UM destino. Destino Google passa pela fn_google_selection do upstream; destino Microsoft grava o nosso e tira o destino do lado Google. Revisoes das duas listas conferidas (40001 quando a tela esta velha).';
revoke all on function public.fn_mia_agenda_selecao(uuid, jsonb, uuid[], uuid[], text, uuid) from public, anon;
grant execute on function public.fn_mia_agenda_selecao(uuid, jsonb, uuid[], uuid[], text, uuid) to authenticated;
