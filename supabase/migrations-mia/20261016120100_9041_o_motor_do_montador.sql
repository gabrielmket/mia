-- manifest: O MOTOR DO MONTADOR DE RELATÓRIOS (item 9, protótipo aprovado em 15/10/2026): o que faltava no motor de conta da 9030 para o montador, e a LISTA POR TRÁS DO NÚMERO. Redefine só funções NOSSAS da 9030 (`fn_mia_relatorio_catalogo`, `fn_mia_relatorio_linhas_de_anuncios`, `fn_mia_relatorio_linhas`, `fn_mia_relatorio_passa`, `fn_mia_relatorio`), mesmas assinaturas, espelhadas no baseline-mia.sql. O que muda: (1) negócios agrupam e filtram por PRODUTO (os produtos do catálogo nos itens das propostas do negócio, menos as canceladas e as substituídas; o negócio com dois produtos conta em cada um, como as etiquetas, e o sem proposta é "Sem produto"); (2) follow-up agrupa e filtra por RESPONSÁVEL (o dono do contato, `carteira_user_id`, o mesmo dos contatos); (3) conversas: o responsável é QUEM ATENDEU, a primeira pessoa que respondeu ou, quando só o agente respondeu, o AGENTE com o nome dele (`ia:<id>`, o agente ativo da conversa ou o da última invocação), e quem não teve resposta fica com quem está atribuído; (4) FILTRO COM VÁRIOS VALORES: uma lista passa se a linha casar com qualquer um deles ("__sem" vale dentro da lista), lista de um vira valor, lista vazia some; funil e só-receita continuam de um valor só; (5) a META POR GRUPO quando a medida é soma dos ganhos agrupando por mês, semana ou dia (`meta_cents` em cada grupo: o alvo do mês, e semana e dia proporcionais aos dias de cada mês), para a linha da meta no gráfico; (6) o FUNIL COM VALOR: "chegaram" aceita a soma junto; (7) a resposta devolve `series_dobradas`, as séries que foram para "Outros". O preparo do pedido (guarda de vínculo, catálogo, filtros, fuso, período, funil) vira `fn_mia_relatorio_preparar`, a régua única do motor e da lista; as linhas só calculam o caro (produto, agente) quando o pedido usa. Peças novas: `fn_mia_relatorio_passa_um`, `fn_mia_relatorio_detalhes` (quem é cada registro: título, contato, telefone, etapa, onde abrir no CRM; `security invoker`, a RLS de quem pergunta) e `fn_mia_relatorio_lista` (os registros de um grupo, de uma célula, de "Outros" ou de uma etapa do funil, com a MESMA conta do gráfico em `total` e a página pedida, até 20.000 linhas para a planilha). Anúncios passam a levar o negócio de origem no rótulo (só para gestor e administrador, como antes), para "Abrir no CRM". Nenhum objeto do upstream é redefinido. Provado em tests/invariants/montador-de-relatorios.test.ts e tests/invariants/motor-de-conta-dos-relatorios.test.ts.
--
-- 9041 · o motor do montador e a lista por trás do número
--
-- `mia`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Toda função aqui é da
-- 9030 (redefinida com a MESMA assinatura, `create or replace`) ou nova, com
-- nome nosso. Idempotente.
--
-- ── A régua única ───────────────────────────────────────────────────────────
--
-- "A conta da lista é o mesmo número da barra" (protótipo, tela 4). A lista
-- não reimplementa nada: o pedido passa por `fn_mia_relatorio_preparar` (a
-- mesma guarda, os mesmos filtros normalizados, o mesmo período no fuso da
-- empresa, o mesmo funil), as linhas saem de `fn_mia_relatorio_linhas` com o
-- mesmo filtro, o grupo é escolhido por `fn_mia_relatorio_chaves` (a mesma
-- chave que agrupou) e o número do topo da lista é `fn_mia_relatorio_medir`
-- sobre as linhas escolhidas. Se a lista não bater com a barra, o defeito
-- aparece na hora, não na reunião.

-- ── 1. o catálogo ───────────────────────────────────────────────────────────
create or replace function public.fn_mia_relatorio_catalogo()
returns jsonb
language sql
immutable
set search_path = ''
as $f$
  select '{
    "negocios": {
      "medidas": ["qtd", "soma", "media", "conv", "tetapa", "tfechar", "prev", "sem_prob", "chegaram"],
      "dims": ["etapa", "situacao", "resp", "origem", "etiqueta", "produto", "motivo", "previsto", "funil", "mes", "semana", "dia"],
      "filtros": ["funil", "resp", "etiqueta", "situacao", "origem", "produto", "motivo", "so_receita"],
      "futuro": false
    },
    "conversas": {
      "medidas": ["qtd", "tresp", "tresp90", "resolv"],
      "dims": ["quem", "canal", "resp", "etiqueta", "mes", "semana", "dia"],
      "filtros": ["resp", "etiqueta", "canal", "quem"],
      "futuro": false
    },
    "contatos": {
      "medidas": ["qtd"],
      "dims": ["origem", "canal", "etiqueta", "resp", "mes", "semana", "dia"],
      "filtros": ["resp", "etiqueta", "origem", "canal"],
      "futuro": false
    },
    "agenda": {
      "medidas": ["qtd", "comp"],
      "dims": ["situacao", "tipo", "prof", "resp", "mes", "semana", "dia"],
      "filtros": ["resp", "situacao", "prof", "tipo"],
      "futuro": true
    },
    "followup": {
      "medidas": ["qtd", "taxa"],
      "dims": ["resultado", "fluxo", "resp", "mes", "semana", "dia"],
      "filtros": ["fluxo", "resultado", "resp"],
      "futuro": false
    },
    "obrigacoes": {
      "medidas": ["qtd", "emdia"],
      "dims": ["situacao", "tipo", "resp", "categoria", "mes", "semana"],
      "filtros": ["resp", "situacao", "tipo", "categoria"],
      "futuro": true
    },
    "anuncios": {
      "medidas": ["qtd", "aceito"],
      "dims": ["evento", "plataforma", "campanha", "mes", "semana", "dia"],
      "filtros": ["plataforma", "evento"],
      "futuro": false
    },
    "_tempo": ["mes", "semana", "dia"],
    "_naturais": {
      "negocios.situacao": ["aberto", "ganho", "perdido"],
      "conversas.quem": ["agente", "equipe", "sem_resposta"],
      "agenda.situacao": ["marcado", "confirmado", "compareceu", "faltou", "desmarcou"],
      "followup.resultado": ["respondeu", "fechou", "equipe", "parou", "sem_resposta", "andamento", "encerrado"],
      "obrigacoes.situacao": ["a_pedir", "pedido", "recebido", "valido", "vencendo", "vencido", "pendente", "feita"],
      "obrigacoes.categoria": ["documento", "atividade"],
      "anuncios.plataforma": ["meta_ads", "google_ads"]
    },
    "_ordenados_pela_chave": ["previsto"],
    "_com_sem": ["resp", "origem", "etiqueta", "produto", "motivo", "previsto", "tipo", "prof", "campanha", "canal"],
    "_de_valor": ["soma", "media", "prev"],
    "_um_valor_so": ["funil", "so_receita"]
  }'::jsonb;
$f$;

comment on function public.fn_mia_relatorio_catalogo() is
  'MIA (9030, 9041): o que cada fonte do motor de relatorios mede, agrupa e filtra. Espelhado em lib/paineis/catalogo.ts e conferido pelo invariante. 9041: produto nos negocios, responsavel no follow-up, filtros de um valor so.';

-- ── 2. anúncios: o negócio de origem no rótulo ──────────────────────────────
--
-- O mesmo definer estreito da 9030, com UMA coisa a mais: o id do negócio de
-- origem em `rotulos.negocio`, para a lista oferecer "Abrir no CRM". Continua
-- sem nome, telefone, valor ou título, e continua só para gestor e
-- administrador (ou a plataforma).
create or replace function public.fn_mia_relatorio_linhas_de_anuncios(
  p_org uuid,
  p_inicio timestamptz,
  p_fim timestamptz
) returns setof public.mia_relatorio_linha
language plpgsql
stable
security definer
set search_path = ''
as $f$
begin
  if auth.uid() is not null
     and not public.fn_is_platform_admin()
     and not public.fn_role_at_least(p_org, 'manager') then
    return;
  end if;
  return query
  select
    d.id,
    d.attempted_at,
    jsonb_build_object(
      'plataforma', d.platform,
      'evento', case
                  when d.event_name = 'Purchase' then 'compra'
                  when d.event_name = 'QualifiedLead' then 'qualificado'
                  when d.event_name ~ '^(Meta)?Etapa:' then 'etapa:' || split_part(d.event_name, ':', 2)
                  else d.event_name
                end,
      'campanha', nullif(btrim(coalesce(
                    l.source_metadata->>'campaign_name',
                    l.source_metadata->>'campaign',
                    l.source_metadata->>'utm_campaign')), '')
    ),
    jsonb_build_object('evento', s.name, 'negocio', d.lead_id),
    null::bigint,
    null::text,
    d.status,
    null::numeric,
    null::numeric,
    null::numeric,
    null::numeric,
    d.status = 'sent'
  from public.ad_conversion_dispatches d
  left join public.crm_leads l
    on l.id = d.lead_id and l.organization_id = d.organization_id
  left join public.crm_stages s
    on d.event_name ~ '^(Meta)?Etapa:[0-9a-fA-F-]{36}$'
   and s.id = split_part(d.event_name, ':', 2)::uuid
   and s.organization_id = d.organization_id
  where d.organization_id = p_org
    and d.status in ('sent', 'error')
    and d.attempted_at >= p_inicio
    and d.attempted_at < p_fim;
