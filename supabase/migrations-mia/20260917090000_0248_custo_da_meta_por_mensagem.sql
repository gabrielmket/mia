-- 0248 — o que a META cobra por mensagem, ao lado do que NÓS cobramos
--
-- A 0244 guarda o preço que o CLIENTE paga. Faltava o outro lado: quanto a
-- conversa custa para a operação. Sem os dois, "margem" é chute — e foi
-- exatamente esse chute que a fatura da OpenAI (0242) veio matar do lado da IA.
--
-- ── Por que uma tabela de TARIFA, e não um campo de custo por mensagem ──────
--
-- A Meta não cobra um valor único: cobra por CATEGORIA (marketing, utilidade,
-- autenticação, serviço) e por PAÍS de destino. Um campo só forçaria a média —
-- e a média esconde justamente o caso caro, que é marketing para o Brasil.
--
-- ⚠️ E as categorias não são iguais no gratuito. O free tier da Meta é de
-- conversas de SERVIÇO (as que o cliente inicia). Mensagem de template de
-- MARKETING — que é o que um disparador manda — é cobrada desde a primeira.
-- Confundir as duas faz vender abaixo do custo e só descobrir na fatura; por
-- isso `gratuitas_por_mes` é POR CATEGORIA e nasce zero.
--
-- ── Declarada, não adivinhada ───────────────────────────────────────────────
--
-- A Graph API não expõe a tabela de preços de forma estável, e raspar página de
-- preço é a receita de um número errado que ninguém confere. Aqui alguém DIGITA
-- o que a Meta cobra, com a data em que aquilo valia — e a tela mostra a data,
-- para quem lê saber se o número é de hoje ou de março.

create table if not exists public.platform_meta_pricing (
  id            uuid primary key default gen_random_uuid(),
  -- 'marketing' | 'utility' | 'authentication' | 'service'
  categoria     text not null,
  -- ISO-2 do destino ('BR'). País importa: a mesma categoria custa diferente.
  pais          text not null default 'BR',
  -- Em CENTAVOS da moeda declarada, para não arrastar float por todo o cálculo.
  preco_cents   integer not null,
  moeda         text not null default 'BRL',
  /**
   * Quantas a Meta dá de graça por mês NESTA categoria. Nasce ZERO: supor o
   * gratuito de serviço para marketing é o erro que faz vender no prejuízo.
   */
  gratuitas_por_mes integer not null default 0,
  /** Desde quando esta tarifa vale. A tela mostra, e é o que evita usar preço velho. */
  vigente_desde date not null default current_date,
  note          text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint platform_meta_pricing_categoria_check
    check (categoria in ('marketing', 'utility', 'authentication', 'service')),
  constraint platform_meta_pricing_preco_check check (preco_cents >= 0),
  constraint platform_meta_pricing_gratuitas_check check (gratuitas_por_mes >= 0)
);

comment on table public.platform_meta_pricing is
  'O que a META cobra por mensagem, por categoria e pais, DECLARADO por quem opera a instalacao (a Graph API nao expoe isso de forma estavel). E o outro lado de tenant_broadcast_pricing: um e o que o cliente paga, outro e o que a operacao paga. Sem os dois, margem e chute.';

comment on column public.platform_meta_pricing.gratuitas_por_mes is
  'Nasce ZERO de proposito. O gratuito da Meta e de conversa de SERVICO (iniciada pelo cliente); template de MARKETING e cobrado desde a primeira. Supor o gratuito de servico para marketing faz vender abaixo do custo e so descobrir na fatura.';

-- Uma tarifa viva por (categoria, país, data): trocar o preço é inserir outra
-- linha com `vigente_desde` novo, e o histórico fica. Preço de disparo antigo
-- continua explicável pelo preço que valia naquele dia.
create unique index if not exists uq_platform_meta_pricing_vigencia
  on public.platform_meta_pricing (categoria, pais, vigente_desde);

alter table public.platform_meta_pricing enable row level security;

-- ZERO POLICIES: é custo da PLATAFORMA, e o cliente nunca vê o que pagamos —
-- mesma doutrina de `platform_ai_ledger` e de `lib/ai/custo-e-da-plataforma.ts`.
revoke all on public.platform_meta_pricing from anon, authenticated;
grant select, insert, delete on public.platform_meta_pricing to service_role;
