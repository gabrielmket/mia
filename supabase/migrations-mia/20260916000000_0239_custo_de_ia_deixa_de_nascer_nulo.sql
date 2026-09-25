-- 0239 — o custo que nasceu nulo ganha número (e o teto volta a vincular)
--
-- `pricing.ts` conhece três modelos Claude e devolve NULL para qualquer outro.
-- O catálogo que a tela oferece (`ai_models`, 0104) tem dezesseis, e o padrão de
-- OpenAI — `gpt-5.6-terra` — é um deles. Quem escolheu um modelo do catálogo
-- ficava assim, medido na instalação da Time Company em 15/09/2026:
--
--   • toda linha de `llm_calls` com `cost_cents` nulo;
--   • 2,8 milhões de tokens no painel da plataforma ao lado de "Custo AI
--     US$ 0,00" — que qualquer pessoa lê como "não custou nada";
--   • `fn_gasto_de_ia_do_mes` somando `coalesce(cost_cents, 0)`, então o TETO
--     mensal e o alarme de 80% nunca disparavam. A proteção contra a fatura
--     surpreender o dono estava desarmada exatamente para o caminho padrão.
--
-- O motor passou a consultar o catálogo (`lib/agent-engine/edge/llm/preco-do-catalogo.ts`).
-- Esta migration faz o mesmo com o que JÁ FOI GRAVADO: os tokens estão todos lá,
-- só o preço faltava. Recalcula apenas onde `cost_cents` é nulo — linha com
-- custo escrito por qualquer um dos três caminhos de cálculo não é tocada.
--
-- Tarifa de cache: `ai_pricing` só tem entrada e saída. O token lido do cache
-- entra a 10% da entrada (o mesmo fator que `pricing.ts` usa nos Claude) e o
-- token escrito no cache entra a preço de entrada — a OpenAI não cobra a escrita
-- à parte, e cobrar a mais seria pior num número que decide bloqueio.
--
-- Idempotente: rodar de novo não casa nada (não há mais nulo a preencher) e o
-- reconciliar do contador recalcula em vez de somar.

-- ---- 1. o preço vigente de cada modelo, com o catálogo como segunda fonte ----
--
-- `ai_pricing` é a fonte (versionada por vigência); `ai_models` cobre o modelo
-- que foi habilitado só pela tela do catálogo e nunca chegou à tabela de preço.
with precos as (
  select distinct on (modelo) modelo, entrada, saida from (
    select p.model as modelo,
           p.prompt_cents_per_million_tokens as entrada,
           p.completion_cents_per_million_tokens as saida,
           1 as prioridade
      from public.ai_pricing p
     where p.effective_from <= now()
       and p.superseded_at is null
       and p.prompt_cents_per_million_tokens is not null
       and p.completion_cents_per_million_tokens is not null
    union all
    select m.model_id,
           m.input_price_per_million_cents::numeric,
           m.output_price_per_million_cents::numeric,
           2
      from public.ai_models m
     where m.deprecated_at is null
       and m.input_price_per_million_cents is not null
       and m.output_price_per_million_cents is not null
  ) fontes
  order by modelo, prioridade
)
update public.llm_calls c
   set cost_cents =
         (greatest(0, c.input_tokens - c.cache_read_tokens) * p.entrada
          + c.cache_read_tokens * p.entrada * 0.1
          + c.output_tokens * p.saida) / 1000000.0
  from precos p
 where p.modelo = c.model
   and c.cost_cents is null
   and (c.input_tokens > 0 or c.output_tokens > 0);

-- ---- 2. o contador materializado do orçamento volta a bater com a fonte ----
--
-- `fn_update_budget_consumption` só roda no INSERT, então o recálculo acima não
-- chega nele sozinho. Mesmo reconciliar da 0095: recalcula o mês corrente a
-- partir das duas telemetrias, em vez de somar por cima do que já estava lá.
insert into public.ai_budgets (organization_id, current_month_consumed_cents)
select o.id,
       coalesce((select sum(cost_cents) from public.llm_calls c
                  where c.organization_id = o.id and c.created_at >= date_trunc('month', now())), 0)
     + coalesce((select sum(cost_cents) from public.ai_invocations i
                  where i.organization_id = o.id and i.created_at >= date_trunc('month', now())), 0)
  from public.organizations o
on conflict (organization_id) do update
   set current_month_consumed_cents = excluded.current_month_consumed_cents,
       updated_at = now();
