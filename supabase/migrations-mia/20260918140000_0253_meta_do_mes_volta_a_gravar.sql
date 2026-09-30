-- 0253 — definir meta volta a funcionar (e nunca funcionou)
--
-- ⚠️ DEFEITO EM PRODUÇÃO DESDE A 0243. Não é "falha quando já existe meta":
-- falha SEMPRE, inclusive a primeira meta do mês numa tabela vazia. A rota
-- `app/api/v1/metas/route.ts` grava com
-- `onConflict: "organization_id,periodo,metrica,user_id,agent_id"`, e o único
-- índice único da tabela é `idx_sales_targets_unica`, que é sobre EXPRESSÕES
-- (`coalesce(user_id, …)`, `coalesce(agent_id, …)`).
--
-- O Postgres infere o índice do `ON CONFLICT` no PLANEJAMENTO, antes de olhar
-- qualquer linha: uma lista de colunas não casa com índice de expressão, e a
-- instrução morre com `42P10 … infer_arbiter_indexes`. Com a tabela vazia,
-- igual. Ou seja: a tela de metas nunca gravou nada, em nenhuma instalação.
--
-- ── Por que ninguém viu, e essa é a parte que se repete ─────────────────────
--
-- A rota descarta `error.code` e devolve "Não consegui gravar a meta.", e
-- `fail()` não escreve log. Um erro em 100% das gravações sobreviveu em
-- produção porque o único lugar onde ele aparecia era um toast genérico. É a
-- mesma família do `no_meta_channel` e da chave de IA: a falha existe, é
-- categórica, e o sistema a conta como se fosse a vida normal.
--
-- ── Por que índice novo, e não outra saída ──────────────────────────────────
--
-- Medido num Postgres real, não deduzido:
--
--  • `on conflict on constraint idx_sales_targets_unica` → `42704`: é ÍNDICE, e
--    não constraint. E o PostgREST só aceita lista de colunas em `on_conflict`,
--    nunca nome de constraint. A saída "aponte para a constraint" é impossível
--    por dois motivos independentes.
--  • Índice único SIMPLES na lista de colunas (NULLS DISTINCT, o padrão) é
--    ARMADILHA: a inferência passa, mas meta da organização (`user_id` e
--    `agent_id` nulos) nunca casa consigo mesma, o INSERT é tentado e morre em
--    `23505`. Trocaria um erro por outro.
--  • `NULLS NOT DISTINCT` resolve: NULL passa a casar com NULL, a inferência
--    encontra o índice e o upsert redefine a linha no lugar. É pg15+, e o piso
--    declarado deste repo é pg15 (`supabase/config.toml`, `scripts/test-db.sh`).
--
-- Select+update na rota também resolveria sem migration, e foi recusado pelo
-- mesmo motivo que a 0250 escolheu gatilho em vez de consertar o upsert: conserta
-- UM chamador e deixa a tabela impossível de upsertar para psql, rota futura ou
-- ferramenta de agente — além de abrir corrida entre o select e o insert.
--
-- ── O que NÃO muda ──────────────────────────────────────────────────────────
--
-- A semântica é idêntica: NULL continua significando "a organização inteira".
-- O índice antigo já proibia a duplicata, então o novo constrói sem conflito em
-- bancos com dados. A rota fica byte a byte como está.

create unique index if not exists idx_sales_targets_unica_nn
  on public.sales_targets (organization_id, periodo, metrica, user_id, agent_id)
  nulls not distinct;

-- O antigo sai DEPOIS do novo existir: em ordem inversa a tabela ficaria, por um
-- instante, sem trava de duplicidade.
drop index if exists public.idx_sales_targets_unica;

comment on index public.idx_sales_targets_unica_nn is
  'Trava de meta unica por (org, periodo, metrica, user, agente). NULLS NOT DISTINCT porque NULL aqui significa "a organizacao inteira" e precisa casar consigo mesmo: sem isso o ON CONFLICT da rota de metas nao infere indice nenhum e TODA gravacao morre em 42P10.';

notify pgrst, 'reload schema';