end;
$f$;

comment on function public.fn_mia_relatorio_linhas_de_anuncios(uuid, timestamptz, timestamptz) is
  'MIA (9030, 9041): as linhas da fonte "anuncios" do motor de relatorios: o que o sistema informou a Meta e ao Google (enviado ou recusado; o que nem saiu fica de fora) por plataforma, evento e campanha, e o id do negocio de origem para abrir no CRM, sem nome, telefone, valor ou titulo. Definer porque ad_conversion_dispatches e so do servidor; confere gestor ou administrador (ou a plataforma) e, para os outros, devolve zero linhas.';

revoke all on function public.fn_mia_relatorio_linhas_de_anuncios(uuid, timestamptz, timestamptz) from public;
revoke execute on function public.fn_mia_relatorio_linhas_de_anuncios(uuid, timestamptz, timestamptz) from anon;
grant execute on function public.fn_mia_relatorio_linhas_de_anuncios(uuid, timestamptz, timestamptz)
  to authenticated, service_role;

-- ── 3. as linhas de cada fonte ──────────────────────────────────────────────
--
-- A regra de data é a da 9030. O que muda está marcado "9041". `__precisa`
-- (lista de agrupamentos e filtros que o pedido usa, posta pelo preparo) diz
-- se vale buscar o caro: os produtos do negócio (propostas e catálogo) e o
-- agente da conversa.
create or replace function public.fn_mia_relatorio_linhas(
  p_org uuid,
  p_fonte text,
  p_inicio timestamptz,
  p_fim timestamptz,
  p_filtros jsonb,
  p_agora timestamptz,
  p_fuso text
) returns setof public.mia_relatorio_linha
language plpgsql
stable
set search_path = ''
as $f$
declare
  v_agora timestamptz := coalesce(p_agora, now());
  v_hoje date := (coalesce(p_agora, now()) at time zone p_fuso)::date;
  v_funil uuid := nullif(coalesce(p_filtros, '{}'::jsonb)->>'funil', '')::uuid;
  v_so_receita boolean := coalesce((coalesce(p_filtros, '{}'::jsonb)->>'so_receita')::boolean, false);
  v_tudo boolean := p_inicio = '-infinity'::timestamptz;
  -- 9041: só calcula o caro quando o pedido usa (sem `__precisa`, calcula tudo).
  v_precisa jsonb := coalesce(p_filtros, '{}'::jsonb) -> '__precisa';
  v_produto boolean := v_precisa is null or v_precisa ? 'produto';
  v_agente boolean := v_precisa is null or v_precisa ? 'resp';
