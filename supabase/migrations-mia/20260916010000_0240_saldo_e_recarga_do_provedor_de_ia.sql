-- 0240 — o saldo do provedor de IA, e os lançamentos que o explicam
--
-- O painel da plataforma respondia "quanto foi consumido" e não respondia a
-- pergunta que acorda alguém de madrugada: "quanto ainda tem na conta do
-- provedor, e até quando dura?". Sem isso a operação inteira para quando o
-- crédito acaba — a chave continua válida, a chamada volta 429/insufficient
-- quota, e o sintoma chega como "a IA parou de responder", sem dizer por quê.
--
-- Duas tabelas, as duas de PLATAFORMA (nunca de tenant): quem paga o provedor é
-- quem opera a instalação.
--
-- ── Por que LANÇAMENTOS, e não um campo "saldo" ──────────────────────────────
--
-- Saldo escrito à mão envelhece no instante seguinte e ninguém sabe de quando
-- ele é. Aqui o saldo é DERIVADO, e por isso se mantém sozinho:
--
--   saldo = última LEITURA + RECARGAS depois dela − consumo desde a leitura
--
-- `leitura` é "fui na conta do provedor e o saldo era este, neste instante" —
-- ela reancora a conta e absorve toda diferença acumulada (uso fora do CRM,
-- arredondamento, a aproximação da tarifa de cache). `recarga` é dinheiro
-- colocado. O consumo sai de `llm_calls`, a mesma fonte das telas.
--
-- Efeito colateral bom: a diferença entre o saldo que o painel calculava e o
-- que a leitura encontrou é a medida de quanto a nossa medição erra.

create table if not exists public.platform_ai_ledger (
  id           uuid primary key default gen_random_uuid(),
  tipo         text        not null,
  amount_usd   numeric(12,4) not null,
  occurred_at  timestamptz not null default now(),
  note         text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  constraint platform_ai_ledger_tipo_check check (tipo in ('recarga', 'leitura')),
  -- Valor negativo aqui viraria saldo inventado para cima ou para baixo sem
  -- rastro; estorno se registra como uma leitura nova, que é o fato observado.
  constraint platform_ai_ledger_valor_check check (amount_usd >= 0)
);

comment on table public.platform_ai_ledger is
  'Lançamentos que explicam o saldo do provedor de IA da INSTALAÇÃO. tipo=leitura: saldo conferido na conta do provedor naquele instante (reancora a conta). tipo=recarga: crédito adicionado. O saldo nunca é gravado: é derivado da última leitura + recargas posteriores − consumo de llm_calls no mesmo intervalo. Lida e escrita só server-side (service_role), pelo admin de plataforma.';

comment on column public.platform_ai_ledger.occurred_at is
  'QUANDO o fato aconteceu na conta do provedor — não quando foi digitado. Recarga lançada dois dias depois conta a partir do dia certo, senão o saldo do intervalo sai errado.';

create index if not exists idx_platform_ai_ledger_quando
  on public.platform_ai_ledger (occurred_at desc);

alter table public.platform_ai_ledger enable row level security;

-- ZERO POLICIES, de propósito: mesma doutrina de `platform_branding`. Não há
-- leitura por cookie de tenant; quem lê é o handler de /admin com service role,
-- depois de `requirePlatformAdmin`.
revoke all on public.platform_ai_ledger from anon, authenticated;
grant select, insert, delete on public.platform_ai_ledger to service_role;

-- ---- a cotação, para o painel falar em real sem inventar câmbio ------------
--
-- O provedor cobra em DÓLAR e a decisão de preço é em REAL. Converter por uma
-- cotação buscada na hora faria o custo de um mês fechado mudar sozinho a cada
-- abertura da tela. Aqui a cotação é declarada, com a data em que foi lida — a
-- tela mostra as duas coisas, e quem decide margem sabe sobre qual câmbio.
create table if not exists public.platform_ai_custo (
  id          smallint primary key default 1,
  usd_brl     numeric(10,4),
  cotado_em   timestamptz,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint platform_ai_custo_singleton check (id = 1),
  constraint platform_ai_custo_valor check (usd_brl is null or (usd_brl > 0 and usd_brl < 1000))
);

comment on table public.platform_ai_custo is
  'Linha única (id=1) com a cotação do dólar que o painel de custo usa para exibir reais, e a data em que ela foi lida. Nula = o painel mostra só dólar, em vez de inventar câmbio.';

alter table public.platform_ai_custo enable row level security;
revoke all on public.platform_ai_custo from anon, authenticated;
grant select, insert, update on public.platform_ai_custo to service_role;

drop trigger if exists trg_platform_ai_custo_touch on public.platform_ai_custo;
create trigger trg_platform_ai_custo_touch
  before update on public.platform_ai_custo
  for each row execute function public.fn_touch_updated_at();

notify pgrst, 'reload schema';
