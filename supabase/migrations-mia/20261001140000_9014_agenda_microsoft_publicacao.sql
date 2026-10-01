-- 9014 · agenda do Microsoft 365, entrega 2: publicação com conflitos
--
-- ── O que esta migration faz ────────────────────────────────────────────────
--
-- O que se marca no CRM vai para a agenda do Outlook de quem atende (quando o
-- destino dela é uma agenda do Outlook), e o que muda lá volta: remarcar ou
-- cancelar no Outlook remarca ou cancela aqui, com a atividade no negócio. Quando
-- os dois lados mudaram, vira decisão humana, como no Google do upstream.
-- Desenho: docs/fork/agenda-microsoft.md, 3.8 e 4.3.
--
-- ── Por que um espelho NOSSO do compromisso ────────────────────────────────
--
-- O vínculo do upstream mora em colunas `google_*` de `calendar_appointments`, e
-- o motor dele (`fn_google_appointment`) publica no destino da pessoa de QUALQUER
-- conexão. O compromisso que vai para o Outlook tem o vínculo dele em
-- `mia_agenda_microsoft_compromissos` (1:1 com o compromisso), e a máquina de
-- reserva e efetivação é nossa (`fn_mia_agenda_microsoft_compromisso`), com o
-- mesmo contrato da dele: reserva de 90 s com época, revisão do domínio e
-- revisão local conferidas em toda ação, escrita pendente como intenção (nunca
-- recibo), base da comparação de três vias por hash (sem dado pessoal).
--
-- A revisão local é a `google_local_revision` que o gatilho DELE já sobe a cada
-- mudança de horário, situação, título, descrição, local ou convidado: lida,
-- nunca escrita. O espelho guarda a revisão que publicou.
--
-- A volta usa a `fn_appointment_change` pública dele (como servidor), que já
-- cancela os follow-ups presos à revisão antiga e fecha os avisos da Central.
--
-- Os já publicados continuam onde estão: compromisso que já está no Google
-- (`google_event_id`) não é publicado no Outlook. Só compromisso de pé e futuro
-- é publicado: mandar o histórico da pessoa para o Outlook dela mandaria convite
-- de reunião passada para cliente.
--
-- Nomes com prefixo `mia_`/`fn_mia_`: nada do upstream é redefinido.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · o vínculo compromisso ↔ evento do Outlook
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.mia_agenda_microsoft_compromissos (
  appointment_id uuid primary key references public.calendar_appointments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conexao_id uuid references public.mia_agenda_microsoft_conexoes(id) on delete set null,
  calendario_externo_id text,
  -- O id IMUTÁVEL do evento (Prefer IdType="ImmutableId"). Nulo até a criação:
  -- quem escolhe o id é a Microsoft.
  evento_id text,
  -- O `transactionId` do POST: a Graph descarta a criação repetida.
  transacao_id uuid not null default gen_random_uuid(),
  etag text,
  base jsonb,
  conflito jsonb,
  escrita_pendente jsonb,
  reserva_token uuid,
  reserva_epoca bigint not null default 0,
  reserva_ate timestamptz,
  revisao_publicada bigint not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  erro text,
  sincronizado_em timestamptz,
  -- A reunião do Teams (entrega 3, migration 9015).
  teams_pedido boolean not null default false,
  teams_estado text not null default 'nao_pedido',
  teams_erro text,
  teams_tentativas integer not null default 0,
  teams_pronto_em timestamptz,
  -- A autorização de entrega do link dada na marcação pela IA (entrega 3).
  entrega_da_ia jsonb,
  entrega_armada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mia_agenda_microsoft_compromissos_teams_estado check (
    teams_estado in ('nao_pedido','pendente','pronto','falhou','cancelado')
  ),
  constraint mia_agenda_microsoft_compromissos_teams_erro check (
    teams_erro is null or teams_erro in ('microsoft_falhou','nao_permite','desconhecido','invalido','destino_google','sem_destino')
  )
);

create unique index if not exists mia_agenda_microsoft_compromissos_evento_key
  on public.mia_agenda_microsoft_compromissos (organization_id, conexao_id, calendario_externo_id, evento_id)
  where evento_id is not null;
create index if not exists mia_agenda_microsoft_compromissos_a_fazer_idx
  on public.mia_agenda_microsoft_compromissos (proxima_tentativa_em)
  where conexao_id is not null;