begin
  if p_fonte = 'negocios' then
    return query
    with primeira as (
      select st.pipeline_id, min(st.position) as posicao
        from public.crm_stages st
       where st.organization_id = p_org and not st.is_archived and not st.is_lost
       group by st.pipeline_id
    )
    select
      l.id,
      case when l.status = 'open' then l.created_at else l.closed_at end,
      jsonb_build_object(
        'etapa', l.stage_id::text,
        'situacao', case l.status when 'open' then 'aberto' when 'won' then 'ganho' else 'perdido' end,
        'resp', l.owner_user_id::text,
        'origem', nullif(btrim(l.source), ''),
        'etiqueta', to_jsonb(coalesce(l.tags, '{}'::text[])),
        -- 9041: os produtos do catálogo nas propostas do negócio.
        'produto', coalesce(pd.produtos, '[]'::jsonb),
        'motivo', case when l.status = 'lost' then nullif(btrim(l.lost_reason), '') end,
        'previsto', to_char(l.expected_close_date, 'YYYY-MM'),
        'funil', l.pipeline_id::text
      ),
      jsonb_build_object('etapa', s.name, 'funil', p.name, 'ordem_etapa', s.position),
      l.value_cents,
      nullif(btrim(l.currency), ''),
      case l.status when 'open' then 'aberto' when 'won' then 'ganho' else 'perdido' end,
      round((extract(epoch from (coalesce(l.closed_at, v_agora) - coalesce(l.stage_changed_at, l.created_at))) / 86400.0)::numeric, 2),
      case when l.status = 'won'
           then round((extract(epoch from (l.closed_at - l.created_at)) / 86400.0)::numeric, 2) end,
      case
        when l.status = 'won' then 1e12::numeric
        when l.status = 'lost' then coalesce(lf.position, case when not s.is_lost then s.position end, pr.posicao)
        else s.position
      end,
      case
        when s.is_won then 100::numeric
        when s.is_lost then 0::numeric
        when (p.settings #>> '{previsao,fonte}') = 'ia_quando_houver' and sc.ai_probability is not null
          then sc.ai_probability::numeric
        else s.win_probability::numeric
      end,
      l.status = 'won'
    from public.crm_leads l
    join public.crm_stages s on s.id = l.stage_id and s.organization_id = l.organization_id
    join public.crm_pipelines p on p.id = l.pipeline_id and p.organization_id = l.organization_id
    left join public.crm_stages lf
      on lf.id = l.lost_from_stage_id and lf.pipeline_id = l.pipeline_id
    left join primeira pr on pr.pipeline_id = l.pipeline_id
    left join public.crm_lead_scores sc
      on sc.lead_id = l.id and sc.organization_id = l.organization_id
    left join lateral (
      -- O produto do negócio é o que foi proposto a ele: os itens com produto
      -- do catálogo, menos as propostas canceladas e as substituídas por uma
      -- versão nova (que traz os itens dela). Pelo NOME, como a etiqueta: é o
      -- que a pessoa lê, e o filtro casa pelo mesmo texto.
      select jsonb_agg(distinct btrim(cp.nome)) as produtos
        from public.crm_proposals pp
        join public.crm_proposal_items it
          on it.proposal_id = pp.id and it.organization_id = pp.organization_id
        join public.catalog_products cp
          on cp.id = it.product_id and cp.organization_id = pp.organization_id
       where v_produto
         and pp.lead_id = l.id and pp.organization_id = p_org
         and pp.status not in ('cancelada', 'substituida')
         and nullif(btrim(cp.nome), '') is not null
    ) pd on true
    where l.organization_id = p_org
      and coalesce(l.lost_reason, '') <> 'moved_to_another_pipeline'
      and (v_funil is null or l.pipeline_id = v_funil)
      and (not v_so_receita or coalesce((p.settings->>'vitoria_e_receita')::boolean, true))
      and (
        (l.status = 'open' and l.created_at >= p_inicio and l.created_at < p_fim)
        or (l.status <> 'open' and l.closed_at >= p_inicio and l.closed_at < p_fim)
      );

  elsif p_fonte = 'conversas' then
    -- 9041: o responsável é QUEM ATENDEU. A primeira pessoa que respondeu (a do
    -- celular não tem usuário: fica com quem está atribuído); quando só o
    -- agente respondeu, o agente, pelo nome (o ativo na conversa, ou o da
    -- última invocação); sem resposta, quem está atribuído.
    return query
    select
      c.id,
      f.primeira_entrada,
      jsonb_build_object(
        'quem', case when r.primeira_humana is not null then 'equipe'
                     when r.primeira_ia is not null then 'agente'
                     else 'sem_resposta' end,
        'canal', c.channel,
        'resp', case
                  when r.primeira_humana is not null then coalesce(r.humano, c.assigned_to_user_id)::text
                  when r.primeira_ia is not null then 'ia:' || coalesce(ag.id::text, '')
                  else c.assigned_to_user_id::text
                end,
        'etiqueta', to_jsonb(coalesce(c.tags, '{}'::text[]))
      ),
      jsonb_build_object('resp', ag.name),
      null::bigint,
      null::text,
      null::text,
      case
        when r.primeira_humana is not null
          then round(extract(epoch from (r.primeira_humana - f.primeira_entrada))::numeric)
        when r.primeira_ia is not null
          then round(extract(epoch from (r.primeira_ia - f.primeira_entrada))::numeric)
      end,
      null::numeric,
      null::numeric,
      null::numeric,
      (r.primeira_humana is null and r.primeira_ia is not null)
    from public.conversations c
    cross join lateral (
      select min(m.sent_at) as primeira_entrada
        from public.messages m
       where m.conversation_id = c.id
         and m.direction = 'inbound'
         and m.sent_at >= p_inicio and m.sent_at < p_fim
    ) f
    cross join lateral (
      select
        min(m.sent_at) filter (where m.sent_by_user_id is not null or m.sent_via = 'external_device') as primeira_humana,
        (array_agg(m.sent_by_user_id order by m.sent_at) filter (where m.sent_by_user_id is not null))[1] as humano,
        min(m.sent_at) filter (where m.sent_via = 'ai') as primeira_ia
      from public.messages m
      where m.conversation_id = c.id
        and m.direction = 'outbound'
        and m.sent_at >= f.primeira_entrada and m.sent_at < p_fim
    ) r
    left join lateral (
      select a.id, a.name
        from public.ai_agents a
       where v_agente
         and r.primeira_humana is null and r.primeira_ia is not null
         and a.organization_id = p_org
         and a.id = coalesce(c.active_ai_agent_id, (
               select i.agent_id from public.ai_invocations i
                where i.conversation_id = c.id and i.organization_id = p_org
                order by i.created_at desc
                limit 1))
    ) ag on true
    where c.organization_id = p_org
      and not c.is_group
      and greatest(c.last_inbound_at, c.last_message_at, c.created_at) >= p_inicio
      and c.created_at < p_fim
      and f.primeira_entrada is not null;

  elsif p_fonte = 'contatos' then
    return query
    select
      ct.id,
      ct.created_at,
      jsonb_build_object(
        'origem', nullif(btrim(ct.source), ''),
        'canal', cv.channel,
        'etiqueta', to_jsonb(coalesce(ct.tags, '{}'::text[])),
        'resp', ct.carteira_user_id::text
      ),
      '{}'::jsonb,
      null::bigint, null::text, null::text,
      null::numeric, null::numeric, null::numeric, null::numeric,
      false
    from public.contacts ct
    left join lateral (
      select c.channel from public.conversations c
       where c.contact_id = ct.id and c.organization_id = p_org
       order by c.created_at
       limit 1
    ) cv on true
    where ct.organization_id = p_org
      and ct.is_merged_into is null
      and not ct.is_personal
      and ct.kind = 'person'
      and ct.created_at >= p_inicio and ct.created_at < p_fim;

  elsif p_fonte = 'agenda' then
    return query
    select
      a.id,
      a.starts_at,
      jsonb_build_object(
        'situacao', case a.status when 'pending' then 'marcado' when 'confirmed' then 'confirmado'
                                  when 'completed' then 'compareceu' when 'no_show' then 'faltou'
                                  else 'desmarcou' end,
        'tipo', a.event_type_id::text,
        'prof', a.owner_user_id::text,
        'resp', case when a.created_by_kind = 'ai' and a.created_by_agent_id is not null
                     then 'ia:' || a.created_by_agent_id::text
                     else a.created_by_user_id::text end
      ),
      jsonb_build_object(
        'tipo', et.name,
        'resp', case when a.created_by_kind = 'ai' then ag.name end
      ),
      null::bigint, null::text,
      case a.status when 'pending' then 'marcado' when 'confirmed' then 'confirmado'
                    when 'completed' then 'compareceu' when 'no_show' then 'faltou'
                    else 'desmarcou' end,
      null::numeric, null::numeric, null::numeric, null::numeric,
      a.status = 'completed'
    from public.calendar_appointments a
    left join public.calendar_event_types et
      on et.id = a.event_type_id and et.organization_id = a.organization_id
    left join public.ai_agents ag
      on ag.id = a.created_by_agent_id and ag.organization_id = a.organization_id
    where a.organization_id = p_org
      and a.starts_at >= p_inicio and a.starts_at < p_fim;

  elsif p_fonte = 'followup' then
    -- 9041: o responsável é o dono do contato (`carteira_user_id`), o mesmo
    -- dos contatos.
    return query
    select
      e.id,
      e.started_at,
      jsonb_build_object(
        'resultado', case e.outcome
                       when 'converted' then 'fechou'
                       when 'replied' then 'respondeu'
                       when 'opted_out' then 'parou'
                       when 'handoff' then 'equipe'
                       when 'exhausted' then 'sem_resposta'
                       else case when e.status in ('completed', 'cancelled', 'dead') then 'encerrado'
                                 else 'andamento' end
                     end,
        'fluxo', e.pointer_id::text,
        'resp', ct.carteira_user_id::text
      ),
      jsonb_build_object('fluxo', fp.name),
      null::bigint, null::text, e.outcome,
      null::numeric, null::numeric, null::numeric, null::numeric,
      coalesce(e.outcome in ('replied', 'converted'), false)
    from public.followup_enrollments e
    join public.followup_flow_pointers fp
      on fp.id = e.pointer_id and fp.organization_id = e.organization_id and fp.surface = 'followup'
    left join public.contacts ct
      on ct.id = e.contact_id and ct.organization_id = e.organization_id
    where e.organization_id = p_org
      and e.started_at >= p_inicio and e.started_at < p_fim
      and exists (
        select 1 from public.followup_enrollment_events ev
         where ev.enrollment_id = e.id and ev.event_type = 'action_sent'
      );

  elsif p_fonte = 'obrigacoes' then
    return query
    select
      o.id,
      case when v.vence is null then null
           else (v.vence::timestamp at time zone p_fuso) end,
      jsonb_build_object(
        'situacao', v.sit,
        'tipo', coalesce(o.tipo_id::text, 'nome:' || o.nome),
        'resp', o.responsavel_user_id::text,
        'categoria', o.categoria
      ),
      jsonb_build_object('tipo', coalesce(t.nome, o.nome)),
      null::bigint, null::text, v.sit,
      null::numeric, null::numeric, null::numeric, null::numeric,
      v.sit in ('valido', 'recebido', 'feita')
    from public.mia_obrigacoes o
    left join public.mia_obrigacoes_tipos t
      on t.id = o.tipo_id and t.organization_id = o.organization_id
    cross join lateral (
      select
        case when o.categoria = 'atividade' then o.proxima_em else coalesce(o.valido_ate, o.prazo_em) end as vence,
        public.fn_mia_obrigacao_situacao(o.categoria, o.proxima_em, o.feita_em, o.valido_ate,
                                         o.recebido_em, o.pedido_em, o.avisos_dias, v_hoje) as sit
    ) v
    where o.organization_id = p_org
      and o.arquivado_em is null
      and (
        (v_tudo and v.vence is null)
        or (v.vence is not null
            and (v.vence::timestamp at time zone p_fuso) >= p_inicio
            and (v.vence::timestamp at time zone p_fuso) < p_fim)
      );

  elsif p_fonte = 'anuncios' then
    return query
    select * from public.fn_mia_relatorio_linhas_de_anuncios(p_org, p_inicio, p_fim);

  else
    raise exception 'fonte_desconhecida: %', p_fonte using errcode = '22023';
  end if;
end;
$f$;

comment on function public.fn_mia_relatorio_linhas(uuid, text, timestamptz, timestamptz, jsonb, timestamptz, text) is
  'MIA (9030, 9041): as linhas de uma fonte do motor de relatorios no periodo [p_inicio, p_fim), com a regra de data do prototipo. security invoker: cada fonte le pela RLS de quem chama, e toda leitura filtra organization_id = p_org. 9041: produto nos negocios, quem atendeu (pessoa ou agente) nas conversas, dono do contato no follow-up; __precisa em p_filtros diz se vale buscar produto e agente.';

-- ── 4. o filtro ─────────────────────────────────────────────────────────────
--
-- Um valor contra uma linha: a peça que o filtro de vários valores repete.
create or replace function public.fn_mia_relatorio_passa_um(p_dims jsonb, p_chave text, p_valor text)
returns boolean
language sql
immutable
set search_path = ''
as $f$
  select case
    when jsonb_typeof(p_dims -> p_chave) = 'array' then
      case when p_valor = '__sem'
           then jsonb_array_length(p_dims -> p_chave) = 0
           else (p_dims -> p_chave) ? p_valor end
    else
      case when p_valor = '__sem'
           then nullif(btrim(p_dims ->> p_chave), '') is null
           else (p_dims ->> p_chave) is not distinct from p_valor end
  end;
$f$;

comment on function public.fn_mia_relatorio_passa_um(jsonb, text, text) is
  'MIA (9041): a linha do motor passa num valor de um filtro? "__sem" pede a ausencia; nas listas (etiqueta, produto), ter o valor.';

-- 9041: a LISTA passa se casar com qualquer valor dela. `so_receita` e as
-- chaves internas (`__…`) não são chave de linha: a fonte e o preparo cuidam.
create or replace function public.fn_mia_relatorio_passa(p_dims jsonb, p_filtros jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $f$
  select coalesce(bool_and(
    case
      when f.key = 'so_receita' or left(f.key, 2) = '__' then true
      when jsonb_typeof(f.value) = 'array' then
        jsonb_array_length(f.value) = 0
        or exists (
          select 1 from jsonb_array_elements_text(f.value) v
           where public.fn_mia_relatorio_passa_um(p_dims, f.key, v))
      else public.fn_mia_relatorio_passa_um(p_dims, f.key, f.value #>> '{}')
    end
  ), true)
  from jsonb_each(coalesce(p_filtros, '{}'::jsonb)) f;
$f$;

comment on function public.fn_mia_relatorio_passa(jsonb, jsonb) is
  'MIA (9030, 9041): a linha do motor de relatorios passa nos filtros? Um valor, ou uma lista (qualquer um deles); "__sem" pede a ausencia; nas etiquetas e produtos, ter o valor. so_receita e as chaves internas (__...) nao sao chave de linha.';

-- ── 5. o preparo do pedido ──────────────────────────────────────────────────
--
-- Tudo o que o motor fazia antes de olhar uma linha, agora num lugar só, para
-- o motor e a lista: quem pergunta, o catálogo, os filtros normalizados (lista
-- de um vira valor, lista vazia some, funil e só-receita de um valor só), o
-- fuso e a moeda da empresa, a janela do período e o funil.
create or replace function public.fn_mia_relatorio_preparar(
  p_org uuid,
  p_fonte text,
  p_medidas text[],
  p_dim1 text,
  p_dim2 text,
  p_filtros jsonb,
  p_periodo text,
  p_de date,
  p_ate date,
  p_agora timestamptz
) returns jsonb
language plpgsql
stable
set search_path = ''
as $f$
declare
  v_catalogo jsonb := public.fn_mia_relatorio_catalogo();
  v_fonte jsonb := v_catalogo -> p_fonte;
  v_filtros jsonb := '{}'::jsonb;
  v_medidas text[];
  v_chave text;
  v_valor jsonb;
  v_fuso text;
  v_moeda text;
  v_janela jsonb;
  v_funil uuid;
  v_funil_info jsonb;
  v_precisa text[];
begin
  -- ── quem pergunta ──
  if auth.uid() is not null
     and not public.fn_is_platform_admin()
     and public.fn_user_role_in_org(p_org) is null then
    raise exception 'sem_vinculo_com_a_organizacao' using errcode = '42501';
  end if;

  -- ── o pedido ──
  if v_fonte is null or left(p_fonte, 1) = '_' then
    raise exception 'fonte_desconhecida: %', p_fonte using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct m order by m), '{}') into v_medidas
    from unnest(coalesce(p_medidas, '{}')) m where m is not null;
  if cardinality(v_medidas) = 0 or cardinality(v_medidas) > 6 then
    raise exception 'medidas: de uma a seis' using errcode = '22023';
  end if;
  foreach v_chave in array v_medidas loop
    if not (v_fonte -> 'medidas') ? v_chave then
      raise exception 'medida_desconhecida_para_a_fonte: % em %', v_chave, p_fonte using errcode = '22023';
    end if;
  end loop;
  if p_dim1 is not null and not (v_fonte -> 'dims') ? p_dim1 then
    raise exception 'agrupamento_desconhecido_para_a_fonte: % em %', p_dim1, p_fonte using errcode = '22023';
  end if;
  if p_dim2 is not null and (p_dim1 is null or not (v_fonte -> 'dims') ? p_dim2 or p_dim2 = p_dim1) then
    raise exception 'segundo_agrupamento_invalido: %', p_dim2 using errcode = '22023';
  end if;

  -- ── os filtros, normalizados ──
  if p_filtros is not null and jsonb_typeof(p_filtros) <> 'object' then
    raise exception 'filtros: um objeto' using errcode = '22023';
  end if;
  for v_chave, v_valor in select f.key, f.value from jsonb_each(coalesce(p_filtros, '{}'::jsonb)) f loop
    -- As chaves internas são do motor: quem pergunta não as escolhe.
    continue when left(v_chave, 2) = '__';
    if not (v_fonte -> 'filtros') ? v_chave then
      raise exception 'filtro_desconhecido_para_a_fonte: % em %', v_chave, p_fonte using errcode = '22023';
    end if;
    continue when jsonb_typeof(v_valor) = 'null';
    if jsonb_typeof(v_valor) = 'array' then
      if (v_catalogo -> '_um_valor_so') ? v_chave then
        raise exception 'filtro_de_um_valor_so: %', v_chave using errcode = '22023';
      end if;
      continue when jsonb_array_length(v_valor) = 0;
      if jsonb_array_length(v_valor) > 50 then
        raise exception 'filtro_com_mais_de_50_valores: %', v_chave using errcode = '22023';
      end if;
      if exists (select 1 from jsonb_array_elements(v_valor) e where jsonb_typeof(e) <> 'string') then
        raise exception 'filtro_lista_so_de_texto: %', v_chave using errcode = '22023';
      end if;
      if jsonb_array_length(v_valor) = 1 then
        v_valor := v_valor -> 0;
      end if;
    end if;
    v_filtros := v_filtros || jsonb_build_object(v_chave, v_valor);
  end loop;

  -- "Chegaram até a etapa" é o funil: agrupando por etapa, sozinha ou com a
  -- soma do valor de quem chegou (9041).
  if 'chegaram' = any(v_medidas)
     and (exists (select 1 from unnest(v_medidas) m where m not in ('chegaram', 'soma'))
          or p_dim1 is distinct from 'etapa' or p_dim2 is not null) then
    raise exception 'chegaram_so_agrupando_por_etapa_com_a_soma_no_maximo' using errcode = '22023';
  end if;

  -- Anúncios: o que foi informado à Meta e ao Google é de gestor e
  -- administrador (o piso das telas de Conversões e de Meta Ads).
  if p_fonte = 'anuncios' and auth.uid() is not null
     and not public.fn_is_platform_admin()
     and not public.fn_role_at_least(p_org, 'manager') then
    raise exception 'anuncios_so_para_gestor_ou_administrador' using errcode = '42501';
  end if;

  -- ── a empresa: fuso e moeda ──
  select coalesce(nullif(btrim(o.timezone), ''), 'America/Sao_Paulo'),
         coalesce(nullif(btrim(o.currency), ''), 'BRL')
    into v_fuso, v_moeda
    from public.organizations o
   where o.id = p_org;
  if v_fuso is null then
    raise exception 'organizacao_inexistente' using errcode = '22023';
  end if;

  -- ── o período ──
  v_janela := public.fn_mia_relatorio_janela(v_fuso, p_periodo, p_de, p_ate,
                                             coalesce((v_fonte->>'futuro')::boolean, false), p_agora);
  if v_janela->>'periodo' <> 'tudo' then
    if (p_dim1 = 'dia' or p_dim2 = 'dia') and (v_janela->>'dias')::int > 400 then
      raise exception 'agrupar_por_dia_ate_400_dias' using errcode = '22023';
    end if;
    if (p_dim1 = 'semana' or p_dim2 = 'semana') and (v_janela->>'dias')::int > 1830 then
      raise exception 'agrupar_por_semana_ate_cinco_anos' using errcode = '22023';
    end if;
  end if;

  -- ── o funil (negócios por etapa, ou filtrados por funil) ──
  if p_fonte = 'negocios'
     and (p_dim1 = 'etapa' or p_dim2 = 'etapa' or v_filtros ? 'funil') then
    v_funil := nullif(v_filtros->>'funil', '')::uuid;
    if v_funil is null then
      select p.id into v_funil
        from public.crm_pipelines p
       where p.organization_id = p_org and not p.is_archived
       order by p.is_default desc, p.position, p.created_at
       limit 1;
    end if;
    select jsonb_build_object('id', p.id, 'nome', p.name, 'vocabulario', p.vocabulary)
      into v_funil_info
      from public.crm_pipelines p
     where p.id = v_funil and p.organization_id = p_org;
    if v_funil_info is null then
      raise exception 'funil_inexistente' using errcode = '22023';
    end if;
    v_filtros := v_filtros || jsonb_build_object('funil', v_funil::text);
  end if;

  -- O que as linhas precisam calcular: os agrupamentos e os filtros do pedido.
  select coalesce(array_agg(distinct x), '{}') into v_precisa
    from unnest(array[p_dim1, p_dim2] || array(select jsonb_object_keys(v_filtros))) x
   where x is not null;

  return jsonb_build_object(
    'medidas', to_jsonb(v_medidas),
    'filtros', v_filtros,
    'precisa', to_jsonb(v_precisa),
    'fuso', v_fuso,
    'moeda', v_moeda,
    'janela', v_janela,
    'funil', v_funil_info
  );
end;
$f$;

comment on function public.fn_mia_relatorio_preparar(uuid, text, text[], text, text, jsonb, text, date, date, timestamptz) is
  'MIA (9041): o preparo de um pedido ao motor de relatorios, a regua unica do motor (fn_mia_relatorio) e da lista (fn_mia_relatorio_lista): a guarda de vinculo (42501), o catalogo (22023), os filtros normalizados, o fuso e a moeda da empresa, a janela do periodo e o funil.';

-- ── 6. o motor ──────────────────────────────────────────────────────────────
--
-- O da 9030, com o preparo em `fn_mia_relatorio_preparar` e as três coisas do
-- montador: o funil com a soma, a meta em cada grupo de tempo e as séries
-- dobradas na resposta.
create or replace function public.fn_mia_relatorio(
  p_org uuid,
  p_fonte text,
  p_medidas text[],
  p_dim1 text default null,
  p_dim2 text default null,
  p_filtros jsonb default '{}'::jsonb,
  p_periodo text default '30',
  p_de date default null,
  p_ate date default null,
  p_valores boolean default true,
  p_comparar boolean default false,
  p_agora timestamptz default null
) returns jsonb
language plpgsql
stable
set search_path = ''
as $f$
declare
  v_catalogo jsonb := public.fn_mia_relatorio_catalogo();
  v_tempo jsonb := v_catalogo -> '_tempo';
  v_com_sem jsonb := v_catalogo -> '_com_sem';
  v_prep jsonb;
  v_filtros jsonb;
  v_medidas text[];
  v_primeira text;
  v_fuso text;
  v_moeda text;
  v_janela jsonb;
  v_inicio timestamptz;
  v_fim timestamptz;
  v_funil uuid;
  v_funil_info jsonb;
  v_linhas public.mia_relatorio_linha[];
  v_total jsonb;
  v_grupos jsonb := '[]'::jsonb;
  v_dobrados text[] := '{}';
  v_series jsonb := null;
  v_series_chaves text[] := null;
  v_series_dobradas text[] := '{}';
  v_universo1 jsonb;
  v_universo2 jsonb;
  v_meta jsonb := null;
  v_meta_aplica boolean;
  v_soma_real bigint;
  v_alvo numeric;
  v_meses_sem_meta int;
  v_meses int;
  v_anterior jsonb := null;
  v_ant record;
  v_resposta jsonb;
begin
  v_prep := public.fn_mia_relatorio_preparar(p_org, p_fonte, p_medidas, p_dim1, p_dim2, p_filtros,
                                             p_periodo, p_de, p_ate, p_agora);
  v_medidas := array(select jsonb_array_elements_text(v_prep -> 'medidas'));
  v_filtros := v_prep -> 'filtros';
  v_fuso := v_prep ->> 'fuso';
  v_moeda := v_prep ->> 'moeda';
  v_janela := v_prep -> 'janela';
  v_funil_info := v_prep -> 'funil';
  v_funil := nullif(v_funil_info ->> 'id', '')::uuid;
  v_inicio := coalesce((v_janela->>'inicio')::timestamptz, '-infinity'::timestamptz);
  v_fim := coalesce((v_janela->>'fim')::timestamptz, 'infinity'::timestamptz);
  v_primeira := coalesce(p_medidas[1], v_medidas[1]);

  -- ── as linhas ──
  select array_agg(l)
    into v_linhas
    from public.fn_mia_relatorio_linhas(p_org, p_fonte, v_inicio, v_fim,
                                        v_filtros || jsonb_build_object('__precisa', v_prep -> 'precisa'),
                                        p_agora, v_fuso) l
   where public.fn_mia_relatorio_passa(l.dims, v_filtros);
  v_linhas := coalesce(v_linhas, '{}');

  -- ── o total (cada registro uma vez, mesmo com etiquetas) ──
  v_total := public.fn_mia_relatorio_medir(v_linhas, v_medidas, v_moeda, p_valores);

  -- ── "chegaram até a etapa": o funil (9041: com a soma de quem chegou) ──
  if 'chegaram' = any(v_medidas) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'chave', s.id::text,
             'rotulo', s.name,
             'ordem', s.position,
             'sem', false,
             'outros', false,
             'n', (x.m->>'n')::bigint,
             'n_ok', 0,
             'valores', ((x.m->'valores') - 'qtd') || jsonb_build_object('chegaram', (x.m->>'n')::bigint),
             'ganho', s.is_won
           ) order by s.position, s.name), '[]'::jsonb)
      into v_grupos
      from public.crm_stages s
      cross join lateral (
        select public.fn_mia_relatorio_medir(
                 coalesce(array_agg(u), '{}'),
                 array['qtd'] || array_remove(v_medidas, 'chegaram'),
                 v_moeda, p_valores) as m
          from unnest(v_linhas) u
         where u.x3 >= s.position
      ) x
     where s.pipeline_id = v_funil and s.organization_id = p_org
       and not s.is_archived and not s.is_lost;
  elsif p_dim1 is not null then
    v_universo1 := case
      when v_tempo ? p_dim1 and v_janela->>'periodo' <> 'tudo' then (
        select jsonb_agg(to_char(g, case p_dim1 when 'mes' then 'YYYY-MM' else 'YYYY-MM-DD' end) order by g)
          from generate_series(
                 case p_dim1 when 'mes' then date_trunc('month', (v_janela->>'de')::date)
                             when 'semana' then date_trunc('week', (v_janela->>'de')::date)
                             else (v_janela->>'de')::date end,
                 (v_janela->>'ate')::date,
                 case p_dim1 when 'mes' then interval '1 month' when 'semana' then interval '1 week'
                             else interval '1 day' end) g)
      when p_dim1 = 'etapa' then (
        select jsonb_agg(s.id::text order by s.position, s.name)
          from public.crm_stages s
         where s.pipeline_id = v_funil and s.organization_id = p_org and not s.is_archived)
      else coalesce(v_catalogo -> '_naturais' -> (p_fonte || '.' || p_dim1), '[]'::jsonb)
    end;
    if v_com_sem ? p_dim1 then
      v_universo1 := coalesce(v_universo1, '[]'::jsonb) || '["__sem"]'::jsonb;
    end if;

    with e as (
      select u as linha, k
        from unnest(v_linhas) u
        cross join lateral public.fn_mia_relatorio_chaves(u.dims, u.momento, p_dim1, v_fuso) k
    ),
    todas as (
      select k from e
      union
      select jsonb_array_elements_text(coalesce(v_universo1, '[]'::jsonb))
    ),
    g as (
      select t.k,
             public.fn_mia_relatorio_medir(
               coalesce(array_agg(e.linha) filter (where e.k is not null), '{}'),
               v_medidas, v_moeda, p_valores) as m,
             max((e.linha).rotulos ->> p_dim1) as rotulo,
             max(((e.linha).rotulos ->> 'ordem_etapa')::numeric) filter (where p_dim1 = 'etapa') as ordem
        from todas t
        left join e on e.k = t.k
       group by t.k
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'chave', g.k,
             'rotulo', g.rotulo,
             'ordem', g.ordem,
             'sem', g.k = '__sem',
             'outros', false,
             'n', (g.m->>'n')::bigint,
             'n_ok', (g.m->>'n_ok')::bigint,
             'valores', g.m->'valores'
           )), '[]'::jsonb)
      into v_grupos
      from g;

    if p_dim1 = 'etapa' then
      select coalesce(jsonb_agg(
               x || jsonb_build_object('rotulo', coalesce(x->>'rotulo', s.name), 'ordem', s.position)
             ), '[]'::jsonb)
        into v_grupos
        from jsonb_array_elements(v_grupos) x
        left join public.crm_stages s
          on s.id::text = x->>'chave' and s.organization_id = p_org;
    end if;

    if not (v_tempo ? p_dim1)
       and not (v_catalogo -> '_naturais' ? (p_fonte || '.' || p_dim1))
       and not (v_catalogo -> '_ordenados_pela_chave' ? p_dim1)
       and p_dim1 <> 'etapa'
       and jsonb_array_length(v_grupos) > 12 then
      with ranq as (
        select x->>'chave' as k,
               row_number() over (
                 order by ((x->'valores'->>v_primeira)::numeric) desc nulls last,
                          (x->>'n')::bigint desc,
                          coalesce(x->>'rotulo', x->>'chave')) as rn
          from jsonb_array_elements(v_grupos) x
         where x->>'chave' <> '__sem'
      ),
      sem as (
        select count(*)::int as n from jsonb_array_elements(v_grupos) x where x->>'chave' = '__sem'
      )
      select coalesce(array_agg(r.k), '{}')
        into v_dobrados
        from ranq r, sem
       where r.rn > 11 - sem.n;

      if cardinality(v_dobrados) > 0 then
        select v_grupos_sem.lista || jsonb_build_array(jsonb_build_object(
                 'chave', '__outros',
                 'rotulo', null,
                 'ordem', null,
                 'sem', false,
                 'outros', true,
                 'quantos', cardinality(v_dobrados),
                 'n', (o.m->>'n')::bigint,
                 'n_ok', (o.m->>'n_ok')::bigint,
                 'valores', o.m->'valores'
               ))
          into v_grupos
          from (
            select coalesce(jsonb_agg(x), '[]'::jsonb) as lista
              from jsonb_array_elements(v_grupos) x
             where not (x->>'chave' = any(v_dobrados))
          ) v_grupos_sem,
          lateral (
            select public.fn_mia_relatorio_medir(coalesce(array_agg(u), '{}'), v_medidas, v_moeda, p_valores) as m
              from unnest(v_linhas) u
             where exists (
               select 1 from public.fn_mia_relatorio_chaves(u.dims, u.momento, p_dim1, v_fuso) k
                where k = any(v_dobrados))
          ) o;
      end if;
    end if;

    select coalesce(jsonb_agg(x order by
             (x->>'chave' = '__sem'),
             (x->>'chave' = '__outros'),
             case when p_dim1 = 'etapa' then (x->>'ordem')::numeric end,
             case when v_catalogo -> '_naturais' ? (p_fonte || '.' || p_dim1)
                  then (select i from jsonb_array_elements_text(v_catalogo -> '_naturais' -> (p_fonte || '.' || p_dim1))
                                 with ordinality n(v, i) where n.v = x->>'chave') end,
             case when v_tempo ? p_dim1 or v_catalogo -> '_ordenados_pela_chave' ? p_dim1
                  then x->>'chave' end,
             ((x->'valores'->>v_primeira)::numeric) desc nulls last,
             (x->>'n')::bigint desc,
             coalesce(x->>'rotulo', x->>'chave')
           ), '[]'::jsonb)
      into v_grupos
      from jsonb_array_elements(v_grupos) x;

    -- ── o segundo agrupamento: as séries ──
    if p_dim2 is not null then
      v_universo2 := case
        when v_tempo ? p_dim2 then '[]'::jsonb
        when p_dim2 = 'etapa' then (
          select jsonb_agg(s.id::text order by s.position, s.name)
            from public.crm_stages s
           where s.pipeline_id = v_funil and s.organization_id = p_org and not s.is_archived)
        else coalesce(v_catalogo -> '_naturais' -> (p_fonte || '.' || p_dim2), '[]'::jsonb)
      end;
      with e2 as (
        select distinct u.registro, k2
          from unnest(v_linhas) u
          cross join lateral public.fn_mia_relatorio_chaves(u.dims, u.momento, p_dim2, v_fuso) k2
      ),
      contagem as (
        select k2, count(*) as n from e2 group by k2
        union all
        select jsonb_array_elements_text(coalesce(v_universo2, '[]'::jsonb)), 0
      ),
      somadas as (
        select k2, sum(n) as n from contagem group by k2
      ),
      ranq as (
        select k2, n, row_number() over (order by n desc, k2) as rn from somadas where k2 <> '__sem'
      )
      select
        coalesce(array_agg(k2) filter (where k2 = '__sem' or not (
          (select count(*) from somadas) > 8
          and not (v_tempo ? p_dim2)
          and not (v_catalogo -> '_naturais' ? (p_fonte || '.' || p_dim2))
          and p_dim2 <> 'etapa'
          and coalesce((select rn from ranq r where r.k2 = s.k2), 0) > 7 - (select count(*) from somadas where k2 = '__sem')
        )), '{}'),
        coalesce(array_agg(k2) filter (where k2 <> '__sem' and (
          (select count(*) from somadas) > 8
          and not (v_tempo ? p_dim2)
          and not (v_catalogo -> '_naturais' ? (p_fonte || '.' || p_dim2))
          and p_dim2 <> 'etapa'
          and coalesce((select rn from ranq r where r.k2 = s.k2), 0) > 7 - (select count(*) from somadas where k2 = '__sem')
        )), '{}')
        into v_series_chaves, v_series_dobradas
        from somadas s;

      with e as (
        select u as linha,
               case when k1 = any(v_dobrados) then '__outros' else k1 end as k1,
               case when k2 = any(v_series_dobradas) then '__outros' else k2 end as k2
          from unnest(v_linhas) u
          cross join lateral public.fn_mia_relatorio_chaves(u.dims, u.momento, p_dim1, v_fuso) k1
          cross join lateral public.fn_mia_relatorio_chaves(u.dims, u.momento, p_dim2, v_fuso) k2
      ),
      celulas as (
        select e.k1, e.k2,
               public.fn_mia_relatorio_medir(array_agg(e.linha), v_medidas, v_moeda, p_valores) as m,
               max((e.linha).rotulos ->> p_dim2) as rotulo2
          from e
         group by e.k1, e.k2
      ),
      por_grupo as (
        select c.k1, jsonb_object_agg(c.k2, jsonb_build_object(
                 'n', (c.m->>'n')::bigint, 'n_ok', (c.m->>'n_ok')::bigint, 'valores', c.m->'valores')) as series
          from celulas c
         group by c.k1
      )
      select coalesce(jsonb_agg(x || jsonb_build_object('series', coalesce(pg.series, '{}'::jsonb))
               order by n.i), '[]'::jsonb)
        into v_grupos
        from jsonb_array_elements(v_grupos) with ordinality n(x, i)
        left join por_grupo pg on pg.k1 = n.x->>'chave';

      with e2 as (
        select distinct u.registro,
               case when k2 = any(v_series_dobradas) then '__outros' else k2 end as k2,
               (u.rotulos ->> p_dim2) as rotulo
          from unnest(v_linhas) u
          cross join lateral public.fn_mia_relatorio_chaves(u.dims, u.momento, p_dim2, v_fuso) k2
      ),
      lista as (
        select k as k2 from unnest(v_series_chaves) k
        union
        select '__outros' where cardinality(v_series_dobradas) > 0
      ),
      info as (
        select l.k2, count(distinct e2.registro) as n, max(e2.rotulo) as rotulo
          from lista l left join e2 on e2.k2 = l.k2
         group by l.k2
      )
      select coalesce(jsonb_agg(jsonb_build_object(
               'chave', i.k2,
               'rotulo', coalesce(i.rotulo, case when p_dim2 = 'etapa' then
                           (select s.name from public.crm_stages s where s.id::text = i.k2 and s.organization_id = p_org) end),
               'sem', i.k2 = '__sem',
               'outros', i.k2 = '__outros',
               'quantos', case when i.k2 = '__outros' then cardinality(v_series_dobradas) end,
               'n', i.n
             ) order by
               (i.k2 = '__sem'), (i.k2 = '__outros'),
               case when p_dim2 = 'etapa' then
                 (select s.position from public.crm_stages s where s.id::text = i.k2 and s.organization_id = p_org) end,
               case when v_catalogo -> '_naturais' ? (p_fonte || '.' || p_dim2)
                    then (select o from jsonb_array_elements_text(v_catalogo -> '_naturais' -> (p_fonte || '.' || p_dim2))
                                   with ordinality q(v, o) where q.v = i.k2) end,
               case when v_tempo ? p_dim2 or v_catalogo -> '_ordenados_pela_chave' ? p_dim2 then i.k2 end,
               i.n desc,
               i.k2), '[]'::jsonb)
        into v_series
        from info i;
    end if;
  end if;

  -- ── a meta (soma dos ganhos) ──
  v_meta_aplica := p_fonte = 'negocios' and 'soma' = any(v_medidas)
                   and v_filtros->>'situacao' = 'ganho' and v_janela->>'periodo' <> 'tudo';
  if v_meta_aplica then
    select coalesce(sum(r.valor_cents), 0)
      into v_soma_real
      from (select distinct on (u.registro) u.* from unnest(v_linhas) u order by u.registro) r
     where coalesce(r.moeda, v_moeda) = v_moeda;

    select
      case when v_janela->>'periodo' = 'mes' then max(a.alvo_cents)::numeric
           else sum(a.alvo_cents::numeric * a.dias_no_periodo / a.dias_do_mes) end,
      count(*) filter (where a.alvo_cents is null),
      count(*)
      into v_alvo, v_meses_sem_meta, v_meses
      from (
        select me.mes,
               t.alvo_cents,
               ((me.mes + interval '1 month')::date - me.mes) as dias_do_mes,
               (least((v_janela->>'ate')::date, (me.mes + interval '1 month' - interval '1 day')::date)
                - greatest((v_janela->>'de')::date, me.mes) + 1) as dias_no_periodo
          from (
            select date_trunc('month', g)::date as mes
              from generate_series(date_trunc('month', (v_janela->>'de')::date),
                                   (v_janela->>'ate')::date, interval '1 month') g
          ) me
          left join public.sales_targets t
            on t.organization_id = p_org and t.periodo = me.mes and t.metrica = 'receita_total'
           and t.user_id is null and t.agent_id is null
      ) a;

    if v_alvo is not null and v_alvo > 0 then
      v_meta := jsonb_build_object(
        'alvo_cents', case when p_valores then round(v_alvo) end,
        'proporcional', v_janela->>'periodo' <> 'mes',
        'meses_sem_meta', v_meses_sem_meta,
        'fracao', round(v_soma_real::numeric / v_alvo, 4),
        'corrido', case when v_janela->>'periodo' = 'mes' then
                     round((((v_janela->>'hoje')::date - (v_janela->>'de')::date + 1)::numeric)
                           / (((v_janela->>'de')::date + interval '1 month')::date - (v_janela->>'de')::date), 4)
                   end
      );
    end if;

    -- 9041: a linha da meta no gráfico. Em cada grupo de tempo, o alvo daquele
    -- pedaço: o mês inteiro no mês; na semana e no dia, a meta de cada mês
    -- dividida pelos dias dele (proporcional, a decisão do protótipo). Sem meta
    -- cadastrada no pedaço, nula. Sem valores, nula (o alvo é dinheiro).
    if p_dim1 in ('mes', 'semana', 'dia') then
      select coalesce(jsonb_agg(
               case when x->>'chave' in ('__sem', '__outros') then x
                    else x || jsonb_build_object('meta_cents', case when p_valores then (
                      select round(sum(t.alvo_cents::numeric
                                       / ((date_trunc('month', d) + interval '1 month')::date - date_trunc('month', d)::date)))
                        from generate_series(
                               case p_dim1 when 'mes' then ((x->>'chave') || '-01')::date else (x->>'chave')::date end,
                               case p_dim1 when 'mes' then (((x->>'chave') || '-01')::date + interval '1 month' - interval '1 day')::date
                                           when 'semana' then (x->>'chave')::date + 6
                                           else (x->>'chave')::date end,
                               interval '1 day') d
                        join public.sales_targets t
                          on t.organization_id = p_org and t.periodo = date_trunc('month', d)::date
                         and t.metrica = 'receita_total' and t.user_id is null and t.agent_id is null)
                    end)
               end order by n.i), '[]'::jsonb)
        into v_grupos
        from jsonb_array_elements(v_grupos) with ordinality n(x, i);
    end if;
  end if;

  -- ── o período anterior ──
  if p_comparar and v_janela->>'periodo' <> 'tudo' then
    select * into v_ant from public.fn_mia_relatorio_janela_anterior(v_janela);
    if v_ant.de is not null then
      v_anterior := public.fn_mia_relatorio(
        p_org, p_fonte, v_medidas, p_dim1, null,
        v_filtros, 'pers', v_ant.de, v_ant.ate, p_valores, false, p_agora);
      v_anterior := jsonb_build_object(
        'janela', v_anterior->'janela',
        'total', v_anterior->'total',
        'grupos', coalesce((
          select jsonb_object_agg(x->>'chave', jsonb_build_object('n', x->'n', 'valores', x->'valores'))
            from jsonb_array_elements(v_anterior->'grupos') x), '{}'::jsonb)
      );
    end if;
  end if;

  v_resposta := jsonb_build_object(
    'fonte', p_fonte,
    'medidas', to_jsonb(v_medidas),
    'dim1', p_dim1,
    'dim2', p_dim2,
    'filtros', v_filtros,
    'janela', v_janela,
    'moeda', v_moeda,
    'valores', p_valores,
    'total', jsonb_build_object('n', (v_total->>'n')::bigint, 'n_ok', (v_total->>'n_ok')::bigint,
                                'valores', v_total->'valores'),
    'fora_da_moeda', (v_total->>'fora_da_moeda')::bigint,
    'grupos', v_grupos,
    'series', v_series,
    'dobrados', to_jsonb(v_dobrados),
    'series_dobradas', to_jsonb(v_series_dobradas),
    'funil', v_funil_info,
    'meta', v_meta,
    'anterior', v_anterior
  );
  return v_resposta;
