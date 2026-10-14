-- manifest: TRES CONSERTOS DA FUSAO DO UPSTREAM v1.80 (.76), so em objetos NOSSOS. (1) A trava da empresa de demonstracao (`fn_mia_trava_da_demonstracao`, 9010/9020) olhava so o `type` do primeiro nivel de `automation_rules.actions`; desde a v1.74 a acao `ai_decide` (#1970) aninha as acoes-alvo em `config.opcoes[].acao`, e uma regra ativa com webhook ou aviso no grupo DENTRO de um ai_decide passava. A checagem passa a olhar os dois niveis (`jsonb_path_exists`). (2) A cobranca do revendedor (0583/0601) nasce desligada (`platform_config.MODULO_COBRANCA`), mas a empresa de demonstracao nunca pode ter assinatura, teste gratis ou plano: gatilho NOVO `trg_mia_demonstracao_sem_cobranca` (BEFORE INSERT em `cobranca_assinaturas`), pela mesma funcao, recusa com 42501. So INSERT: uma assinatura que exista antes da marca (hoje nenhuma, a chave esta desligada) segue atualizavel pela reconciliacao do provedor. (3) O clone do Outlook (`fn_mia_agenda_microsoft_compromisso`, 9014) recebe o conserto da 0578 do upstream em `fn_google_appointment` (#2467): a acao `idle` (convergente, sem nada a enviar e sem falha) limpa o erro guardado de rodada passada; o corpo e o da 9014 com so essa linha a mais. Nenhum objeto do upstream e tocado. Provado em tests/invariants/empresa-de-demonstracao-nao-envia.test.ts (com controle negativo) e tests/invariants/agenda-microsoft-idle-limpa-erro.test.ts.
--
-- 9021 · a trava da demonstração alcança o ai_decide e a cobrança; o idle do
--        Outlook limpa o erro velho
--
-- `fn_mia_`/`trg_mia_`: só objetos NOSSOS são redefinidos (docs/FORK-MIA.md,
-- regra 3). Idempotente: `create or replace` e `drop trigger if exists`.

-- ── 1 e 2. a trava da demonstração ──────────────────────────────────────────
create or replace function public.fn_mia_trava_da_demonstracao()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_porta text;
begin
  -- As condições baratas primeiro: só depois a consulta à empresa.
  case tg_table_name
    when 'messages' then
      if new.direction is distinct from 'outbound'
         or new.status not in ('queued', 'sending') then
        return new;
      end if;
      if tg_op = 'UPDATE' and old.status is not distinct from new.status then
        return new;
      end if;
      if not public.fn_mia_e_demonstracao(new.organization_id) then
        return new;
      end if;
      if tg_op = 'UPDATE' then
        -- Lote do vigia (ver o cabeçalho da 9010): converter, nunca abortar o lote.
        new.status := 'failed';
        new.error_code := 'organizacao_de_demonstracao';
        new.error_message := 'Empresa de demonstracao: nada sai daqui.';
        return new;
      end if;
      v_porta := 'mensagem de saida';

    when 'channel_sessions' then
      if new.archived_at is not null then return new; end if;
      v_porta := 'numero de WhatsApp conectado';

    when 'campaigns' then
      if new.status not in ('scheduled', 'running') then return new; end if;
      v_porta := 'campanha agendada ou enviando';

    when 'broadcasts' then
      if new.status not in ('agendada', 'enviando') then return new; end if;
      v_porta := 'broadcast agendado ou enviando';

    when 'automation_rules' then
      -- (9021) a ação `ai_decide` (upstream v1.74, #1970) aninha as ações-alvo
      -- em `config.opcoes[].acao`: o webhook e o aviso no grupo podem morar ali.
      if not new.is_active
         or jsonb_typeof(new.actions) is distinct from 'array'
         or not (
              jsonb_path_exists(new.actions,
                '$[*] ? (@.type == "call_webhook" || @.type == "notify_group")')
           or jsonb_path_exists(new.actions,
                '$[*].config.opcoes[*].acao ? (@.type == "call_webhook" || @.type == "notify_group")')
            ) then
        return new;
      end if;
      v_porta := 'regra de automacao ativa com webhook ou aviso no grupo';

    when 'config_aviso_de_caso' then
      if not new.ligado then return new; end if;
      v_porta := 'aviso de caso ligado';

    when 'ad_platform_connections' then
      if not new.enabled then return new; end if;
      v_porta := 'envio de conversoes para a Meta ou o Google';

    when 'calendar_connections' then
      v_porta := 'agenda externa conectada';

    when 'push_subscriptions' then
      v_porta := 'notificacao push';

    when 'org_voice_calls' then
      if not new.enabled then return new; end if;
      v_porta := 'ligacao pelo WhatsApp';

    when 'voip_trunk_settings' then
      if not new.is_active then return new; end if;
      v_porta := 'ligacao pelo tronco SIP';

    -- (9020) o convite de equipe saiu daqui: ele funciona na demonstração.

    -- (9021) a cobrança do revendedor (upstream 0583): a empresa de
    -- demonstração não tem assinatura, nem teste grátis, nem plano.
    when 'cobranca_assinaturas' then
      v_porta := 'assinatura de cobranca';

    else
      return new;
  end case;

  if not public.fn_mia_e_demonstracao(new.organization_id) then
    return new;
  end if;

  raise exception 'organizacao_de_demonstracao: % nao existe numa empresa de demonstracao', v_porta
    using errcode = '42501',
          hint = 'Esta e a empresa de demonstracao da plataforma: nada sai dela (docs/fork/cliente-modelo.md).';
end
$f$;

comment on function public.fn_mia_trava_da_demonstracao() is
  'MIA (9010, revista na 9020 e na 9021): a trava da empresa de demonstracao. Recusa (42501) fila de mensagem de saida, numero vivo, campanha e broadcast agendados, regra ativa com webhook ou aviso no grupo (inclusive dentro das opcoes de um ai_decide, 9021), aviso de caso, conversoes, agenda externa, push, ligacao e assinatura de cobranca (9021). Em UPDATE de messages converte a fila em failed em vez de recusar (lote do vigia). Convite de equipe NAO e travado desde a 9020: e o sistema falando com uma pessoa real que quem administra escolheu, e nao com um contato.';

revoke all on function public.fn_mia_trava_da_demonstracao() from public;
revoke execute on function public.fn_mia_trava_da_demonstracao() from anon, authenticated;

drop trigger if exists trg_mia_demonstracao_sem_cobranca on public.cobranca_assinaturas;
create trigger trg_mia_demonstracao_sem_cobranca
  before insert on public.cobranca_assinaturas
  for each row execute function public.fn_mia_trava_da_demonstracao();

-- ── 3. o idle do Outlook limpa o erro de rodada passada ─────────────────────
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
      -- (9021) idle = convergente, sem nada a fazer e sem falha nesta rodada: o
      -- erro guardado é de rodada passada e não pode sobreviver (o conserto da
      -- 0578 do upstream em fn_google_appointment, #2467, no clone do Outlook).
      update public.mia_agenda_microsoft_compromissos
         set erro = null,
             proxima_tentativa_em = now() + interval '15 minutes'
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
  'MIA (9014, revista na 9021: idle limpa o erro de rodada passada): a reserva e a efetivacao da publicacao de um compromisso no Outlook, com o contrato de fn_google_appointment do upstream (reserva de 90 s, revisoes conferidas, escrita pendente como intencao, volta pela fn_appointment_change com atividade "Remarcado no Outlook"/"Cancelado no Outlook"). Execucao so para service_role.';
revoke all on function public.fn_mia_agenda_microsoft_compromisso(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_compromisso(uuid, uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';