comment on table public.mia_agenda_microsoft_compromissos is
  'MIA (9014): o vinculo de um compromisso com o evento dele no Outlook (1:1), e o estado da sincronizacao: base da comparacao de tres vias por hash, conflito, escrita pendente, reserva e a revisao local publicada. Espelha as colunas google_* de calendar_appointments do upstream. Nenhum dado pessoal: o horario e o texto ficam no compromisso.';

drop trigger if exists trg_mia_agenda_microsoft_compromissos_updated_at on public.mia_agenda_microsoft_compromissos;
create trigger trg_mia_agenda_microsoft_compromissos_updated_at
  before update on public.mia_agenda_microsoft_compromissos
  for each row execute function public.fn_set_updated_at();

alter table public.mia_agenda_microsoft_compromissos enable row level security;
drop policy if exists mia_agenda_microsoft_compromissos_da_empresa on public.mia_agenda_microsoft_compromissos;
create policy mia_agenda_microsoft_compromissos_da_empresa on public.mia_agenda_microsoft_compromissos
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
revoke all on public.mia_agenda_microsoft_compromissos from anon, authenticated;
-- A autorização de entrega (fronteira do atendimento) e a reserva ficam fora.
grant select (appointment_id, organization_id, conexao_id, calendario_externo_id, evento_id, etag, conflito,
              revisao_publicada, erro, sincronizado_em, teams_pedido, teams_estado, teams_erro,
              teams_pronto_em, created_at, updated_at)
  on public.mia_agenda_microsoft_compromissos to authenticated;
grant select, insert, update, delete on public.mia_agenda_microsoft_compromissos to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · o anti-eco ganha corpo (a função é NOSSA, da 9011)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_mia_agenda_microsoft_evento_e_compromisso(
  p_org uuid, p_conexao uuid, p_calendario text, p_evento text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.mia_agenda_microsoft_compromissos
     where organization_id = p_org and conexao_id = p_conexao
       and calendario_externo_id = p_calendario and evento_id = p_evento
  );