end;
$f$;

comment on function public.fn_mia_relatorio(uuid, text, text[], text, text, jsonb, text, date, date, boolean, boolean, timestamptz) is
  'MIA (9030, 9041): o motor de conta dos paineis prontos e do montador de relatorios. Fonte + medidas (1 a 6) + ate dois agrupamentos + filtros (um valor ou uma lista) + periodo, somados no banco (sem o teto de 1000 linhas), no fuso e na moeda da empresa, com a regra de data do prototipo. security invoker: cada um ve o que a RLS ja deixa ver; quem nao e membro da organizacao e recusado (42501); a plataforma (service_role) chama com a organizacao resolvida no servidor. p_valores = false esconde o dinheiro. 9041: meta_cents em cada grupo de tempo, o funil com a soma, series_dobradas.';

-- ── 7. quem é cada registro ─────────────────────────────────────────────────
--
-- O que a lista mostra de cada linha contada e onde abrir no CRM. `security
-- invoker`: a RLS de quem pergunta decide também aqui (o atendente não lê o
-- contato que não vê). Anúncios não passam por aqui: a tabela é só do
-- servidor, e a lista usa o negócio de origem que o definer já devolve.
create or replace function public.fn_mia_relatorio_detalhes(
  p_org uuid,
  p_fonte text,
  p_registros uuid[]
) returns table (registro uuid, detalhe jsonb)
language plpgsql
stable
set search_path = ''
as $f$
begin
  if p_fonte = 'negocios' then
    return query
    select l.id, jsonb_build_object(
      'titulo', l.title,
      'contato', coalesce(nullif(btrim(ct.display_name), ''), nullif(btrim(ct.name), '')),
      'telefone', ct.phone_number,
      'etapa', s.name,
      'funil', p.name,
      'pessoa', l.owner_user_id,
      'link', '/app/leads/' || l.id)
    from public.crm_leads l
    left join public.contacts ct on ct.id = l.contact_id and ct.organization_id = l.organization_id
    left join public.crm_stages s on s.id = l.stage_id and s.organization_id = l.organization_id
    left join public.crm_pipelines p on p.id = l.pipeline_id and p.organization_id = l.organization_id
    where l.organization_id = p_org and l.id = any(p_registros);

  elsif p_fonte = 'conversas' then
    return query
    select c.id, jsonb_build_object(
      'contato', coalesce(nullif(btrim(ct.display_name), ''), nullif(btrim(ct.name), '')),
      'telefone', ct.phone_number,
      'link', '/app/inbox/' || c.id)
    from public.conversations c
    left join public.contacts ct on ct.id = c.contact_id and ct.organization_id = c.organization_id
    where c.organization_id = p_org and c.id = any(p_registros);

  elsif p_fonte = 'contatos' then
    return query
    select ct.id, jsonb_build_object(
      'contato', coalesce(nullif(btrim(ct.display_name), ''), nullif(btrim(ct.name), '')),
      'telefone', ct.phone_number,
      'link', '/app/contacts/' || ct.id)
    from public.contacts ct
    where ct.organization_id = p_org and ct.id = any(p_registros);

  elsif p_fonte = 'agenda' then
    return query
    select a.id, jsonb_build_object(
      'titulo', a.title,
      'contato', coalesce(nullif(btrim(ct.display_name), ''), nullif(btrim(ct.name), '')),
      'telefone', ct.phone_number,
      'link', case when a.contact_id is not null then '/app/contacts/' || a.contact_id else '/app/agenda' end)
    from public.calendar_appointments a
    left join public.contacts ct on ct.id = a.contact_id and ct.organization_id = a.organization_id
    where a.organization_id = p_org and a.id = any(p_registros);

  elsif p_fonte = 'followup' then
    return query
    select e.id, jsonb_build_object(
      'contato', coalesce(nullif(btrim(ct.display_name), ''), nullif(btrim(ct.name), '')),
      'telefone', ct.phone_number,
      'link', case when e.conversation_id is not null then '/app/inbox/' || e.conversation_id
                   else '/app/contacts/' || e.contact_id end)
    from public.followup_enrollments e
    left join public.contacts ct on ct.id = e.contact_id and ct.organization_id = e.organization_id
    where e.organization_id = p_org and e.id = any(p_registros);

  elsif p_fonte = 'obrigacoes' then
    return query
    select o.id, jsonb_build_object(
      'titulo', o.nome,
      'contato', coalesce(nullif(btrim(ct.display_name), ''), nullif(btrim(ct.name), ''), l.title),
      'telefone', ct.phone_number,
      'link', case when o.lead_id is not null then '/app/leads/' || o.lead_id
                   when o.contact_id is not null then '/app/contacts/' || o.contact_id
                   else '/app/obrigacoes' end)
    from public.mia_obrigacoes o
    left join public.contacts ct on ct.id = o.contact_id and ct.organization_id = o.organization_id
    left join public.crm_leads l on l.id = o.lead_id and l.organization_id = o.organization_id
    where o.organization_id = p_org and o.id = any(p_registros);

  elsif p_fonte = 'anuncios' then
    return;
  else
    raise exception 'fonte_desconhecida: %', p_fonte using errcode = '22023';
  end if;
