-- 0241 — a cotação do dólar, um valor POR DIA (e não um número que envelhece)
--
-- A 0240 guardou uma cotação única em `platform_ai_custo`. Serve para hoje e
-- mente sobre ontem: o provedor cobra em dólar, e converter um mês inteiro pela
-- cotação de hoje faz o custo de agosto MUDAR quando o câmbio mexe em setembro.
-- Quem decide margem olhando esse número decide sobre areia.
--
-- Aqui cada dia guarda a cotação DELE. O custo de um dia fechado é convertido
-- pela cotação daquele dia e para de se mexer — e o painel continua automático,
-- porque quem preenche é o cron (`api/v1/cron/cotacao-do-dolar`), não uma pessoa.
--
-- `platform_ai_custo` continua existindo e passa a ser o ESPELHO da cotação mais
-- recente: é o que a tela lê para dizer "convertido a R$ X, de tal dia", e é o
-- que uma pessoa pode sobrescrever à mão se a origem estiver fora do ar.

create table if not exists public.platform_fx_rates (
  dia           date        primary key,
  usd_brl       numeric(10,4) not null,
  fonte         text        not null default 'awesomeapi',
  capturado_em  timestamptz not null default now(),
  -- Piso e teto de sanidade: um soluço da origem devolvendo 0 ou 9999 viraria
  -- custo zerado ou pânico na tela. O intervalo é largo de propósito — protege
  -- contra resposta quebrada, não contra variação real do câmbio.
  constraint platform_fx_rates_valor_check check (usd_brl > 0.5 and usd_brl < 100)
);

comment on table public.platform_fx_rates is
  'Cotação USD→BRL de cada dia, preenchida pelo cron cotacao-do-dolar. O custo de IA de um dia é convertido pela cotação DAQUELE dia: sem isto, o custo de um mês fechado mudaria sozinho a cada oscilação do câmbio. Tabela de plataforma: lida e escrita só server-side (service_role).';

comment on column public.platform_fx_rates.fonte is
  'De onde veio o número. Existe para o dia em que a origem mudar: um valor lançado à mão e um vindo da API não valem o mesmo na hora de conferir uma diferença.';

alter table public.platform_fx_rates enable row level security;

-- ZERO POLICIES, de propósito — mesma doutrina de `platform_branding` e da 0240.
revoke all on public.platform_fx_rates from anon, authenticated;
grant select, insert, update on public.platform_fx_rates to service_role;

-- ---- o dólar que VOCÊ pagou, que não é o do mercado -----------------------
--
-- Recarga feita com cartão brasileiro sai por mais do que a cotação: tem o
-- spread do banco e o IOF. Calcular isso por percentual seria inventar precisão
-- — a taxa do banco muda por operação e o IOF muda por decreto.
--
-- Então a recarga passa a poder registrar QUANTO SAIU EM REAIS. Com os dois
-- números (dólares que entraram na conta do provedor e reais que saíram do
-- cartão), a taxa efetiva é uma divisão, já com IOF e spread dentro, medida em
-- vez de estimada. É ela que vale para decidir margem; a de mercado serve para
-- mostrar quanto custou comprar o dólar.
--
-- Nulo é um estado legítimo: recarga antiga, ou paga por outro meio, fica sem
-- o valor em reais e simplesmente não entra na média da taxa efetiva.
alter table public.platform_ai_ledger
  add column if not exists amount_brl numeric(12,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'platform_ai_ledger_brl_check'
  ) then
    alter table public.platform_ai_ledger
      add constraint platform_ai_ledger_brl_check
      check (amount_brl is null or amount_brl >= 0);
  end if;
end $$;

comment on column public.platform_ai_ledger.amount_brl is
  'Quanto saiu em REAIS nesta recarga (cartão, Pix, o que for). Com o amount_usd dá a taxa efetiva paga — IOF e spread do banco inclusos, medidos e não estimados. NULL = não informado; a linha fica fora da média.';

notify pgrst, 'reload schema';
