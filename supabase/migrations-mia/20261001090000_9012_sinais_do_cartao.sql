-- 9012 · os sinais do cartão do funil: a objeção aberta e quem mandou a última mensagem
--
-- ── O que o cartão passa a responder ────────────────────────────────────────
--
-- O cartão fechado do funil (docs/fork/cartoes-e-fichas.md) passa a dizer COM
-- QUEM ESTÁ A BOLA ("Lead há 12 min", "Agente há 1 h", "Você há 4 dias") e a
-- OBJEÇÃO ABERTA mais recente ("objeção: parcela"). As duas respostas já estão
-- gravadas — nenhuma coluna nova:
--
--   · a objeção é o retrato que a IA grava a cada turno em
--     `lead_checkpoints.objections` (string[]). Cada checkpoint é uma foto nova
--     da lista, não um acréscimo (`lib/leads/checkpoint-diff.ts` compara um com
--     o anterior para achar as novas): o que está no ÚLTIMO checkpoint é o que
--     segue aberto; o que sumiu dele foi respondido.
--   · a conversa guarda QUANDO saiu a última mensagem (`last_outbound_at`), não
--     QUEM mandou. Quem mandou é `messages.sent_via` (ai, automation, crm…) e
--     `sent_by_user_id`, na última mensagem de saída do contato.
--
-- ── Por que uma função, e não duas consultas da rota ────────────────────────
--
-- As duas perguntas são "a linha mais recente POR CONTATO", e o PostgREST não
-- tem `distinct on`. Sem a função, a rota do quadro teria de trazer TODOS os
-- checkpoints e TODAS as mensagens de saída dos contatos do funil para jogar
-- quase tudo fora — um checkpoint por turno de IA, uma mensagem por resposta.
-- `idx_lead_checkpoints_latest (organization_id, contact_id, seq desc)` serve a
-- primeira; `idx_messages_contact_id` a segunda.
--
-- ── Segurança ───────────────────────────────────────────────────────────────
--
-- `security invoker`: roda com a RLS de quem chama (tenant_isolation das duas
-- tabelas), e ainda filtra `organization_id = p_org` explicitamente — a regra
-- do CLAUDE.md para toda consulta que cruza tabelas tenant-aware. Não escreve
-- nada. EXECUTE só para `authenticated` e `service_role`: as DUAS origens de
-- EXECUTE (o default privileges do baseline, que dá a anon, e o grant a PUBLIC
-- do Postgres) são revogadas.
--
-- Nome com prefixo `fn_mia_`: é nossa, ao lado das do upstream, nunca por cima
-- (docs/FORK-MIA.md, regra 3).

create or replace function public.fn_mia_sinais_do_cartao(p_org uuid, p_contatos uuid[])
returns table (
  contact_id uuid,
  objecoes jsonb,
  objecoes_em timestamptz,
  ultima_saida_via text,
  ultima_saida_por uuid,
  ultima_saida_em timestamptz
)
language sql
stable
security invoker
set search_path = public
as $f$
  with alvo as (
    select distinct c as contact_id
      from unnest(coalesce(p_contatos, '{}'::uuid[])) as c
     where c is not null
  ),
  retrato as (
    select distinct on (lc.contact_id)
           lc.contact_id, lc.objections, lc.created_at
      from public.lead_checkpoints lc
     where lc.organization_id = p_org
       and lc.contact_id in (select a.contact_id from alvo a)
     order by lc.contact_id, lc.seq desc
  ),
  saida as (
    select distinct on (m.contact_id)
           m.contact_id, m.sent_via, m.sent_by_user_id, m.sent_at
      from public.messages m
     where m.organization_id = p_org
       and m.contact_id in (select a.contact_id from alvo a)
       and m.direction = 'outbound'
       and m.status <> 'failed'
     order by m.contact_id, m.sent_at desc
  )
  select a.contact_id,
         r.objections,
         r.created_at,
         s.sent_via,
         s.sent_by_user_id,
         s.sent_at
    from alvo a
    left join retrato r on r.contact_id = a.contact_id
    left join saida s on s.contact_id = a.contact_id
   where r.contact_id is not null or s.contact_id is not null;
$f$;

comment on function public.fn_mia_sinais_do_cartao(uuid, uuid[]) is
  'MIA (9012): para cada contato, as objecoes do ULTIMO checkpoint da IA (o retrato atual; o que sumiu dele foi respondido) e quem mandou a ultima mensagem de saida (messages.sent_via e sent_by_user_id). Leitura do cartao do funil (com quem esta a bola, objecao aberta). security invoker: vale a RLS de quem chama, mais o filtro explicito de organizacao.';

revoke execute on function public.fn_mia_sinais_do_cartao(uuid, uuid[]) from public, anon;
grant execute on function public.fn_mia_sinais_do_cartao(uuid, uuid[]) to authenticated, service_role;
