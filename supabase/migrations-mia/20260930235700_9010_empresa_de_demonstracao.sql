-- 9010 · a empresa de demonstração (cliente modelo): nada sai dela, e ela não conta
--
-- ── O que é ─────────────────────────────────────────────────────────────────
--
-- Decisão do Gabriel (30/09): uma empresa de DEMONSTRAÇÃO, com dados fictícios,
-- que exercita todos os recursos da plataforma para testar, medir e mostrar em
-- venda. Mora em produção, como empresa separada, com uma marca que:
--
--   1. TRAVA qualquer envio real — WhatsApp, broadcast, campanha, follow-up,
--      aviso no grupo, e-mail, push, conversões da Meta/Google, webhooks de
--      saída, agenda externa e ligação;
--   2. tira a empresa das métricas, do faturamento e dos relatórios da
--      PLATAFORMA (dentro dela, os relatórios dela continuam funcionando).
--
-- A semente é `scripts/cliente-modelo.ts` (docs/fork/cliente-modelo.md).
--
-- ── Por que coluna, e não `settings` ────────────────────────────────────────
--
-- `organizations.settings` é preferência da empresa: as rotas do cliente o
-- escrevem com o service_role, mesclando chaves (Configurações, marca, grupo de
-- avisos, modo de venda). Uma chave `demonstracao` ali estaria a um PATCH mal
-- feito de sumir — e a trava sumiria junto, em silêncio: falha ABERTA. A marca
-- é outra coisa: é a plataforma dizendo "esta empresa não fala com ninguém".
-- Por isso é coluna própria, `not null default false` (nenhuma empresa de
-- verdade muda de comportamento, sem backfill), e só a plataforma a muda.
--
-- ── Como a trava falha fechada ──────────────────────────────────────────────
--
-- A trava mora no BANCO, no lugar por onde cada envio TEM de passar antes de
-- sair — e não numa lista de `if` no código, que o próximo caminho de envio
-- esqueceria. Medido no código (30/09), todo envio ao lead passa por UMA destas
-- portas, e a empresa de demonstração não abre nenhuma:
--
--   · a fila de mensagens: `messages` de saída nasce `queued` antes de ir ao
--     canal (app/api/v1/messages/_handler.ts, a porta de UI, automação, MCP,
--     agente, follow-up, campanha, prospecção, lembrete e proposta). Mensagem de
--     saída em fila numa empresa de demonstração é RECUSADA (42501): a linha
--     não nasce, e o handler não chega ao canal;
--   · o número: nenhuma sessão de canal VIVA (não arquivada). Sem número, não há
--     por onde mandar nada — nem o "digitando", nem edição, nem modelo da Meta;
--   · o que dispara sozinho: campanha e broadcast não passam de rascunho para
--     agendado/enviando; regra de automação com webhook ou aviso no grupo não
--     fica ativa; aviso de caso não liga;
--   · os destinos de fora: grupo de avisos, conexão de conversões (Meta/Google),
--     agenda externa (o Google manda convite por e-mail aos participantes),
--     assinatura de push, ligação (voz e tronco SIP) e convite de equipe (que é
--     e-mail) não existem para ela.
--
-- O e-mail que não nasce de uma linha destas (a entrega do relatório LGPD ao
-- titular, o alarme de prazo LGPD) é travado no roteador de e-mail, no código,
-- pela mesma pergunta `fn_mia_e_demonstracao`.
--
-- ⚠️ Nenhuma recusa aqui roda dentro de um UPDATE em lote de vários tenants:
-- quem é recusado é a ação de UMA empresa (enfileirar, conectar, agendar,
-- ligar). A única escrita em lote que alcança a fila (o reenvio do vigia, que
-- promove `queued`) encontra a empresa de demonstração SEM fila: o INSERT não
-- nasce, e marcar a empresa derruba as pendentes para `failed`. Por isso o
-- ramo de UPDATE de `messages` converte em vez de recusar — recusar ali
-- abortaria o lote das empresas de verdade.
--
-- ── Marcar e desmarcar ──────────────────────────────────────────────────────
--
-- Só a plataforma muda a marca (service_role, postgres ou admin da plataforma).
-- Marcar uma empresa que tem destino vivo é RECUSADO, com a lista do que
-- desligar: marcar por engano uma empresa de verdade não pode derrubar o
-- WhatsApp dela em silêncio. O que é transitório é desligado na marcação: fila
-- de saída vira `failed`, assinaturas de push somem, convites pendentes são
-- revogados.
--
-- Nomes `fn_mia_`/`trg_mia_`: estender, nunca redefinir (docs/FORK-MIA.md,
-- regra 3). Nenhum objeto do upstream é tocado.