end;
$f$;

comment on function public.fn_mia_relatorio_detalhes(uuid, text, uuid[]) is
  'MIA (9041): quem e cada registro contado pelo motor de relatorios (titulo, contato, telefone, etapa, onde abrir no CRM), para a lista por tras do numero. security invoker: a RLS de quem pergunta.';

-- ── 8. a lista por trás do número ───────────────────────────────────────────
--
-- Os registros de um grupo (`p_chave1`), de uma célula (`p_chave1` e
-- `p_chave2`), de "Outros" (`__outros` com os dobrados que o motor devolveu)
-- ou de uma etapa do funil (`p_funil`: quem chegou até ela), com o mesmo
-- pedido do gráfico. `total` é a mesma conta do gráfico, feita sobre estas
-- linhas. Página de até 200 linhas na tela; até 20.000 para a planilha.
create or replace function public.fn_mia_relatorio_lista(
  p_org uuid,
  p_fonte text,
  p_medidas text[],
  p_dim1 text default null,
  p_dim2 text default null,
  p_filtros jsonb default '{}'::jsonb,
  p_periodo text default '30',
  p_de date default null,
  p_ate date default null,
  p_chave1 text default null,
  p_chave2 text default null,
  p_dobrados1 text[] default null,
  p_dobrados2 text[] default null,
  p_funil boolean default false,
  p_limite integer default 50,
  p_deslocamento integer default 0,
  p_valores boolean default true,
  p_agora timestamptz default null
) returns jsonb
language plpgsql
stable
set search_path = ''
as $f$
declare
  v_prep jsonb;
  v_medidas text[];
  v_filtros jsonb;
  v_fuso text;
  v_moeda text;
  v_janela jsonb;
  v_inicio timestamptz;
  v_fim timestamptz;
  v_chave1 text := nullif(p_chave1, '__tudo');
  v_posicao numeric;
  v_linhas public.mia_relatorio_linha[];
  v_sel public.mia_relatorio_linha[];
  v_pagina public.mia_relatorio_linha[];
  v_total jsonb;
  v_itens jsonb;
