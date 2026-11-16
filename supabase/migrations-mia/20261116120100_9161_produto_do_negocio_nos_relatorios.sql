-- manifest: O PRODUTO DO NEGÓCIO NOS RELATÓRIOS MONTADOS (.109; docs/fork/produto-no-negocio.md). FORK MIA (.109): o motor dos relatórios montados (`fn_mia_relatorio_linhas`, 9030/9041/9046) já tinha "Produto" para agrupar e filtrar negócios, mas lia só os itens das PROPOSTAS: o negócio fechado sem proposta caía em "sem produto" mesmo com o item escolhido no bloco do negócio (9160). Aqui a dimensão `produto` da fonte `negocios` passa a juntar os itens da proposta (como antes) e os do próprio negócio (`mia_itens_do_negocio`), pelo nome do catálogo de hoje (produto apagado fica com o nome de quando entrou). Nenhuma tela nova: o relatório que já agrupa por produto passa a ver o negócio sem proposta. Só uma função NOSSA é redefinida, com o corpo da última definição (a 9046) e a diferença marcada "9161"; as permissões reemitidas como na 9046. Idempotente.
--
-- 9161 · o produto do negócio nos relatórios montados
--
-- `fn_mia_`: só objetos NOSSOS são redefinidos (docs/FORK-MIA.md, regra 3).
-- Idempotente: `create or replace`, e as permissões reemitidas como na 9046. O
-- corpo é o da última definição; o que muda está marcado "9161".

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
        -- 9041: os produtos do catálogo nas propostas do negócio; 9161: e os do próprio negócio.
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
      -- 9161: e os itens do PRÓPRIO negócio (o bloco do negócio, 9160), para o
      -- negócio sem proposta também cair no grupo do produto. Pelo nome do
      -- catálogo de hoje, como a proposta; produto apagado fica com o nome de
      -- quando entrou.
      select jsonb_agg(distinct nm.nome) as produtos
        from (
          select btrim(cp.nome) as nome
            from public.crm_proposals pp
            join public.crm_proposal_items it
              on it.proposal_id = pp.id and it.organization_id = pp.organization_id
            join public.catalog_products cp
              on cp.id = it.product_id and cp.organization_id = pp.organization_id
           where v_produto
             and pp.lead_id = l.id and pp.organization_id = p_org
             and pp.status not in ('cancelada', 'substituida')
             and nullif(btrim(cp.nome), '') is not null
          union all
          select btrim(coalesce(cpn.nome, ni.nome))
            from public.mia_itens_do_negocio ni
            left join public.catalog_products cpn
              on cpn.id = ni.product_id and cpn.organization_id = ni.organization_id
           where v_produto
             and ni.lead_id = l.id and ni.organization_id = p_org
             and nullif(btrim(coalesce(cpn.nome, ni.nome)), '') is not null
        ) nm
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
         and m.type <> 'reaction'  -- 9046: a reação não abre o relógio
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
        and m.type <> 'reaction'  -- 9046: reagir pelo celular não é responder
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
  'MIA (9030, 9041, 9046, 9161): as linhas de uma fonte do motor de relatorios no periodo [p_inicio, p_fim), com a regra de data do prototipo. security invoker: cada fonte le pela RLS de quem chama, e toda leitura filtra organization_id = p_org. 9041: produto nos negocios, quem atendeu (pessoa ou agente) nas conversas, dono do contato no follow-up; __precisa em p_filtros diz se vale buscar produto e agente. 9046: a reacao do WhatsApp (messages.type = reaction, upstream 0684) nao abre o relogio nem conta como resposta. 9161: o produto dos negocios inclui os itens do proprio negocio (mia_itens_do_negocio), nao so os da proposta.';

revoke all on function public.fn_mia_relatorio_linhas(uuid, text, timestamptz, timestamptz, jsonb, timestamptz, text) from public;
revoke execute on function public.fn_mia_relatorio_linhas(uuid, text, timestamptz, timestamptz, jsonb, timestamptz, text) from anon;
grant execute on function public.fn_mia_relatorio_linhas(uuid, text, timestamptz, timestamptz, jsonb, timestamptz, text) to authenticated, service_role;

notify pgrst, 'reload schema';
