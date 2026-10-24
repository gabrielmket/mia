-- manifest: O TRACO DO TURNO DO AGENTE ENTRA NA ANONIMIZACAO (fusao do upstream v1.87 e v1.88, .86). A 0721 do upstream (#2869) criou `agent_turn_traces`, uma linha por turno com `contact_id`, `conversation_id`, o texto do erro (`error_message`) e as ferramentas chamadas com a mensagem de erro de cada uma (`ferramentas[].erro`), e nenhum caminho de anonimizacao a alcanca (a catraca `lgpd-exporta-o-que-redige` acusou). A funcao NOSSA `fn_redigir_o_que_sobrou_do_contato_anonimizado` (0266, 9007) ganha um quinto bloco, com o corpo identico ao da 9007 e o bloco marcado "9047": o traco do titular (pelo contato e pelas conversas dele, como o `ai_agent_runs`) perde `error_message` e o `erro` de cada ferramenta, e guarda o nome, o estado e a duracao (a trilha do que o agente fez continua legivel). Cura quem ja foi anonimizado. Mesmas permissoes. Nenhum objeto do upstream e tocado.
--
-- 9047 · o traço do turno do agente entra na anonimização
--
-- Só a função NOSSA é redefinida (docs/FORK-MIA.md, regra 3). A tabela é do
-- upstream e só recebe `update` de dado, nunca DDL. Idempotente: `create or
-- replace`, e a cura só toca linha com erro ainda não redigido.
--
-- O que o traço guarda (0721): por turno, o modelo, os tokens, o custo, a
-- latência, as skills, as fontes de conhecimento, as ferramentas chamadas
-- (`{ nome, estado, erro, duracao_ms }`) e o desfecho. O texto de erro é o
-- único que pode repetir o que a pessoa disse (uma ferramenta que recusa o
-- telefone informado devolve o próprio dado na mensagem), então é ele que
-- sai, do turno e de cada ferramenta. O resto é número, código e nome de
-- ferramenta: a mesma régua que a 9007 usa para `ai_agent_runs`.

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

  return new;
end $$;

comment on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() is
  'MIA (0266, 9007, 9047): redige o que o gatilho do upstream nao alcanca quando o contato e anonimizado. ai_agent_runs: redige tool_calls com fn_lgpd_redigir_tool_calls (a mesma do upstream, 0494, que preserva o nome da ferramenta) tambem nas execucoes ligadas pela conversa, e apaga error_message. demandas (assunto, proximo_passo), broadcast_recipients (telefone copiado), query_raw dos cliques de anuncio e, desde a 9047, agent_turn_traces (0721): error_message e o erro de cada ferramenta, guardando nome, estado e duracao.';

revoke all on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from public;
revoke execute on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from anon;
revoke execute on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from authenticated;

-- Quem JÁ foi anonimizado e tem traço com erro ainda não redigido.
update public.agent_turn_traces t
   set error_message = null,
       ferramentas   = case
                         when jsonb_typeof(t.ferramentas) = 'array' then coalesce(
                           (select jsonb_agg(
                                     case
                                       when jsonb_typeof(f.item) = 'object' and f.item ? 'erro'
                                         then jsonb_set(f.item, '{erro}', 'null'::jsonb)
                                       else f.item
                                     end
                                     order by f.ordem)
                              from jsonb_array_elements(t.ferramentas) with ordinality as f(item, ordem)),
                           '[]'::jsonb)
                         else '[]'::jsonb
                       end
  from public.contacts c
 where c.is_anonymized = true
   and c.organization_id = t.organization_id
   and (
     t.contact_id = c.id
     or t.conversation_id in (
       select id from public.conversations
        where organization_id = c.organization_id and contact_id = c.id
     )
   )
   and (
     t.error_message is not null
     or case
          when jsonb_typeof(t.ferramentas) = 'array' then exists (
            select 1 from jsonb_array_elements(t.ferramentas) f
             where jsonb_typeof(f) = 'object' and f ? 'erro' and jsonb_typeof(f->'erro') <> 'null'
          )
          else t.ferramentas is not null
        end
   );