begin
  if p_limite is null or p_limite < 1 or p_limite > 20000 then
    raise exception 'limite_de_1_a_20000' using errcode = '22023';
  end if;
  if p_deslocamento is null or p_deslocamento < 0 then
    raise exception 'deslocamento_negativo' using errcode = '22023';
  end if;
  if p_chave2 is not null and (p_dim2 is null or v_chave1 is null) then
    raise exception 'celula_sem_os_dois_agrupamentos' using errcode = '22023';
  end if;
  if p_funil and (p_dim1 is distinct from 'etapa' or v_chave1 is null or p_chave2 is not null) then
    raise exception 'funil_pede_uma_etapa' using errcode = '22023';
  end if;

  v_prep := public.fn_mia_relatorio_preparar(p_org, p_fonte, p_medidas, p_dim1, p_dim2, p_filtros,
                                             p_periodo, p_de, p_ate, p_agora);
  -- A conta do topo da lista: a do gráfico. No funil, "chegaram" é a contagem.
  v_medidas := array(
    select distinct case when m = 'chegaram' then 'qtd' else m end
      from jsonb_array_elements_text(v_prep -> 'medidas') m);
  v_filtros := v_prep -> 'filtros';
  v_fuso := v_prep ->> 'fuso';
  v_moeda := v_prep ->> 'moeda';
  v_janela := v_prep -> 'janela';
  v_inicio := coalesce((v_janela->>'inicio')::timestamptz, '-infinity'::timestamptz);
  v_fim := coalesce((v_janela->>'fim')::timestamptz, 'infinity'::timestamptz);

  -- Sem `__precisa`: a lista mostra o produto do negócio e quem atendeu a
  -- conversa mesmo quando o relatório não agrupa por eles.
  select array_agg(l)
    into v_linhas
    from public.fn_mia_relatorio_linhas(p_org, p_fonte, v_inicio, v_fim, v_filtros, p_agora, v_fuso) l
   where public.fn_mia_relatorio_passa(l.dims, v_filtros);
  v_linhas := coalesce(v_linhas, '{}');

  if p_funil then
    select s.position into v_posicao
      from public.crm_stages s
     where s.id::text = v_chave1 and s.organization_id = p_org
       and s.pipeline_id = nullif(v_prep -> 'funil' ->> 'id', '')::uuid
       and not s.is_lost;
    if v_posicao is null then
      raise exception 'etapa_fora_do_funil' using errcode = '22023';
    end if;
    select array_agg(u order by u.momento desc nulls last, u.registro)
      into v_sel
      from unnest(v_linhas) u
     where u.x3 >= v_posicao;
  else
    select array_agg(u order by u.momento desc nulls last, u.registro)
      into v_sel
      from unnest(v_linhas) u
     where (v_chave1 is null or exists (
              select 1 from public.fn_mia_relatorio_chaves(u.dims, u.momento, p_dim1, v_fuso) k
               where k = v_chave1
                  or (v_chave1 = '__outros' and k = any(coalesce(p_dobrados1, '{}')))))
       and (p_chave2 is null or exists (
              select 1 from public.fn_mia_relatorio_chaves(u.dims, u.momento, p_dim2, v_fuso) k
               where k = p_chave2
                  or (p_chave2 = '__outros' and k = any(coalesce(p_dobrados2, '{}')))));
  end if;
  v_sel := coalesce(v_sel, '{}');

  v_total := public.fn_mia_relatorio_medir(v_sel, v_medidas, v_moeda, p_valores);

  v_pagina := v_sel[(p_deslocamento + 1):(p_deslocamento + p_limite)];

  select coalesce(jsonb_agg(jsonb_build_object(
           'registro', n.registro,
           'momento', n.momento,
           'dims', n.dims,
           'rotulos', n.rotulos,
           'valor_cents', case when p_valores then n.valor_cents end,
           'moeda', coalesce(n.moeda, v_moeda),
           'sit', n.sit,
           'x1', n.x1,
           'x2', n.x2,
           'ok', n.ok,
           'detalhe', coalesce(d.detalhe,
                               case when p_fonte = 'anuncios' and (n.rotulos ->> 'negocio') is not null
                                    then jsonb_build_object('link', '/app/leads/' || (n.rotulos ->> 'negocio'))
                                    else '{}'::jsonb end)
         ) order by n.i), '[]'::jsonb)
    into v_itens
    from unnest(v_pagina) with ordinality n(registro, momento, dims, rotulos, valor_cents, moeda, sit, x1, x2, x3, prob, ok, i)
    left join public.fn_mia_relatorio_detalhes(
                p_org, p_fonte,
                array(select x.registro from unnest(v_pagina) x)) d
      on d.registro = n.registro;

  return jsonb_build_object(
    'fonte', p_fonte,
    'janela', v_janela,
    'moeda', v_moeda,
    'valores', p_valores,
    'medidas', to_jsonb(v_medidas),
    'n', cardinality(v_sel),
    'total', jsonb_build_object('n', (v_total->>'n')::bigint, 'n_ok', (v_total->>'n_ok')::bigint,
                                'valores', v_total->'valores'),
    'limite', p_limite,
    'deslocamento', p_deslocamento,
    'linhas', v_itens
  );
