-- 0242 — o gasto REAL da conta do provedor, ao lado do que este sistema mede
--
-- O CRM soma token × preço de tabela. É boa medida, sustenta teto e preço por
-- conversa — mas é MEDIÇÃO, e medição tem erro: modelo sem preço no catálogo,
-- desconto de cache que a tarifa não descreve, uso da mesma chave fora daqui.
--
-- A API de organização da OpenAI responde a pergunta definitiva: quanto foi
-- COBRADO. Guardando dia a dia, a diferença entre as duas deixa de ser suspeita
-- e vira número — é ela que diz se dá para confiar no custo por conversa na
-- hora de fechar preço com um cliente.
--
-- Só dias FECHADOS entram: o dia corrente não existe na fatura até virar a
-- meia-noite UTC, e inventar o dia aberto seria repetir o defeito que esta
-- tabela veio medir.

create table if not exists public.platform_openai_spend (
  dia           date        primary key,
  usd           numeric(12,4) not null,
  capturado_em  timestamptz not null default now(),
  constraint platform_openai_spend_valor_check check (usd >= 0)
);

comment on table public.platform_openai_spend is
  'Gasto diário COBRADO pela OpenAI (API de organização, /v1/organization/costs), preenchido pelo cron gasto-openai quando existe OPENAI_ADMIN_KEY. Existe para comparar com o custo que o sistema mede a partir de llm_calls: a diferença entre os dois é a margem de erro da nossa medição. Só dias fechados — o dia corrente não existe na fatura.';

alter table public.platform_openai_spend enable row level security;

-- ZERO POLICIES, de propósito — mesma doutrina de `platform_branding`, 0240 e 0241.
revoke all on public.platform_openai_spend from anon, authenticated;
grant select, insert, update on public.platform_openai_spend to service_role;

notify pgrst, 'reload schema';
