-- manifest: O ASSISTENTE DA MIA NA LGPD E NA RETENÇÃO (.88). A função NOSSA `fn_redigir_o_que_sobrou_do_contato_anonimizado` (0266, 9007, 9047) ganha um sexto bloco, com o corpo idêntico ao da 9047 e o bloco marcado "9051": anonimizar o contato apaga o texto e os botões das mensagens do assistente que o citam (`mia_assistente_mensagens.contatos`, a pergunta e a resposta) e tira o id dele da lista; o resto da conversa da pessoa fica. Cura quem já foi anonimizado. E a retenção do assistente: `fn_mia_expurgar_assistente_vencido(p_retencao_dias, p_limite)` apaga as mensagens com mais de 90 dias (piso de 30), as conversas que ficaram vazias e os chamados resolvidos há mais de 365 dias (o print vai para a fila de remoção pelo gatilho da 9050), em lotes, chamada pelo cron do resumo da manhã. Só o servidor executa. Nenhum objeto do upstream é tocado.
--
-- 9051 · o assistente da MIA na LGPD e na retenção
--
-- Só a função NOSSA é redefinida (docs/FORK-MIA.md, regra 3). Idempotente:
-- `create or replace`, e a cura só toca mensagem que ainda cita alguém já
-- anonimizado.
--
-- ── Por que o histórico do assistente guarda os contatos citados ────────────
--
-- A resposta do assistente pode dizer "a Helena espera desde as 18h". O
-- histórico é da PESSOA da equipe, não do contato, mas o nome dele está ali.
-- Sem a lista `contatos`, anonimizar a Helena deixaria o nome dela no histórico
-- de quem perguntou por até 90 dias, e o acesso do titular não o entregaria. A
-- lista é preenchida pelo turno com os contatos que as ferramentas leram (a
-- mais, nunca a menos), e é por ela que este bloco e o acesso do titular
-- (lib/lgpd/export-collector.ts) alcançam a mensagem.

create or replace function public.fn_redigir_o_que_sobrou_do_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rotulo text := 'Contato anonimizado';
begin
  -- 1 · ai_agent_runs, o rastro da IA sobre esta pessoa. Redige como a 0494
  --     do upstream (preserva o nome da ferramenta) e alcança também as
  --     execuções ligadas pela conversa.
  update public.ai_agent_runs
     set tool_calls    = case
                           when jsonb_typeof(tool_calls) = 'array'
                             then public.fn_lgpd_redigir_tool_calls(tool_calls)
                           else '[]'::jsonb
                         end,
         error_message = null
   where organization_id = new.organization_id
     and (
       contact_id = new.id
       or conversation_id in (
         select id from public.conversations
          where organization_id = new.organization_id
            and contact_id = new.id
       )
     )
     and (
       error_message is not null
       or case
            when jsonb_typeof(tool_calls) = 'array' then exists (
              select 1 from jsonb_array_elements(tool_calls) s
               where coalesce(s->>'redacted', 'false')::boolean is not true
            )
            else tool_calls is not null
          end
     );

  -- 2 · demandas, o problema dela, escrito à mão.
  update public.demandas
     set assunto       = null,
         proximo_passo = null
   where organization_id = new.organization_id
     and contact_id = new.id
     and (assunto is not null or proximo_passo is not null);

  -- 3 · broadcast_recipients: rótulo, não `null`. A coluna é `not null` e a
  --     linha precisa continuar contável para o relatório do disparo.
  update public.broadcast_recipients
     set phone_e164 = v_rotulo,
         valores    = '{}'::jsonb
   where organization_id = new.organization_id
     and contact_id = new.id
     and (phone_e164 <> v_rotulo or valores <> '{}'::jsonb);

  -- 4 · google_ads_click_refs e meta_ads_click_refs, do upstream (0306 dele).
  --     O perigo é `query_raw`, a query string CRUA da landing page.
  update public.google_ads_click_refs
     set query_raw  = '{}'::jsonb,
         contact_id = null
   where organization_id = new.organization_id
     and contact_id = new.id;

  update public.meta_ads_click_refs
     set query_raw  = '{}'::jsonb,
         contact_id = null
   where organization_id = new.organization_id
     and contact_id = new.id;

  -- 5 · 9047 · agent_turn_traces, o traço do turno (0721 do upstream). Sai o
  --     texto de erro do turno e o de cada ferramenta; ficam o nome, o estado
  --     e a duração. Alcança também os turnos ligados pela conversa, como o 1.
  --     Uma lista que não seja lista (nunca deveria existir) vira `[]`, em vez
  --     de derrubar a anonimização inteira.
  update public.agent_turn_traces
     set error_message = null,
         ferramentas   = case
                           when jsonb_typeof(ferramentas) = 'array' then coalesce(
                             (select jsonb_agg(
                                       case
                                         when jsonb_typeof(f.item) = 'object' and f.item ? 'erro'
                                           then jsonb_set(f.item, '{erro}', 'null'::jsonb)
                                         else f.item
                                       end
                                       order by f.ordem)
                                from jsonb_array_elements(ferramentas) with ordinality as f(item, ordem)),
                             '[]'::jsonb)
                           else '[]'::jsonb
                         end
   where organization_id = new.organization_id
     and (
       contact_id = new.id
       or conversation_id in (
         select id from public.conversations
          where organization_id = new.organization_id
            and contact_id = new.id
       )
     )
     and (
       error_message is not null
       or case
            when jsonb_typeof(ferramentas) = 'array' then exists (
              select 1 from jsonb_array_elements(ferramentas) f
               where jsonb_typeof(f) = 'object' and f ? 'erro' and jsonb_typeof(f->'erro') <> 'null'
            )
            else ferramentas is not null
          end
     );


  -- 6 · 9051 · mia_assistente_mensagens, o histórico do assistente da MIA. A
  --     pergunta e a resposta que citam este contato perdem o texto e os
  --     botões; o id dele sai da lista. O resto da conversa da pessoa fica.
  update public.mia_assistente_mensagens
     set texto    = 'Conteúdo removido: um contato citado aqui foi anonimizado.',
         acoes    = '[]'::jsonb,
         contatos = array_remove(contatos, new.id)
   where organization_id = new.organization_id
     and contatos @> array[new.id];

  return new;
