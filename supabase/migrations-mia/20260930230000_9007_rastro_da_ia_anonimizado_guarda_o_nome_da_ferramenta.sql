-- ─── 9007 · o rastro da IA de quem foi anonimizado guarda o NOME da ferramenta ───
--
-- FORK MIA (fusão da v1.66.0 do upstream). A 0266 da MIA redigia
-- `ai_agent_runs.tool_calls` do contato anonimizado trocando o valor inteiro
-- por `[]`. Na época nenhum caminho do upstream alcançava essa coluna.
--
-- A 0494 do upstream (#1964) passou a alcançar: o gatilho dele
-- (`fn_redigir_conversas_ao_anonimizar`) redige cada passo com
-- `fn_lgpd_redigir_tool_calls`, que PRESERVA o nome das ferramentas e o número
-- do passo (`{ step, tool_name, redacted: true, tool_calls: [{ tool_name }] }`)
-- e apaga argumentos, resultados e o texto do modelo. A trilha do que o agente
-- fez continua legível; o dado da pessoa sai.
--
-- Os dois gatilhos são AFTER UPDATE OF is_anonymized, e o Postgres os dispara
-- em ordem alfabética: `trg_redigir_conversas_…` (dele) antes de
-- `trg_redigir_o_que_sobrou_…` (nosso). O nosso rodava por último e zerava para
-- `[]` o que o dele acabara de redigir, e a invariante
-- `lgpd-cascata-do-banco-alcanca-notas-itens` reprovou no CI.
--
-- Pela regra 3 de docs/FORK-MIA.md (estender, nunca redefinir), o nosso passa a
-- redigir do MESMO jeito que o dele, chamando a função dele, e continua fazendo
-- só o que a dele não faz:
--
--   · alcança também as execuções ligadas pela CONVERSA do titular (as que
--     nasceram antes de o contato ser resolvido; a dele filtra só por
--     `contact_id`);
--   · apaga `error_message`, que pode repetir texto da conversa.
--
-- Guardas: só mexe em linha com passo ainda não redigido ou com
-- `error_message`; um `tool_calls` que não seja lista (nunca deveria existir)
-- vira `[]`, em vez de derrubar a anonimização inteira num
-- `jsonb_array_elements` de objeto.
--
-- O que já virou `[]` não volta: o nome das ferramentas se perdeu quando a 0266
-- rodou. O ajuste vale daqui para frente e para quem foi anonimizado com a
-- redação antiga do upstream por cima.

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

  return new;
end $$;

comment on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() is
  'MIA (0266, 9007): redige o que o gatilho do upstream nao alcanca quando o contato e anonimizado. ai_agent_runs: redige tool_calls com fn_lgpd_redigir_tool_calls (a mesma do upstream, 0494, que preserva o nome da ferramenta) tambem nas execucoes ligadas pela conversa, e apaga error_message. demandas (assunto, proximo_passo), broadcast_recipients (telefone copiado) e query_raw dos cliques de anuncio.';

revoke all on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from public;
revoke execute on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from anon;
revoke execute on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from authenticated;

-- Quem JÁ foi anonimizado e ainda tem passo sem redigir (ou error_message).
update public.ai_agent_runs r
   set tool_calls    = case
                         when jsonb_typeof(r.tool_calls) = 'array'
                           then public.fn_lgpd_redigir_tool_calls(r.tool_calls)
                         else '[]'::jsonb
                       end,
       error_message = null
  from public.contacts c
 where c.is_anonymized = true
   and c.organization_id = r.organization_id
   and (
     r.contact_id = c.id
     or r.conversation_id in (
       select id from public.conversations
        where organization_id = c.organization_id and contact_id = c.id
     )
   )
   and (
     r.error_message is not null
     or case
          when jsonb_typeof(r.tool_calls) = 'array' then exists (
            select 1 from jsonb_array_elements(r.tool_calls) s
             where coalesce(s->>'redacted', 'false')::boolean is not true
          )
          else r.tool_calls is not null
        end
   );
