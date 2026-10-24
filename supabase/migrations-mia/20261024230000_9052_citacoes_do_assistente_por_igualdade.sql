-- manifest: OS CONTATOS CITADOS PELO ASSISTENTE DA MIA, POR IGUALDADE (.88). A 9050 guarda na mensagem a lista `contatos` (uuid[]) e o acesso do titular a procurava por "contém" (`cs`), um operador que nenhuma leitura do coletor do titular usa e que os dublês do coletor (e as pontes SQL dos invariantes) não respondem: o CI da .88 reprovou 9 arquivos assim. A tabela NOSSA `mia_assistente_citacoes` (mensagem, contato, empresa) é o índice relacional da lista, mantido por gatilho (`fn_mia_assistente_citacoes_sincroniza`, depois de inserir ou mudar `contatos`), e o coletor procura por `contact_id`, como em toda outra seção. A lista continua a fonte (o turno grava nela); a tabela é só servidor (RLS ligada, nenhuma permissão para a sessão). A NOSSA `fn_redigir_o_que_sobrou_do_contato_anonimizado` (0266, 9007, 9047, 9051) ganha o bloco 6b, com o corpo idêntico ao da 9051: a citação do contato anonimizado sai junto. Cura as mensagens que já existem. Nenhum objeto do upstream é tocado.
--
-- 9052 · os contatos citados pelo assistente, por igualdade
--
-- `mia`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `create
-- table if not exists`, `create or replace`, `drop trigger if exists` e a cura
-- com `on conflict do nothing`.

create table if not exists public.mia_assistente_citacoes (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mensagem_id     uuid not null references public.mia_assistente_mensagens(id) on delete cascade,
  contact_id      uuid not null references public.contacts(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (mensagem_id, contact_id)
);

comment on table public.mia_assistente_citacoes is
  'MIA (9052): o indice relacional de mia_assistente_mensagens.contatos (os contatos que a pergunta ou a resposta do assistente citam), mantido por fn_mia_assistente_citacoes_sincroniza. Existe para o acesso do titular procurar por igualdade (contact_id), como toda outra secao do coletor. So o servidor le e escreve.';

create index if not exists mia_assistente_citacoes_contato_idx
  on public.mia_assistente_citacoes (organization_id, contact_id);

alter table public.mia_assistente_citacoes enable row level security;
revoke all on table public.mia_assistente_citacoes from public, anon, authenticated;
grant all on table public.mia_assistente_citacoes to service_role;

-- A lista é a fonte; a tabela segue a lista. Só entra contato que existe na
-- MESMA empresa da mensagem (um id de outra empresa na lista não vira linha).
create or replace function public.fn_mia_assistente_citacoes_sincroniza()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  delete from public.mia_assistente_citacoes ci
   where ci.mensagem_id = new.id
     and not (ci.contact_id = any(coalesce(new.contatos, '{}'::uuid[])));
  insert into public.mia_assistente_citacoes (organization_id, mensagem_id, contact_id)
  select new.organization_id, new.id, c.id
    from public.contacts c
   where c.organization_id = new.organization_id
     and c.id = any(coalesce(new.contatos, '{}'::uuid[]))
  on conflict (mensagem_id, contact_id) do nothing;
  return new;
end
$f$;

comment on function public.fn_mia_assistente_citacoes_sincroniza() is
  'MIA (9052): depois de inserir uma mensagem do assistente ou mudar a lista contatos, a tabela mia_assistente_citacoes passa a ter exatamente os contatos da lista que existem na mesma empresa.';

revoke all on function public.fn_mia_assistente_citacoes_sincroniza() from public;
revoke execute on function public.fn_mia_assistente_citacoes_sincroniza() from anon, authenticated;

drop trigger if exists trg_mia_assistente_citacoes_sincroniza on public.mia_assistente_mensagens;
create trigger trg_mia_assistente_citacoes_sincroniza
  after insert or update of contatos on public.mia_assistente_mensagens
  for each row execute function public.fn_mia_assistente_citacoes_sincroniza();

-- As mensagens que já existem.
insert into public.mia_assistente_citacoes (organization_id, mensagem_id, contact_id)
select m.organization_id, m.id, c.id
  from public.mia_assistente_mensagens m
  join public.contacts c
    on c.organization_id = m.organization_id
   and c.id = any(m.contatos)
on conflict (mensagem_id, contact_id) do nothing;

-- ── a anonimização leva a citação junto ─────────────────────────────────────
--
-- A função é NOSSA; o corpo é o da 9051 com o bloco 6b.
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

  -- 6b · 9052 · mia_assistente_citacoes, o índice dos contatos citados: a
  --     citação deste contato sai junto (o gatilho da 9052 também a tiraria
  --     ao mudar a lista, e aqui fica escrito, sem depender de outro gatilho).
  delete from public.mia_assistente_citacoes
   where organization_id = new.organization_id
     and contact_id = new.id;

  return new;
end $$;


comment on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() is
  'MIA (0266, 9007, 9047, 9051, 9052): redige o que o gatilho do upstream nao alcanca quando o contato e anonimizado. ai_agent_runs: redige tool_calls com fn_lgpd_redigir_tool_calls (a mesma do upstream, 0494, que preserva o nome da ferramenta) tambem nas execucoes ligadas pela conversa, e apaga error_message. demandas (assunto, proximo_passo), broadcast_recipients (telefone copiado), query_raw dos cliques de anuncio, desde a 9047 agent_turn_traces (0721): error_message e o erro de cada ferramenta, guardando nome, estado e duracao; desde a 9051 o historico do assistente da MIA (mia_assistente_mensagens que citam o contato perdem texto e botoes) e desde a 9052 a citacao dele em mia_assistente_citacoes.';

revoke all on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from public;
revoke execute on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from anon;
revoke execute on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from authenticated;

-- A tabela nova é só do servidor: as travas do suporte a deixam sem política.
do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

notify pgrst, 'reload schema';
