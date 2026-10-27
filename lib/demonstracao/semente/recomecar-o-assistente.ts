/**
 * FORK MIA (.94) · "RECOMEÇAR" A DEMONSTRAÇÃO LIMPA O ASSISTENTE INTEIRO
 * (protótipo "ensina e faz", decisão 10: trilhas e propostas funcionam com os
 * dados fictícios, e recomeçar limpa tudo).
 *
 * A semente regrava os dados dela, mas não apaga o que nasceu depois. Então,
 * antes de apagar as propostas e o progresso das trilhas, este bloco DESFAZ as
 * peças que nasceram de proposta aplicada, uma por tipo, a partir do
 * `resultado` que o aplicar guardou:
 *
 *   etapa_criar           a etapa é arquivada (como a tela); o negócio que
 *                         estava nela vai para a primeira etapa aberta do funil
 *   etapa_renomear        volta o nome de antes, se ninguém renomeou de novo
 *   resposta, tarefa,     saem
 *   relatorio
 *   etiqueta              sai do vocabulário e dos contatos, negócios e conversas
 *   rascunho_de_followup  sai (inscrições, versões e o fluxo), e sai do rascunho
 *   e followup (.91)      do agente que o armava
 *   conhecimento          o item sai do material; o material que a proposta
 *                         criou é arquivado
 *   meta                  volta a meta de antes (ou nenhuma)
 *   agente (.91)          é arquivado, com o nome marcado para ficar livre
 *   funil (.91)           volta ao quadro de antes, quando o aplicar o guardou
 *                         (a função do banco recusa se houver negócio)
 *
 * Diferente do botão Desfazer, aqui não há trava de uso: é a demonstração, e o
 * objetivo é voltar ao começo. Por isso o bloco só age em empresa de
 * DEMONSTRAÇÃO, pela mesma marca da trava da 9010 (`organizations.demonstracao`,
 * a que `fn_mia_e_demonstracao` lê): em qualquer outra empresa ele não faz nada.
 * Cada peça é desfeita num bloco próprio: a que falhar não derruba a semente.
 *
 * É SQL puro (um `do`), para servir aos dois modos da semente (direto no banco
 * e o roteiro gerado), e é o MESMO texto que o invariante executa.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sqlDeRecomecarOAssistente(organizacaoId: string): string {
  if (!UUID.test(organizacaoId)) throw new Error(`recomeçar o assistente: organização inválida (${organizacaoId})`);
  return `do $recomecar$
declare
  v_org constant uuid := '${organizacaoId}'::uuid;
  p record;
  r jsonb;
  v_id uuid;
  v_destino uuid;
  v_tag text;
begin
  -- A mesma marca da trava da 9010: só a empresa de demonstração recomeça.
  if not coalesce((select o.demonstracao from public.organizations o where o.id = v_org), false) then
    return;
  end if;

  if to_regclass('public.mia_assistente_propostas') is not null then
    for p in
      select tipo, resultado
        from public.mia_assistente_propostas
       where organization_id = v_org and situacao = 'aplicada' and resultado is not null
       order by aplicada_em desc nulls last
    loop
      r := p.resultado;
      begin
        case p.tipo
          when 'etapa_criar' then
            v_id := nullif(r->>'etapa_id', '')::uuid;
            select s.id into v_destino
              from public.crm_stages s
             where s.organization_id = v_org
               and s.pipeline_id = (select x.pipeline_id from public.crm_stages x where x.id = v_id)
               and s.id <> v_id and not s.is_archived and not s.is_won and not s.is_lost
             order by s.position
             limit 1;
            if v_destino is not null then
              update public.crm_leads set stage_id = v_destino where organization_id = v_org and stage_id = v_id;
            end if;
            update public.crm_stages set is_archived = true where organization_id = v_org and id = v_id;
          when 'etapa_renomear' then
            update public.crm_stages set name = r->>'de'
             where organization_id = v_org and id = nullif(r->>'etapa_id', '')::uuid and name = r->>'para';
          when 'resposta' then
            delete from public.message_templates where organization_id = v_org and id = nullif(r->>'resposta_id', '')::uuid;
          when 'tarefa' then
            delete from public.crm_tasks where organization_id = v_org and id = nullif(r->>'tarefa_id', '')::uuid;
          when 'relatorio' then
            delete from public.mia_relatorios where organization_id = v_org and id = nullif(r->>'relatorio_id', '')::uuid;
          when 'etiqueta' then
            v_tag := r->>'etiqueta';
            update public.contacts set tags = array_remove(tags, v_tag) where organization_id = v_org and v_tag = any(tags);
            update public.crm_leads set tags = array_remove(tags, v_tag) where organization_id = v_org and v_tag = any(tags);
            update public.conversations set tags = array_remove(tags, v_tag) where organization_id = v_org and v_tag = any(tags);
            update public.organizations o
               set settings = jsonb_set(
                     o.settings,
                     '{tags}',
                     coalesce(
                       (select jsonb_agg(x)
                          from jsonb_array_elements(o.settings->'tags') x
                         where lower(btrim(coalesce(x->>'tag', x #>> '{}'))) <> lower(btrim(v_tag))),
                       '[]'::jsonb))
             where o.id = v_org and jsonb_typeof(o.settings->'tags') = 'array';
          when 'rascunho_de_followup', 'followup' then
            v_id := nullif(r->>'fluxo_id', '')::uuid;
            update public.ai_agent_versions
               set followup = jsonb_set(
                     followup,
                     '{flow_pointer_ids}',
                     coalesce(
                       (select jsonb_agg(f) from jsonb_array_elements(followup->'flow_pointer_ids') f where f #>> '{}' <> v_id::text),
                       '[]'::jsonb))
             where organization_id = v_org and status = 'draft'
               and jsonb_typeof(followup->'flow_pointer_ids') = 'array'
               and followup->'flow_pointer_ids' @> to_jsonb(array[v_id::text]);
            delete from public.followup_enrollments where organization_id = v_org and pointer_id = v_id;
            update public.followup_flow_pointers set active_version_id = null where organization_id = v_org and id = v_id;
            delete from public.followup_flow_versions where organization_id = v_org and pointer_id = v_id;
            delete from public.followup_flow_pointers where organization_id = v_org and id = v_id;
          when 'conhecimento' then
            v_id := nullif(r->>'material_id', '')::uuid;
            if coalesce((r->>'material_novo')::boolean, false) then
              update public.ai_knowledge_sources set status = 'archived', is_active = false where organization_id = v_org and id = v_id;
            else
              delete from public.ai_faq_items
               where organization_id = v_org and knowledge_source_id = v_id
                 and lower(btrim(question)) = lower(btrim(r->>'pergunta'));
            end if;
          when 'meta' then
            if r->>'antes_cents' is null then
              delete from public.sales_targets
               where organization_id = v_org and periodo = ((r->>'mes') || '-01')::date
                 and metrica = 'receita_total' and user_id is null and agent_id is null;
            else
              update public.sales_targets set alvo_cents = (r->>'antes_cents')::bigint
               where organization_id = v_org and periodo = ((r->>'mes') || '-01')::date
                 and metrica = 'receita_total' and user_id is null and agent_id is null;
            end if;
          when 'agente' then
            update public.ai_agents
               set archived_at = now(), is_active = false, is_default = false, published_version_id = null,
                   name = left(name || ' (desfeito ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS') || ')', 120)
             where organization_id = v_org and id = nullif(r->>'agente_id', '')::uuid and archived_at is null;
          when 'funil' then
            if jsonb_typeof(r->'antes') = 'object' then
              perform public.fn_aplicar_quadro_do_onboarding(
                v_org, nullif(r->>'funil_id', '')::uuid, r#>>'{antes,nome}', r#>>'{antes,slug}', r#>'{antes,etapas}');
            end if;
          else
            null;
        end case;
      exception when others then
        raise notice 'recomeçar o assistente: a peça da proposta (%) ficou: %', p.tipo, sqlerrm;
      end;
    end loop;
    delete from public.mia_assistente_propostas where organization_id = v_org;
  end if;

  if to_regclass('public.mia_assistente_trilhas') is not null then
    delete from public.mia_assistente_trilhas where organization_id = v_org;
  end if;
end
$recomecar$`;
}
