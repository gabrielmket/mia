-- 9015 · agenda do Microsoft 365, entrega 3: Microsoft Teams
--
-- ── O que esta migration faz ────────────────────────────────────────────────
--
-- "Microsoft Teams" passa a ser um "onde acontece" do tipo de agendamento. Ao
-- publicar no Outlook um compromisso desse tipo, a reunião é criada no próprio
-- evento, o link vai para `calendar_appointments.meeting_url` e, quando foi a IA
-- que marcou numa conversa, o link é entregue ao cliente pelo WhatsApp pela
-- MESMA máquina de entrega do upstream (genérica desde a 0366). Desenho:
-- docs/fork/agenda-microsoft.md, 3.6 e 3.7.
--
-- ── Por que o Teams é um "Link de vídeo" marcado, e não um local novo ──────
--
-- O local é fechado por CHECK do upstream em `calendar_event_types` e
-- `calendar_appointments`; acrescentar `microsoft_teams` seria redefinir as
-- constraints dele (regra 3 do docs/FORK-MIA.md). O Teams É um link de vídeo:
-- o tipo fica `video_link` com `location_details = 'Microsoft Teams'`, e a marca
-- mora em `mia_agenda_tipos_com_teams`. Tudo o que o upstream mostra de "link de
-- vídeo" passa a mostrar o Teams, sem mexer nele.
--
-- ── Por que a entrega do link é ARMADA aqui, e não na marcação ─────────────
--
-- A entrega dele só ESPERA o link quando o local é `google_meet`; para
-- `video_link` ela enfileira na hora e mandaria a mensagem sem o link. Então a
-- marcação pela IA guarda a autorização no nosso espelho (`entrega_da_ia`) e
-- `fn_mia_agenda_microsoft_teams` arma `meeting_delivery` quando o link fica
-- pronto. Daí em diante é a máquina DELE: ela confere se o atendimento ainda é
-- o mesmo (senão marca `stale` e avisa na Central), respeita opt-out, LGPD,
-- janela e limites do canal.
--
-- Nomes com prefixo `mia_`/`fn_mia_`: nada do upstream é redefinido.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · quais tipos de agendamento são reunião do Teams
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.mia_agenda_tipos_com_teams (
  event_type_id uuid primary key references public.calendar_event_types(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.mia_agenda_tipos_com_teams is
  'MIA (9015): os tipos de agendamento "Link de video" que sao reuniao do Microsoft Teams. A publicacao no Outlook pede a reuniao no evento e grava o link em calendar_appointments.meeting_url. Existe porque o CHECK do local e do upstream.';

alter table public.mia_agenda_tipos_com_teams enable row level security;
drop policy if exists mia_agenda_tipos_com_teams_da_empresa on public.mia_agenda_tipos_com_teams;
create policy mia_agenda_tipos_com_teams_da_empresa on public.mia_agenda_tipos_com_teams
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
revoke all on public.mia_agenda_tipos_com_teams from anon, authenticated;
grant select on public.mia_agenda_tipos_com_teams to authenticated;
grant select, insert, update, delete on public.mia_agenda_tipos_com_teams to service_role;

-- A função da 9014 (NOSSA) ganha corpo.
create or replace function public.fn_mia_agenda_tipo_e_teams(p_org uuid, p_tipo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_tipo is not null and exists (
    select 1 from public.mia_agenda_tipos_com_teams
     where organization_id = p_org and event_type_id = p_tipo
  );
$$;
revoke all on function public.fn_mia_agenda_tipo_e_teams(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_tipo_e_teams(uuid, uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · o que a publicação observou da reunião, e a entrega armada
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_mia_agenda_microsoft_teams(p_org uuid, p_id uuid, p_args jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.calendar_appointments;
  m public.mia_agenda_microsoft_compromissos;
  r jsonb := p_args->'result';
  contato uuid;
begin
  select contact_id into contato from public.calendar_appointments where organization_id = p_org and id = p_id;
  if contato is not null then
    perform public.fn_service_lock(p_org, contato);
  end if;
  select * into a from public.calendar_appointments where organization_id = p_org and id = p_id for update;
  select * into m from public.mia_agenda_microsoft_compromissos where appointment_id = p_id and organization_id = p_org for update;
  if a.id is null or m.appointment_id is null
     or m.reserva_token is distinct from (p_args->'claim'->>'token')::uuid
     or m.reserva_epoca::text is distinct from p_args->'claim'->>'epoch'
     or m.reserva_ate is null or m.reserva_ate <= clock_timestamp()
     or a.revision::text is distinct from p_args->>'revision'
     or a.google_local_revision::text is distinct from p_args->>'local_revision' then
    raise exception 'microsoft_stale' using errcode = '40001';
  end if;
  if not m.teams_pedido or a.status = 'cancelled' then
    return;
  end if;

  if r->>'estado' = 'pronto' then
    if coalesce(r->>'url', '') !~ '^https://teams[.](microsoft|live)[.]com/' then
      raise exception 'microsoft_teams_link_invalido' using errcode = '22023';
    end if;
    update public.mia_agenda_microsoft_compromissos
       set teams_estado = 'pronto', teams_erro = null, teams_pronto_em = coalesce(teams_pronto_em, now())
     where appointment_id = p_id;
    -- O link vai para o compromisso: tudo o que o upstream mostra e manda de
    -- "link de vídeo" passa a ser o Teams.
    update public.calendar_appointments
       set meeting_url = r->>'url'
     where organization_id = p_org and id = p_id and location_kind = 'video_link'
       and meeting_url is distinct from r->>'url';
    -- A entrega autorizada pela IA na marcação, armada agora que há link.
    if m.entrega_da_ia is not null and m.entrega_armada_em is null and a.status in ('pending','confirmed') then
      update public.calendar_appointments
         set meeting_delivery = jsonb_build_object(
               'state', 'waiting_for_link',
               'generation', gen_random_uuid(),
               'service_boundary', m.entrega_da_ia->'service_boundary',
               'source_operation_id', m.entrega_da_ia->'source_operation_id',
               'authorized_by', m.entrega_da_ia->'authorized_by')
       where organization_id = p_org and id = p_id
         and coalesce(meeting_delivery->>'state', 'none') = 'none';
      update public.mia_agenda_microsoft_compromissos set entrega_armada_em = now() where appointment_id = p_id;
    end if;
  elsif r->>'estado' = 'pendente' then
    update public.mia_agenda_microsoft_compromissos
       set teams_tentativas = teams_tentativas + 1
     where appointment_id = p_id;
  elsif r->>'estado' = 'falhou' then
    if coalesce(r->>'erro', '') not in ('microsoft_falhou','nao_permite','desconhecido','invalido') then
      raise exception 'microsoft_teams_erro_invalido' using errcode = '22023';
    end if;
    update public.mia_agenda_microsoft_compromissos
       set teams_estado = 'falhou', teams_erro = r->>'erro', teams_tentativas = teams_tentativas + 1
     where appointment_id = p_id;
    perform public.fn_meet_notice(p_org, p_id, 'meeting_failed');
  else
    raise exception 'microsoft_teams_estado_invalido' using errcode = '22023';
  end if;
end
$$;
comment on function public.fn_mia_agenda_microsoft_teams(uuid, uuid, jsonb) is
  'MIA (9015): grava o que a publicacao no Outlook observou da reuniao do Teams (pronto com o link validado, pendente, falhou) sob a mesma reserva da publicacao. Pronto: o link vai para calendar_appointments.meeting_url e, se a IA marcou numa conversa, a entrega do upstream e armada (meeting_delivery waiting_for_link). Falhou: aviso na Central (fn_meet_notice do upstream).';
revoke all on function public.fn_mia_agenda_microsoft_teams(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_teams(uuid, uuid, jsonb) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · o compromisso Teams que não vai para o Outlook
-- ═══════════════════════════════════════════════════════════════════════════
-- Quem atende publica no Google (ou não tem destino): o Teams não pode ser
-- criado. Uma linha no espelho registra isso (o detalhe do compromisso mostra o
-- porquê) e a Central avisa UMA vez. Se depois a pessoa escolher um destino do
-- Outlook e o compromisso ainda não estiver no Google, a publicação o pega.
create or replace function public.fn_mia_agenda_microsoft_teams_sem_outlook(p_limite integer default 50)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  n integer := 0;
begin
  for c in
    select a.id, a.organization_id, (a.google_event_id is not null) as no_google
      from public.calendar_appointments a
      join public.mia_agenda_tipos_com_teams t
        on t.organization_id = a.organization_id and t.event_type_id = a.event_type_id
     where a.status in ('pending','confirmed') and a.ends_at > now() and a.owner_user_id is not null
       and not exists (select 1 from public.mia_agenda_microsoft_compromissos m where m.appointment_id = a.id)
       and (a.google_event_id is not null or not exists (
         select 1 from public.mia_agenda_microsoft_calendarios k
           join public.mia_agenda_microsoft_conexoes cx on cx.organization_id = k.organization_id and cx.id = k.conexao_id
          where k.organization_id = a.organization_id and cx.user_id = a.owner_user_id and k.destino and cx.status = 'healthy'))
       and a.created_at < now() - interval '2 minutes'
     order by a.created_at
     limit greatest(1, least(coalesce(p_limite, 50), 200))
  loop
    insert into public.mia_agenda_microsoft_compromissos (
      appointment_id, organization_id, teams_pedido, teams_estado, teams_erro, proxima_tentativa_em
    ) values (
      c.id, c.organization_id, true, 'falhou', case when c.no_google then 'destino_google' else 'sem_destino' end,
      now() + interval '1 hour'
    ) on conflict (appointment_id) do nothing;
    begin
      perform public.fn_meet_notice(c.organization_id, c.id, 'meeting_failed');
    exception when others then
      null; -- o aviso é melhor esforço: a tela do compromisso já diz o porquê.
    end;
    n := n + 1;
  end loop;
  return n;
end
$$;
comment on function public.fn_mia_agenda_microsoft_teams_sem_outlook(integer) is
  'MIA (9015): registra os compromissos de tipo Teams que nao podem ter o Teams (quem atende publica no Google ou nao tem destino) e avisa na Central uma vez. Execucao so para service_role.';
revoke all on function public.fn_mia_agenda_microsoft_teams_sem_outlook(integer) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_teams_sem_outlook(integer) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · o link do Teams sai dos estados da IA, como o do Meet
-- ═══════════════════════════════════════════════════════════════════════════
-- O upstream troca o link do Meet por um marcador nas tabelas de estado da IA
-- (`fn_meet_minimize_runtime`, 0226): o link é credencial de entrada na reunião
-- e o lugar dele é o compromisso. O gatilho NOSSO faz o mesmo com o do Teams,
-- nas mesmas seis tabelas e com os mesmos marcadores.
create or replace function public.fn_mia_teams_minimize_runtime()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new := jsonb_populate_record(
    new,
    regexp_replace(
      to_jsonb(new)::text,
      'https://teams[.](microsoft|live)[.]com/[^[:space:]"\\]+',
      case when tg_table_name = 'outbound_copies' then '[meet-link]' else '[link da reunião disponível na Agenda]' end,
      'g'
    )::jsonb
  );
  return new;
end
$$;
revoke all on function public.fn_mia_teams_minimize_runtime() from public, anon, authenticated;

do $$
declare
  tab text;
begin
  foreach tab in array array['lead_checkpoints','lead_state','lead_state_transitions','agent_cases','outbound_copies','conversations'] loop
    if to_regclass('public.' || tab) is not null then
      execute format('drop trigger if exists trg_mia_teams_minimize_runtime on public.%I', tab);
      execute format('create trigger trg_mia_teams_minimize_runtime before insert or update on public.%I for each row execute function public.fn_mia_teams_minimize_runtime()', tab);
    end if;
  end loop;
end
$$;