end;
$f$;

comment on function public.fn_mia_relatorio_lista(uuid, text, text[], text, text, jsonb, text, date, date, text, text, text[], text[], boolean, integer, integer, boolean, timestamptz) is
  'MIA (9041): a lista por tras de um numero do montador: os registros de um grupo, de uma celula, de "Outros" ou de uma etapa do funil, com o mesmo pedido do grafico (fn_mia_relatorio_preparar), o total com a mesma conta (fn_mia_relatorio_medir) e quem e cada um (fn_mia_relatorio_detalhes). security invoker. Ate 20.000 linhas por chamada (a planilha).';

-- ── 9. quem executa ─────────────────────────────────────────────────────────
revoke all on function public.fn_mia_relatorio_catalogo() from public;
revoke execute on function public.fn_mia_relatorio_catalogo() from anon;
grant execute on function public.fn_mia_relatorio_catalogo() to authenticated, service_role;

revoke all on function public.fn_mia_relatorio_linhas(uuid, text, timestamptz, timestamptz, jsonb, timestamptz, text) from public;
revoke execute on function public.fn_mia_relatorio_linhas(uuid, text, timestamptz, timestamptz, jsonb, timestamptz, text) from anon;
grant execute on function public.fn_mia_relatorio_linhas(uuid, text, timestamptz, timestamptz, jsonb, timestamptz, text) to authenticated, service_role;

