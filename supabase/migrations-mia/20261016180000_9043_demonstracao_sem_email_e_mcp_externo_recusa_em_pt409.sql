-- manifest: TRES CONSERTOS DA FUSAO DO UPSTREAM v1.83 (.81), so em objetos NOSSOS. (1) A trava da empresa de demonstracao (`fn_mia_trava_da_demonstracao`, ultima na 9021) passa a recusar regra ATIVA com a acao nova `send_email` do upstream (v1.81, #2726), no primeiro nivel e dentro das opcoes de um `ai_decide`, como ja fazia com webhook e aviso no grupo; o codigo tambem passa a organizacao ao roteador de e-mail (`lib/automation/actions/send-email.ts`). (2) O servidor MCP externo do upstream (`organizations.settings.mcp_externo` + chave cifrada da 0580, tela na v1.83) e rede para o sistema de um terceiro: gatilho NOVO `trg_mia_demonstracao_sem_mcp_externo` (BEFORE INSERT/UPDATE em `organizations`, funcao nossa `fn_mia_demonstracao_sem_mcp_externo`) recusa com 42501 cadastrar ou trocar o servidor numa empresa de demonstracao e marcar como demonstracao a empresa que tem um cadastrado; apagar segue livre. (3) O conserto da 0654 do upstream (#2805: o PostgREST 14 repete `40001` sem limite e derruba a instalacao) nas funcoes NOSSAS que recusavam para sempre com `40001`: `fn_mia_agenda_microsoft_catalogo`, `_calendario`, `fn_mia_agenda_selecao`, `fn_mia_agenda_microsoft_compromisso`, `_resolver`, `_teams` e `fn_mia_obrigacao_fechar_ciclo` passam a `PT409` (14 sitios), com o corpo identico ao da ultima definicao; os chamadores aceitam os dois codigos. Nenhum objeto do upstream e tocado. Provado em tests/invariants/empresa-de-demonstracao-nao-envia.test.ts e tests/unit/recusa-permanente-do-fork-nao-pede-repeticao.test.ts.
--
-- 9043 · a demonstração sem e-mail e sem servidor externo; recusa permanente em PT409
--
-- `fn_mia_`/`trg_mia_`: só objetos NOSSOS são redefinidos (docs/FORK-MIA.md,
-- regra 3). Idempotente: `create or replace` e `drop trigger if exists`.

-- ── 1. a trava da demonstração alcança o send_email ────────────────────────
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
      -- (9043) a ação `send_email` (upstream v1.81, #2726) manda e-mail para o
      -- contato, o responsável ou um endereço fixo: é saída como as outras duas.
      if not new.is_active
         or jsonb_typeof(new.actions) is distinct from 'array'
         or not (
              jsonb_path_exists(new.actions,
                '$[*] ? (@.type == "call_webhook" || @.type == "notify_group" || @.type == "send_email")')
           or jsonb_path_exists(new.actions,
                '$[*].config.opcoes[*].acao ? (@.type == "call_webhook" || @.type == "notify_group" || @.type == "send_email")')
            ) then
        return new;
      end if;
      v_porta := 'regra de automacao ativa com webhook, aviso no grupo ou e-mail';

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
  'MIA (9010, revista na 9020, na 9021 e na 9043): a trava da empresa de demonstracao. Recusa (42501) fila de mensagem de saida, numero vivo, campanha e broadcast agendados, regra ativa com webhook, aviso no grupo ou e-mail (inclusive dentro das opcoes de um ai_decide, 9021; o e-mail desde a 9043), aviso de caso, conversoes, agenda externa, push, ligacao e assinatura de cobranca (9021). Em UPDATE de messages converte a fila em failed em vez de recusar (lote do vigia). Convite de equipe NAO e travado desde a 9020: e o sistema falando com uma pessoa real que quem administra escolheu, e nao com um contato.';

revoke all on function public.fn_mia_trava_da_demonstracao() from public;
revoke execute on function public.fn_mia_trava_da_demonstracao() from anon, authenticated;

-- ── 2. o servidor MCP externo não existe na demonstração ───────────────────
--
-- O registro é do upstream (`settings.mcp_externo` com o endereço; a chave
-- cifrada nas colunas `mcp_externo_chave_*` da 0580). Com ele, a IA da empresa
-- consulta o sistema de um terceiro a cada turno: é rede de saída, e da
-- demonstração nada sai. O código recusa nas duas pontas (o cadastro em
-- `definirServidorMcpExterno` e a carga em `carregarServidorMcpExterno`); aqui o
-- banco fecha o resto (o MCP de plataforma, um SQL à mão):
--
--   - cadastrar ou TROCAR o servidor numa empresa de demonstração: recusado;
--   - marcar como demonstração a empresa que tem um cadastrado: recusado, com a
--     frase da 9010 ("ainda tem destino vivo"); desligue antes de marcar;
--   - APAGAR é livre (é como se limpa), e uma escrita que não mexe no servidor
--     não é barrada por ele.
create or replace function public.fn_mia_demonstracao_sem_mcp_externo()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  if not coalesce(new.demonstracao, false) then
    return new;
  end if;
  if jsonb_typeof(new.settings -> 'mcp_externo') is distinct from 'object'
     and new.mcp_externo_chave_encrypted is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if not old.demonstracao then
      raise exception 'organizacao_de_demonstracao: a empresa ainda tem destino vivo (%): desligue antes de marcar',
        'servidor MCP externo cadastrado'
        using errcode = '42501';
    end if;
    -- Já estava assim (cadastro anterior à 9043): só a escrita que mexe nele é barrada.
    if (new.settings -> 'mcp_externo') is not distinct from (old.settings -> 'mcp_externo')
       and new.mcp_externo_chave_encrypted is not distinct from old.mcp_externo_chave_encrypted then
      return new;
    end if;
  end if;

  raise exception 'organizacao_de_demonstracao: % nao existe numa empresa de demonstracao', 'servidor MCP externo'
    using errcode = '42501',
          hint = 'Esta e a empresa de demonstracao da plataforma: nada sai dela (docs/fork/cliente-modelo.md).';
end
$f$;

comment on function public.fn_mia_demonstracao_sem_mcp_externo() is
  'MIA (9043): a trava da empresa de demonstracao (9010) no servidor MCP externo do upstream (settings.mcp_externo e a chave cifrada da 0580). Recusa (42501, organizacao_de_demonstracao:) cadastrar ou trocar o servidor numa demonstracao e marcar como demonstracao a empresa que tem um cadastrado. Apagar e livre. Pendurada ao lado de fn_mia_marca_de_demonstracao, que nao e reescrita.';

revoke all on function public.fn_mia_demonstracao_sem_mcp_externo() from public;
revoke execute on function public.fn_mia_demonstracao_sem_mcp_externo() from anon, authenticated;

drop trigger if exists trg_mia_demonstracao_sem_mcp_externo on public.organizations;
create trigger trg_mia_demonstracao_sem_mcp_externo
  before insert or update of demonstracao, settings, mcp_externo_chave_encrypted on public.organizations
  for each row execute function public.fn_mia_demonstracao_sem_mcp_externo();

-- ── 3. a recusa permanente sai em PT409 (o conserto da 0654 do upstream) ─────
--
-- Corpo de cada função IGUAL ao da última definição (baseline-mia.sql), com
-- `errcode = '40001'` trocado por `'PT409'` nos 14 sítios de recusa. Nenhuma
-- delas tinha recusa em que repetir passa, nem handler de `serialization_failure`.

-- fn_mia_agenda_microsoft_catalogo (última definição: 9011) · 1 sítio(s)
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
    raise exception 'microsoft_escolha_desatualizada' using errcode = 'PT409';
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
  'MIA (9011; recusa permanente em PT409 na 9043): grava o catalogo de agendas de uma conta Microsoft (lista inteira, com papel e reunioes permitidas). Primeira vez de quem nao tem destino em lugar nenhum: a agenda padrao vira fonte e destino. Execucao so para service_role.';
revoke all on function public.fn_mia_agenda_microsoft_catalogo(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_catalogo(uuid, uuid, jsonb, text) to service_role;

-- fn_mia_agenda_microsoft_calendario (última definição: 9011) · 1 sítio(s)
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
      raise exception 'microsoft_stale' using errcode = 'PT409';
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
  'MIA (9011; recusa permanente em PT409 na 9043): a leitura de um calendario do Outlook, com o contrato de fn_google_calendar do upstream (reserva de 90 s, cursor retomavel, geracao, cobertura, recomeco). Leitura completa apaga o que nao reapareceu na janela. Execucao so para service_role.';
revoke all on function public.fn_mia_agenda_microsoft_calendario(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_calendario(uuid, uuid, text, jsonb) to service_role;

-- fn_mia_agenda_selecao (última definição: 9011) · 2 sítio(s)
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
    raise exception 'agenda_selecao_desatualizada' using errcode = 'PT409';
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
      raise exception 'agenda_selecao_desatualizada' using errcode = 'PT409';
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
  'MIA (9011; recusa permanente em PT409 na 9043): a escolha das agendas da pessoa, Google e Microsoft juntos: fontes (o que ocupa) e UM destino. Destino Google passa pela fn_google_selection do upstream; destino Microsoft grava o nosso e tira o destino do lado Google. Revisoes das duas listas conferidas (PT409 quando a tela esta velha).';
revoke all on function public.fn_mia_agenda_selecao(uuid, jsonb, uuid[], uuid[], text, uuid) from public, anon;
grant execute on function public.fn_mia_agenda_selecao(uuid, jsonb, uuid[], uuid[], text, uuid) to authenticated;

-- fn_mia_agenda_microsoft_compromisso (última definição: 9014, 9021) · 6 sítio(s)
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
    raise exception 'appointment_stale' using errcode = 'PT409';
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
      raise exception 'microsoft_stale' using errcode = 'PT409';
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
      raise exception 'microsoft_stale' using errcode = 'PT409';
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
        raise exception 'microsoft_escrita_indisponivel' using errcode = 'PT409';
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
        raise exception 'microsoft_stale' using errcode = 'PT409';
      end if;
      if r ? 'apply_remote' then
        if a.status not in ('pending','confirmed') then
          raise exception 'microsoft_outcome_protected' using errcode = 'PT409';
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
  'MIA (9014, revista na 9021: idle limpa o erro de rodada passada; recusa permanente em PT409 na 9043): a reserva e a efetivacao da publicacao de um compromisso no Outlook, com o contrato de fn_google_appointment do upstream (reserva de 90 s, revisoes conferidas, escrita pendente como intencao, volta pela fn_appointment_change com atividade "Remarcado no Outlook"/"Cancelado no Outlook"). Execucao so para service_role.';
revoke all on function public.fn_mia_agenda_microsoft_compromisso(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_compromisso(uuid, uuid, text, jsonb) to service_role;

-- fn_mia_agenda_microsoft_resolver (última definição: 9014) · 2 sítio(s)
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
    raise exception 'microsoft_stale' using errcode = 'PT409';
  end if;
  if p_escolha = 'retry' then
    if m.conflito is not null then
      raise exception 'microsoft_conflito_pede_escolha' using errcode = 'PT409';
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
  'MIA (9014; recusa permanente em PT409 na 9043): a pessoa responsavel decide o conflito de um compromisso com o Outlook (usar o do Outlook, manter o daqui, preservar os campos do Outlook) ou pede nova tentativa. Revisoes e etag conferidos: a decisao vale para a comparacao que ela viu.';
revoke all on function public.fn_mia_agenda_microsoft_resolver(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.fn_mia_agenda_microsoft_resolver(uuid, uuid, text, text, text, text) to authenticated;

-- fn_mia_agenda_microsoft_teams (última definição: 9015) · 1 sítio(s)
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
    raise exception 'microsoft_stale' using errcode = 'PT409';
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
  'MIA (9015; recusa permanente em PT409 na 9043): grava o que a publicacao no Outlook observou da reuniao do Teams (pronto com o link validado, pendente, falhou) sob a mesma reserva da publicacao. Pronto: o link vai para calendar_appointments.meeting_url e, se a IA marcou numa conversa, a entrega do upstream e armada (meeting_delivery waiting_for_link). Falhou: aviso na Central (fn_meet_notice do upstream).';
revoke all on function public.fn_mia_agenda_microsoft_teams(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_teams(uuid, uuid, jsonb) to service_role;

-- fn_mia_obrigacao_fechar_ciclo (última definição: 9018) · 1 sítio(s)
create or replace function public.fn_mia_obrigacao_fechar_ciclo(
  p_obrigacao uuid,
  p_ciclo_esperado integer,
  p_como text,
  p_dia date,
  p_valido_ate date default null,
  p_proxima_em date default null,
  p_arquivo jsonb default null,
  p_ator uuid default null,
  p_proposta uuid default null
) returns integer
language plpgsql
security invoker
set search_path = public
as $f$
declare
  v public.mia_obrigacoes%rowtype;
  v_tinha boolean;
  v_ciclo integer;
begin
  select * into v from public.mia_obrigacoes where id = p_obrigacao for update;
  if not found then
    raise exception 'mia_obrigacao_nao_encontrada' using errcode = 'P0002';
  end if;
  -- Duas pessoas confirmando o mesmo recebimento: a segunda encontra o ciclo
  -- já fechado e é recusada, em vez de fechar o ciclo seguinte sem querer.
  if v.ciclo <> p_ciclo_esperado then
    raise exception 'mia_obrigacao_mudou: o item ja esta no ciclo %', v.ciclo using errcode = 'PT409';
  end if;
  if p_dia is null then
    raise exception 'mia_obrigacao_sem_dia' using errcode = '22004';
  end if;

  if p_como = 'recebido' then
    if v.categoria <> 'documento' then
      raise exception 'mia_obrigacao_categoria: so documento e recebido' using errcode = '22023';
    end if;
    v_tinha := v.recebido_em is not null or v.valido_ate is not null;
    if v_tinha then
      insert into public.mia_obrigacoes_ciclos
        (organization_id, obrigacao_id, ciclo, como, pedido_em, recebido_em, valido_ate,
         arquivo_path, arquivo_nome, arquivo_mime, arquivo_bytes, encerrado_por_user_id)
      values
        (v.organization_id, v.id, v.ciclo, 'recebido', v.pedido_em, v.recebido_em, v.valido_ate,
         v.arquivo_path, v.arquivo_nome, v.arquivo_mime, v.arquivo_bytes, p_ator);
    end if;
    v_ciclo := v.ciclo + case when v_tinha then 1 else 0 end;
    update public.mia_obrigacoes
       set recebido_em = p_dia,
           valido_ate = p_valido_ate,
           pedido_em = null,
           prazo_em = null,
           cobrado_em = null,
           renovado_em = case when v_tinha then p_dia else null end,
           arquivo_path = p_arquivo->>'path',
           arquivo_nome = p_arquivo->>'nome',
           arquivo_mime = p_arquivo->>'mime',
           arquivo_bytes = nullif(p_arquivo->>'bytes', '')::bigint,
           ciclo = v_ciclo,
           updated_at = now(),
           updated_by_user_id = p_ator
     where id = v.id;
    -- A proposta que levou a este recebimento é a confirmada; outra pendente
    -- do mesmo item deixou de fazer sentido.
    update public.mia_obrigacoes_propostas
       set situacao = case when id = p_proposta then 'confirmada' else 'superada' end,
           decidida_em = now(),
           decidida_por_user_id = p_ator
     where obrigacao_id = v.id and situacao = 'pendente';
  elsif p_como = 'feita' then
    if v.categoria <> 'atividade' then
      raise exception 'mia_obrigacao_categoria: so atividade e marcada feita' using errcode = '22023';
    end if;
    insert into public.mia_obrigacoes_ciclos
      (organization_id, obrigacao_id, ciclo, como, proxima_em, feita_em, encerrado_por_user_id)
    values
      (v.organization_id, v.id, v.ciclo, 'feita', v.proxima_em, p_dia, p_ator);
    v_ciclo := v.ciclo + 1;
    update public.mia_obrigacoes
       set feita_em = p_dia,
           proxima_em = p_proxima_em,
           ciclo = v_ciclo,
           updated_at = now(),
           updated_by_user_id = p_ator
     where id = v.id;
  else
    raise exception 'mia_obrigacao_como: use recebido ou feita' using errcode = '22023';
  end if;

  return v_ciclo;
end
$f$;

comment on function public.fn_mia_obrigacao_fechar_ciclo(uuid, integer, text, date, date, date, jsonb, uuid, uuid) is
  'MIA (9018; recusa permanente em PT409 na 9043): fecha o ciclo de uma obrigacao numa transacao: o ciclo que termina vai para mia_obrigacoes_ciclos e o item segue com as datas novas. SECURITY INVOKER: vale a RLS de quem chama. Recusa (PT409) quando o item ja mudou de ciclo.';
revoke all on function public.fn_mia_obrigacao_fechar_ciclo(uuid, integer, text, date, date, date, jsonb, uuid, uuid) from public;
revoke execute on function public.fn_mia_obrigacao_fechar_ciclo(uuid, integer, text, date, date, date, jsonb, uuid, uuid) from anon;
grant execute on function public.fn_mia_obrigacao_fechar_ciclo(uuid, integer, text, date, date, date, jsonb, uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
