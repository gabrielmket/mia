-- 0272 — a chegada do cadastro incorporado guardou o id errado
--
-- ── O defeito, medido na primeira chegada real ───────────────────────────────
--
-- Em 21/09/2026, às 16:02, a primeira conta chegou de verdade pelo cadastro
-- incorporado. O webhook recebeu, a assinatura conferiu, a linha foi gravada —
-- e o `waba_id` gravado não existe na Meta.
--
-- O payload veio assim, e só assim:
--
--   { "event": "PARTNER_ADDED",
--     "waba_info": { "waba_id": "…", "owner_business_id": "…" } }
--
-- `lerChegada` procurava `value.waba_id`, que nesse formato não existe, e caía
-- no `entry.id` do envelope. No `account_update` esse fallback está certo (ali
-- o `entry.id` É a conta); no `partner_added`, não é.
--
-- O estrago não é o campo errado: é o que ele faz com a tela. O operador abriu
-- `/admin/cadastro-incorporado`, viu uma conta esperando, e não tinha como
-- amarrá-la nem conferi-la — porque o id que ele estava vendo não correspondia
-- a nada do lado da Meta. "Chegou e não dá para fazer nada" é pior que não ter
-- chegado: no segundo caso você vai procurar o problema na Meta, no primeiro
-- você acha que já está resolvido.
--
-- ── Por que a correção é aqui e não só no código ─────────────────────────────
--
-- O conserto do parser vale para a PRÓXIMA chegada. A linha que já está no
-- banco continuaria errada para sempre, e ela é justamente a do cliente que
-- está esperando agora. O payload cru foi guardado inteiro de propósito (o
-- comentário da 0257 diz por quê: "o que hoje é ruído pode ser o único lugar
-- onde está o dado que faltou") — e hoje é o dia em que isso paga.
--
-- ── owner_business_id ────────────────────────────────────────────────────────
--
-- O `partner_added` não traz número nenhum: ele avisa que uma empresa adicionou
-- nosso app, e os números vêm depois. Sem número e sem nome, a única pista de
-- "de quem é esta conta" é o portfólio empresarial do cliente. É o que permite
-- ao operador conferir, a olho, que a conta que chegou é do cliente que ele
-- espera — antes de amarrar. Guardar essa pista é o que impede a amarração no
-- palpite, que é o desfecho que o cadastro incorporado inteiro existe para
-- evitar.

alter table public.meta_onboardings
  add column if not exists owner_business_id text;

comment on column public.meta_onboardings.owner_business_id is
  'Portfólio empresarial DO CLIENTE, lido de payload->waba_info->owner_business_id. A única pista de dono que o partner_added traz, e o que permite conferir a amarração antes de fazê-la.';

-- ── O reparo das linhas já gravadas ──────────────────────────────────────────
--
-- Só toca linha em que as TRÊS coisas são verdade:
--   · o payload tem `waba_info.waba_id` (é do formato que o parser lia errado);
--   · ele difere do `waba_id` gravado (senão não há o que consertar);
--   · a linha ainda NÃO foi amarrada a cliente nenhum.
--
-- A terceira condição é a que importa. `waba_id` é a chave por onde a
-- amarração encontra a linha e por onde `guardarChegada` decide não mexer no
-- que já tem dono. Trocar o id de uma linha JÁ amarrada desligaria em silêncio
-- a conta de um canal que pode estar conversando — exatamente o estrago que
-- esta migration existe para evitar, invertido.
--
-- E o `not exists` guarda o índice único: se o id correto já estiver na tabela
-- (uma segunda chegada da mesma conta, dessa vez lida certo), a linha velha
-- fica como está em vez de derrubar a migration inteira num 23505. Sobra uma
-- linha órfã que o operador vê e ignora; o alternativo é o baseline parar.
update public.meta_onboardings as m
   set waba_id           = m.payload -> 'waba_info' ->> 'waba_id',
       owner_business_id = coalesce(
                             m.owner_business_id,
                             m.payload -> 'waba_info' ->> 'owner_business_id'
                           ),
       updated_at        = now()
 where m.payload -> 'waba_info' ->> 'waba_id' is not null
   and m.payload -> 'waba_info' ->> 'waba_id' <> m.waba_id
   and m.organization_id is null
   and not exists (
         select 1
           from public.meta_onboardings as outra
          where outra.waba_id = m.payload -> 'waba_info' ->> 'waba_id'
       );

-- Linhas do formato certo que só não tinham a coluna: preenche sem mexer no id.
update public.meta_onboardings as m
   set owner_business_id = m.payload -> 'waba_info' ->> 'owner_business_id'
 where m.owner_business_id is null
   and m.payload -> 'waba_info' ->> 'owner_business_id' is not null;