end $$;

comment on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() is
  'MIA (0266, 9007, 9047, 9051): redige o que o gatilho do upstream nao alcanca quando o contato e anonimizado. ai_agent_runs: redige tool_calls com fn_lgpd_redigir_tool_calls (a mesma do upstream, 0494, que preserva o nome da ferramenta) tambem nas execucoes ligadas pela conversa, e apaga error_message. demandas (assunto, proximo_passo), broadcast_recipients (telefone copiado), query_raw dos cliques de anuncio, desde a 9047 agent_turn_traces (0721): error_message e o erro de cada ferramenta, guardando nome, estado e duracao; e desde a 9051 o historico do assistente da MIA (mia_assistente_mensagens que citam o contato perdem texto e botoes).';

revoke all on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from public;
revoke execute on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from anon;
revoke execute on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from authenticated;

-- Quem JÁ foi anonimizado e ainda é citado no histórico do assistente.
update public.mia_assistente_mensagens m
   set texto    = 'Conteúdo removido: um contato citado aqui foi anonimizado.',
       acoes    = '[]'::jsonb,
       contatos = (
         select coalesce(array_agg(x), '{}'::uuid[])
           from unnest(m.contatos) as x
          where not exists (
            select 1 from public.contacts c
             where c.id = x and c.organization_id = m.organization_id and c.is_anonymized
          )
       )
 where exists (
   select 1 from public.contacts c
    where c.organization_id = m.organization_id
      and c.is_anonymized
      and m.contatos @> array[c.id]
 );

-- ── A retenção do assistente ────────────────────────────────────────────────
--
-- O histórico é guardado por 90 dias (regra "Histórico" do protótipo), com o
-- piso de 30 dentro do corpo, como as `fn_expurgar_*` do upstream (0587): um
-- valor errado vindo de fora nunca apaga o mês corrente. As conversas que
-- ficaram sem mensagem saem junto. O chamado resolvido sai 365 dias depois da
-- resposta (piso de 180): é o registro do que a Time respondeu, e um ano cobre
-- a pergunta "isso já tinha acontecido?". O chamado aberto nunca sai.
--
-- Em lotes (`p_limite`), para o cron nunca segurar a tabela inteira. O nome
-- diz "expurgar", e não "apagar": é retenção por idade, não o caminho da
-- anonimização (este fica no bloco 6 acima).
create or replace function public.fn_mia_expurgar_assistente_vencido(
  p_retencao_dias integer default 90,
  p_limite integer default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  v_dias integer := greatest(coalesce(p_retencao_dias, 90), 30);
  v_limite integer := least(greatest(coalesce(p_limite, 5000), 1), 50000);
  v_mensagens integer := 0;
  v_conversas integer := 0;
  v_chamados integer := 0;
begin
  with vencidas as (
    select id from public.mia_assistente_mensagens
     where created_at < now() - make_interval(days => v_dias)
     order by created_at
     limit v_limite
  )
  delete from public.mia_assistente_mensagens m
   using vencidas v
   where m.id = v.id;
  get diagnostics v_mensagens = row_count;

  with vazias as (
    select c.id from public.mia_assistente_conversas c
     where c.ultima_em < now() - make_interval(days => v_dias)
       and not exists (select 1 from public.mia_assistente_mensagens m where m.conversa_id = c.id)
     order by c.ultima_em
     limit v_limite
  )
  delete from public.mia_assistente_conversas c
   using vazias v
   where c.id = v.id;
  get diagnostics v_conversas = row_count;

  with resolvidos as (
    select id from public.mia_chamados
     where situacao = 'resolvido'
       and coalesce(respondido_em, updated_at) < now() - make_interval(days => 365)
     order by coalesce(respondido_em, updated_at)
     limit v_limite
  )
  delete from public.mia_chamados ch
   using resolvidos r
   where ch.id = r.id;
  get diagnostics v_chamados = row_count;

  return jsonb_build_object(
    'mensagens', v_mensagens,
    'conversas', v_conversas,
    'chamados', v_chamados,
    'retencao_dias', v_dias
  );
end
$f$;

comment on function public.fn_mia_expurgar_assistente_vencido(integer, integer) is
  'MIA (9051): a retencao do assistente da MIA. Apaga, em lotes, as mensagens com mais de p_retencao_dias (90 por padrao, piso de 30), as conversas que ficaram vazias e os chamados resolvidos ha mais de 365 dias (o print vai para storage_redaction_queue pelo gatilho da 9050). Chamada pelo cron do resumo da manha. So o servidor executa.';

revoke all on function public.fn_mia_expurgar_assistente_vencido(integer, integer) from public;
revoke execute on function public.fn_mia_expurgar_assistente_vencido(integer, integer) from anon, authenticated;
grant execute on function public.fn_mia_expurgar_assistente_vencido(integer, integer) to service_role;