-- ── 1. a marca ──────────────────────────────────────────────────────────────
alter table public.organizations
  add column if not exists demonstracao boolean not null default false;

comment on column public.organizations.demonstracao is
  'MIA (9010): empresa de DEMONSTRACAO (cliente modelo, dados ficticios). Nada sai dela (os gatilhos trg_mia_demonstracao_* recusam fila de saida, numero vivo, agendamento de campanha e broadcast, destinos externos) e ela fica fora das metricas, do faturamento e dos relatorios da plataforma. So a plataforma marca e desmarca.';

-- ── 2. a pergunta ───────────────────────────────────────────────────────────
-- Empresa que não existe responde `false`: a linha que a citasse esbarraria na
-- chave estrangeira de qualquer jeito, e é essa recusa que vale.
create or replace function public.fn_mia_e_demonstracao(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $f$
  select coalesce(
    (select o.demonstracao from public.organizations o where o.id = p_org),
    false
  );
$f$;

comment on function public.fn_mia_e_demonstracao(uuid) is
  'MIA (9010): a empresa e de demonstracao? Consultada pelos gatilhos da trava e pelo roteador de e-mail. Execucao so para service_role.';

revoke all on function public.fn_mia_e_demonstracao(uuid) from public;
revoke execute on function public.fn_mia_e_demonstracao(uuid) from anon, authenticated;
grant execute on function public.fn_mia_e_demonstracao(uuid) to service_role;

-- Quem escreve é a PLATAFORMA? Tudo que não é sessão de usuário (service_role,
-- postgres, a semente) é; sessão de usuário só quando é admin da plataforma.
create or replace function public.fn_mia_escrita_da_plataforma()
returns boolean
language sql
stable
security definer
set search_path = public
as $f$
  select not (
           coalesce(current_setting('role', true), '') in ('authenticated', 'anon')
           or coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon')
         )
      or public.fn_is_platform_admin();
$f$;

comment on function public.fn_mia_escrita_da_plataforma() is
  'MIA (9010): verdadeiro quando quem escreve e a plataforma (service_role, postgres) ou um admin da plataforma logado. E quem pode marcar e desmarcar a empresa de demonstracao.';

revoke all on function public.fn_mia_escrita_da_plataforma() from public;
revoke execute on function public.fn_mia_escrita_da_plataforma() from anon, authenticated;

-- ── 3. a trava, uma função para todas as portas ─────────────────────────────
--
-- A mensagem de toda recusa começa com `organizacao_de_demonstracao:` — é por
-- ela que o código traduz o erro para a tela (lib/demonstracao/trava.ts).
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
        -- Lote do vigia (ver o cabeçalho): converter, nunca abortar o lote.
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
      if not new.is_active
         or jsonb_typeof(new.actions) is distinct from 'array'
         or not exists (
              select 1 from jsonb_array_elements(new.actions) a
               where a ->> 'type' in ('call_webhook', 'notify_group')
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

    when 'team_invites' then
      v_porta := 'convite de equipe por e-mail';

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
  'MIA (9010): a trava da empresa de demonstracao. Recusa (42501) fila de mensagem de saida, numero vivo, campanha e broadcast agendados, regra ativa com webhook ou aviso no grupo, aviso de caso, conversoes, agenda externa, push, ligacao e convite de equipe. Em UPDATE de messages converte a fila em failed em vez de recusar (lote do vigia).';

revoke all on function public.fn_mia_trava_da_demonstracao() from public;
revoke execute on function public.fn_mia_trava_da_demonstracao() from anon, authenticated;

drop trigger if exists trg_mia_demonstracao_nao_envia on public.messages;
create trigger trg_mia_demonstracao_nao_envia
  before insert or update of status on public.messages
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_numero on public.channel_sessions;
create trigger trg_mia_demonstracao_sem_numero
  before insert or update of archived_at, organization_id on public.channel_sessions
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_campanha on public.campaigns;
create trigger trg_mia_demonstracao_sem_campanha
  before insert or update of status, organization_id on public.campaigns
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_broadcast on public.broadcasts;
create trigger trg_mia_demonstracao_sem_broadcast
  before insert or update of status, organization_id on public.broadcasts
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_regra_de_saida on public.automation_rules;
create trigger trg_mia_demonstracao_sem_regra_de_saida
  before insert or update of is_active, actions, organization_id on public.automation_rules
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_aviso_de_caso on public.config_aviso_de_caso;
create trigger trg_mia_demonstracao_sem_aviso_de_caso
  before insert or update of ligado, organization_id on public.config_aviso_de_caso
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_conversoes on public.ad_platform_connections;
create trigger trg_mia_demonstracao_sem_conversoes
  before insert or update of enabled, organization_id on public.ad_platform_connections
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_agenda_externa on public.calendar_connections;
create trigger trg_mia_demonstracao_sem_agenda_externa
  before insert or update of organization_id on public.calendar_connections
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_push on public.push_subscriptions;
create trigger trg_mia_demonstracao_sem_push
  before insert or update of organization_id on public.push_subscriptions
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_voz on public.org_voice_calls;
create trigger trg_mia_demonstracao_sem_voz
  before insert or update of enabled, organization_id on public.org_voice_calls
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_tronco on public.voip_trunk_settings;
create trigger trg_mia_demonstracao_sem_tronco
  before insert or update of is_active, organization_id on public.voip_trunk_settings
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_convite on public.team_invites;
create trigger trg_mia_demonstracao_sem_convite
  before insert or update of organization_id on public.team_invites
  for each row execute function public.fn_mia_trava_da_demonstracao();

-- ── 4. a própria marca: quem muda, e o que ela exige ────────────────────────
create or replace function public.fn_mia_marca_de_demonstracao()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_vivos text[] := array[]::text[];
begin
  -- (a) só a plataforma marca e desmarca.
  if (tg_op = 'INSERT' and new.demonstracao)
     or (tg_op = 'UPDATE' and new.demonstracao is distinct from old.demonstracao) then
    if not public.fn_mia_escrita_da_plataforma() then
      raise exception 'organizacao_de_demonstracao: so a plataforma marca ou desmarca a empresa de demonstracao'
        using errcode = '42501';
    end if;
  end if;

  if not new.demonstracao then
    return new;
  end if;

  -- (b) a empresa de demonstração não tem grupo de avisos no WhatsApp.
  if jsonb_typeof(new.settings -> 'grupo_de_avisos') = 'object' then
    raise exception 'organizacao_de_demonstracao: grupo de avisos no WhatsApp nao existe numa empresa de demonstracao'
      using errcode = '42501',
            hint = 'Esta e a empresa de demonstracao da plataforma: nada sai dela (docs/fork/cliente-modelo.md).';
  end if;

  -- (c) marcar uma empresa que já tem destino vivo é recusado, com a lista.
  if tg_op = 'UPDATE' and not old.demonstracao then
    if exists (select 1 from public.channel_sessions s
                where s.organization_id = new.id and s.archived_at is null) then
      v_vivos := array_append(v_vivos, 'numero de WhatsApp conectado');
    end if;
    if exists (select 1 from public.campaigns c
                where c.organization_id = new.id and c.status in ('scheduled', 'running')) then
      v_vivos := array_append(v_vivos, 'campanha agendada ou enviando');
    end if;
    if exists (select 1 from public.broadcasts b
                where b.organization_id = new.id and b.status in ('agendada', 'enviando')) then
      v_vivos := array_append(v_vivos, 'broadcast agendado ou enviando');
    end if;
    if exists (select 1 from public.automation_rules r
                where r.organization_id = new.id and r.is_active
                  and jsonb_typeof(r.actions) = 'array'
                  and exists (select 1 from jsonb_array_elements(r.actions) a
                               where a ->> 'type' in ('call_webhook', 'notify_group'))) then
      v_vivos := array_append(v_vivos, 'regra de automacao ativa com webhook ou aviso no grupo');
    end if;
    if exists (select 1 from public.config_aviso_de_caso a
                where a.organization_id = new.id and a.ligado) then
      v_vivos := array_append(v_vivos, 'aviso de caso ligado');
    end if;
    if exists (select 1 from public.ad_platform_connections p
                where p.organization_id = new.id and p.enabled) then
      v_vivos := array_append(v_vivos, 'envio de conversoes ligado');
    end if;
    if exists (select 1 from public.calendar_connections k
                where k.organization_id = new.id) then
      v_vivos := array_append(v_vivos, 'agenda externa conectada');
    end if;
    if exists (select 1 from public.org_voice_calls v
                where v.organization_id = new.id and v.enabled) then
      v_vivos := array_append(v_vivos, 'ligacao pelo WhatsApp');
    end if;
    if exists (select 1 from public.voip_trunk_settings t
                where t.organization_id = new.id and t.is_active) then
      v_vivos := array_append(v_vivos, 'tronco SIP ativo');
    end if;

    if cardinality(v_vivos) > 0 then
      raise exception 'organizacao_de_demonstracao: a empresa ainda tem destino vivo (%): desligue antes de marcar',
        array_to_string(v_vivos, ', ')
        using errcode = '42501';
    end if;
  end if;

  return new;
end
$f$;

comment on function public.fn_mia_marca_de_demonstracao() is
  'MIA (9010): so a plataforma muda organizations.demonstracao; empresa de demonstracao nao tem grupo de avisos; marcar empresa com destino vivo (numero, campanha, broadcast, regra de saida, aviso de caso, conversoes, agenda externa, voz, tronco) e recusado com a lista.';

revoke all on function public.fn_mia_marca_de_demonstracao() from public;
revoke execute on function public.fn_mia_marca_de_demonstracao() from anon, authenticated;

drop trigger if exists trg_mia_marca_de_demonstracao on public.organizations;
create trigger trg_mia_marca_de_demonstracao
  before insert or update of demonstracao, settings on public.organizations
  for each row execute function public.fn_mia_marca_de_demonstracao();

-- Ao marcar: o transitório é desligado (fila de saída, push, convites).
create or replace function public.fn_mia_desliga_o_transitorio_da_demonstracao()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  update public.messages m
     set status = 'failed',
         error_code = 'organizacao_de_demonstracao',
         error_message = 'Empresa de demonstracao: nada sai daqui.'
   where m.organization_id = new.id
     and m.direction = 'outbound'
     and m.status in ('queued', 'sending');

  delete from public.push_subscriptions p where p.organization_id = new.id;

  update public.team_invites i
     set revoked_at = now()
   where i.organization_id = new.id
     and i.accepted_at is null
     and i.revoked_at is null;

  return new;
end
$f$;

comment on function public.fn_mia_desliga_o_transitorio_da_demonstracao() is
  'MIA (9010): ao marcar a empresa como demonstracao, a fila de saida vira failed (organizacao_de_demonstracao), as assinaturas de push somem e os convites pendentes sao revogados.';

revoke all on function public.fn_mia_desliga_o_transitorio_da_demonstracao() from public;
revoke execute on function public.fn_mia_desliga_o_transitorio_da_demonstracao() from anon, authenticated;

drop trigger if exists trg_mia_desliga_o_transitorio_da_demonstracao on public.organizations;
create trigger trg_mia_desliga_o_transitorio_da_demonstracao
  after update of demonstracao on public.organizations
  for each row
  when (new.demonstracao and not old.demonstracao)
  execute function public.fn_mia_desliga_o_transitorio_da_demonstracao();