revoke all on function public.fn_mia_relatorio_passa_um(jsonb, text, text) from public;
revoke execute on function public.fn_mia_relatorio_passa_um(jsonb, text, text) from anon;
grant execute on function public.fn_mia_relatorio_passa_um(jsonb, text, text) to authenticated, service_role;

revoke all on function public.fn_mia_relatorio_passa(jsonb, jsonb) from public;
revoke execute on function public.fn_mia_relatorio_passa(jsonb, jsonb) from anon;
grant execute on function public.fn_mia_relatorio_passa(jsonb, jsonb) to authenticated, service_role;

revoke all on function public.fn_mia_relatorio_preparar(uuid, text, text[], text, text, jsonb, text, date, date, timestamptz) from public;
revoke execute on function public.fn_mia_relatorio_preparar(uuid, text, text[], text, text, jsonb, text, date, date, timestamptz) from anon;
grant execute on function public.fn_mia_relatorio_preparar(uuid, text, text[], text, text, jsonb, text, date, date, timestamptz) to authenticated, service_role;

revoke all on function public.fn_mia_relatorio(uuid, text, text[], text, text, jsonb, text, date, date, boolean, boolean, timestamptz) from public;
revoke execute on function public.fn_mia_relatorio(uuid, text, text[], text, text, jsonb, text, date, date, boolean, boolean, timestamptz) from anon;
grant execute on function public.fn_mia_relatorio(uuid, text, text[], text, text, jsonb, text, date, date, boolean, boolean, timestamptz) to authenticated, service_role;

revoke all on function public.fn_mia_relatorio_detalhes(uuid, text, uuid[]) from public;
revoke execute on function public.fn_mia_relatorio_detalhes(uuid, text, uuid[]) from anon;
grant execute on function public.fn_mia_relatorio_detalhes(uuid, text, uuid[]) to authenticated, service_role;

revoke all on function public.fn_mia_relatorio_lista(uuid, text, text[], text, text, jsonb, text, date, date, text, text, text[], text[], boolean, integer, integer, boolean, timestamptz) from public;
revoke execute on function public.fn_mia_relatorio_lista(uuid, text, text[], text, text, jsonb, text, date, date, text, text, text[], text[], boolean, integer, integer, boolean, timestamptz) from anon;
grant execute on function public.fn_mia_relatorio_lista(uuid, text, text[], text, text, jsonb, text, date, date, text, text, text[], text[], boolean, integer, integer, boolean, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
