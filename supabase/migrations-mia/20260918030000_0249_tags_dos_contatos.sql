-- 0249 — as tags que os contatos REALMENTE têm, com quantos em cada
--
-- O disparador pede as tags num campo de texto livre. Quem digita um nome que
-- não existe recebe uma lista VAZIA e nenhuma explicação — e foi exatamente
-- assim que se descobriu, na primeira campanha real, que `contacts.tags` e
-- `crm_leads.tags` são colunas diferentes: a tag tinha sido posta no CARTÃO do
-- funil, o filtro lê a do CONTATO, e o sistema devolveu zero em silêncio.
--
-- ── Por que uma função e não um `select` na rota ────────────────────────────
--
-- `tags` é `text[]`, e "as tags distintas da organização, com contagem" é um
-- `unnest` + `group by`. O PostgREST não expressa isso: a rota teria de puxar a
-- coluna de TODOS os contatos e agregar no Node — o que transforma uma pergunta
-- de índice numa transferência de 50 mil arrays a cada vez que alguém abre o
-- seletor.
--
-- ── Por que a CONTAGEM vai junto, e não é enfeite ───────────────────────────
--
-- É ela que responde antes de custar. Ver `vip (0)` no seletor diz na hora que
-- aquela tag não vai render campanha nenhuma; sem o número, a mesma descoberta
-- exige montar a lista e ficar olhando um "0 destinatários" sem causa.
--
-- ── SECURITY INVOKER de propósito ──────────────────────────────────────────
--
-- A função NÃO é definer: rodando como quem chamou, a RLS de `contacts` decide
-- o que ela enxerga, e o `p_org` vira conveniência de filtro em vez de ser a
-- única defesa. Uma definer aqui precisaria repetir à mão a checagem de
-- pertencimento — mais um lugar para a regra divergir da política da tabela.
--
-- Contato ANONIMIZADO e contato FUNDIDO ficam de fora: o primeiro não deve ser
-- alvo de campanha por dever legal, e o segundo é uma linha que já virou outra.

create or replace function public.fn_contact_tags(p_org uuid)
returns table (tag text, quantos bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select t as tag, count(*)::bigint as quantos
    from public.contacts c
    cross join lateral unnest(c.tags) as t
   where c.organization_id = p_org
     and c.is_anonymized = false
     and c.is_merged_into is null
   group by t
   order by count(*) desc, t asc
$$;

comment on function public.fn_contact_tags(uuid) is
  'As tags distintas de contacts.tags da organizacao, com quantos contatos em cada. Alimenta o seletor de tags do MIA Broadcast: sem a contagem, tag que nao rende ninguem so e descoberta depois de montar a lista. SECURITY INVOKER: a RLS de contacts e quem decide o alcance.';

revoke all on function public.fn_contact_tags(uuid) from public;
grant execute on function public.fn_contact_tags(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
