-- manifest: O CONVITE DE EQUIPE passa a funcionar na empresa de demonstração (decisão do Gabriel, 07/10/2026). A 9010 tratava o convite como mais uma saída ("é e-mail") e o recusava em `team_invites` pelo gatilho `trg_mia_demonstracao_sem_convite`; medido em produção em 07/10, convidar uma pessoa pela tela Convidar membros de uma empresa de demonstração respondia "Erro interno" (a auditoria `member.invited` era gravada, o INSERT era recusado com 42501 e a rota devolvia 500). A trava existe para nada chegar aos CONTATOS fictícios nem a destino de fora (mensagem, follow-up, automação, conversão, aviso, agenda externa, campanha, push, ligação); convite de equipe é o sistema falando com uma pessoa real que quem administra a empresa escolheu, e é o jeito de dar acesso à demonstração a quem ainda não tem login. Esta migration derruba SÓ esse gatilho e tira da função `fn_mia_trava_da_demonstracao` (nossa, 9010) o ramo de `team_invites`; os outros onze gatilhos `trg_mia_demonstracao_*`, os dois da 9016 (agenda do Outlook) e a marca seguem exatamente como estavam. O que NÃO muda: ao MARCAR uma empresa como demonstração os convites pendentes dela continuam sendo revogados (`fn_mia_desliga_o_transitorio_da_demonstracao`), porque foram emitidos para a empresa de verdade que ela era. Do lado do código, o roteador de e-mail abre uma exceção nomeada só para o convite (`excecaoDaTravaDaDemonstracao: "convite_de_equipe"`, usada só por `issueInvite`). Nenhum objeto do upstream é tocado. Provado em tests/invariants/empresa-de-demonstracao-nao-envia.test.ts (o convite entra na demonstração; todas as outras portas seguem recusadas, cada uma com controle) e em tests/invariants/mcp-de-implantacao-ponta-a-ponta.test.ts.
--
-- 9020 · o convite de equipe funciona na empresa de demonstração
--
-- ── O que aconteceu ─────────────────────────────────────────────────────────
--
-- A 9010 fechou, na empresa de demonstração, cada porta por onde algo sai. Uma
-- delas era `team_invites`: "convite de equipe (que é e-mail)". O raciocínio
-- valia para o e-mail e errava o destinatário: a trava existe para nada chegar
-- aos contatos fictícios nem a um destino de fora, e quem recebe um convite de
-- equipe não é contato de ninguém. É uma pessoa de verdade que quem administra a
-- empresa escolheu, para entrar e ver a demonstração.
--
-- O efeito, medido em produção em 07/10/2026: na tela Convidar membros de uma
-- empresa de demonstração, o convite respondia "Erro interno. Tente de novo em
-- instantes." O roteador de e-mail recusava o envio, a auditoria
-- `member.invited` era gravada com esse motivo, o INSERT em `team_invites` era
-- recusado pelo gatilho (42501) e a rota devolvia 500. O único jeito de dar
-- acesso à demonstração era incluir, pela semente, quem JÁ tinha login.
--
-- ── A regra, a partir daqui ─────────────────────────────────────────────────
--
-- Convite de equipe funciona na empresa de demonstração como em qualquer
-- empresa: a linha nasce, o e-mail do convite sai, a pessoa aceita e entra.
-- TUDO O RESTO continua recusado como antes: mensagem de saída, número vivo,
-- campanha e broadcast, regra com webhook ou aviso no grupo, aviso de caso,
-- conversões, agenda externa (Google e Outlook), push e ligação.
--
-- ── O que esta migration faz, e só isto ─────────────────────────────────────
--
--   1. derruba o gatilho `trg_mia_demonstracao_sem_convite` de `team_invites`;
--   2. redefine `fn_mia_trava_da_demonstracao` SEM o ramo de `team_invites`. O
--      corpo é o da 9010, linha a linha, menos esse ramo: com o gatilho fora o
--      ramo já não rodaria, e ele sai para a função não dizer que trava o que
--      não trava (e para um gatilho recriado por engano não reacender a recusa).
--
-- ── O que NÃO muda ──────────────────────────────────────────────────────────
--
--   · os outros onze gatilhos `trg_mia_demonstracao_*` da 9010 e os dois da 9016;
--   · a marca (`fn_mia_marca_de_demonstracao`) e a pergunta (`fn_mia_e_demonstracao`);
--   · `fn_mia_desliga_o_transitorio_da_demonstracao`: ao MARCAR uma empresa como
--     demonstração, os convites pendentes dela continuam sendo revogados. Eles
--     foram emitidos para a empresa de verdade que ela era; quem quiser dar
--     acesso à demonstração convida de novo, já com a marca.
--
-- `fn_mia_`/`trg_mia_`: só objetos NOSSOS (9010) são tocados (docs/FORK-MIA.md,
-- regra 3). Idempotente: `drop trigger if exists` e `create or replace`.

-- ── 1. o gatilho do convite sai ─────────────────────────────────────────────
drop trigger if exists trg_mia_demonstracao_sem_convite on public.team_invites;

-- ── 2. a função da trava, sem o ramo do convite ─────────────────────────────
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

    -- (9020) o convite de equipe saiu daqui: ele funciona na demonstração.

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
  'MIA (9010, revista na 9020): a trava da empresa de demonstracao. Recusa (42501) fila de mensagem de saida, numero vivo, campanha e broadcast agendados, regra ativa com webhook ou aviso no grupo, aviso de caso, conversoes, agenda externa, push e ligacao. Em UPDATE de messages converte a fila em failed em vez de recusar (lote do vigia). Convite de equipe NAO e travado desde a 9020: e o sistema falando com uma pessoa real que quem administra escolheu, e nao com um contato.';

revoke all on function public.fn_mia_trava_da_demonstracao() from public;
revoke execute on function public.fn_mia_trava_da_demonstracao() from anon, authenticated;

-- ── 3. a coluna da marca diz o que a trava cobre ────────────────────────────
comment on column public.organizations.demonstracao is
  'MIA (9010, revista na 9020): empresa de DEMONSTRACAO (cliente modelo, dados ficticios). Nada sai dela para os contatos nem para destino de fora (os gatilhos trg_mia_demonstracao_* recusam fila de saida, numero vivo, agendamento de campanha e broadcast, destinos externos) e ela fica fora das metricas, do faturamento e dos relatorios da plataforma. Convite de equipe funciona nela (9020). So a plataforma marca e desmarca.';