$$;
revoke all on function public.fn_mia_agenda_microsoft_evento_e_compromisso(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_evento_e_compromisso(uuid, uuid, text, text) to service_role;

-- O tipo do compromisso é reunião do Teams? Na 9014 nenhum é; a 9015 (Teams)
-- redefine esta função, que é NOSSA.
create or replace function public.fn_mia_agenda_tipo_e_teams(p_org uuid, p_tipo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select false;
$$;
revoke all on function public.fn_mia_agenda_tipo_e_teams(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_tipo_e_teams(uuid, uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · mudança no compromisso põe o vínculo na frente da fila
-- ═══════════════════════════════════════════════════════════════════════════
-- O gatilho dele sobe `google_local_revision` e rearma o prazo do Google; este,
-- nosso, rearma o do Outlook. Sem ele, uma remarcação feita aqui esperaria a
-- próxima releitura (até 15 min) para chegar ao Outlook.
create or replace function public.fn_mia_agenda_microsoft_compromisso_mudou()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mia_agenda_microsoft_compromissos
     set proxima_tentativa_em = now()
   where appointment_id = new.id and organization_id = new.organization_id
     and proxima_tentativa_em > now();
  return null;
end
$$;
revoke all on function public.fn_mia_agenda_microsoft_compromisso_mudou() from public, anon, authenticated;

drop trigger if exists trg_mia_agenda_microsoft_compromisso_mudou on public.calendar_appointments;
create trigger trg_mia_agenda_microsoft_compromisso_mudou
  after update of google_local_revision, status on public.calendar_appointments
  for each row
  when (new.google_local_revision is distinct from old.google_local_revision or new.status is distinct from old.status)
  execute function public.fn_mia_agenda_microsoft_compromisso_mudou();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · quem a rotina de publicação pega
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_mia_agenda_microsoft_a_publicar(p_limite integer default 50)
returns table (id uuid, organization_id uuid, user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.organization_id, a.owner_user_id
    from public.calendar_appointments a
    left join public.mia_agenda_microsoft_compromissos m on m.appointment_id = a.id
   where a.owner_user_id is not null
     and not exists (
       select 1 from public.contacts c
        where c.organization_id = a.organization_id and c.id = a.contact_id and c.is_anonymized)
     and (
       -- (a) Nunca publicado em lugar nenhum, de pé e futuro, e o destino de
       --     quem atende é uma agenda do Outlook.
       ((m.appointment_id is null or (m.conexao_id is null and m.proxima_tentativa_em <= now()))
        and a.google_event_id is null
        and a.status in ('pending','confirmed')
        and a.ends_at > now()
        and exists (
          select 1 from public.mia_agenda_microsoft_calendarios k
            join public.mia_agenda_microsoft_conexoes c
              on c.organization_id = k.organization_id and c.id = k.conexao_id
           where k.organization_id = a.organization_id and c.user_id = a.owner_user_id
             and k.destino and c.status = 'healthy'))
       -- (b) Já é do Outlook e há o que fazer: mudança daqui, releitura
       --     periódica do que ainda não passou, decisão de conflito registrada.
       or (m.conexao_id is not null and m.proxima_tentativa_em <= now()
           and (m.conflito is null or m.conflito ? 'resolution')
           and (a.ends_at > now() - interval '1 day' or a.google_local_revision > m.revisao_publicada))
     )
   order by coalesce(m.proxima_tentativa_em, a.created_at)
   limit greatest(1, least(coalesce(p_limite, 50), 200));
$$;
revoke all on function public.fn_mia_agenda_microsoft_a_publicar(integer) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_a_publicar(integer) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · a máquina de reserva e efetivação (o contrato de fn_google_appointment)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_mia_agenda_microsoft_compromisso(
  p_org uuid, p_id uuid, p_acao text, p_args jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.calendar_appointments;
  m public.mia_agenda_microsoft_compromissos;
  k public.mia_agenda_microsoft_calendarios;
  contato uuid;
  reserva jsonb := p_args->'claim';
  r jsonb;
  remoto jsonb;
  mudou boolean;
  aceito boolean;
  revisao_nova bigint;
  teams boolean;
begin
  select contact_id into contato from public.calendar_appointments where organization_id = p_org and id = p_id;
  if not found then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;
  if contato is not null then
    perform public.fn_service_lock(p_org, contato);
  end if;
  select * into a from public.calendar_appointments where organization_id = p_org and id = p_id for update;
  if a.contact_id is distinct from contato then
    raise exception 'appointment_stale' using errcode = '40001';
  end if;
  if contato is not null and exists (
    select 1 from public.contacts where organization_id = p_org and id = contato and is_anonymized
  ) then
    if p_acao = 'claim' then
      return jsonb_build_object('terminal', 'redacted');
    end if;
    raise exception 'microsoft_contato_anonimizado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.user_organizations
     where organization_id = p_org and user_id = a.owner_user_id and revoked_at is null
  ) then
    raise exception 'microsoft_dono_indisponivel' using errcode = '42501';
  end if;

  select * into m from public.mia_agenda_microsoft_compromissos
   where appointment_id = p_id and organization_id = p_org for update;

  if p_acao = 'claim' then
    if found and m.reserva_ate > clock_timestamp() then
      return null;
    end if;
    if m.appointment_id is null or m.conexao_id is null then
      -- Nunca publicado: reserva o destino do Outlook de quem atende.
      if a.status not in ('pending','confirmed') or a.google_event_id is not null then
        return null;
      end if;
      select k2.* into k
        from public.mia_agenda_microsoft_calendarios k2
        join public.mia_agenda_microsoft_conexoes c
          on c.organization_id = k2.organization_id and c.id = k2.conexao_id
       where k2.organization_id = p_org and c.user_id = a.owner_user_id and k2.destino;
      if not found then
        return null;
      end if;
      teams := public.fn_mia_agenda_tipo_e_teams(p_org, a.event_type_id);
      if not k.disponivel or k.papel not in ('owner','writer') then
        insert into public.mia_agenda_microsoft_compromissos (appointment_id, organization_id, erro, proxima_tentativa_em)
        values (p_id, p_org, 'A agenda de destino no Outlook não permite publicação. Confira em Suas agendas.', now() + interval '15 minutes')
        on conflict (appointment_id) do update set erro = excluded.erro, proxima_tentativa_em = excluded.proxima_tentativa_em;
        return null;
      end if;
      insert into public.mia_agenda_microsoft_compromissos (
        appointment_id, organization_id, conexao_id, calendario_externo_id, escrita_pendente,
        teams_pedido, teams_estado, teams_erro
      ) values (
        p_id, p_org, k.conexao_id, k.calendario_externo_id, '{"reserva":true}'::jsonb,
        teams, case when teams then 'pendente' else 'nao_pedido' end, null
      )
      on conflict (appointment_id) do update set
        conexao_id = excluded.conexao_id,
        calendario_externo_id = excluded.calendario_externo_id,
        escrita_pendente = excluded.escrita_pendente,
        teams_pedido = excluded.teams_pedido or mia_agenda_microsoft_compromissos.teams_pedido,
        teams_estado = case when excluded.teams_pedido or mia_agenda_microsoft_compromissos.teams_pedido
                            then 'pendente' else 'nao_pedido' end,
        teams_erro = null,
        erro = null
      returning * into m;
    end if;
    update public.mia_agenda_microsoft_compromissos
       set reserva_token = gen_random_uuid(),
           reserva_epoca = reserva_epoca + 1,
           reserva_ate = clock_timestamp() + interval '90 seconds'
     where appointment_id = p_id
     returning * into m;
  else
    if m.appointment_id is null
       or m.reserva_token is distinct from (reserva->>'token')::uuid
       or m.reserva_epoca::text is distinct from reserva->>'epoch'
       or m.reserva_ate is null or m.reserva_ate <= clock_timestamp() then
      raise exception 'microsoft_stale' using errcode = '40001';
    end if;

    if p_acao = 'release' then
      update public.mia_agenda_microsoft_compromissos
         set reserva_token = null, reserva_ate = null
       where appointment_id = p_id;
      return 'true'::jsonb;
    end if;

    if a.revision::text is distinct from p_args->>'revision'
       or a.google_local_revision::text is distinct from p_args->>'local_revision'
       or m.evento_id is distinct from p_args->>'event_id'
       or m.conexao_id::text is distinct from p_args->>'connection_id'
       or m.calendario_externo_id is distinct from p_args->>'calendar_id' then
      raise exception 'microsoft_stale' using errcode = '40001';
    end if;

    if p_acao = 'renew' then
      if not exists (
        select 1 from public.mia_agenda_microsoft_conexoes c
          join public.mia_agenda_microsoft_calendarios k2
            on k2.organization_id = c.organization_id and k2.conexao_id = c.id
         where c.organization_id = p_org and c.id = m.conexao_id and c.user_id = a.owner_user_id
           and c.status = 'healthy' and k2.calendario_externo_id = m.calendario_externo_id
           and k2.disponivel and k2.papel in ('owner','writer')
      ) then
        raise exception 'microsoft_conexao_indisponivel' using errcode = '42501';
      end if;
      update public.mia_agenda_microsoft_compromissos
         set reserva_ate = clock_timestamp() + interval '90 seconds'
       where appointment_id = p_id
       returning * into m;
    elsif p_acao = 'error' then
      update public.mia_agenda_microsoft_compromissos
         set erro = left(p_args->>'message', 200),
             proxima_tentativa_em = now() + interval '15 minutes'
       where appointment_id = p_id;
      return 'true'::jsonb;
    elsif p_acao = 'idle' then
      update public.mia_agenda_microsoft_compromissos
         set proxima_tentativa_em = now() + interval '15 minutes'
       where appointment_id = p_id;
      return 'true'::jsonb;
    elsif p_acao = 'prepare' then
      if (m.escrita_pendente is not null and m.escrita_pendente <> '{"reserva":true}'::jsonb)
         or m.conflito is not null then
        raise exception 'microsoft_escrita_indisponivel' using errcode = '40001';
      end if;
      update public.mia_agenda_microsoft_compromissos
         set escrita_pendente = p_args->'operation'
       where appointment_id = p_id;
      return 'true'::jsonb;
    elsif p_acao = 'commit' then
      r := p_args->'result';
      remoto := r->'remote';
      revisao_nova := a.google_local_revision;
      if r ? 'operation_id' and m.escrita_pendente->>'operation_id' is distinct from r->>'operation_id' then
        raise exception 'microsoft_stale' using errcode = '40001';
      end if;
      if r ? 'apply_remote' then
        if a.status not in ('pending','confirmed') then
          raise exception 'microsoft_outcome_protected' using errcode = '40001';
        end if;
        -- Remarcar em cima de outro compromisso de quem atende não é aplicado:
        -- vira conflito para uma pessoa decidir.
        if not coalesce((remoto->>'cancelled')::boolean, false) and exists (
          select 1 from public.calendar_appointments outro
           where outro.organization_id = p_org and outro.owner_user_id = a.owner_user_id and outro.id <> a.id
             and outro.status in ('pending','confirmed')
             and outro.starts_at < (remoto->>'ends_at')::timestamptz
             and outro.ends_at > (remoto->>'starts_at')::timestamptz
        ) then
          return jsonb_build_object('overlap', true);
        end if;
        mudou := row(a.starts_at, a.ends_at, a.status = 'cancelled') is distinct from
                 row((remoto->>'starts_at')::timestamptz, (remoto->>'ends_at')::timestamptz,
                     coalesce((remoto->>'cancelled')::boolean, false));
        if mudou then
          perform public.fn_appointment_change(
            p_org, p_id, a.revision,
            jsonb_build_object('starts_at', remoto->>'starts_at', 'ends_at', remoto->>'ends_at')
            || case when coalesce((remoto->>'cancelled')::boolean, false)
                    then '{"status":"cancelled","cancellation_reason":"Cancelado no Outlook"}'::jsonb
                    else '{}'::jsonb end
          );
          insert into public.crm_lead_activities (organization_id, lead_id, contact_id, type, source_module, source_id, actor_kind, reason, payload)
          select p_org, l.lead_id, a.contact_id,
                 case when coalesce((remoto->>'cancelled')::boolean, false) then 'appointment_cancelled' else 'appointment_rescheduled' end,
                 'agenda', p_id, 'system',
                 case when coalesce((remoto->>'cancelled')::boolean, false) then 'Cancelado no Outlook' else 'Remarcado no Outlook' end,
                 jsonb_build_object('origin', 'outlook', 'appointment_id', p_id, 'resolution_actor_id', m.conflito->'resolution'->>'actor_id')
            from public.crm_lead_links l
           where l.organization_id = p_org and l.target_id = p_id and l.target_kind = 'appointment'
           group by l.lead_id;
          select * into a from public.calendar_appointments where organization_id = p_org and id = p_id;
          revisao_nova := a.google_local_revision;
        end if;
      end if;
      aceito := coalesce((r->>'ack')::boolean, false);
      update public.mia_agenda_microsoft_compromissos set
        base = case when r ? 'base' then r->'base' else base end,
        etag = case when r ? 'etag' then r->>'etag' else etag end,
        evento_id = case when r ? 'event_id' and r->>'event_id' is not null then r->>'event_id' else evento_id end,
        conflito = case when r ? 'conflict' then nullif(r->'conflict', 'null'::jsonb) else conflito end,
        escrita_pendente = case
          when coalesce((r->>'retry_creation')::boolean, false) and base is null and escrita_pendente->>'method' = 'POST'
            then '{"reserva":true}'::jsonb
          when coalesce((r->>'clear_pending')::boolean, false) then null
          else escrita_pendente end,
        revisao_publicada = case when aceito then revisao_nova else revisao_publicada end,
        sincronizado_em = case when aceito then now() else sincronizado_em end,
        erro = null,
        proxima_tentativa_em = now() + interval '5 minutes'
       where appointment_id = p_id
       returning * into m;
    else
      raise exception 'microsoft_acao_invalida' using errcode = '22023';
    end if;
  end if;

  select k2.* into k from public.mia_agenda_microsoft_calendarios k2
   where k2.organization_id = p_org and k2.conexao_id = m.conexao_id
     and k2.calendario_externo_id = m.calendario_externo_id;
  return jsonb_build_object(
    'appointment', jsonb_build_object(
      'id', a.id, 'organization_id', a.organization_id, 'owner_user_id', a.owner_user_id,
      'contact_id', a.contact_id, 'event_type_id', a.event_type_id, 'title', a.title,
      'description', a.description, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
      'time_zone', a.time_zone, 'status', a.status, 'location_kind', a.location_kind,
      'location_details', a.location_details, 'meeting_url', a.meeting_url,
      'guest_email', a.guest_email, 'revision', a.revision::text,
      'local_revision', a.google_local_revision::text, 'google_event_id', a.google_event_id
    ),
    'mirror', jsonb_build_object(
      'connection_id', m.conexao_id, 'calendar_id', m.calendario_externo_id, 'event_id', m.evento_id,
      'transaction_id', m.transacao_id, 'etag', m.etag, 'base', m.base, 'conflict', m.conflito,
      'pending', m.escrita_pendente, 'published_revision', m.revisao_publicada::text,
      'teams_requested', m.teams_pedido, 'teams_state', m.teams_estado, 'teams_attempts', m.teams_tentativas
    ),
    'meeting_providers', to_jsonb(coalesce(k.reunioes_permitidas, array[]::text[])),
    'claim', jsonb_build_object('token', m.reserva_token, 'epoch', m.reserva_epoca::text, 'lease_until', m.reserva_ate)
  );
end
$$;
comment on function public.fn_mia_agenda_microsoft_compromisso(uuid, uuid, text, jsonb) is
  'MIA (9014): a reserva e a efetivacao da publicacao de um compromisso no Outlook, com o contrato de fn_google_appointment do upstream (reserva de 90 s, revisoes conferidas, escrita pendente como intencao, volta pela fn_appointment_change com atividade "Remarcado no Outlook"/"Cancelado no Outlook"). Execucao so para service_role.';
revoke all on function public.fn_mia_agenda_microsoft_compromisso(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_compromisso(uuid, uuid, text, jsonb) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · a decisão de conflito, pela pessoa responsável
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_mia_agenda_microsoft_resolver(
  p_org uuid, p_id uuid, p_revision text, p_local_revision text, p_etag text, p_escolha text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.calendar_appointments;
  m public.mia_agenda_microsoft_compromissos;
  contato uuid;
begin
  if auth.uid() is null or not public.fn_role_at_least(p_org, 'agent') or not public.fn_support_write_allowed(p_org) then
    raise exception 'microsoft_decisao_proibida' using errcode = '42501';
  end if;
  select contact_id into contato from public.calendar_appointments where organization_id = p_org and id = p_id;
  if contato is not null then
    perform public.fn_service_lock(p_org, contato);
  end if;
  select * into a from public.calendar_appointments where organization_id = p_org and id = p_id for update;
  if not found or a.owner_user_id is distinct from auth.uid() then
    raise exception 'microsoft_decisao_proibida' using errcode = '42501';
  end if;
  select * into m from public.mia_agenda_microsoft_compromissos
   where appointment_id = p_id and organization_id = p_org for update;
  if not found then
    raise exception 'microsoft_decisao_proibida' using errcode = '42501';
  end if;
  if a.revision::text is distinct from p_revision
     or a.google_local_revision::text is distinct from p_local_revision
     or m.etag is distinct from p_etag then
    raise exception 'microsoft_stale' using errcode = '40001';
  end if;
  if p_escolha = 'retry' then
    if m.conflito is not null then
      raise exception 'microsoft_conflito_pede_escolha' using errcode = '40001';
    end if;
    update public.mia_agenda_microsoft_compromissos set proxima_tentativa_em = now() where appointment_id = p_id;
  else
    if p_escolha not in ('outlook','local','preserve_remote') or m.conflito is null then
      raise exception 'microsoft_escolha_invalida' using errcode = '22023';
    end if;
    update public.mia_agenda_microsoft_compromissos
       set conflito = conflito || jsonb_build_object('resolution', jsonb_build_object('choice', p_escolha, 'actor_id', auth.uid())),
           proxima_tentativa_em = now()
     where appointment_id = p_id;
  end if;
end
$$;
comment on function public.fn_mia_agenda_microsoft_resolver(uuid, uuid, text, text, text, text) is
  'MIA (9014): a pessoa responsavel decide o conflito de um compromisso com o Outlook (usar o do Outlook, manter o daqui, preservar os campos do Outlook) ou pede nova tentativa. Revisoes e etag conferidos: a decisao vale para a comparacao que ela viu.';
revoke all on function public.fn_mia_agenda_microsoft_resolver(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.fn_mia_agenda_microsoft_resolver(uuid, uuid, text, text, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · LGPD: anonimizar o contato para a sincronização do compromisso
-- ═══════════════════════════════════════════════════════════════════════════
-- A redação DELE (`fn_redigir_agenda_do_contato_anonimizado`) já limpa o
-- compromisso (título, descrição, local, link). Este gatilho, nosso, limpa o
-- estado da sincronização com o Outlook, como o `fn_google_redact_contact` faz
-- com as colunas google_*.
create or replace function public.fn_mia_agenda_microsoft_redige_contato()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mia_agenda_microsoft_compromissos m
     set base = null, conflito = null, escrita_pendente = null, etag = null,
         reserva_token = null, reserva_ate = null, reserva_epoca = m.reserva_epoca + 1,
         entrega_da_ia = null,
         erro = 'Contato anonimizado. Sincronização interrompida.'
    from public.calendar_appointments a
   where a.organization_id = new.organization_id and a.contact_id = new.id
     and m.appointment_id = a.id;
  return new;
end
$$;
revoke all on function public.fn_mia_agenda_microsoft_redige_contato() from public, anon, authenticated;

drop trigger if exists trg_mia_agenda_microsoft_redige_contato on public.contacts;
create trigger trg_mia_agenda_microsoft_redige_contato
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true)
  execute function public.fn_mia_agenda_microsoft_redige_contato();
