-- ═══════════════════════════════════════════════════════════════════════════
-- baseline-mia.sql — O SCHEMA DA PLATAFORMA MIA
--
-- Aplicado por easypanel/bootstrap.sh DEPOIS de supabase/baseline.sql, que é o
-- do upstream (melgarafael/DeskcommCRM) byte a byte e NUNCA é editado aqui.
--
-- AS DUAS REGRAS DESTE ARQUIVO:
--
--   1. Estender, nunca redefinir. Nada aqui pode fazer `create or replace` de
--      função, gatilho ou view que já exista em baseline.sql. Quando a MIA
--      precisa de mais, pendura o seu ao lado (gatilho próprio, tabela nova,
--      função com nome nosso). Vigiado por scripts/redefinicoes-do-upstream.mjs.
--
--   2. A varredura `anon` é o ÚLTIMO bloco deste arquivo — e portanto do schema
--      inteiro. Ela é auto-curativa e cura as funções dos DOIS arquivos, mas só
--      as que já existem quando ela roda.
--
-- Gerado por scripts/separar-baseline-mia.mjs em 25/09/2026.
-- ═══════════════════════════════════════════════════════════════════════════


-- ---- custo de IA deixa de nascer nulo (migration 0239) ----
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


-- ---- saldo e recarga do provedor de IA (migration 0240) ----
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


-- ---- cotacao do dolar por dia (migration 0241) ----
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


-- ---- gasto real da conta OpenAI (migration 0242) ----
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


-- ---- metas comerciais (migration 0243) ----
--
-- O CRM sabia QUANTO uma oportunidade vale e QUEM é o dono dela. Faltavam três
-- coisas para fechar o mês sem planilha à parte:
--
--  1. QUEM ORIGINOU. O card tem um dono (quem fecha). Quando o SDR marca a
--     reunião e o closer fecha, o crédito da venda fica inteiro com o closer, e
--     a participação do SDR vira planilha paralela — que é exatamente o que
--     este CRM existe para matar.
--  2. QUE TIPO DE RECEITA É. Mensalidade e projeto avulso somam igual num total
--     que decide comissão e projeção, e não deveriam: R$ 10 mil recorrentes e
--     R$ 10 mil de setup valem coisas diferentes para o negócio.
--  3. O ALVO. Sem meta gravada, "quanto falta" é conta de cabeça, e acompanhar
--     progresso exige alguém montando o número toda segunda-feira.
--
-- As três entram aqui. O cálculo do progresso NÃO: ele é derivado das mesmas
-- linhas de `crm_leads` que já existem (doutrina DIRC — o que se calcula não se
-- guarda), e vive em `lib/crm/metas/`.

-- ---- 1. o card ganha origem e natureza da receita ---------------------------

alter table public.crm_leads
  add column if not exists originated_by_user_id uuid references auth.users(id) on delete set null;

comment on column public.crm_leads.originated_by_user_id is
  'Quem ORIGINOU a oportunidade (o SDR que marcou a reunião), quando não é a mesma pessoa que fecha (owner_user_id). NULL = originada pelo próprio dono, ou origem não registrada. Existe para a meta de participação do SDR sair do mesmo lugar onde a venda é registrada, em vez de uma planilha paralela.';

alter table public.crm_leads
  add column if not exists revenue_kind text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_leads_revenue_kind_enum') then
    alter table public.crm_leads
      add constraint crm_leads_revenue_kind_enum
      check (revenue_kind is null or revenue_kind in ('recorrente', 'avulso'));
  end if;
end $$;

comment on column public.crm_leads.revenue_kind is
  'recorrente = mensalidade/assinatura; avulso = projeto, setup, venda única. NULL = não classificada, e a tela DIZ isso em vez de escolher um lado — somar uma venda não classificada como avulsa inventaria a divisão que o relatório existe para mostrar.';

alter table public.crm_leads
  add column if not exists recurring_months integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_leads_recurring_months_check') then
    alter table public.crm_leads
      add constraint crm_leads_recurring_months_check
      check (recurring_months is null or (recurring_months > 0 and recurring_months <= 120));
  end if;
end $$;

comment on column public.crm_leads.recurring_months is
  'Duração do contrato em meses, para receita recorrente. Com ela, `value_cents` (a mensalidade) vira valor de contrato e receita anual sem ninguém multiplicar na mão. NULL em receita avulsa, e em recorrente sem prazo definido.';

create index if not exists idx_crm_leads_originado_por
  on public.crm_leads (organization_id, originated_by_user_id, closed_at)
  where originated_by_user_id is not null;

-- ---- 2. a meta do mês -------------------------------------------------------
--
-- Uma linha por (organização, mês, métrica, quem). "Quem" é a organização
-- inteira (user_id e agent_id nulos), uma PESSOA, ou um AGENTE de IA — porque a
-- meta de reunião marcada vale tanto para o SDR quanto para a Mia.

create table if not exists public.sales_targets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  -- Sempre o dia 1: mês é a unidade de meta comercial, e guardar o dia exato
  -- criaria duas metas "de setembro" que não se encontram.
  periodo          date not null,
  metrica          text not null,
  alvo_cents       bigint,
  alvo_quantidade  integer,
  user_id          uuid references auth.users(id) on delete cascade,
  agent_id         uuid,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sales_targets_metrica_enum check (metrica in (
    'reunioes',            -- atividade: reuniões marcadas no mês
    'receita_total',       -- tudo que foi ganho
    'receita_recorrente',  -- só mensalidade
    'receita_avulsa',      -- só projeto/setup
    'receita_originada'    -- a participação de quem ORIGINOU (a meta do SDR)
  )),
  -- Meta de dinheiro tem alvo em centavos; meta de atividade, em quantidade.
  -- Uma linha com os dois (ou com nenhum) não tem como ser exibida nem cobrada.
  constraint sales_targets_alvo_coerente check (
    (metrica = 'reunioes' and alvo_quantidade is not null and alvo_cents is null)
    or (metrica <> 'reunioes' and alvo_cents is not null and alvo_quantidade is null)
  ),
  constraint sales_targets_alvo_positivo check (
    coalesce(alvo_cents, 1) > 0 and coalesce(alvo_quantidade, 1) > 0
  ),
  -- Pessoa OU agente, nunca os dois: a meta é de um responsável só.
  constraint sales_targets_um_responsavel check (user_id is null or agent_id is null),
  constraint sales_targets_periodo_no_dia_1 check (extract(day from periodo) = 1)
);

comment on table public.sales_targets is
  'A meta de cada mês, por métrica e por responsável (organização inteira, uma pessoa, ou um agente de IA). O PROGRESSO não mora aqui: é derivado de crm_leads e de agendamentos, na leitura — o que se calcula não se guarda, senão a meta e a realidade divergem em silêncio.';

-- Índice único com as colunas nuláveis normalizadas: sem o coalesce, o Postgres
-- trata cada NULL como distinto e a mesma meta pode ser cadastrada duas vezes.
-- ⚠️ NULLS NOT DISTINCT, e a forma importa (migration 0253).
--
-- Este índice já foi de EXPRESSÃO (`coalesce(user_id, …)`), com a intenção certa
-- — NULL tem de casar com NULL — e a forma errada: o `ON CONFLICT` da rota de
-- metas lista COLUNAS, e o Postgres infere o índice no PLANEJAMENTO. Lista de
-- colunas não casa com índice de expressão, então TODA gravação de meta morria
-- em `42P10`, inclusive a primeira numa tabela vazia.
--
-- A rota engolia `error.code` e devolvia um toast genérico, então um erro em
-- 100% das gravações sobreviveu em produção sem aparecer em log nenhum.
create unique index if not exists idx_sales_targets_unica_nn
  on public.sales_targets (organization_id, periodo, metrica, user_id, agent_id)
  nulls not distinct;

-- O nome antigo sai do caminho em bancos que já o têm (o bloco 0253, no fim
-- deste arquivo, faz o mesmo ao reaplicar).
drop index if exists public.idx_sales_targets_unica;

create index if not exists idx_sales_targets_org_periodo
  on public.sales_targets (organization_id, periodo desc);

alter table public.sales_targets enable row level security;

drop policy if exists "sales_targets_select" on public.sales_targets;
create policy "sales_targets_select" on public.sales_targets
  for select using (organization_id in (select fn_user_org_ids()));

-- Escrever meta é decisão de gestão: manager+ define, o time acompanha.
drop policy if exists "sales_targets_write" on public.sales_targets;
create policy "sales_targets_write" on public.sales_targets
  for all using (
    organization_id in (select fn_user_org_ids())
    and fn_role_at_least(organization_id, 'manager')
  )
  with check (
    organization_id in (select fn_user_org_ids())
    and fn_role_at_least(organization_id, 'manager')
  );

revoke all on public.sales_targets from anon;
grant select, insert, update, delete on public.sales_targets to authenticated, service_role;

drop trigger if exists trg_sales_targets_touch on public.sales_targets;
create trigger trg_sales_targets_touch
  before update on public.sales_targets
  for each row execute function public.fn_set_updated_at();


-- ---- carteira do cliente (migration 0244) ----
--
-- Espelho EXATO da migration. Idempotente, como todo o apêndice.

-- 0244 — a carteira do cliente: crédito, extrato e trava de saldo
--
-- Primeira peça do disparador. Antes de o motor de envio existir, é preciso
-- responder três perguntas que ninguém consegue responder DEPOIS que a primeira
-- mensagem saiu: quanto o cliente tem, quanto cada envio custou a ELE, e o que
-- acontece quando o crédito acaba no meio de uma lista de 4.000 contatos.
--
-- ── Por que LANÇAMENTOS, e não um campo `saldo` ─────────────────────────────
--
-- Mesma doutrina da 0240 (saldo do provedor de IA), com uma diferença que muda
-- o desenho: lá o dinheiro está numa conta de TERCEIRO, e por isso existe o
-- lançamento `leitura`, que reancora a conta e absorve o que aconteceu fora do
-- nosso alcance. Aqui a conta é NOSSA. Não há movimento fora dela — todo
-- crédito entrou por um lançamento e todo débito saiu por outro —, então o
-- saldo é a soma exata, sem reancoragem e sem erro acumulado.
--
-- Um campo `saldo_cents` atualizado a cada envio seria mais rápido de ler e
-- erraria no primeiro envio concorrente: duas mensagens debitando ao mesmo
-- tempo leem o mesmo saldo e gravam o mesmo resultado, e uma delas sai de
-- graça. A soma não tem esse buraco.
--
-- ── A idempotência é do BANCO, não do código ────────────────────────────────
--
-- Disparador é a funcionalidade que MAIS vai ter retentativa: o provedor
-- devolve tempo esgotado depois de já ter aceitado, o worker morre entre o
-- envio e o débito, a fila reentrega. Um índice único sobre (origem,
-- referência) é o que garante que a mesma mensagem não seja cobrada duas vezes
-- — e é a única garantia que sobrevive a um `catch` mal escrito seis meses
-- depois.
--
-- ── Cobrança é do TENANT, custo é da PLATAFORMA ─────────────────────────────
--
-- Esta tabela é o que o CLIENTE vê: o que ele comprou e o que gastou. O que a
-- operação PAGA pela mesma mensagem não entra aqui e não tem policy que o
-- exponha — isso é `lib/ai/custo-e-da-plataforma.ts`, e a separação é
-- deliberada.

create table if not exists public.tenant_wallet_ledger (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  -- `credito`: dinheiro que entrou (pacote comprado, cortesia, ajuste a favor).
  -- `debito`: consumo (uma mensagem enviada e aceita pelo provedor).
  -- `estorno`: devolução de um débito que não virou entrega.
  tipo             text not null,
  -- SEMPRE positivo. O sinal vem do `tipo`, e não do número: valor negativo com
  -- tipo `credito` viraria débito escondido num extrato que diz "crédito".
  amount_cents     bigint not null,
  currency         text not null default 'BRL',
  occurred_at      timestamptz not null default now(),
  -- De onde veio o lançamento, para o extrato explicar cada linha e para a
  -- idempotência ter sobre o que se apoiar. `ref_kind` = 'broadcast_message',
  -- 'recarga_manual', 'ajuste'; `ref_id` = o id daquilo.
  ref_kind         text,
  ref_id           text,
  note             text,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint tenant_wallet_ledger_tipo_check
    check (tipo in ('credito', 'debito', 'estorno')),
  constraint tenant_wallet_ledger_valor_check
    check (amount_cents > 0)
);

comment on table public.tenant_wallet_ledger is
  'Carteira do CLIENTE (o que ele comprou e o que gastou), em centavos da moeda dele. O saldo NUNCA é gravado: e a soma de creditos + estornos menos debitos, porque a conta e nossa e nao ha movimento fora do nosso alcance. NAO guarda o CUSTO da operacao - isso e de plataforma e fica noutro lugar, de proposito.';

comment on column public.tenant_wallet_ledger.amount_cents is
  'Sempre POSITIVO. O sinal do lancamento vem de tipo - um negativo aqui viraria debito disfarcado de credito num extrato que a pessoa le para conferir a conta dela.';

comment on column public.tenant_wallet_ledger.occurred_at is
  'QUANDO o fato aconteceu, nao quando a linha foi digitada. Recarga confirmada no banco as 23h e lancada no dia seguinte conta no dia certo.';

-- A idempotência do débito. Índice PARCIAL porque `ref_id` nulo é legítimo
-- (ajuste manual sem referência), e um único global recusaria o segundo ajuste.
create unique index if not exists uq_tenant_wallet_ledger_ref
  on public.tenant_wallet_ledger (organization_id, ref_kind, ref_id)
  where ref_kind is not null and ref_id is not null;

create index if not exists idx_tenant_wallet_ledger_extrato
  on public.tenant_wallet_ledger (organization_id, occurred_at desc);

alter table public.tenant_wallet_ledger enable row level security;

-- O cliente LÊ a própria carteira (é o dinheiro dele, e extrato que não se lê
-- não é extrato) e não ESCREVE nela por caminho nenhum: crédito entra por
-- decisão comercial, débito entra pelo motor de envio. Os dois são service_role.
drop policy if exists tenant_wallet_ledger_select on public.tenant_wallet_ledger;
create policy tenant_wallet_ledger_select on public.tenant_wallet_ledger
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- `authenticated` sai do revoke junto com anon (migration 9001): o default ACL do
-- Supabase dá ALL a toda tabela nova, e o `grant select` abaixo sozinho deixava
-- insert/update/delete concedidos a quem a policy diz que só lê.
revoke all on public.tenant_wallet_ledger from anon, authenticated;
grant select on public.tenant_wallet_ledger to authenticated;
grant select, insert on public.tenant_wallet_ledger to service_role;
-- Sem `update` e sem `delete` NEM para service_role: extrato que se edita não é
-- extrato. Lançamento errado se corrige com outro lançamento, que é o que um
-- contador faria e o que deixa a correção visível para o cliente.

-- ---- o preço que ESTE cliente paga por mensagem -----------------------------
--
-- A trava de saldo precisa de um limiar, e o limiar é o preço. Uma tabela por
-- organização, e não um catálogo de planos: o produto ainda não tem plano, e
-- inventar o catálogo agora fixaria um desenho antes de existir o primeiro
-- contrato para descrevê-lo.
--
-- Linha ausente ou preço NULL = esta organização não tem preço acordado, e o
-- disparador RECUSA em vez de supor. Zero seria "de graça", que é uma decisão
-- comercial e precisa ser digitada como tal.
create table if not exists public.tenant_broadcast_pricing (
  organization_id          uuid primary key references public.organizations(id) on delete cascade,
  preco_por_mensagem_cents integer,
  -- Piso de aviso: abaixo disto a tela avisa que o crédito está acabando, em
  -- vez de o cliente descobrir na mensagem 3.200 de 4.000.
  alerta_saldo_cents       bigint,
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users(id) on delete set null,
  constraint tenant_broadcast_pricing_preco_check
    check (preco_por_mensagem_cents is null or preco_por_mensagem_cents >= 0),
  constraint tenant_broadcast_pricing_alerta_check
    check (alerta_saldo_cents is null or alerta_saldo_cents >= 0)
);

comment on table public.tenant_broadcast_pricing is
  'O preco por mensagem disparada acordado com ESTA organizacao, e o piso de saldo em que ela deve ser avisada. Linha ausente ou preco NULL = sem preco acordado, e o disparador RECUSA em vez de supor - zero e decisao comercial e precisa ser digitada como tal.';

alter table public.tenant_broadcast_pricing enable row level security;

-- O cliente lê o próprio preço (ele o contratou); só a plataforma escreve.
drop policy if exists tenant_broadcast_pricing_select on public.tenant_broadcast_pricing;
create policy tenant_broadcast_pricing_select on public.tenant_broadcast_pricing
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- `authenticated` sai do revoke junto com anon (migration 9001) — ver a carteira, acima.
revoke all on public.tenant_broadcast_pricing from anon, authenticated;
grant select on public.tenant_broadcast_pricing to authenticated;
grant select, insert, update on public.tenant_broadcast_pricing to service_role;


-- ---- liberação por módulo (migration 0245) ----
--
-- Espelho EXATO da migration. Idempotente, como todo o apêndice.

-- 0245 — cada cliente com o que comprou
--
-- O sistema passou a ter peça VENDÁVEL SEPARADA (o disparador é a primeira), e
-- até aqui "quem tem acesso a quê" só existia em duas réguas: papel dentro da
-- organização e admin de plataforma. Nenhuma das duas responde "esta empresa
-- contratou este módulo" — e sem a resposta, ligar um módulo para um cliente
-- significa ligá-lo para todos.
--
-- ── Ausência de linha = NÃO contratado, e só para módulo DECLARADO ──────────
--
-- A tentação é gravar uma linha por módulo por organização no dia da criação, e
-- ela envelhece mal: módulo novo nasce invisível para todo cliente antigo, e
-- alguém tem de lembrar de um backfill a cada lançamento.
--
-- Aqui o catálogo dos módulos vive no CÓDIGO (`lib/modulos/catalogo.ts`) e só o
-- que o cliente COMPROU vira linha. O que a tabela responde é uma pergunta só:
-- "existe liberação viva deste módulo para esta organização?". Tudo que o
-- catálogo não declara continua valendo para todo mundo, como hoje — esta
-- migration não tira NADA de ninguém.
--
-- ── Por que `revoked_at` e não `delete` ─────────────────────────────────────
--
-- Cancelamento é fato comercial: quem cancelou, quando, e por quê. Apagar a
-- linha responde "nunca teve", que é outra história — e é a história errada na
-- conversa em que alguém pergunta por que a tela sumiu.

create table if not exists public.organization_modules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  -- A chave do catálogo em `lib/modulos/catalogo.ts`. Texto livre de propósito:
  -- um CHECK com a lista obrigaria uma migration a cada módulo novo, e a lista
  -- de verdade (com rótulo, descrição e o que cada um destrava) já mora no
  -- código, onde ela é lida.
  modulo           text not null,
  granted_at       timestamptz not null default now(),
  granted_by       uuid references auth.users(id) on delete set null,
  -- Cancelamento. Linha com `revoked_at` preenchido NÃO libera nada, e continua
  -- contando a história: quem liberou, quando, quem cancelou, quando.
  revoked_at       timestamptz,
  revoked_by       uuid references auth.users(id) on delete set null,
  note             text,
  created_at       timestamptz not null default now()
);

comment on table public.organization_modules is
  'Modulos VENDAVEIS que cada organizacao contratou. Ausencia de linha (ou linha revogada) = nao contratado. O catalogo dos modulos vive no codigo (lib/modulos/catalogo.ts); o que o catalogo nao declara continua liberado para todos, como sempre foi.';

comment on column public.organization_modules.revoked_at is
  'Cancelamento. Preenchido = nao libera mais. A linha FICA, porque apagar responderia "nunca teve", que e outra historia - e a errada na conversa em que alguem pergunta por que a tela sumiu.';

-- Uma liberação VIVA por módulo por organização. Revogadas podem se repetir
-- (contratou, cancelou, contratou de novo é histórico legítimo), e por isso o
-- índice é parcial.
create unique index if not exists uq_organization_modules_vivo
  on public.organization_modules (organization_id, modulo)
  where revoked_at is null;

create index if not exists idx_organization_modules_org
  on public.organization_modules (organization_id, modulo, revoked_at);

alter table public.organization_modules enable row level security;

-- A organização LÊ o que ela contratou (a tela precisa saber o que mostrar);
-- quem libera e cancela é a plataforma, e só ela.
drop policy if exists organization_modules_select on public.organization_modules;
create policy organization_modules_select on public.organization_modules
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()))
  );

-- `authenticated` sai do revoke junto com anon (migration 9001) — ver a carteira, acima.
revoke all on public.organization_modules from anon, authenticated;
grant select on public.organization_modules to authenticated;
grant select, insert, update on public.organization_modules to service_role;
-- Sem `delete`: revogar é `update` em `revoked_at`, e o histórico fica.


-- ---- meta de reunião realizada (migration 0246) ----
--
-- Espelho EXATO da migration. Idempotente, como todo o apêndice.

-- 0246 — marcar não é comparecer: a métrica de reunião REALIZADA
--
-- A 0243 deu ao SDR a meta de `reunioes`, que conta o que ele MARCOU. É a
-- medida certa da atividade dele — marcar é o que ele controla. Só que ela
-- sozinha esconde os dois comportamentos opostos que importam:
--
--   • o SDR que marca bem e leva faltas do cliente (fora do controle dele);
--   • o SDR que marca com qualquer um para bater número, e a agenda do closer
--     vira sala vazia.
--
-- Com as duas métricas lado a lado, os dois aparecem. Sem a segunda, nenhum.
--
-- ⚠️ A falta NÃO é descontada de `reunioes`, e isso é decisão, não esquecimento:
-- descontar puniria o SDR pelo cliente que não apareceu. `reunioes` continua
-- sendo "quantas ficaram de pé"; `reunioes_realizadas` é "quantas aconteceram".
--
-- O dado já existia inteiro (`calendar_appointments.status` tem `completed` e
-- `no_show` desde sempre, com tela e ferramenta de agente para registrar). O que
-- faltava era alguém poder pôr um ALVO em cima dele.

do $$
begin
  -- `if not exists` nas duas pontas: a migration roda de novo em toda
  -- reimplantação (o bootstrap reaplica o baseline em modo update).
  if exists (select 1 from pg_constraint where conname = 'sales_targets_metrica_enum') then
    alter table public.sales_targets drop constraint sales_targets_metrica_enum;
  end if;

  alter table public.sales_targets
    add constraint sales_targets_metrica_enum check (metrica in (
      'reunioes',             -- atividade: reuniões que ficaram de pé no mês
      'reunioes_realizadas',  -- comparecimento: as que de fato aconteceram
      'receita_total',        -- tudo que foi ganho
      'receita_recorrente',   -- só mensalidade
      'receita_avulsa',       -- só projeto/setup
      'receita_originada'     -- a participação de quem ORIGINOU (a meta do SDR)
    ));
end $$;

-- A coerência do alvo acompanha: reunião realizada também se conta em unidades,
-- não em centavos. Sem isto, uma meta de comparecimento exigiria valor em
-- dinheiro e o CHECK recusaria uma linha perfeitamente válida.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'sales_targets_alvo_coerente') then
    alter table public.sales_targets drop constraint sales_targets_alvo_coerente;
  end if;

  alter table public.sales_targets
    add constraint sales_targets_alvo_coerente check (
      (metrica in ('reunioes', 'reunioes_realizadas')
        and alvo_quantidade is not null and alvo_cents is null)
      or (metrica not in ('reunioes', 'reunioes_realizadas')
        and alvo_cents is not null and alvo_quantidade is null)
    );
end $$;


-- ---- MIA Broadcast (migration 0247) ----
--
-- Espelho EXATO da migration. Idempotente, como todo o apêndice.

-- 0247 — MIA Broadcast: a campanha e cada mensagem dela
--
-- A 0244 deu a carteira (crédito, preço, trava de saldo). Isto é o que gasta
-- esse crédito: uma CAMPANHA (o que vai ser enviado, para quem, por qual
-- número) e uma linha POR DESTINATÁRIO, que é onde mora a verdade.
--
-- ── Por que uma linha por destinatário, e não um contador ───────────────────
--
-- Um campo `enviadas: 1832` responde "quantas" e não responde a pergunta que
-- aparece no dia seguinte: "o fulano recebeu?". Sem a linha, também não há onde
-- pendurar o id que a Meta devolveu — e sem esse id o webhook de entrega não
-- tem em que casar o "entregue"/"lido"/"falhou" que chega depois.
--
-- A linha é ainda o que torna a COBRANÇA auditável: cada débito na carteira
-- aponta para uma destas linhas (`ref_kind='broadcast_message'`), e o índice
-- único da 0244 usa esse id. Contador não tem id.
--
-- ── O estado é do ENVIO, não da campanha ────────────────────────────────────
--
--   pendente  → ainda não saiu
--   enviada   → a Meta ACEITOU (é quando se cobra: é o que ela fatura)
--   entregue  → chegou no aparelho (webhook)
--   lida      → foi aberta (webhook)
--   falhou    → a Meta recusou, ou o envio estourou
--   estornada → falhou DEPOIS de cobrada, e o crédito voltou
--
-- ⚠️ `enviada` é o marco da cobrança, e não `entregue`. A Meta cobra o que
-- aceita; esperar a entrega para debitar deixaria o cliente com saldo que ele
-- não tem mais, e o débito dependendo de um webhook que pode não vir.
--
-- ── Cobrar em cima de QUAL preço ────────────────────────────────────────────
--
-- O preço vai gravado na linha (`preco_cents`), e não lido da tabela de preço
-- na hora de somar. Preço acordado muda; um relatório que multiplica o volume
-- de junho pelo preço de hoje reescreve o passado, e a conversa sobre a fatura
-- de junho vira discussão sobre o que estava combinado naquele mês.

create table if not exists public.broadcasts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  nome             text not null,
  -- Por onde sai. É a sessão do canal oficial: o número, a WABA e a credencial.
  channel_session_id uuid references public.channel_sessions(id) on delete set null,
  -- O template APROVADO, pelo par que a Meta usa para identificá-lo.
  template_name    text not null,
  template_language text not null,
  /**
   * Os valores das variáveis, por POSIÇÃO, quando são iguais para todo mundo.
   * O que muda por pessoa (o nome, por exemplo) sai do contato na hora do
   * envio — ver `broadcast_recipients.valores`.
   */
  valores_padrao   jsonb not null default '{}'::jsonb,
  status           text not null default 'rascunho',
  -- O preço acordado no momento em que a campanha foi DISPARADA. Ver o cabeçalho.
  preco_cents      integer,
  agendado_para    timestamptz,
  iniciado_em      timestamptz,
  concluido_em     timestamptz,
  /** Por que parou, quando parou sozinha (saldo, qualidade do número). */
  motivo_da_parada text,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint broadcasts_status_check check (status in (
    'rascunho',   -- sendo montada, ainda não cobra nada
    'agendada',   -- vai começar na hora marcada
    'enviando',
    'pausada',    -- parou e PODE continuar (saldo acabou, qualidade caiu)
    'concluida',
    'cancelada'
  )),
  constraint broadcasts_preco_check check (preco_cents is null or preco_cents >= 0)
);

comment on table public.broadcasts is
  'Campanha do MIA Broadcast: o que sera enviado, por qual numero, com qual template. O preco vai GRAVADO na campanha (preco_cents) porque preco acordado muda, e relatorio que multiplica volume antigo por preco de hoje reescreve o passado.';

comment on column public.broadcasts.status is
  'rascunho | agendada | enviando | pausada | concluida | cancelada. PAUSADA e diferente de cancelada: ela para e pode continuar (saldo acabou, qualidade do numero caiu), e motivo_da_parada diz qual dos dois.';

create index if not exists idx_broadcasts_org
  on public.broadcasts (organization_id, created_at desc);

-- Fila de quem está para enviar: é por este índice que o motor pega o próximo
-- lote sem varrer campanha concluída.
create index if not exists idx_broadcasts_na_fila
  on public.broadcasts (status, agendado_para)
  where status in ('agendada', 'enviando');

alter table public.broadcasts enable row level security;

drop policy if exists broadcasts_select on public.broadcasts;
create policy broadcasts_select on public.broadcasts
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );

-- Criar e disparar campanha é decisão de gestão: cada mensagem custa dinheiro
-- do cliente, e quem atende não decide gastar.
drop policy if exists broadcasts_write on public.broadcasts;
create policy broadcasts_write on public.broadcasts
  for all to authenticated
  using (
    (organization_id in (select public.fn_user_org_ids()))
    and public.fn_role_at_least(organization_id, 'manager')
  )
  with check (
    (organization_id in (select public.fn_user_org_ids()))
    and public.fn_role_at_least(organization_id, 'manager')
  );

revoke all on public.broadcasts from anon;
grant select, insert, update, delete on public.broadcasts to authenticated;
grant select, insert, update on public.broadcasts to service_role;

-- ---- uma linha por destinatário -------------------------------------------

create table if not exists public.broadcast_recipients (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  broadcast_id     uuid not null references public.broadcasts(id) on delete cascade,
  contact_id       uuid references public.contacts(id) on delete set null,
  -- O telefone vai COPIADO, e não só referenciado: o contato pode ser anonimizado
  -- (LGPD) ou apagado, e o relatório de um disparo que já aconteceu não pode
  -- virar uma lista de linhas sem destinatário.
  phone_e164       text not null,
  /** O que muda por pessoa, por posição: {"1": "Gabriel"}. */
  valores          jsonb not null default '{}'::jsonb,
  status           text not null default 'pendente',
  /** O id da Meta. É por ele que o webhook casa entrega, leitura e falha. */
  external_id      text,
  erro             text,
  /** Quanto ESTA mensagem custou ao cliente. Nulo enquanto não foi cobrada. */
  preco_cents      integer,
  enviado_em       timestamptz,
  atualizado_em    timestamptz,
  created_at       timestamptz not null default now(),
  constraint broadcast_recipients_status_check check (status in (
    'pendente', 'enviada', 'entregue', 'lida', 'falhou', 'estornada'
  ))
);

comment on table public.broadcast_recipients is
  'Uma linha por destinatario. Um contador nao responde "o fulano recebeu?", nao tem onde pendurar o id da Meta (sem o qual o webhook de entrega nao casa com nada) e nao da id para o debito da carteira apontar.';

comment on column public.broadcast_recipients.phone_e164 is
  'COPIADO do contato de proposito: o contato pode ser anonimizado pela LGPD ou apagado, e o relatorio de um disparo que ja aconteceu nao pode virar lista de linhas sem destinatario.';

comment on column public.broadcast_recipients.preco_cents is
  'O que ESTA mensagem custou. Nulo = ainda nao cobrada. O debito na carteira aponta para esta linha por ref_id, e o indice unico da 0244 e o que impede cobrar duas vezes na retentativa.';

-- O MESMO contato não entra duas vezes na MESMA campanha. Sem isto, montar a
-- lista duas vezes (ou um clique duplo) cobraria o cliente duas vezes e mandaria
-- a mesma mensagem para a mesma pessoa — que é o que faz bloquear.
create unique index if not exists uq_broadcast_recipients_sem_repetido
  on public.broadcast_recipients (broadcast_id, phone_e164);

create index if not exists idx_broadcast_recipients_fila
  on public.broadcast_recipients (broadcast_id, status);

-- O webhook chega com o id da Meta e precisa achar a linha por ele.
create index if not exists idx_broadcast_recipients_external
  on public.broadcast_recipients (organization_id, external_id)
  where external_id is not null;

alter table public.broadcast_recipients enable row level security;

drop policy if exists broadcast_recipients_select on public.broadcast_recipients;
create policy broadcast_recipients_select on public.broadcast_recipients
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );

-- `authenticated` sai do revoke junto com anon (migration 9001) — ver a carteira, acima.
revoke all on public.broadcast_recipients from anon, authenticated;
grant select on public.broadcast_recipients to authenticated;
-- A escrita é do MOTOR (service_role): quem monta a lista é a rota, quem marca
-- enviada/falhou é o worker. Nenhum dos dois é o navegador do cliente.
grant select, insert, update on public.broadcast_recipients to service_role;


-- ---- custo da Meta por mensagem (migration 0248) ----
--
-- Espelho EXATO da migration. Idempotente, como todo o apêndice.

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


-- ---- tags dos contatos (migration 0249) ----
--
-- 0249 — as tags que os contatos REALMENTE têm, com quantos em cada.
--
-- O filtro do disparador era texto livre, e nome errado devolvia lista vazia
-- sem dizer por quê. A contagem é o que responde antes de custar: `vip (0)`
-- diz na hora que aquela tag não rende campanha.
--
-- SECURITY INVOKER: a RLS de `contacts` decide o alcance, e `p_org` é filtro,
-- não defesa. Anonimizado e fundido ficam de fora — o primeiro por dever legal,
-- o segundo porque já virou outra linha.

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

revoke all on function public.fn_contact_tags(uuid) from public;
grant execute on function public.fn_contact_tags(uuid) to authenticated, service_role;


-- ---- channel_knobs.updated_at para de mentir (migration 0250) ----
-- A coluna tinha `default now()` e nada a atualizava: a ficha de anti-ban
-- alterada às 04:36 continuava dizendo 03:18, e uma investigação de produção
-- concluiu por isso que a janela já estava aberta quando o turno foi adiado.
-- GATILHO e não conserto do upsert: o gatilho pega `psql` direto e qualquer rota
-- futura. `fn_set_updated_at()` já existe no corpo deste arquivo — nada é criado
-- aqui, e por isso este bloco não tem nada a ver com a varredura de anon.
drop trigger if exists trg_channel_knobs_updated_at on public.channel_knobs;
create trigger trg_channel_knobs_updated_at
  before update on public.channel_knobs
  for each row execute function public.fn_set_updated_at();

comment on column public.channel_knobs.updated_at is
  'Carimbado pelo gatilho trg_channel_knobs_updated_at (migration 0250), nunca pelo chamador.';


-- ---- motivo do adiamento do job em coluna própria (migration 0251) ----
-- O motivo vivia numa frase de `last_error`, escrita para gente ler. Filtrar
-- jobs por texto de mensagem quebra calado no dia em que alguém melhorar a
-- frase — e é dessa filtragem que depende reprogramar turno adiado quando o
-- operador alarga a janela anti-ban. Vocabulário FECHADO porque cada valor é uma
-- condição diferente: só `janela_anti_ban` fica obsoleto quando o knob do canal
-- muda. Toda linha existente fica NULL, então não há backfill a fazer.
alter table public.job_queue
  add column if not exists deferred_reason text;

alter table public.job_queue
  drop constraint if exists job_queue_deferred_reason_check;
alter table public.job_queue
  add constraint job_queue_deferred_reason_check
  check (
    deferred_reason is null
    or deferred_reason in ('janela_anti_ban', 'horario_do_agente', 'canal_fora')
  );

create index if not exists idx_job_queue_adiado_por_motivo
  on public.job_queue (organization_id, deferred_reason, run_after)
  where status = 'pending' and deferred_reason is not null;

comment on column public.job_queue.deferred_reason is
  'POR QUE este job esta com run_after no futuro, em vocabulario fechado. O texto legivel continua em last_error; esta coluna existe para ser FILTRADA. Par em lib/agent-engine/queue/queue.ts (MOTIVOS_DE_ADIAMENTO), cobrado por tests/invariants/vocabulario-banco-x-typescript.test.ts.';


-- ---- memória da org aceita origem 'agent' (migration 0252) ----
--
-- (ABSORVIDA pela 0385 do upstream, que faz exatamente o mesmo `CHECK`.
-- Removida daqui em 25/09/2026: repeti-la seria redefinir a constraint dele,
-- e a próxima origem que ele acrescentasse seria desfeita pela nossa cópia.)

-- ---- meta do mês volta a gravar (migration 0253) ----
--
-- Para o banco que JÁ EXISTE. O bloco da 0243, acima, já nasce certo — este aqui
-- é o que conserta quem foi instalado antes. Índice novo primeiro, o antigo
-- depois: em ordem inversa a tabela ficaria um instante sem trava de duplicidade.
create unique index if not exists idx_sales_targets_unica_nn
  on public.sales_targets (organization_id, periodo, metrica, user_id, agent_id)
  nulls not distinct;

drop index if exists public.idx_sales_targets_unica;


-- ---- número de avisos da plataforma (migration 0254) ----
--
-- O número que avisa o TIME no grupo de WhatsApp quando um lead é qualificado.
-- É da PLATAFORMA, não do cliente: um só, conectado uma vez por quem opera e
-- adicionado aos grupos de todos. Exigir um por cliente transformaria cada
-- implantação numa conexão a mais, e é encanamento nosso.
--
-- ⚠️ Ponto único de falha assumido: se ele cair, NENHUM cliente recebe aviso.
-- A contrapartida é avisar quem opera quando isso acontecer.
--
-- Coluna e não tabela: é uma sessão de canal como outra qualquer (conecta por
-- QR, tem status, tem saúde) — o que muda é o PAPEL. Tabela própria duplicaria
-- conexão e monitoramento, e o primeiro defeito seria o número caindo sem
-- ninguém ver porque o vigia olha a outra tabela.
--
-- Índice único PARCIAL: só UMA na instalação inteira. Sem a trava, marcar a
-- segunda deixaria duas e "qual envia" viraria sorteio do `order by`.

alter table public.channel_sessions
  add column if not exists e_numero_de_avisos boolean not null default false;

create unique index if not exists uq_channel_sessions_numero_de_avisos
  on public.channel_sessions ((true))
  where e_numero_de_avisos;


-- ---- empresas: o cliente que é uma organização (migration 0255) ----
--
-- O CRM só conhecia PESSOA. Em venda B2B quem compra é a empresa: três contatos
-- do mesmo cliente viravam três fichas sem parentesco. Tabela própria e não
-- campo de texto porque texto digitado de novo a cada contato não responde
-- "quanto vendemos para eles".
--
-- O vínculo está em contacts E em crm_leads de propósito: o negócio pode ser
-- com uma empresa enquanto quem fala é o contato de outra, e a pessoa pode
-- trocar de emprego sem que a negociação antiga mude de dono.
--
-- `on delete set null` nos dois: apagar empresa não pode apagar contato nem
-- histórico de negócio.

create table if not exists public.crm_empresas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null,
  -- Documento SEM máscara e SEM validação de dígito: quem cadastra está com o
  -- cliente na linha, e recusar um CNPJ digitado com um dígito trocado pararia
  -- o cadastro inteiro por causa do campo menos urgente da ficha.
  cnpj text,
  site text,
  telefone text,
  email text,
  endereco text,
  -- O que não cabe em campo nenhum. Toda ficha de CRM tem esse canto, e sem ele
  -- a informação vai para o nome da empresa ("Padaria do Zé - só fala manhã").
  observacoes text,
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references auth.users(id) on delete set null,
  constraint crm_empresas_nome_nao_vazio check (length(btrim(nome)) > 0)
);

comment on table public.crm_empresas is
  'A empresa como cliente (venda B2B): agrupa contatos e negocios sob um CNPJ so. Apagar uma empresa NAO apaga contato nem negocio — o vinculo vira null.';

create index if not exists idx_crm_empresas_org_nome
  on public.crm_empresas (organization_id, lower(nome));

create unique index if not exists uq_crm_empresas_org_cnpj
  on public.crm_empresas (organization_id, cnpj)
  where cnpj is not null and btrim(cnpj) <> '';

alter table public.contacts
  add column if not exists empresa_id uuid references public.crm_empresas(id) on delete set null;

alter table public.crm_leads
  add column if not exists empresa_id uuid references public.crm_empresas(id) on delete set null;

create index if not exists idx_contacts_empresa
  on public.contacts (organization_id, empresa_id)
  where empresa_id is not null;

create index if not exists idx_crm_leads_empresa
  on public.crm_leads (organization_id, empresa_id)
  where empresa_id is not null;

alter table public.crm_empresas enable row level security;

drop policy if exists "crm_empresas_select" on public.crm_empresas;
drop policy if exists "crm_empresas_escrita" on public.crm_empresas;

create policy "crm_empresas_select" on public.crm_empresas
  for select using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()))
  );

create policy "crm_empresas_escrita" on public.crm_empresas
  for all using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  ) with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );


-- ---- modelo de IA da plataforma (migration 0256) ----
--
-- Mesma doutrina da chave de IA: o cérebro é engrenagem nossa, e a conta
-- também. Linha única como platform_branding, RLS ligada e ZERO policies (só
-- service_role). Nulo = ninguém decidiu, e aí vale a escolha automática de
-- escolherModeloDoProvedor — ausência faz cair para trás, nunca trava.

create table if not exists public.platform_ia (
  id          smallint primary key default 1,
  -- Nulos = "ninguém decidiu ainda", e nesse caso vale a escolha automática de
  -- antes. AUSÊNCIA faz cair para trás; nunca uma escolha errada.
  provider    text,
  model_id    text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  constraint platform_ia_singleton check (id = 1),
  -- Os dois juntos ou nenhum: um `model_id` sem provedor não endereça nada, e
  -- um provedor sem modelo faria a publicação voltar à escolha automática sem
  -- dizer por quê.
  constraint platform_ia_par_completo check ((provider is null) = (model_id is null))
);

comment on table public.platform_ia is
  'O modelo de IA padrao da INSTALACAO (linha unica id=1). Quem escolhe e quem opera a plataforma, no /admin — o cliente nao ve e nao troca, mesma doutrina da chave de IA. Nulo = ninguem decidiu, e ai vale a escolha automatica de escolherModeloDoProvedor. Lida/escrita so server-side (service_role).';

alter table public.platform_ia enable row level security;


revoke all on public.platform_ia from anon, authenticated;
grant select, insert, update on public.platform_ia to service_role;


-- ---- cadastro incorporado da Meta (migration 0257) ----
--
-- A conta que chega pelo login do cliente. O webhook NAO adivinha o dono: o
-- link e da instalacao, e dois clientes podem entrar na mesma tarde — amarrar
-- errado faria a conversa de um sair pelo numero do outro. Guarda o fato;
-- amarrar e ato humano no painel. A porta manual continua existindo ao lado.

create table if not exists public.meta_onboardings (
  id uuid primary key default gen_random_uuid(),
  waba_id text not null,
  business_name text,
  phone_number_id text,
  phone_number text,
  /**
   * O evento CRU, como veio.
   *
   * A Meta muda o formato destes avisos sem aviso, e o que hoje é ruído pode
   * ser o único lugar onde está o dado que faltou. Guardar o payload inteiro é
   * o que permite consertar depois sem pedir ao cliente que refaça o cadastro.
   */
  payload jsonb not null default '{}'::jsonb,
  organization_id uuid references public.organizations(id) on delete set null,
  channel_session_id uuid references public.channel_sessions(id) on delete set null,
  bound_at timestamptz,
  bound_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.meta_onboardings is
  'O que chegou pelo cadastro incorporado da Meta, antes de alguem amarrar a um cliente. O webhook NAO adivinha o dono: o link e da instalacao, e dois clientes podem entrar na mesma tarde. Amarrar e ato humano no /admin.';

create unique index if not exists uq_meta_onboardings_waba
  on public.meta_onboardings (waba_id);

create index if not exists idx_meta_onboardings_pendentes
  on public.meta_onboardings (created_at desc)
  where organization_id is null;

alter table public.meta_onboardings enable row level security;

revoke all on public.meta_onboardings from anon, authenticated;
grant select, insert, update on public.meta_onboardings to service_role;


create table if not exists public.platform_meta (
  id                    smallint primary key default 1,
  embedded_signup_url   text,
  updated_at            timestamptz not null default now(),
  updated_by            uuid,
  constraint platform_meta_singleton check (id = 1)
);

comment on table public.platform_meta is
  'Configuracao da INSTALACAO para o canal oficial da Meta — hoje so o link do cadastro incorporado. Linha unica id=1, no mesmo formato de platform_branding e platform_ia. Sem link, a tela do cliente mostra so a porta manual: ausencia esconde a porta, nunca mostra uma porta quebrada.';

alter table public.platform_meta enable row level security;

revoke all on public.platform_meta from anon, authenticated;
grant select, insert, update on public.platform_meta to service_role;


-- ---- report da plataforma no grupo interno (migration 0258) ----
--
-- O numero de avisos fala com o grupo de cada CLIENTE; este e o outro lado do
-- mesmo numero: o grupo NOSSO. A Central e por organizacao e serve a quem esta
-- com a tela aberta — um credito que acaba as 2h de sabado derruba TODOS os
-- clientes ate alguem abrir o navegador por acaso.
--
-- A segunda tabela e a trava anti-ruido: grupo que recebe demais e ignorado em
-- uma semana, e ai o aviso que importa chega junto com o lixo.

create table if not exists public.platform_avisos (
  id                    smallint primary key default 1,
  grupo_id              text,
  grupo_nome            text,
  limite_saldo_usd      numeric(12,2) not null default 20,
  resumo_diario         boolean not null default true,
  updated_at            timestamptz not null default now(),
  updated_by            uuid,
  constraint platform_avisos_singleton check (id = 1),
  constraint platform_avisos_grupo_par check ((grupo_id is null) = (grupo_nome is null))
);

comment on table public.platform_avisos is
  'O grupo INTERNO que recebe o que e da plataforma: credito de IA acabando, numero caido, fila travada, resumo diario. Linha unica id=1, no formato de platform_branding/platform_ia/platform_meta. Sem grupo escolhido, nada e enviado — ausencia cala, nunca manda para o lugar errado.';

create table if not exists public.platform_avisos_enviados (
  chave       text primary key,
  enviado_em  timestamptz not null default now(),
  detalhe     jsonb not null default '{}'::jsonb
);

comment on table public.platform_avisos_enviados is
  'Trava anti-ruido do report da plataforma: quando cada aviso saiu pela ultima vez. Grupo que recebe demais e ignorado em uma semana, e ai o aviso que importa chega junto com o lixo.';

alter table public.platform_avisos enable row level security;
alter table public.platform_avisos_enviados enable row level security;

revoke all on public.platform_avisos from anon, authenticated;
revoke all on public.platform_avisos_enviados from anon, authenticated;
grant select, insert, update on public.platform_avisos to service_role;
grant select, insert, update, delete on public.platform_avisos_enviados to service_role;


-- ---- custo da Meta por mensagem (migration 0259) ----
--
-- A Meta manda `pricing` em todo status e a gente descartava. Ela traz
-- `billable` e `category`, NUNCA valor — cobra por tabela, que muda por país.
-- Por isso a mensagem guarda o FATO e o preço mora numa tabela nossa: gravar
-- valor calculado congelaria o preço do dia no histórico.

alter table public.messages
  add column if not exists meta_pricing_category text,
  add column if not exists meta_billable boolean;

comment on column public.messages.meta_pricing_category is
  'A categoria que a META cobrou (marketing, utility, authentication, service), como veio no `pricing` do status de entrega. NAO e o que pedimos: e o que ela decidiu cobrar — os dois divergem, e e a decisao dela que vira fatura.';

comment on column public.messages.meta_billable is
  'Se a Meta cobrou por esta mensagem. Ha mensagem gratuita (janela de servico, ponto de entrada de anuncio) e conta-la como paga inflaria o custo do cliente.';

create index if not exists idx_messages_custo_meta
  on public.messages (organization_id, created_at, meta_pricing_category)
  where meta_billable is true;


create table if not exists public.platform_precos_meta (
  categoria text primary key,
  centavos_brl integer not null check (centavos_brl >= 0),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);

comment on table public.platform_precos_meta is
  'Quanto custa cada categoria de mensagem da Meta, em centavos de REAL. A Meta nao manda valor no webhook — so a categoria —, entao o dinheiro sai daqui. Vazia = o relatorio mostra a CONTAGEM e diz que o preco nao foi informado, nunca zero (que se leria como "de graca").';

alter table public.platform_precos_meta enable row level security;

revoke all on public.platform_precos_meta from anon, authenticated;
grant select, insert, update, delete on public.platform_precos_meta to service_role;


-- ---- channel_knobs.updated_at para de mentir (migration 0260) ----
--
-- Auditoria de 18/09: a linha tinha created_at == updated_at mesmo tendo sido
-- alterada horas depois. O campo nao ficava em branco — ficava MENTINDO com
-- cara de verdade, e transformou comportamento correto em suspeita de bug.
-- Gatilho e nao conserto do upsert: pega SQL direto e rota futura tambem.

create or replace trigger trg_channel_knobs_updated_at
  before update on public.channel_knobs
  for each row execute function public.fn_set_updated_at();


-- ---- id do template na Meta (migration 0261) ----
--
-- Editar template e POST /{template-id}, e o id nunca foi guardado: a
-- sincronizacao nao pedia `id` em FIELDS. Sem ele, editar exigiria uma busca a
-- mais na Meta a cada clique. NULO nas linhas anteriores — elas o ganham na
-- proxima sincronizacao, e quem edita trata ausencia como "sincronize antes".

alter table public.meta_templates
  add column if not exists meta_template_id text;

create index if not exists idx_meta_templates_meta_id
  on public.meta_templates (organization_id, meta_template_id)
  where meta_template_id is not null;


-- ---- cargo e setor na pessoa, campos adicionais na empresa (migration 0262) ----
--
-- Cargo fica no CONTATO e nao na empresa: tres contatos da mesma empresa tem
-- tres cargos, e um deles pode ser o contador, que nem trabalha la. E e a
-- informacao que decide COM QUEM falar numa lista de cinco pessoas.
--
-- Campos adicionais em jsonb, com as DEFINICOES em crm_pipelines.settings.fields
-- — o mesmo lugar do contato e do lead. Um segundo registro faria o operador
-- cadastrar o mesmo campo duas vezes e as duas divergirem.

alter table public.contacts
  add column if not exists cargo text,
  add column if not exists setor text;

comment on column public.contacts.cargo is
  'O cargo desta PESSOA na empresa dela (crm_empresas). Fica no contato e nao na empresa porque tres contatos da mesma empresa tem tres cargos — e um deles pode ser o contador, que nem trabalha la.';

alter table public.crm_empresas
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

comment on column public.crm_empresas.custom_fields is
  'Campos adicionais da empresa. As DEFINICOES moram em crm_pipelines.settings.fields, o mesmo lugar do contato e do lead — um segundo registro de definicoes faria o operador cadastrar o mesmo campo duas vezes e as duas divergirem.';

create index if not exists idx_contacts_empresa_cargo
  on public.contacts (organization_id, empresa_id, cargo)
  where empresa_id is not null and cargo is not null;


notify pgrst, 'reload schema';


-- ---- mesclar empresas duplicadas (migration 0263) ----
--
-- A empresa ganhou duas portas de criacao: a tela e o agente. A segunda cria
-- ficha do que o cliente DITOU, e duas grafias distantes nascem separadas.
-- Sem fusao, o conserto seria apagar — e apagar leva junto o vinculo dos
-- contatos e negocios. FUNCAO e nao updates na rota: fusao nao tem desfazer.
-- FKs vem de pg_constraint, nao de lista a mao. LAPIDE e nao DELETE: apagar
-- responderia "essa empresa nunca existiu" a quem for conferir.

alter table public.crm_empresas
  add column if not exists mesclada_em timestamptz,
  add column if not exists mesclada_com uuid references public.crm_empresas(id) on delete set null;

comment on column public.crm_empresas.mesclada_com is
  'A empresa que VENCEU a fusao. Preenchida = esta ficha e lapide: some das listas e do seletor, mas responde "para onde foi" a quem conferir um negocio antigo.';

create index if not exists idx_crm_empresas_vivas
  on public.crm_empresas (organization_id, lower(nome))
  where mesclada_em is null;

create or replace function public.fn_mesclar_empresas(
  p_organization_id uuid,
  p_vencedora uuid,
  p_perdedora uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vencedora public.crm_empresas%rowtype;
  v_perdedora public.crm_empresas%rowtype;
  v_alvo record;
  v_movidas integer;
  v_repontado jsonb := '{}'::jsonb;
begin
  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'manager') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;

  if p_vencedora is null or p_perdedora is null or p_vencedora = p_perdedora then
    raise exception using errcode = '22023', message = 'selecao_de_mesclagem_invalida';
  end if;

  select * into v_vencedora from public.crm_empresas
   where organization_id = p_organization_id and id = least(p_vencedora, p_perdedora)
   for update;
  select * into v_perdedora from public.crm_empresas
   where organization_id = p_organization_id and id = greatest(p_vencedora, p_perdedora)
   for update;

  if v_vencedora.id <> p_vencedora then
    select * into v_vencedora from public.crm_empresas
     where organization_id = p_organization_id and id = p_vencedora;
    select * into v_perdedora from public.crm_empresas
     where organization_id = p_organization_id and id = p_perdedora;
  end if;

  if v_vencedora.id is null or v_perdedora.id is null then
    raise exception using errcode = '22023', message = 'empresa_nao_encontrada';
  end if;
  if v_perdedora.mesclada_em is not null then
    raise exception using errcode = '22023', message = 'empresa_ja_mesclada';
  end if;

  for v_alvo in
    select n.nspname as esquema, c.relname as tabela, a.attname as coluna
      from pg_catalog.pg_constraint co
      join pg_catalog.pg_class c on c.oid = co.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = co.conrelid and a.attnum = co.conkey[1]
     where co.contype = 'f'
       and co.confrelid = 'public.crm_empresas'::regclass
       and co.conrelid <> 'public.crm_empresas'::regclass
       and array_length(co.conkey, 1) = 1
       and c.relkind = 'r'
       and n.nspname = 'public'
     order by 2, 3
  loop
    execute format(
      'update %I.%I set %I = $1 where %I = $2',
      v_alvo.esquema, v_alvo.tabela, v_alvo.coluna, v_alvo.coluna
    ) using p_vencedora, p_perdedora;
    get diagnostics v_movidas = row_count;
    v_repontado := v_repontado || jsonb_build_object(v_alvo.tabela, v_movidas);
  end loop;

  update public.crm_empresas set
    cnpj        = coalesce(cnpj, v_perdedora.cnpj),
    site        = coalesce(site, v_perdedora.site),
    telefone    = coalesce(telefone, v_perdedora.telefone),
    email       = coalesce(email, v_perdedora.email),
    endereco    = coalesce(endereco, v_perdedora.endereco),
    observacoes = coalesce(observacoes, v_perdedora.observacoes),
    tags          = (select array(select distinct unnest(tags || v_perdedora.tags))),
    custom_fields = v_perdedora.custom_fields || custom_fields,
    updated_at  = now()
   where organization_id = p_organization_id and id = p_vencedora;

  update public.crm_empresas
     set mesclada_em = now(), mesclada_com = p_vencedora, updated_at = now()
   where organization_id = p_organization_id and id = p_perdedora;

  return jsonb_build_object(
    'vencedora', p_vencedora,
    'perdedora', p_perdedora,
    'repontado', v_repontado
  );
end; $$;

revoke all on function public.fn_mesclar_empresas(uuid,uuid,uuid) from public, anon;
grant execute on function public.fn_mesclar_empresas(uuid,uuid,uuid) to authenticated, service_role;

-- ─── 0264 · a anonimizacao alcanca custom_fields, cargo e setor ──────────
--
-- `contacts.custom_fields` — o jsonb livre — falhava nas DUAS pontas da LGPD:
-- sobrevivia a anonimizacao, e na exportacao estava no `select` e era
-- descartado antes do relatorio. Acesso negado por omissao e esquecimento
-- negado por omissao, no mesmo campo. `cargo` e `setor` (0262) e `empresa_id`
-- (0255) entraram depois e tambem ficaram de fora.
-- `crm_empresas` e `crm_leads.empresa_id` NAO sao tocados: ali o vinculo e com
-- a pessoa juridica, que nao e titular deste pedido.

-- (Aqui ficava uma REDEFINIÇÃO de fn_lgpd_cascade_redact_contact, a cascata do
-- upstream. Removida em 25/09/2026 pela regra do fork: estender, nunca
-- redefinir. O que ela acrescentava — zerar cargo, setor e empresa_id — é
-- feito pelo gatilho `trg_contacts_anonimizado_limpa_mia`, no bloco 0265.
-- A cascata que vale é a do upstream, intacta, com as tabelas dele todas.)


-- ─── 0265 · o gatilho limpa o que a ROTA DIRETA esquece ──────────────────
--
-- Ha DOIS caminhos que anonimizam um contato: `fn_lgpd_cascade_redact_contact`
-- (a cascata) e `fn_lgpd_anonymize_contact` (a rota direta, o botao da ficha).
-- A rota direta limpa nome, e-mail, telefone, CPF e nascimento e PARA AI —
-- nunca limpou `consent`, `tags` nem `source_metadata`, de onde saem as colunas
-- geradas `wa_identity` e `wa_lid` (a identidade da pessoa no WhatsApp).
--
-- Por isso a lista mora no GATILHO e nao nas funcoes: pendurada no FATO
-- (`is_anonymized` virou true), ela cobre os dois caminhos, o terceiro que
-- alguem escrever, e o DBA que fizer a mao. Espalhar a lista por tres funcoes
-- foi como o produto chegou aqui.
--
-- Vigiado por `tests/unit/lgpd-as-duas-pontas.test.ts`.
-- ── A MIA pendura o SEU gatilho ao lado do dele, nunca por cima ─────────
--
-- Até 25/09/2026 este bloco REDEFINIA a função do gatilho do upstream
-- (`fn_contato_anonimizado_limpa_campos_personalizados`) para acrescentar
-- colunas. Funcionava — até o dia em que o upstream mexesse na função dele: a
-- mudança entraria na sincronização e seria desfeita pela nossa cópia, que roda
-- depois. É o mesmo defeito que quase apagou doze tabelas da cascata em 23/09.
--
-- Agora são DOIS gatilhos no mesmo fato. O dele zera `custom_fields`, como
-- sempre. O nosso zera o resto. Nenhum escreve coluna do outro, então a ordem
-- em que o Postgres os dispara não importa.
--
-- As colunas daqui são de dois tipos, e o motivo de cada um é diferente:
--   · cargo, setor, empresa_id — só existem na MIA (0262, 0255). Nenhum código
--     do upstream as conhece, então só um gatilho nosso pode alcançá-las.
--   · source_metadata, tags, consent — são do upstream, e a CASCATA dele as zera.
--     Mas a rota DIRETA (`fn_lgpd_anonymize_contact`) não: ela para no nome, no
--     e-mail e no telefone. Pendurar no fato `is_anonymized`, e não numa rota,
--     é o que cobre as duas. (Candidato a PR no upstream: é defeito dele, não
--     particularidade nossa.)
--   · social_identity — do upstream (redes sociais nativas, 0368 dele), e
--     NENHUM caminho a zera: nem a cascata, nem a rota direta, nem o gatilho
--     dele. É a chave da pessoa numa rede social; quem pede exclusão continuaria
--     identificável por ela. Achado pela catraca lgpd-as-duas-pontas em
--     25/09/2026, dois dias depois de a coluna nascer. (Também candidato a PR.)
create or replace function public.fn_mia_contato_anonimizado_limpa()
  returns trigger
  language plpgsql
as $$
begin
  new.cargo := null;
  new.setor := null;
  new.empresa_id := null;
  new.source_metadata := '{}'::jsonb;
  new.tags := '{}'::text[];
  new.consent := '{}'::jsonb;
  new.social_identity := null;
  return new;
end$$;

comment on function public.fn_mia_contato_anonimizado_limpa() is
  'Gatilho da MIA: zera cargo, setor, empresa_id, source_metadata, tags, consent e social_identity quando o contato é anonimizado. Ao lado de trg_contacts_anonimizado_limpa_custom_fields (do upstream), nunca por cima.';

revoke all on function public.fn_mia_contato_anonimizado_limpa() from public;
revoke execute on function public.fn_mia_contato_anonimizado_limpa() from anon;
revoke execute on function public.fn_mia_contato_anonimizado_limpa() from authenticated;

drop trigger if exists trg_contacts_anonimizado_limpa_mia on public.contacts;
create trigger trg_contacts_anonimizado_limpa_mia
  before update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized = true and coalesce(old.is_anonymized, false) = false)
  execute function public.fn_mia_contato_anonimizado_limpa();

-- ── E os contatos JÁ anonimizados antes desta migration ───────────────────
--
-- Sem isto, quem exerceu o direito ontem pelo botão da tela continua com o
-- `waha_lid`, as tags e o consentimento no banco para sempre — o gatilho só
-- dispara na TRANSIÇÃO, e para eles ela já passou. É o mesmo raciocínio da
-- varredura que completa cascatas interrompidas: um direito exercido não pode
-- depender de alguém lembrar de reexecutar.
--
-- `is_anonymized` não é tocado, então o gatilho não redispara.
update public.contacts
   set custom_fields   = '{}'::jsonb,
       cargo           = null,
       setor           = null,
       empresa_id      = null,
       source_metadata = '{}'::jsonb,
       tags            = '{}'::text[],
       consent         = '{}'::jsonb
 where is_anonymized = true
   and (
        custom_fields   <> '{}'::jsonb
     or cargo           is not null
     or setor           is not null
     or empresa_id      is not null
     or source_metadata <> '{}'::jsonb
     or tags            <> '{}'::text[]
     or consent         <> '{}'::jsonb
   );


-- ─── 0266 · as tres tabelas com contact_id que nada alcancava ────────
--
-- Achadas cruzando TODA tabela com `contact_id` contra TODO caminho que
-- anonimiza. Quinze tem a coluna; onze eram cobertas; `lgpd_requests` e excecao
-- declarada (e o REGISTRO do pedido, a prova de que o direito foi exercido).
--
--   ai_agent_runs         `tool_calls` guarda args, results e ate 4.000
--                         caracteres da prosa do modelo
--   demandas              `assunto` e `proximo_passo` sao texto livre sobre
--                         a pessoa — mesma classe que a 0184 ja declarou
--                         pessoal em `calendar_appointments.notes`
--   broadcast_recipients  o telefone COPIADO, que no WhatsApp e tambem o
--                         endereco; recebe o ROTULO como `voice_calls` na 0235
--
-- Vigiado por `tests/unit/lgpd-exporta-o-que-redige.test.ts`, que obriga a
-- outra ponta: o que se apaga a pedido do titular se entrega a pedido dele.
create or replace function public.fn_redigir_o_que_sobrou_do_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rotulo text := 'Contato anonimizado';
begin
  -- 1 · ai_agent_runs — o rastro da IA sobre esta pessoa.
  update public.ai_agent_runs
     set tool_calls    = '[]'::jsonb,
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
     and (tool_calls <> '[]'::jsonb or error_message is not null);

  -- 2 · demandas — o problema dela, escrito à mão.
  update public.demandas
     set assunto       = null,
         proximo_passo = null
   where organization_id = new.organization_id
     and contact_id = new.id
     and (assunto is not null or proximo_passo is not null);

  -- 3 · broadcast_recipients — rótulo, não `null`: a coluna é `not null` e a
  --     linha precisa continuar contável para o relatório do disparo.
  update public.broadcast_recipients
     set phone_e164 = v_rotulo,
         valores    = '{}'::jsonb
   where organization_id = new.organization_id
     and contact_id = new.id
     and (phone_e164 <> v_rotulo or valores <> '{}'::jsonb);

  -- 4 · google_ads_click_refs e meta_ads_click_refs — do upstream (0306 dele).
  --     O perigo é `query_raw`: a query string CRUA da landing page, e página
  --     de anúncio costuma carregar e-mail e nome na URL. A atribuição de
  --     campanha (gclid, utm) continua servindo ao relatório; o elo com a
  --     pessoa, não. `contact_id` já é `on delete set null`, então nulo é um
  --     estado que a tabela aceita e o resto do código já trata.
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

  return new;
end $$;

comment on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() is
  'Redige as tres tabelas com contact_id que nenhum outro caminho de anonimizacao alcancava: ai_agent_runs (tool_calls guarda args, results e a prosa do modelo), demandas (assunto e proximo_passo sao texto livre sobre a pessoa) e broadcast_recipients (o telefone copiado, que no WhatsApp e tambem o endereco).';

-- As DUAS origens de EXECUTE (item 9 do CLAUDE.md).
revoke all on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from public;
revoke execute on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from anon;
revoke execute on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from authenticated;

drop trigger if exists trg_redigir_o_que_sobrou_ao_anonimizar on public.contacts;
create trigger trg_redigir_o_que_sobrou_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized = true and coalesce(old.is_anonymized, false) = false)
  execute function public.fn_redigir_o_que_sobrou_do_contato_anonimizado();

-- ── E quem JÁ foi anonimizado ─────────────────────────────────────────────
--
-- Mesma razão da 0265: o gatilho dispara na TRANSIÇÃO, e para quem exerceu o
-- direito antes desta migration ela já passou. Sem isto, o rastro da IA e o
-- telefone deles ficam no banco para sempre — e são exatamente as pessoas que
-- já pediram para sair.

-- FORK MIA (9007): este arquivo é reaplicado a CADA deploy, e o `[]` daqui
-- apagaria, deploy após deploy, o nome das ferramentas que a 0494 do upstream
-- preserva ao redigir. A redação passa a ser a MESMA dele
-- (`fn_lgpd_redigir_tool_calls`), com a guarda de só tocar passo não redigido.
-- O arquivo da migration 0266 fica como a história do que ela fez.
update public.ai_agent_runs r
   set tool_calls    = case
                         when jsonb_typeof(r.tool_calls) = 'array'
                           then public.fn_lgpd_redigir_tool_calls(r.tool_calls)
                         else '[]'::jsonb
                       end,
       error_message = null
  from public.contacts c
 where c.is_anonymized = true
   and c.organization_id = r.organization_id
   and (
     r.contact_id = c.id
     or r.conversation_id in (
       select id from public.conversations
        where organization_id = c.organization_id and contact_id = c.id
     )
   )
   and (
     r.error_message is not null
     or case
          when jsonb_typeof(r.tool_calls) = 'array' then exists (
            select 1 from jsonb_array_elements(r.tool_calls) s
             where coalesce(s->>'redacted', 'false')::boolean is not true
          )
          else r.tool_calls is not null
        end
   );

update public.demandas d
   set assunto = null, proximo_passo = null
  from public.contacts c
 where c.is_anonymized = true
   and c.organization_id = d.organization_id
   and d.contact_id = c.id
   and (d.assunto is not null or d.proximo_passo is not null);

update public.broadcast_recipients b
   set phone_e164 = 'Contato anonimizado', valores = '{}'::jsonb
  from public.contacts c
 where c.is_anonymized = true
   and c.organization_id = b.organization_id
   and b.contact_id = c.id
   and (b.phone_e164 <> 'Contato anonimizado' or b.valores <> '{}'::jsonb);


-- ─── 0267 · quem responde legalmente pela INSTALACAO (E7) ─────────
--
-- `/legal/privacy` diz "o controlador e <X>, quem instalou e opera este
-- sistema", e `<X>` vinha da ORGANIZACAO ATIVA DA SESSAO. Num self-host esta
-- certo. Numa instalacao GERENCIADA, abrir a pagina com um cliente selecionado
-- fazia o documento declarar que aquele cliente opera o servidor e controla os
-- dados de todos os tenants — e TROCAR de nome conforme quem estava logado.
--
-- `operador_razao_social` e o INTERRUPTOR entre os dois modos: nula = self-host
-- (segue da sessao), preenchida = gerenciado (vale para todo leitor). Estado
-- impossivel nao existe, porque quem declara o operador E o operador.
--
-- Vigiado por `tests/unit/legal-operador-da-instalacao.test.ts`.
alter table public.platform_branding
  -- A razão social, não o nome fantasia: é o documento legal que a nomeia.
  add column if not exists operador_razao_social text,
  add column if not exists operador_cnpj text,
  -- Encarregado (DPO) da PLATAFORMA. Continua havendo o do tenant
  -- (`organizations.dpo_email`), e eles respondem por coisas diferentes: o do
  -- tenant atende os contatos DELE, o daqui atende quem usa a instalação.
  add column if not exists operador_dpo_email text,
  -- A política publicada pelo operador. Quando existe, `/legal/privacy`
  -- redireciona para ela em vez de renderizar o texto do produto.
  add column if not exists operador_politica_url text;

comment on column public.platform_branding.operador_razao_social is
  'Razao social de quem opera ESTA instalacao. NULA = self-host, e ai o operador sai da organizacao da sessao (desenho original). PREENCHIDA = modelo gerenciado, e ai ela vale para todo leitor: a organizacao da sessao deixa de ter voz no documento legal. E o interruptor entre os dois modos.';

comment on column public.platform_branding.operador_dpo_email is
  'Encarregado (DPO) da PLATAFORMA. Nao substitui organizations.dpo_email: aquele atende os contatos DO TENANT, este atende quem usa a instalacao.';

comment on column public.platform_branding.operador_politica_url is
  'Politica de privacidade publicada pelo operador da instalacao. Quando presente, /legal/privacy redireciona para ela. Validada na SAIDA por urlDePoliticaSegura (http/https apenas) — o schema do formulario aceita javascript: e a rota e publica.';


-- ─── 0268 · o carimbo do schema ────────────────────────────
--
-- `easypanel/bootstrap.sh` aplica este arquivo com `|| true` num banco que ja
-- existe — que e TODO deploy depois do primeiro. Se uma migration tropeca, ele
-- escreve `AVISO: ... (o app sobe mesmo assim)` e segue: o produto sobe
-- saudavel, com o codigo novo e o schema de ontem, e as duas coisas sao
-- verdade. O unico registro e o stdout de um conteiner efemero, e a agregacao
-- de logs da VPS esta desligada (E4).
--
-- O bloco abaixo carimba. `/api/v1/health` compara com a constante compilada na
-- imagem (`lib/schema/carimbo.ts`) e responde `schema.em_dia`. Assim "o banco
-- veio junto?" passa a ter resposta de fora, com um curl.
--
-- ⚠️ A LINHA DO `insert` TEM DE CASAR com `CARIMBO_DO_SCHEMA` e com a migration
-- mais nova de `supabase/migrations/`. Tres lugares, uma verdade, conferidos por
-- `tests/unit/carimbo-do-schema.test.ts` — que e o que impede este carimbo de
-- virar mais uma lista mantida a mao que envelhece em silencio.
create table if not exists public.schema_baseline (
  id smallint primary key default 1,
  -- O NOME do arquivo, sem extensão: `20260920030000_0268_carimbo_do_schema`.
  -- Nome e não só o timestamp porque quem lê a saúde de madrugada quer saber o
  -- QUE entrou, e "0268_carimbo_do_schema" responde; "20260920030000" não.
  migration_mais_nova text not null,
  aplicado_em timestamptz not null default now(),
  constraint schema_baseline_singleton check (id = 1),
  constraint schema_baseline_nao_vazia check (length(btrim(migration_mais_nova)) > 0)
);

comment on table public.schema_baseline is
  'Qual baseline este banco recebeu. Gravada pelo proprio baseline perto do fim; comparada em /api/v1/health com a constante compilada na imagem (lib/schema/carimbo.ts). Existe porque o bootstrap aplica o baseline com || true num banco existente: o schema pode falhar e o app sobe igual, saudavel, com o banco de ontem.';

comment on column public.schema_baseline.aplicado_em is
  'Quando o carimbo foi gravado. "Em dia" e "em dia desde quando" sao perguntas diferentes: esta responde se o deploy de agora carimbou, ou se o carimbo e de tres deploys atras e o baseline vem falhando calado.';

alter table public.schema_baseline enable row level security;

-- Sem policies de propósito: ninguém lê isto por sessão. A rota de saúde usa o
-- `service_role`, que é `bypassrls`.
revoke all on table public.schema_baseline from anon, authenticated;
grant select, insert, update on table public.schema_baseline to service_role;

-- O carimbo desta migration. O BASELINE tem o bloco equivalente perto do fim, e
-- é aquele que vale no dia a dia — este aqui serve ao banco que aplica as
-- migrations uma a uma.
insert into public.schema_baseline (id, migration_mais_nova, aplicado_em)
values (1, '20261005120000_9019_conversoes_da_meta_seguem_o_upstream', now())
on conflict (id) do update
  set migration_mais_nova = excluded.migration_mais_nova,
      aplicado_em = now();


-- ─── 0269 · o carimbo conta os erros, nao so a chegada ───────────
--
-- Num banco existente o `psql` roda SEM `ON_ERROR_STOP`: um comando que falha
-- vira uma linha de ERROR e a execucao CONTINUA ate o fim — inclusive ate o
-- bloco que carimba. O carimbo da 0268 provava "o baseline foi lido inteiro",
-- nunca "cada comando passou", e a saude respondia `em_dia: true` sobre um
-- banco em que a migration nova podia ter falhado.
--
-- `easypanel/bootstrap.sh` JA calculava os erros nao benignos e os imprimia
-- como AVISO, no stdout de um conteiner efemero. Agora ele os grava aqui, e
-- `em_dia` exige carimbo certo E zero erros.
alter table public.schema_baseline
  -- Quantos erros NÃO benignos o `psql` cuspiu ao aplicar o baseline.
  -- `0` = passou limpo. Default 0 e não null: uma linha carimbada por uma
  -- versão anterior desta migration não pode parecer "nunca conferida" e
  -- derrubar a saúde de uma instalação correta no primeiro deploy.
  add column if not exists erros_inesperados integer not null default 0,
  -- As primeiras linhas, para o diagnóstico começar em algum lugar.
  add column if not exists erros_amostra text;

comment on column public.schema_baseline.erros_inesperados is
  'Erros NAO benignos ao aplicar o baseline (o bootstrap ja filtra "already exists" e afins). 0 = passou limpo. Num banco existente o psql roda sem ON_ERROR_STOP: o baseline chega ao fim e carimba mesmo tendo falhado no meio, e sem esta coluna a saude responderia em_dia:true sobre um banco que nao tem o que o carimbo diz ter.';

comment on column public.schema_baseline.erros_amostra is
  'Primeiras linhas do erro, para diagnosticar sem acesso ao conteiner. NUNCA sai na resposta publica da saude: mensagem de erro de Postgres carrega nome de tabela, de coluna e as vezes o valor que violou a constraint.';


-- ─── 0270 · regua NOVA encerra ao responder (B1-a) ─────────────
--
-- Troca so o DEFAULT DA COLUNA: vale para a proxima regua criada e para mais
-- nada. Nenhuma linha existente e tocada, e isso e a decisao, nao um detalhe —
-- um `update` em massa mudaria o que as reguas dos clientes fazem numa conversa
-- em andamento, sem ninguem ter pedido, com o sintoma aparecendo dias depois.

-- ⚠️ Era `public.followup_flows`, que NUNCA existiu: a 0270 errou em todo deploy
-- desde a .46 e era o `erros: 1` da saúde. Corrigido em 25/09/2026.
alter table public.followup_flow_pointers
  alter column trigger_config
  set default '{"kind":"manual","cancel_on_reply":true}'::jsonb;
-- ─── 0271 · o token que administra a PLATAFORMA (E6) ────────────
--
-- Tabela PROPRIA e nao um escopo em `api_tokens`: aquela tem
-- `organization_id` NOT NULL, e e essa coluna que garante que todo token
-- pertence a UM cliente — afrouxa-la para caber um token de plataforma
-- tiraria a garantia de TODOS.
--
-- `operacoes` e lista BRANCA e comeca VAZIA: leitura e livre, escrita e
-- nomeada uma a uma. Nao existe coluna "pode tudo", e a ausencia dela e a
-- feature — ela seria o que todo mundo marca no primeiro token.
--
-- Vigiado por `tests/unit/mcp-de-plataforma-escopo.test.ts`.
create table if not exists public.platform_api_tokens (
  id uuid primary key default gen_random_uuid(),
  -- Como quem criou reconhece o token na lista. Sem ele, revogar vira loteria.
  name text not null,
  -- Os 8 primeiros caracteres, para a tela poder mostrar QUAL token sem
  -- guardar nada que sirva para autenticar.
  prefix text not null,
  -- SHA-256 do plaintext, como `api_tokens`. O plaintext existe uma vez, na
  -- resposta da criação, e nunca é gravado.
  token_hash bytea not null,

  -- ⚠️ A LISTA BRANCA. Vazia = só leitura, e é o default de propósito: o token
  -- criado sem pensar não escreve nada.
  operacoes text[] not null default '{}'::text[],

  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  -- Motivo por escrito, como em `platform_admins.reason`: quem concede acesso
  -- de plataforma explica por quê, e quem audita seis meses depois lê.
  reason text not null,

  last_used_at timestamptz,
  last_used_ip inet,
  expires_at timestamptz,

  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoke_reason text,

  constraint platform_api_tokens_nome_nao_vazio check (length(btrim(name)) > 0),
  constraint platform_api_tokens_motivo_nao_vazio check (length(btrim(reason)) > 0),
  -- Revogar é um ato com autor e motivo: os três andam juntos ou nenhum existe.
  constraint platform_api_tokens_revogacao_completa check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (revoked_at is not null and revoked_by is not null)
  )
);

comment on table public.platform_api_tokens is
  'Token de administracao da PLATAFORMA (MCP admin, item E6). Tabela propria e nao um escopo em api_tokens porque aquela tem organization_id NOT NULL — e e essa coluna que garante que todo token pertence a UM cliente. `operacoes` e lista branca e comeca VAZIA: leitura e livre, escrita e nomeada uma a uma. Nao existe coluna "pode tudo", e a ausencia dela e a feature.';

comment on column public.platform_api_tokens.operacoes is
  'Lista branca das escritas permitidas (ex.: criar_cliente, liberar_modulo, lancar_credito). VAZIA = so leitura. O catalogo de operacoes vive no codigo (lib/mcp-plataforma/), nao aqui: o que uma operacao faz muda junto com o codigo que a executa, e uma tabela de catalogo envelheceria em silencio.';

-- A busca do token é sempre por hash exato, e é o caminho quente de toda
-- chamada MCP.
create unique index if not exists uniq_platform_api_tokens_hash
  on public.platform_api_tokens (token_hash);

-- RLS ligada e ZERO policies: esta tabela é server-side only, lida e escrita
-- pelo `service_role` (que é `bypassrls`). Uma policy aqui seria uma porta a
-- mais para uma tabela cujo conteúdo autentica quem administra tudo.
alter table public.platform_api_tokens enable row level security;
revoke all on table public.platform_api_tokens from anon, authenticated;
grant select, insert, update on table public.platform_api_tokens to service_role;



-- ============================================================
-- APENDICE 0272 — 20260921200000_0272_a_chegada_guardou_o_id_errado
-- ============================================================

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

-- ─── 9001 · as tabelas da MIA entram nas travas do modo somente leitura do suporte ───
--
-- O upstream planta as restritivas `support_write_{insert,update,delete}` por
-- `public.fn_aplicar_travas_de_suporte()` (migration 0274 dele), chamada no ÚLTIMO
-- bloco do baseline.sql — depois de toda tabela DELE. As nossas nascem depois, aqui,
-- e numa instalação nova ficavam sem trava nenhuma: `broadcasts`, `crm_empresas` e
-- `sales_targets` aceitavam escrita de um operador em suporte SOMENTE LEITURA. Numa
-- atualização a segunda passada do baseline.sql as alcançava, e é por isso que o
-- buraco só apareceu quando o gate de banco passou a aplicar este arquivo (28/09):
-- tests/invariants/travas-de-suporte-cobrem-toda-tabela-na-instalacao.test.ts.
--
-- Chamar a função DELE, e não copiar o laço: a regra de seleção é dele e continua
-- dele (extensão, nunca redefinição — docs/FORK-MIA.md, regra 3). Vai aqui, antes
-- da varredura anon, porque daqui para baixo nada cria tabela.
--
-- A outra metade da 9001 mora nos blocos das tabelas: carteira, preço, módulos e
-- destinatários passam a revogar `authenticated` junto com anon. A função trata
-- tabela gravável por `authenticated` como da sessão e planta as três travas; nas
-- que só a plataforma escreve, o grant de escrita herdado do default ACL era mentira
-- sobre o contrato e faria a trava nascer onde não há escrita a travar.
do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;
-- ─── 9002 · a IA dos agentes é da plataforma também no banco, não só na tela ───
--
-- Provedor, modelo e chave de IA dos agentes são escolha de quem opera a
-- plataforma. Até aqui só a tela escondia isso: as políticas do upstream deixam
-- o admin da empresa escrever em ai_agent_versions, ai_agents, ai_routers,
-- ai_purpose_bindings e ai_provider_credentials, e com o próprio login, direto no
-- PostgREST, ele trocava a IA de uma versão, apontava o agente para ela sem
-- passar pela publicação, e podia até mudar o endereço da chave que a
-- plataforma cadastrou.
--
-- Gatilhos NOSSOS ao lado das políticas dele (regra 3 do docs/FORK-MIA.md). Só
-- agem quando quem escreve é usuário logado (papel `authenticated`), não é admin
-- da plataforma e é membro da organização da linha; o servidor (`service_role`)
-- e o motor passam sem ser tocados — a regra do lado deles mora em
-- lib/ai/trava-da-ia.ts. Racional inteiro, e a tabela do que fica travado, na
-- migration 9002. Provado em tests/invariants/ia-dos-agentes-e-da-plataforma.test.ts.
--
-- Vai antes da varredura anon, que fecha o arquivo: as funções daqui nascem com
-- EXECUTE revogado de public/anon/authenticated e ela não o devolve.

-- ── quem escreve é o cliente? ───────────────────────────────────────────────
create or replace function public.fn_mia_escrita_de_cliente(p_org uuid)
returns boolean
language sql
stable
set search_path = public
as $f$
  select (coalesce(current_setting('role', true), '') = 'authenticated'
          or coalesce(auth.jwt() ->> 'role', '') = 'authenticated')
     and not public.fn_is_platform_admin()
     and p_org in (select public.fn_user_org_ids());
$f$;

comment on function public.fn_mia_escrita_de_cliente(uuid) is
  'MIA (9002): verdadeiro quando quem escreve e usuario logado (papel authenticated), nao e admin da plataforma e e membro da organizacao. E a condicao em que as travas da IA dos agentes agem.';

revoke all on function public.fn_mia_escrita_de_cliente(uuid) from public;
revoke execute on function public.fn_mia_escrita_de_cliente(uuid) from anon, authenticated;

-- ── a IA que uma versão pode ter ────────────────────────────────────────────
create or replace function public.fn_mia_ia_permitida(
  p_org uuid,
  p_agent uuid,
  p_provider text,
  p_model text,
  p_credential uuid,
  p_operator_model text
)
returns boolean
language plpgsql
stable
set search_path = public
as $f$
declare
  v_provider text;
  v_model text;
  v_credential uuid;
  v_operator text;
  v_achou boolean := false;
  v_par_provider text;
  v_par_model text;
begin
  -- 1. a IA atual do agente: a da versão no ar ...
  select v.provider, v.model, v.credential_id, v.operator_model
    into v_provider, v_model, v_credential, v_operator
    from public.ai_agents a
    join public.ai_agent_versions v
      on v.id = a.published_version_id and v.organization_id = a.organization_id
   where a.id = p_agent and a.organization_id = p_org;
  v_achou := found;

  -- ... e, sem versão no ar, a da versão mais nova.
  if not v_achou then
    select v.provider, v.model, v.credential_id, v.operator_model
      into v_provider, v_model, v_credential, v_operator
      from public.ai_agent_versions v
     where v.agent_id = p_agent and v.organization_id = p_org
     order by v.version_number desc
     limit 1;
    v_achou := found;
  end if;

  if v_achou
     and v_provider is not distinct from p_provider
     and v_model is not distinct from p_model
     and v_credential is not distinct from p_credential
     and v_operator is not distinct from p_operator_model then
    return true;
  end if;

  -- 2. o par padrão da plataforma, sem Operador próprio e com chave nula ou da
  --    própria organização (toda chave de organização é cadastrada pela
  --    plataforma: a escrita em ai_provider_credentials também fica travada).
  select pi.provider, pi.model_id into v_par_provider, v_par_model
    from public.platform_ia pi
   where pi.id = 1;

  return v_par_provider is not null
     and v_par_provider = p_provider
     and v_par_model = p_model
     and p_operator_model is null
     and (p_credential is null
          or exists (select 1 from public.ai_provider_credentials c
                      where c.id = p_credential and c.organization_id = p_org));
end
$f$;

comment on function public.fn_mia_ia_permitida(uuid, uuid, text, text, uuid, text) is
  'MIA (9002): a IA que uma sessao de cliente pode gravar numa versao de agente — a atual do agente (versao no ar; sem ela, a mais nova) ou o par padrao da plataforma (platform_ia).';

revoke all on function public.fn_mia_ia_permitida(uuid, uuid, text, text, uuid, text) from public;
revoke execute on function public.fn_mia_ia_permitida(uuid, uuid, text, text, uuid, text) from anon, authenticated;

-- ── ai_agent_versions ───────────────────────────────────────────────────────
create or replace function public.fn_mia_trava_ia_versao()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  if not public.fn_mia_escrita_de_cliente(new.organization_id) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.provider is distinct from old.provider
       or new.model is distinct from old.model
       or new.credential_id is distinct from old.credential_id
       or new.operator_model is distinct from old.operator_model
       or new.agent_id is distinct from old.agent_id
       or new.organization_id is distinct from old.organization_id then
      raise exception 'ia_da_plataforma: provedor, modelo e chave de IA do agente são escolhidos pela plataforma'
        using errcode = '42501',
              hint = 'Esta sessão pode editar o resto da versão; a IA dela não muda por aqui.';
    end if;
    return new;
  end if;

  if not public.fn_mia_ia_permitida(new.organization_id, new.agent_id, new.provider,
                                    new.model, new.credential_id, new.operator_model) then
    raise exception 'ia_da_plataforma: a versão nova tem de usar a IA atual do agente ou a padrão da plataforma'
      using errcode = '42501',
            hint = 'Provedor, modelo e chave de IA são escolhidos pela plataforma.';
  end if;
  return new;
end
$f$;

revoke all on function public.fn_mia_trava_ia_versao() from public;
revoke execute on function public.fn_mia_trava_ia_versao() from anon, authenticated;

drop trigger if exists trg_mia_trava_ia_versao on public.ai_agent_versions;
create trigger trg_mia_trava_ia_versao
  before insert or update on public.ai_agent_versions
  for each row
  execute function public.fn_mia_trava_ia_versao();

-- ── ai_agents ───────────────────────────────────────────────────────────────
create or replace function public.fn_mia_trava_ia_agente()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_agent uuid;
  v_provider text;
  v_model text;
  v_credential uuid;
  v_operator text;
begin
  if not public.fn_mia_escrita_de_cliente(new.organization_id) then
    return new;
  end if;

  if new.model is distinct from old.model
     or (new.config -> 'voice_model') is distinct from (old.config -> 'voice_model') then
    raise exception 'ia_da_plataforma: o modelo do agente é escolhido pela plataforma'
      using errcode = '42501';
  end if;

  -- Tirar do ar (ponteiro nulo) não troca IA nenhuma. Apontar para uma versão é
  -- publicar, e publicar é onde a IA muda de verdade.
  if new.published_version_id is distinct from old.published_version_id
     and new.published_version_id is not null then
    select v.agent_id, v.provider, v.model, v.credential_id, v.operator_model
      into v_agent, v_provider, v_model, v_credential, v_operator
      from public.ai_agent_versions v
     where v.id = new.published_version_id and v.organization_id = new.organization_id;
    if not found or v_agent is distinct from new.id then
      raise exception 'ia_da_plataforma: a versão no ar tem de ser deste agente'
        using errcode = '42501';
    end if;
    -- Lido ANTES do update: dentro do gatilho BEFORE a linha de ai_agents ainda
    -- tem o ponteiro antigo, então "a IA atual" é a da versão que está no ar.
    if not public.fn_mia_ia_permitida(new.organization_id, new.id, v_provider, v_model,
                                      v_credential, v_operator) then
      raise exception 'ia_da_plataforma: a versão escolhida usa uma IA que não é a atual do agente nem a padrão da plataforma'
        using errcode = '42501',
              hint = 'Quem troca a IA de um agente é a plataforma.';
    end if;
  end if;
  return new;
end
$f$;

revoke all on function public.fn_mia_trava_ia_agente() from public;
revoke execute on function public.fn_mia_trava_ia_agente() from anon, authenticated;

drop trigger if exists trg_mia_trava_ia_agente on public.ai_agents;
create trigger trg_mia_trava_ia_agente
  before update on public.ai_agents
  for each row
  execute function public.fn_mia_trava_ia_agente();

-- ── ai_routers ──────────────────────────────────────────────────────────────
create or replace function public.fn_mia_trava_ia_roteador()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  if not public.fn_mia_escrita_de_cliente(new.organization_id) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Roteador de cliente nasce no "Automático": o classificador usa o que a
    -- plataforma escolheu (painel de provedores, senão o padrão da organização).
    -- Aqui o banco APAGA o que vier em vez de recusar, e não é descuido: o
    -- default da coluna `config` do upstream já traz um `classifier_model`
    -- fixo, então um insert que nem cita o classificador chegaria com modelo, e
    -- recusar derrubaria o roteador por um valor que ninguém escolheu.
    new.config := coalesce(new.config, '{}'::jsonb)
                  || jsonb_build_object('classifier_model', null, 'classifier_provider', null);
    return new;
  end if;

  if (new.config -> 'classifier_model') is distinct from (old.config -> 'classifier_model')
     or (new.config -> 'classifier_provider') is distinct from (old.config -> 'classifier_provider') then
    raise exception 'ia_da_plataforma: o modelo do classificador do roteador é escolhido pela plataforma'
      using errcode = '42501';
  end if;
  return new;
end
$f$;

revoke all on function public.fn_mia_trava_ia_roteador() from public;
revoke execute on function public.fn_mia_trava_ia_roteador() from anon, authenticated;

drop trigger if exists trg_mia_trava_ia_roteador on public.ai_routers;
create trigger trg_mia_trava_ia_roteador
  before insert or update on public.ai_routers
  for each row
  execute function public.fn_mia_trava_ia_roteador();

-- ── ai_purpose_bindings e ai_provider_credentials: só a plataforma escreve ───
create or replace function public.fn_mia_trava_ia_so_plataforma()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_org uuid;
begin
  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  if public.fn_mia_escrita_de_cliente(v_org) then
    raise exception 'ia_da_plataforma: % é configurado pela plataforma', tg_table_name
      using errcode = '42501',
            hint = 'Chave e modelo de IA desta instalação são escolhidos por quem opera a plataforma.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$f$;

revoke all on function public.fn_mia_trava_ia_so_plataforma() from public;
revoke execute on function public.fn_mia_trava_ia_so_plataforma() from anon, authenticated;

drop trigger if exists trg_mia_trava_ia_binding on public.ai_purpose_bindings;
create trigger trg_mia_trava_ia_binding
  before insert or update or delete on public.ai_purpose_bindings
  for each row
  execute function public.fn_mia_trava_ia_so_plataforma();

drop trigger if exists trg_mia_trava_ia_credencial on public.ai_provider_credentials;
create trigger trg_mia_trava_ia_credencial
  before insert or update or delete on public.ai_provider_credentials
  for each row
  execute function public.fn_mia_trava_ia_so_plataforma();

-- ── organizations.settings.llm ──────────────────────────────────────────────
create or replace function public.fn_mia_trava_ia_organizacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  if not public.fn_mia_escrita_de_cliente(new.id) then
    return new;
  end if;
  if (new.settings -> 'llm') is distinct from (old.settings -> 'llm') then
    raise exception 'ia_da_plataforma: o padrão de IA da empresa é escolhido pela plataforma'
      using errcode = '42501';
  end if;
  return new;
end
$f$;

revoke all on function public.fn_mia_trava_ia_organizacao() from public;
revoke execute on function public.fn_mia_trava_ia_organizacao() from anon, authenticated;

drop trigger if exists trg_mia_trava_ia_organizacao on public.organizations;
create trigger trg_mia_trava_ia_organizacao
  before update on public.organizations
  for each row
  when (new.settings is distinct from old.settings)
  execute function public.fn_mia_trava_ia_organizacao();

-- ─── 9003 · os leads dos formulários da Meta: a chave, o que importar, o histórico e a deduplicação ───
--
-- Espelho EXATO da migration 9003 (supabase/migrations-mia/). Idempotente, como todo o
-- apêndice. Vai antes da varredura anon, que fecha o arquivo.
--
-- ── O que entra ─────────────────────────────────────────────────────────────
--
-- Os anúncios de cadastro instantâneo da Meta passam a entregar o lead no funil
-- (docs/fork/leads-da-meta.md). A rotina `app/api/v1/cron/leads-da-meta` lê, a
-- cada 5 minutos, os leads novos de cada formulário escolhido e os grava pela
-- mesma via da fonte de webhook (contato, negócio, `webhook_lead_captures`,
-- automações). Estas quatro tabelas são o estado dela:
--
--   · mia_leads_da_meta_config       a chave POR EMPRESA e quantos dias recuperar
--   · mia_leads_da_meta_formularios  o que importar, para qual funil/etapa, e até
--                                    onde já foi lido (a marca de leitura)
--   · mia_leads_da_meta_leituras     o histórico de cada leitura: sucesso, sem
--                                    novos, ou erro com o motivo (sistema vivo)
--   · mia_leads_da_meta_recebidos    a deduplicação pelo id do lead da Meta
--
-- ── Nenhuma guarda dado pessoal, e é de propósito ──────────────────────────
--
-- Nome, telefone, e-mail e respostas ficam onde a LGPD já alcança: `contacts`,
-- `crm_leads` e `webhook_lead_captures`. Aqui mora só o estado da rotina. Nem o id
-- do lead da Meta fica cru: `recebidos.chave_do_lead` é um hash dele. Com o id cru
-- e o token da empresa, alguém buscaria na Meta, por até 90 dias, o nome e o
-- telefone de quem pediu para ser anonimizado; com o hash, a deduplicação funciona
-- e a porta não existe. Por isso também nenhuma tem `contact_id`.
--
-- ── Quem lê e quem escreve ─────────────────────────────────────────────────
--
-- RLS por empresa. Gerente (ou acima) da organização LÊ; ninguém da sessão
-- escreve: toda escrita é das rotas (que conferem papel e módulo) e da rotina, pelo
-- `service_role`. Sem grant de escrita a `authenticated`, as travas do modo
-- somente leitura do suporte (9001) não têm o que travar aqui.
--
-- Nomes com prefixo `mia_`: estender, nunca redefinir (docs/FORK-MIA.md, regra 3).

-- ── a chave por empresa ────────────────────────────────────────────────────
create table if not exists public.mia_leads_da_meta_config (
  organization_id     uuid primary key references public.organizations(id) on delete cascade,
  ativo               boolean not null default false,
  -- Na PRIMEIRA leitura de um formulário, quantos dias para trás buscar. A Meta
  -- guarda 90; zero = só o que chegar daqui para a frente.
  dias_de_recuperacao smallint not null default 7,
  ativado_em          timestamptz,
  atualizado_em       timestamptz not null default now(),
  atualizado_por      uuid references auth.users(id) on delete set null,
  constraint mia_leads_da_meta_config_dias check (dias_de_recuperacao between 0 and 90)
);

comment on table public.mia_leads_da_meta_config is
  'MIA (9003): a chave POR EMPRESA da importacao dos leads dos formularios da Meta. Sem linha, ou ativo=false: a rotina nao le nada desta empresa.';

-- ── o que importar ─────────────────────────────────────────────────────────
create table if not exists public.mia_leads_da_meta_formularios (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  page_id           text not null,
  page_name         text,
  form_id           text not null,
  form_name         text,
  -- chave da pergunta na Meta -> o texto da pergunta, para a captação guardar o
  -- formulário com os rótulos originais. É o formulário, não a resposta.
  perguntas         jsonb not null default '{}'::jsonb,
  pipeline_id       uuid references public.crm_pipelines(id) on delete set null,
  stage_id          uuid references public.crm_stages(id) on delete set null,
  ativo             boolean not null default true,
  -- A marca de leitura: tudo criado na Meta antes dela já foi gravado. Só avança
  -- quando a leitura inteira deu certo.
  lido_ate          timestamptz,
  ultima_leitura_em timestamptz,
  ultimo_status     text,
  ultimo_motivo     text,
  ultimo_detalhe    text,
  importados_total  integer not null default 0,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  atualizado_por    uuid references auth.users(id) on delete set null,
  constraint mia_leads_da_meta_formularios_status
    check (ultimo_status is null or ultimo_status in ('sucesso', 'sem_novos', 'erro'))
);

create unique index if not exists uq_mia_leads_da_meta_formularios_org_form
  on public.mia_leads_da_meta_formularios (organization_id, form_id);

comment on table public.mia_leads_da_meta_formularios is
  'MIA (9003): os formularios da Meta que cada empresa importa, para qual funil/etapa, e ate onde ja foram lidos (lido_ate).';

-- ── o histórico de cada leitura ────────────────────────────────────────────
create table if not exists public.mia_leads_da_meta_leituras (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  formulario_id   uuid not null references public.mia_leads_da_meta_formularios(id) on delete cascade,
  iniciada_em     timestamptz not null default now(),
  terminada_em    timestamptz not null default now(),
  status          text not null,
  novos           integer not null default 0,
  repetidos       integer not null default 0,
  recusados       integer not null default 0,
  motivo          text,
  detalhe         text,
  janela_de       timestamptz,
  janela_ate      timestamptz,
  -- Leituras seguidas com o MESMO desfecho que não é sucesso (sem novos, o mesmo
  -- erro) viram uma linha só com o contador: o histórico fica legível e não vira
  -- 288 linhas de "sem novos" por dia.
  repeticoes      integer not null default 1,
  constraint mia_leads_da_meta_leituras_status check (status in ('sucesso', 'sem_novos', 'erro'))
);

create index if not exists idx_mia_leads_da_meta_leituras_form
  on public.mia_leads_da_meta_leituras (organization_id, formulario_id, terminada_em desc);
create index if not exists idx_mia_leads_da_meta_leituras_poda
  on public.mia_leads_da_meta_leituras (terminada_em);

comment on table public.mia_leads_da_meta_leituras is
  'MIA (9003): o historico de cada leitura dos formularios da Meta (sucesso, sem novos, erro com motivo). Podado pela propria rotina depois de 30 dias.';

-- ── a deduplicação ─────────────────────────────────────────────────────────
create table if not exists public.mia_leads_da_meta_recebidos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- sha-256 do id do lead na Meta, nunca o id cru (ver o cabeçalho).
  chave_do_lead   text not null,
  formulario_id   uuid references public.mia_leads_da_meta_formularios(id) on delete set null,
  form_id         text,
  page_id         text,
  ad_id           text,
  adset_id        text,
  campaign_id     text,
  criado_na_meta  timestamptz,
  desfecho        text not null,
  crm_lead_id     uuid references public.crm_leads(id) on delete set null,
  recebido_em     timestamptz not null default now(),
  constraint mia_leads_da_meta_recebidos_desfecho check (desfecho in ('criado', 'repetido', 'recusado'))
);

create unique index if not exists uq_mia_leads_da_meta_recebidos_org_chave
  on public.mia_leads_da_meta_recebidos (organization_id, chave_do_lead);
create index if not exists idx_mia_leads_da_meta_recebidos_poda
  on public.mia_leads_da_meta_recebidos (recebido_em);

comment on table public.mia_leads_da_meta_recebidos is
  'MIA (9003): cada lead da Meta ja processado (criado, repetido, recusado), pelo hash do id. Deduplica as leituras sobrepostas. Podado depois de 120 dias (a Meta so devolve 90).';

-- ── RLS: gerente lê a própria empresa; só o servidor escreve ───────────────
alter table public.mia_leads_da_meta_config enable row level security;
alter table public.mia_leads_da_meta_formularios enable row level security;
alter table public.mia_leads_da_meta_leituras enable row level security;
alter table public.mia_leads_da_meta_recebidos enable row level security;

drop policy if exists mia_leads_da_meta_config_select on public.mia_leads_da_meta_config;
create policy mia_leads_da_meta_config_select on public.mia_leads_da_meta_config
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_leads_da_meta_formularios_select on public.mia_leads_da_meta_formularios;
create policy mia_leads_da_meta_formularios_select on public.mia_leads_da_meta_formularios
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_leads_da_meta_leituras_select on public.mia_leads_da_meta_leituras;
create policy mia_leads_da_meta_leituras_select on public.mia_leads_da_meta_leituras
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_leads_da_meta_recebidos_select on public.mia_leads_da_meta_recebidos;
create policy mia_leads_da_meta_recebidos_select on public.mia_leads_da_meta_recebidos
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- O default ACL do Supabase dá ALL a anon e authenticated em toda tabela nova;
-- o `grant select` sozinho não o desfaz (lição da 9001).
revoke all on public.mia_leads_da_meta_config from anon, authenticated;
revoke all on public.mia_leads_da_meta_formularios from anon, authenticated;
revoke all on public.mia_leads_da_meta_leituras from anon, authenticated;
revoke all on public.mia_leads_da_meta_recebidos from anon, authenticated;

grant select on public.mia_leads_da_meta_config to authenticated;
grant select on public.mia_leads_da_meta_formularios to authenticated;
grant select on public.mia_leads_da_meta_leituras to authenticated;
grant select on public.mia_leads_da_meta_recebidos to authenticated;

grant select, insert, update, delete on public.mia_leads_da_meta_config to service_role;
grant select, insert, update, delete on public.mia_leads_da_meta_formularios to service_role;
grant select, insert, update, delete on public.mia_leads_da_meta_leituras to service_role;
grant select, insert, update, delete on public.mia_leads_da_meta_recebidos to service_role;

-- ─── 9004 · cada Página da Meta é de UMA empresa, e quem decide é a plataforma ───
--
-- Espelho EXATO da migration 9004 (supabase/migrations-mia/). Idempotente, como todo o
-- apêndice. Vai antes da varredura anon, que fecha o arquivo.
--
-- ── O buraco que isto fecha ─────────────────────────────────────────────────
--
-- Na .60 a tela Configurações › Formulários da Meta listava TODAS as Páginas que
-- o token alcança. O token que existe é o da agência (o usuário do sistema do
-- Gerenciador da Time Company), e ele enxerga as Páginas de vários clientes. Com
-- esse token colado numa empresa, o admin dela via as Páginas dos outros e podia
-- escolher o formulário de uma delas: os leads do vizinho nasceriam no funil dele.
--
-- ── A regra ─────────────────────────────────────────────────────────────────
--
--   · cada Página tem no máximo UM dono (`page_id` é a chave primária);
--   · quem atribui é o dono da plataforma (/admin/paginas-da-meta, service_role);
--   · a empresa só vê e só configura formulário de Página dela;
--   · Página sem dono não aparece para empresa nenhuma.
--
-- ── Garantido no banco, não só na tela ─────────────────────────────────────
--
-- A invariante: **todo formulário ATIVO é de uma Página atribuída à MESMA
-- empresa.** Dois gatilhos a mantêm, um de cada lado:
--
--   1. em `mia_leads_da_meta_formularios`, antes de gravar: formulário ativo de
--      Página que não é da empresa é RECUSADO (42501), venha de onde vier;
--   2. em `mia_paginas_da_meta`, depois de atribuir, trocar ou retirar o dono:
--      os formulários ativos de OUTRAS empresas naquela Página são desligados,
--      com o motivo gravado para a tela delas mostrar.
--
-- Desligar é sempre permitido (formulário inativo não é lido). E a rotina confere
-- a mesma coisa de novo no código, antes de chamar a Meta (lib/leads-da-meta/paginas.ts).
--
-- ── A conexão da plataforma ─────────────────────────────────────────────────
--
-- Só a Time Company tem conexão de leitura (`ad_insights_connections`, a de
-- Configurações › Meta Ads). Uma empresa cliente sem conexão própria não teria
-- como ler os leads da Página dela. `mia_meta_conexao_da_plataforma` diz QUAL
-- empresa empresta a conexão, e ela só é usada para as Páginas atribuídas à
-- empresa que lê: nunca lista, nem lê, Página de outra. Linha única, RLS ligada
-- e zero policies (como `platform_ia`, `platform_meta`): só o servidor lê.
--
-- Nomes com prefixo `mia_`: estender, nunca redefinir (docs/FORK-MIA.md, regra 3).

-- ── o dono de cada Página ──────────────────────────────────────────────────
create table if not exists public.mia_paginas_da_meta (
  page_id         text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- O nome como a Meta devolveu na hora da atribuição. É o que a tela mostra
  -- antes de consultar a Meta, e o que sobra quando a Página some do token.
  page_name       text,
  atribuida_em    timestamptz not null default now(),
  atribuida_por   uuid references auth.users(id) on delete set null,
  constraint mia_paginas_da_meta_page_id check (page_id ~ '^[0-9]{1,30}$')
);

create index if not exists idx_mia_paginas_da_meta_org
  on public.mia_paginas_da_meta (organization_id);

comment on table public.mia_paginas_da_meta is
  'MIA (9004): de qual empresa e cada Pagina da Meta. Uma Pagina, um dono (page_id e a chave). Quem atribui e o dono da plataforma; a empresa so ve e so importa formulario de Pagina dela.';

-- ── a conexão que a plataforma empresta ────────────────────────────────────
create table if not exists public.mia_meta_conexao_da_plataforma (
  id                      smallint primary key default 1,
  -- A empresa cuja conexão de Meta Ads (Configurações › Meta Ads) lê as Páginas
  -- atribuídas a quem não tem conexão própria. Não é dado de uma empresa: é
  -- configuração da instalação, por isso não se chama `organization_id`.
  organizacao_da_conexao  uuid references public.organizations(id) on delete set null,
  atualizado_em           timestamptz not null default now(),
  atualizado_por          uuid references auth.users(id) on delete set null,
  constraint mia_meta_conexao_da_plataforma_singleton check (id = 1)
);

comment on table public.mia_meta_conexao_da_plataforma is
  'MIA (9004): qual empresa empresta a conexao de Meta Ads para ler as Paginas atribuidas a quem nao tem conexao propria. Linha unica id=1; so o servidor le. Usada so para Pagina atribuida a empresa que le.';

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.mia_paginas_da_meta enable row level security;
alter table public.mia_meta_conexao_da_plataforma enable row level security;

-- Gerente (ou acima) lê as Páginas da PRÓPRIA empresa; a plataforma lê todas.
drop policy if exists mia_paginas_da_meta_select on public.mia_paginas_da_meta;
create policy mia_paginas_da_meta_select on public.mia_paginas_da_meta
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- A conexão da plataforma: zero policies, de propósito.

-- O default ACL do Supabase dá ALL a anon e authenticated em toda tabela nova;
-- o `grant select` sozinho não o desfaz (lição da 9001).
revoke all on public.mia_paginas_da_meta from anon, authenticated;
revoke all on public.mia_meta_conexao_da_plataforma from anon, authenticated;

grant select on public.mia_paginas_da_meta to authenticated;

grant select, insert, update, delete on public.mia_paginas_da_meta to service_role;
grant select, insert, update on public.mia_meta_conexao_da_plataforma to service_role;

-- ── gatilho 1: formulário ativo só de Página da própria empresa ────────────
create or replace function public.fn_mia_formulario_da_meta_so_da_pagina_da_empresa()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  -- Desligar é sempre permitido: formulário inativo não é lido por ninguém.
  if not new.ativo then
    return new;
  end if;

  if not exists (
    select 1
      from public.mia_paginas_da_meta p
     where p.page_id = new.page_id
       and p.organization_id = new.organization_id
  ) then
    raise exception 'MIA: a Pagina % da Meta nao e desta empresa', new.page_id
      using errcode = '42501',
            hint = 'Quem administra a plataforma atribui cada Pagina a uma empresa (/admin/paginas-da-meta).';
  end if;

  return new;
end
$f$;

comment on function public.fn_mia_formulario_da_meta_so_da_pagina_da_empresa() is
  'MIA (9004): recusa formulario ATIVO de Pagina que nao e da mesma empresa (mia_paginas_da_meta). Desligar e sempre permitido.';

revoke all on function public.fn_mia_formulario_da_meta_so_da_pagina_da_empresa() from public;
revoke execute on function public.fn_mia_formulario_da_meta_so_da_pagina_da_empresa() from anon, authenticated;

-- `update of` e não `update`: a rotina grava a última leitura do formulário a
-- cada 5 minutos, e isso não muda nem a empresa, nem a Página, nem a chave.
drop trigger if exists trg_mia_formulario_da_meta_so_da_pagina_da_empresa
  on public.mia_leads_da_meta_formularios;
create trigger trg_mia_formulario_da_meta_so_da_pagina_da_empresa
  before insert or update of organization_id, page_id, ativo
  on public.mia_leads_da_meta_formularios
  for each row
  execute function public.fn_mia_formulario_da_meta_so_da_pagina_da_empresa();

-- ── gatilho 2: a Página mudou de dono, os formulários dos outros desligam ──
create or replace function public.fn_mia_pagina_da_meta_mudou_de_dono()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_pagina text;
  v_dono uuid;
begin
  if tg_op = 'DELETE' then
    v_pagina := old.page_id;
    v_dono := null;
  else
    v_pagina := new.page_id;
    v_dono := new.organization_id;
  end if;

  update public.mia_leads_da_meta_formularios f
     set ativo = false,
         ultimo_status = 'erro',
         ultimo_motivo = 'pagina_nao_e_da_empresa',
         ultimo_detalhe = null,
         atualizado_em = now()
   where f.page_id = v_pagina
     and f.ativo
     and (v_dono is null or f.organization_id <> v_dono);

  return null;
end
$f$;

comment on function public.fn_mia_pagina_da_meta_mudou_de_dono() is
  'MIA (9004): quando uma Pagina da Meta ganha, troca ou perde o dono, desliga os formularios ativos das OUTRAS empresas nela, com o motivo gravado.';

revoke all on function public.fn_mia_pagina_da_meta_mudou_de_dono() from public;
revoke execute on function public.fn_mia_pagina_da_meta_mudou_de_dono() from anon, authenticated;

drop trigger if exists trg_mia_pagina_da_meta_mudou_de_dono on public.mia_paginas_da_meta;
create trigger trg_mia_pagina_da_meta_mudou_de_dono
  after insert or update of organization_id or delete
  on public.mia_paginas_da_meta
  for each row
  execute function public.fn_mia_pagina_da_meta_mudou_de_dono();

-- ── o que já existia antes desta migration ─────────────────────────────────
--
-- Formulário ativo da .60 cuja Página ainda não é da empresa dele fica
-- DESLIGADO, com o motivo à vista na tela. Sem isto a invariante valeria só para
-- o que for gravado daqui para a frente. Quando a plataforma atribuir a Página, o
-- admin da empresa liga o formulário de novo e a leitura continua de onde parou
-- (`lido_ate` não é tocado). Idempotente: depois da primeira vez não sobra linha
-- que case, e a reaplicação do baseline a cada deploy não muda nada.
update public.mia_leads_da_meta_formularios f
   set ativo = false,
       ultimo_status = 'erro',
       ultimo_motivo = 'pagina_nao_e_da_empresa',
       ultimo_detalhe = null,
       atualizado_em = now()
 where f.ativo
   and not exists (
     select 1
       from public.mia_paginas_da_meta p
      where p.page_id = f.page_id
        and p.organization_id = f.organization_id
   );

-- ─── 9005 · leads da Meta: o aviso em tempo real, o telefone em pergunta própria e o aviso quando a leitura para ───
--
-- Espelho EXATO da migration 9005 (supabase/migrations-mia/). Idempotente, como todo o
-- apêndice. Vai antes da varredura anon, que fecha o arquivo.
--
-- ── O que entra ─────────────────────────────────────────────────────────────
--
-- Três passos da importação dos leads dos formulários da Meta
-- (docs/fork/leads-da-meta.md). Nenhuma tabela nova: só colunas nas tabelas
-- NOSSAS da 9003 e um índice parcial na Central de avisos.
--
--   1. TEMPO REAL. A Meta avisa o app (webhook `leadgen`, rota
--      `app/api/v1/webhooks/leads-da-meta`) quando alguém preenche o
--      formulário, e o lead entra em segundos pela MESMA via da leitura a cada 5
--      minutos, que continua como rede de segurança. Para a Meta avisar, a
--      Página tem de estar assinada no app (`subscribed_apps` com o campo
--      `leadgen`), e isso pode ser recusado por permissão: o formulário guarda o
--      resultado da assinatura para a tela dizer o motivo, e quando o último
--      aviso da Meta chegou. `recebidos.via` diz por qual caminho cada lead
--      entrou primeiro.
--
--   2. O TELEFONE EM PERGUNTA PRÓPRIA. Formulário como o da Erglares pergunta
--      o celular numa pergunta criada por eles (`celular:_(ddd_+_número)`) e
--      não no campo padrão `phone_number`. O sistema passa a reconhecer
--      sozinho, e quando errar o administrador escolhe qual pergunta é o
--      telefone, o nome e o e-mail. Guarda-se a CHAVE da pergunta, nunca a
--      resposta.
--
--   3. O AVISO QUANDO A LEITURA PARA. Três falhas seguidas (token vencido,
--      permissão retirada, Página removida) viram UM aviso na Central para os
--      administradores, com o motivo e o que fazer, e o aviso some sozinho
--      quando a leitura volta. `falhas_seguidas` conta; `aviso_de_falha_motivo`
--      é o "já avisei deste problema", que impede repetir a cada 5 minutos.
--
-- ── Nenhuma coluna guarda dado pessoal ─────────────────────────────────────
--
-- Como na 9003: chave de pergunta, estado da assinatura, contador e motivo são
-- estado da rotina. Nome, telefone e respostas continuam em `contacts`,
-- `crm_leads` e `webhook_lead_captures`, que a LGPD já alcança.
--
-- ── Quem lê e quem escreve ─────────────────────────────────────────────────
--
-- As colunas herdam a RLS e os grants da 9003: gerente lê a própria empresa,
-- só o servidor escreve.
--
-- Nomes com prefixo `mia_`: estender, nunca redefinir (docs/FORK-MIA.md, regra 3).

-- ── 1. o tempo real ────────────────────────────────────────────────────────
alter table public.mia_leads_da_meta_formularios
  -- `assinado`: a Página está assinada no app para o campo `leadgen`.
  -- `recusado`: a Meta recusou assinar; o motivo diz o que falta. Nulo: ainda
  -- não tentado (formulário de antes da .62), e a rotina tenta sozinha.
  add column if not exists tempo_real text
    check (tempo_real is null or tempo_real in ('assinado', 'recusado')),
  add column if not exists tempo_real_motivo text,
  add column if not exists tempo_real_detalhe text,
  add column if not exists tempo_real_em timestamptz,
  -- Quando o último lead deste formulário chegou pelo aviso da Meta. É o que
  -- mostra que o tempo real FUNCIONA, e não só que a assinatura foi aceita.
  add column if not exists ultimo_aviso_da_meta_em timestamptz;

alter table public.mia_leads_da_meta_recebidos
  -- Por qual caminho o lead entrou primeiro. O outro caminho o acha já
  -- importado pela mesma chave, e não grava nada.
  add column if not exists via text not null default 'consulta'
    check (via in ('consulta', 'tempo_real'));

-- ── 2. qual pergunta é o telefone, o nome e o e-mail ───────────────────────
alter table public.mia_leads_da_meta_formularios
  -- A CHAVE da pergunta na Meta (`celular:_(ddd_+_número)`), escolhida pelo
  -- administrador. Nulo: automático.
  add column if not exists campo_telefone text,
  add column if not exists campo_nome text,
  add column if not exists campo_email text;

-- ── 3. o aviso quando a leitura falha seguidas vezes ───────────────────────
alter table public.mia_leads_da_meta_formularios
  -- Leituras com erro seguidas. Volta a zero na primeira que dá certo.
  add column if not exists falhas_seguidas integer not null default 0,
  -- O motivo que já foi avisado e quando. Enquanto o problema for o mesmo,
  -- ninguém é avisado de novo; some quando a leitura volta.
  add column if not exists aviso_de_falha_motivo text,
  add column if not exists aviso_de_falha_em timestamptz;

comment on column public.mia_leads_da_meta_formularios.falhas_seguidas is
  'MIA (9005): leituras com erro seguidas deste formulario. Tres (ou doze, se o motivo passa sozinho) viram UM aviso na Central para os administradores.';

-- UM aviso aberto por formulário, garantido no banco: duas rodadas ao mesmo
-- tempo (o relógio e o "Ler agora") não avisam duas vezes. Índice NOSSO numa
-- tabela do upstream, ao lado dos dele (`agent_inbox_routing_unique` é o mesmo
-- desenho): estende, não redefine. `ack` conta como aberto: quem viu o aviso e
-- não resolveu o problema continua com ele.
create unique index if not exists uq_mia_aviso_de_leitura_da_meta_aberto
  on public.agent_inbox_items (organization_id, ref_id)
  where ref_kind = 'mia_leads_da_meta_formulario' and status <> 'resolved';

-- ─── 9006 · o estado do backup, sem dado sensível, para a saúde ───
--
-- Espelho EXATO da migration 9006 (supabase/migrations-mia/), onde está o porquê
-- inteiro. Idempotente, como todo o apêndice. Vai antes da varredura anon, que
-- fecha o arquivo.
--
-- Em uma linha: `/api/v1/health` e o vigia da plataforma leem o backup diário
-- (`operacao.backup`, que não é do app) por esta função, que devolve só a
-- situação e duas datas. Nada de `detalhe` (texto de erro do pg_dump/rclone).
-- O dono (`postgres`) lê pela pertença a `pg_read_all_data` da imagem do
-- Supabase; sem ela, a função responde `sem_permissao` em vez de falhar.
create or replace function public.fn_mia_estado_do_backup()
returns table (situacao text, ultima_copia_em timestamptz, enviada_em timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $f$
begin
  if not exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'operacao'
       and c.relname = 'backup'
  ) then
    return query select 'sem_tabela'::text, null::timestamptz, null::timestamptz;
    return;
  end if;

  begin
    return query execute
      'select ''ok''::text, b.terminado_em, b.enviado_em
         from operacao.backup b
        where b.ok is true
          and b.terminado_em is not null
        order by b.terminado_em desc
        limit 1';
    if not found then
      return query select 'sem_copia'::text, null::timestamptz, null::timestamptz;
    end if;
  exception
    when insufficient_privilege then
      return query select 'sem_permissao'::text, null::timestamptz, null::timestamptz;
    when undefined_table or undefined_column or invalid_schema_name then
      return query select 'sem_tabela'::text, null::timestamptz, null::timestamptz;
  end;
end;
$f$;

comment on function public.fn_mia_estado_do_backup() is
  'MIA (9006): o estado do backup diario para /api/v1/health e o vigia da plataforma, sem dado sensivel: situacao (ok, sem_copia, sem_tabela, sem_permissao), quando ficou pronta a ultima copia completa de operacao.backup e quando ela foi enviada ao Drive. Security definer porque o schema operacao nao e do app: o dono le pela pertenca a pg_read_all_data (imagem do Supabase); sem ela, responde sem_permissao ate supabase_admin conceder USAGE em operacao e SELECT (ok, terminado_em, enviado_em) em operacao.backup. Execucao so para service_role.';

revoke all on function public.fn_mia_estado_do_backup() from public;
revoke execute on function public.fn_mia_estado_do_backup() from anon, authenticated;
grant execute on function public.fn_mia_estado_do_backup() to service_role;

notify pgrst, 'reload schema';

-- ─── 9007 · o rastro da IA de quem foi anonimizado guarda o NOME da ferramenta ───
--
-- Espelho EXATO da migration 9007 (supabase/migrations-mia/), onde está o porquê
-- inteiro. Idempotente, como todo o apêndice. Vai antes da varredura anon, que
-- fecha o arquivo.
--
-- FORK MIA (fusão da v1.66.0 do upstream). A 0266 da MIA redigia
-- `ai_agent_runs.tool_calls` do contato anonimizado trocando o valor inteiro
-- por `[]`. Na época nenhum caminho do upstream alcançava essa coluna.
--
-- A 0494 do upstream (#1964) passou a alcançar: o gatilho dele
-- (`fn_redigir_conversas_ao_anonimizar`) redige cada passo com
-- `fn_lgpd_redigir_tool_calls`, que PRESERVA o nome das ferramentas e o número
-- do passo (`{ step, tool_name, redacted: true, tool_calls: [{ tool_name }] }`)
-- e apaga argumentos, resultados e o texto do modelo. A trilha do que o agente
-- fez continua legível; o dado da pessoa sai.
--
-- Os dois gatilhos são AFTER UPDATE OF is_anonymized, e o Postgres os dispara
-- em ordem alfabética: `trg_redigir_conversas_…` (dele) antes de
-- `trg_redigir_o_que_sobrou_…` (nosso). O nosso rodava por último e zerava para
-- `[]` o que o dele acabara de redigir, e a invariante
-- `lgpd-cascata-do-banco-alcanca-notas-itens` reprovou no CI.
--
-- Pela regra 3 de docs/FORK-MIA.md (estender, nunca redefinir), o nosso passa a
-- redigir do MESMO jeito que o dele, chamando a função dele, e continua fazendo
-- só o que a dele não faz:
--
--   · alcança também as execuções ligadas pela CONVERSA do titular (as que
--     nasceram antes de o contato ser resolvido; a dele filtra só por
--     `contact_id`);
--   · apaga `error_message`, que pode repetir texto da conversa.
--
-- Guardas: só mexe em linha com passo ainda não redigido ou com
-- `error_message`; um `tool_calls` que não seja lista (nunca deveria existir)
-- vira `[]`, em vez de derrubar a anonimização inteira num
-- `jsonb_array_elements` de objeto.
--
-- O que já virou `[]` não volta: o nome das ferramentas se perdeu quando a 0266
-- rodou. O ajuste vale daqui para frente e para quem foi anonimizado com a
-- redação antiga do upstream por cima.

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

  return new;
end $$;

comment on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() is
  'MIA (0266, 9007): redige o que o gatilho do upstream nao alcanca quando o contato e anonimizado. ai_agent_runs: redige tool_calls com fn_lgpd_redigir_tool_calls (a mesma do upstream, 0494, que preserva o nome da ferramenta) tambem nas execucoes ligadas pela conversa, e apaga error_message. demandas (assunto, proximo_passo), broadcast_recipients (telefone copiado) e query_raw dos cliques de anuncio.';

revoke all on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from public;
revoke execute on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from anon;
revoke execute on function public.fn_redigir_o_que_sobrou_do_contato_anonimizado() from authenticated;

-- Quem JÁ foi anonimizado e ainda tem passo sem redigir (ou error_message).
update public.ai_agent_runs r
   set tool_calls    = case
                         when jsonb_typeof(r.tool_calls) = 'array'
                           then public.fn_lgpd_redigir_tool_calls(r.tool_calls)
                         else '[]'::jsonb
                       end,
       error_message = null
  from public.contacts c
 where c.is_anonymized = true
   and c.organization_id = r.organization_id
   and (
     r.contact_id = c.id
     or r.conversation_id in (
       select id from public.conversations
        where organization_id = c.organization_id and contact_id = c.id
     )
   )
   and (
     r.error_message is not null
     or case
          when jsonb_typeof(r.tool_calls) = 'array' then exists (
            select 1 from jsonb_array_elements(r.tool_calls) s
             where coalesce(s->>'redacted', 'false')::boolean is not true
          )
          else r.tool_calls is not null
        end
   );


-- ─── 9008 · a empresa com conta própria da Meta escolhe as Páginas dela ───
--
-- Espelho EXATO da migration 9008 (supabase/migrations-mia/), onde está o porquê
-- inteiro. Idempotente, como todo o apêndice. Vai antes da varredura anon, que
-- fecha o arquivo.
--
-- ── O que muda desde a 9004 ─────────────────────────────────────────────────
--
-- Na 9004 só o dono da plataforma atribuía Página, MESMO para a empresa que
-- conectou a própria conta da Meta em Configurações › Meta Ads. O pedido do
-- Gabriel: "quando o cliente conectar a conta dele, ele que tem que definir
-- qual página abrir ou se vai ter mais de uma página para puxar o formulário".
--
-- Da .64 em diante, cada dono de Página tem uma ORIGEM:
--
--   · `plataforma`     o dono da plataforma atribuiu (/admin/paginas-da-meta).
--                      É o único caminho de quem lê pela conexão emprestada, e
--                      é o que TRANSFERE ou corrige qualquer Página;
--   · `conta_propria`  a própria empresa assumiu, na aba Formulários de leads,
--                      uma Página que o token DELA alcança na Meta (a rota
--                      confere na Meta, na hora, antes de gravar).
--
-- ── A regra, garantida no banco ─────────────────────────────────────────────
--
-- A invariante da 9004 continua (uma Página, um dono; formulário ativo só de
-- Página da própria empresa). A 9008 acrescenta, para a origem `conta_propria`:
--
--   1. assumir nunca tira a Página de outra empresa. Inserir a Página que já
--      tem dono esbarra na chave primária (23505); um upsert ou update que
--      troque o dono com a origem `conta_propria` é recusado (42501). Trocar o
--      dono é só da plataforma, com a origem `plataforma`;
--   2. só assume quem tem conexão PRÓPRIA de Meta Ads (`ad_insights_connections`
--      da mesma empresa). Empresa que lê pela conexão emprestada continua como
--      na 9004: quem atribui é a plataforma.
--
-- Soltar (a empresa desmarca a Página) é `fn_mia_soltar_pagina_da_meta`, numa
-- transação só: desliga os formulários ativos dela naquela Página com o motivo
-- `pagina_solta` e apaga o dono. Só solta o que ela mesma assumiu; a Página
-- que a plataforma atribuiu continua sendo da plataforma soltar.
--
-- Por que a empresa não escreve direto (RLS): a conferência "o token dela
-- alcança esta Página na Meta" só existe no servidor, que é quem fala com a
-- Meta. A escrita segue pelo service_role das rotas, e os gatilhos acima valem
-- para qualquer caminho, inclusive ele.
--
-- Nomes com prefixo `mia_`/`fn_mia_`: estender, nunca redefinir (docs/FORK-MIA.md,
-- regra 3). Os gatilhos e a função da 9004 não são tocados.

-- ── a origem de cada dono ──────────────────────────────────────────────────
-- Tudo o que existe até aqui foi atribuído pela plataforma: o padrão conta a
-- história certa para as linhas antigas, sem backfill.
alter table public.mia_paginas_da_meta
  add column if not exists origem text not null default 'plataforma';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'mia_paginas_da_meta_origem'
       and conrelid = 'public.mia_paginas_da_meta'::regclass
  ) then
    alter table public.mia_paginas_da_meta
      add constraint mia_paginas_da_meta_origem
      check (origem in ('plataforma', 'conta_propria'));
  end if;
end $$;

comment on column public.mia_paginas_da_meta.origem is
  'MIA (9008): de onde veio o dono. plataforma = atribuida pelo dono da plataforma (/admin/paginas-da-meta), que tambem transfere; conta_propria = a empresa assumiu pela propria conexao de Meta Ads, conferida na Meta na hora.';

comment on table public.mia_paginas_da_meta is
  'MIA (9004, 9008): de qual empresa e cada Pagina da Meta. Uma Pagina, um dono (page_id e a chave). A plataforma atribui e transfere; a empresa com conta propria da Meta assume as Paginas que o token dela alcanca (origem conta_propria) e nunca a de outra empresa.';

-- ── gatilho 3: assumir pela conta própria ──────────────────────────────────
create or replace function public.fn_mia_pagina_da_meta_pela_conta_propria()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  -- A plataforma atribui e transfere sem esta conferência (9004).
  if new.origem is distinct from 'conta_propria' then
    return new;
  end if;

  -- Assumir não toma a Página de ninguém: trocar o dono é só da plataforma.
  if tg_op = 'UPDATE' and old.organization_id is distinct from new.organization_id then
    raise exception 'MIA: esta Pagina da Meta ja esta ligada a outra empresa da plataforma'
      using errcode = '42501',
            hint = 'So quem administra a plataforma transfere uma Pagina (/admin/paginas-da-meta).';
  end if;

  -- Só assume quem tem a PRÓPRIA conexão de Meta Ads.
  if not exists (
    select 1
      from public.ad_insights_connections c
     where c.organization_id = new.organization_id
       and c.platform = 'meta_ads'
  ) then
    raise exception 'MIA: a empresa nao tem conexao propria de Meta Ads para assumir a Pagina %', new.page_id
      using errcode = '42501',
            hint = 'Sem conexao propria, quem atribui a Pagina e o dono da plataforma.';
  end if;

  return new;
end
$f$;

comment on function public.fn_mia_pagina_da_meta_pela_conta_propria() is
  'MIA (9008): dono com origem conta_propria so nasce para empresa com conexao propria de Meta Ads, e nunca toma a Pagina de outra empresa (trocar o dono e so da plataforma).';

revoke all on function public.fn_mia_pagina_da_meta_pela_conta_propria() from public;
revoke execute on function public.fn_mia_pagina_da_meta_pela_conta_propria() from anon, authenticated;

drop trigger if exists trg_mia_pagina_da_meta_pela_conta_propria on public.mia_paginas_da_meta;
create trigger trg_mia_pagina_da_meta_pela_conta_propria
  before insert or update of organization_id, origem
  on public.mia_paginas_da_meta
  for each row
  execute function public.fn_mia_pagina_da_meta_pela_conta_propria();

-- ── soltar: a empresa desmarca a Página que assumiu ────────────────────────
--
-- Numa transação: os formulários ATIVOS da empresa naquela Página desligam com
-- o motivo `pagina_solta` (e o aviso de falha deles zera, como no desligar da
-- rota), e o dono sai. O gatilho 2 da 9004 dispara no delete e não acha mais
-- formulário ativo: o motivo que fica é este, e não "não é da empresa".
--
-- Devolve `{solta: true, formularios: [ids]}` ou `{solta: false, motivo}`:
--   `nao_e_da_empresa`           a Página não tem dono, ou o dono é outra empresa;
--   `atribuida_pela_plataforma`  quem atribuiu foi a plataforma, e só ela solta.
create or replace function public.fn_mia_soltar_pagina_da_meta(
  p_organization_id uuid,
  p_page_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_origem text;
  v_formularios uuid[];
begin
  select p.origem
    into v_origem
    from public.mia_paginas_da_meta p
   where p.page_id = p_page_id
     and p.organization_id = p_organization_id
   for update;

  if not found then
    return jsonb_build_object('solta', false, 'motivo', 'nao_e_da_empresa');
  end if;
  if v_origem <> 'conta_propria' then
    return jsonb_build_object('solta', false, 'motivo', 'atribuida_pela_plataforma');
  end if;

  with desligados as (
    update public.mia_leads_da_meta_formularios f
       set ativo = false,
           ultimo_status = 'erro',
           ultimo_motivo = 'pagina_solta',
           ultimo_detalhe = null,
           falhas_seguidas = 0,
           aviso_de_falha_motivo = null,
           aviso_de_falha_em = null,
           atualizado_em = now()
     where f.organization_id = p_organization_id
       and f.page_id = p_page_id
       and f.ativo
    returning f.id
  )
  select coalesce(array_agg(d.id), '{}'::uuid[]) into v_formularios from desligados d;

  delete from public.mia_paginas_da_meta p
   where p.page_id = p_page_id
     and p.organization_id = p_organization_id;

  return jsonb_build_object('solta', true, 'formularios', to_jsonb(v_formularios));
end
$f$;

comment on function public.fn_mia_soltar_pagina_da_meta(uuid, text) is
  'MIA (9008): a empresa solta a Pagina da Meta que ela mesma assumiu (origem conta_propria): desliga os formularios ativos dela ali com o motivo pagina_solta e apaga o dono, na mesma transacao. Pagina atribuida pela plataforma nao e solta por aqui. Execucao so para service_role.';

revoke all on function public.fn_mia_soltar_pagina_da_meta(uuid, text) from public;
revoke execute on function public.fn_mia_soltar_pagina_da_meta(uuid, text) from anon, authenticated;
grant execute on function public.fn_mia_soltar_pagina_da_meta(uuid, text) to service_role;


-- ─── 9009 · desconectar a conta própria da Meta solta as Páginas que a empresa assumiu ───
--
-- Espelho EXATO da migration 9009 (supabase/migrations-mia/), onde está o porquê
-- inteiro. Idempotente, como todo o apêndice. Vai antes da varredura anon, que
-- fecha o arquivo.
--
-- ── O que muda desde a 9008 ─────────────────────────────────────────────────
--
-- Na 9008 a empresa com conexão própria de Meta Ads (Configurações › Meta Ads,
-- `ad_insights_connections`) passou a assumir Páginas (origem `conta_propria`).
-- Mas desconectar a conta só apagava a conexão: as Páginas continuavam em nome
-- dela e os formulários, "ativos". Sem o token próprio, a leitura
-- (lib/leads-da-meta/paginas.ts) ou falhava por falta de acesso, ou seguia
-- pelo token da PLATAFORMA, quando ele também alcança a Página: uma Página que
-- a empresa escolheu pela conta dela passava a ser lida por uma conexão que ela
-- não escolheu. E nenhuma outra empresa podia assumir a Página, que tinha dono.
--
-- A decisão do Gabriel: "solta a página, o usuário pode conectar e
-- desconectar". Desconectar solta TODAS as Páginas que a empresa assumiu, com
-- o mesmo efeito de desmarcar uma por uma (`fn_mia_soltar_pagina_da_meta`, da
-- 9008): os formulários ativos dela ali desligam com o motivo `pagina_solta`,
-- o aviso de falha deles zera e o dono sai. Reconectar e marcar de novo volta
-- a importar, como no desmarcar.
--
-- A Página atribuída pela PLATAFORMA (origem `plataforma`) NÃO é solta: ela
-- não dependia da conexão da empresa (a plataforma lê pela conexão dela), e
-- quem a atribuiu é quem decide soltar.
--
-- ── Por que no banco (gatilho), e não na rota ───────────────────────────────
--
-- A tela desconecta com um DELETE em `ad_insights_connections`
-- (app/actions/settings/updateAdInsightsConnection.ts), mas a linha também
-- some por outros caminhos (apagar a empresa, a mão no banco, uma rota futura).
-- Um gatilho AFTER DELETE vale para todos, na mesma transação do DELETE: ou a
-- conexão sai e as Páginas são soltas, ou nada acontece.
--
-- Guardas:
--   · só a conexão de Meta Ads (`platform = 'meta_ads'`) solta Página;
--   · se ainda houver outra conexão de Meta Ads da mesma empresa, nada é solto
--     (o índice único `(organization_id, platform)` da 0214 não deixa existir
--     hoje; a guarda é para não depender dele);
--   · a soltura é a função da 9008, chamada Página por Página: o motivo, o que
--     zera e o que fica são UM código só, e não uma cópia que envelhece.
--
-- Nomes com prefixo `mia_`/`fn_mia_`, gatilho NOSSO numa tabela do upstream:
-- estender, nunca redefinir (docs/FORK-MIA.md, regra 3). Nada da 9004/9008 nem
-- da 0214 é tocado.

create or replace function public.fn_mia_soltar_paginas_ao_desconectar_a_meta()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_pagina text;
begin
  if old.platform is distinct from 'meta_ads' then
    return null;
  end if;

  -- Ainda conectada por outra linha: a empresa segue alcançando as Páginas.
  if exists (
    select 1
      from public.ad_insights_connections c
     where c.organization_id = old.organization_id
       and c.platform = 'meta_ads'
  ) then
    return null;
  end if;

  for v_pagina in
    select p.page_id
      from public.mia_paginas_da_meta p
     where p.organization_id = old.organization_id
       and p.origem = 'conta_propria'
     order by p.page_id
  loop
    perform public.fn_mia_soltar_pagina_da_meta(old.organization_id, v_pagina);
  end loop;

  return null;
end
$f$;

comment on function public.fn_mia_soltar_paginas_ao_desconectar_a_meta() is
  'MIA (9009): ao apagar a conexao propria de Meta Ads da empresa (desconectar), solta as Paginas que ela assumiu (origem conta_propria) com fn_mia_soltar_pagina_da_meta: formularios desligados com o motivo pagina_solta e dono apagado. Pagina atribuida pela plataforma fica.';

revoke all on function public.fn_mia_soltar_paginas_ao_desconectar_a_meta() from public;
revoke execute on function public.fn_mia_soltar_paginas_ao_desconectar_a_meta() from anon, authenticated;

drop trigger if exists trg_mia_soltar_paginas_ao_desconectar_a_meta on public.ad_insights_connections;
create trigger trg_mia_soltar_paginas_ao_desconectar_a_meta
  after delete
  on public.ad_insights_connections
  for each row
  when (old.platform = 'meta_ads')
  execute function public.fn_mia_soltar_paginas_ao_desconectar_a_meta();


-- ─── 9010 · a empresa de demonstração (cliente modelo): nada sai dela, e ela não conta ───
--
-- Espelho EXATO da migration 9010 (supabase/migrations-mia/), onde está o porquê
-- inteiro. Idempotente, como todo o apêndice. Vai antes da varredura anon, que
-- fecha o arquivo.
--
-- ── O que é ─────────────────────────────────────────────────────────────────
--
-- Decisão do Gabriel (30/09): uma empresa de DEMONSTRAÇÃO, com dados fictícios,
-- que exercita todos os recursos da plataforma para testar, medir e mostrar em
-- venda. Mora em produção, como empresa separada, com uma marca que:
--
--   1. TRAVA qualquer envio real — WhatsApp, broadcast, campanha, follow-up,
--      aviso no grupo, e-mail, push, conversões da Meta/Google, webhooks de
--      saída, agenda externa e ligação;
--   2. tira a empresa das métricas, do faturamento e dos relatórios da
--      PLATAFORMA (dentro dela, os relatórios dela continuam funcionando).
--
-- A semente é `scripts/cliente-modelo.ts` (docs/fork/cliente-modelo.md).
--
-- ── Por que coluna, e não `settings` ────────────────────────────────────────
--
-- `organizations.settings` é preferência da empresa: as rotas do cliente o
-- escrevem com o service_role, mesclando chaves (Configurações, marca, grupo de
-- avisos, modo de venda). Uma chave `demonstracao` ali estaria a um PATCH mal
-- feito de sumir — e a trava sumiria junto, em silêncio: falha ABERTA. A marca
-- é outra coisa: é a plataforma dizendo "esta empresa não fala com ninguém".
-- Por isso é coluna própria, `not null default false` (nenhuma empresa de
-- verdade muda de comportamento, sem backfill), e só a plataforma a muda.
--
-- ── Como a trava falha fechada ──────────────────────────────────────────────
--
-- A trava mora no BANCO, no lugar por onde cada envio TEM de passar antes de
-- sair — e não numa lista de `if` no código, que o próximo caminho de envio
-- esqueceria. Medido no código (30/09), todo envio ao lead passa por UMA destas
-- portas, e a empresa de demonstração não abre nenhuma:
--
--   · a fila de mensagens: `messages` de saída nasce `queued` antes de ir ao
--     canal (app/api/v1/messages/_handler.ts, a porta de UI, automação, MCP,
--     agente, follow-up, campanha, prospecção, lembrete e proposta). Mensagem de
--     saída em fila numa empresa de demonstração é RECUSADA (42501): a linha
--     não nasce, e o handler não chega ao canal;
--   · o número: nenhuma sessão de canal VIVA (não arquivada). Sem número, não há
--     por onde mandar nada — nem o "digitando", nem edição, nem modelo da Meta;
--   · o que dispara sozinho: campanha e broadcast não passam de rascunho para
--     agendado/enviando; regra de automação com webhook ou aviso no grupo não
--     fica ativa; aviso de caso não liga;
--   · os destinos de fora: grupo de avisos, conexão de conversões (Meta/Google),
--     agenda externa (o Google manda convite por e-mail aos participantes),
--     assinatura de push, ligação (voz e tronco SIP) e convite de equipe (que é
--     e-mail) não existem para ela.
--
-- O e-mail que não nasce de uma linha destas (a entrega do relatório LGPD ao
-- titular, o alarme de prazo LGPD) é travado no roteador de e-mail, no código,
-- pela mesma pergunta `fn_mia_e_demonstracao`.
--
-- ⚠️ Nenhuma recusa aqui roda dentro de um UPDATE em lote de vários tenants:
-- quem é recusado é a ação de UMA empresa (enfileirar, conectar, agendar,
-- ligar). A única escrita em lote que alcança a fila (o reenvio do vigia, que
-- promove `queued`) encontra a empresa de demonstração SEM fila: o INSERT não
-- nasce, e marcar a empresa derruba as pendentes para `failed`. Por isso o
-- ramo de UPDATE de `messages` converte em vez de recusar — recusar ali
-- abortaria o lote das empresas de verdade.
--
-- ── Marcar e desmarcar ──────────────────────────────────────────────────────
--
-- Só a plataforma muda a marca (service_role, postgres ou admin da plataforma).
-- Marcar uma empresa que tem destino vivo é RECUSADO, com a lista do que
-- desligar: marcar por engano uma empresa de verdade não pode derrubar o
-- WhatsApp dela em silêncio. O que é transitório é desligado na marcação: fila
-- de saída vira `failed`, assinaturas de push somem, convites pendentes são
-- revogados.
--
-- Nomes `fn_mia_`/`trg_mia_`: estender, nunca redefinir (docs/FORK-MIA.md,
-- regra 3). Nenhum objeto do upstream é tocado.

-- ── 1. a marca ──────────────────────────────────────────────────────────────
alter table public.organizations
  add column if not exists demonstracao boolean not null default false;

comment on column public.organizations.demonstracao is
  'MIA (9010): empresa de DEMONSTRACAO (cliente modelo, dados ficticios). Nada sai dela (os gatilhos trg_mia_demonstracao_* recusam fila de saida, numero vivo, agendamento de campanha e broadcast, destinos externos) e ela fica fora das metricas, do faturamento e dos relatorios da plataforma. So a plataforma marca e desmarca.';

-- ── 2. a pergunta ───────────────────────────────────────────────────────────
-- Empresa que não existe responde `false`: a linha que a citasse esbarraria na
-- chave estrangeira de qualquer jeito, e é essa recusa que vale.
create or replace function public.fn_mia_e_demonstracao(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $f$
  select coalesce(
    (select o.demonstracao from public.organizations o where o.id = p_org),
    false
  );
$f$;

comment on function public.fn_mia_e_demonstracao(uuid) is
  'MIA (9010): a empresa e de demonstracao? Consultada pelos gatilhos da trava e pelo roteador de e-mail. Execucao so para service_role.';

revoke all on function public.fn_mia_e_demonstracao(uuid) from public;
revoke execute on function public.fn_mia_e_demonstracao(uuid) from anon, authenticated;
grant execute on function public.fn_mia_e_demonstracao(uuid) to service_role;

-- Quem escreve é a PLATAFORMA? Tudo que não é sessão de usuário (service_role,
-- postgres, a semente) é; sessão de usuário só quando é admin da plataforma.
create or replace function public.fn_mia_escrita_da_plataforma()
returns boolean
language sql
stable
security definer
set search_path = public
as $f$
  select not (
           coalesce(current_setting('role', true), '') in ('authenticated', 'anon')
           or coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon')
         )
      or public.fn_is_platform_admin();
$f$;

comment on function public.fn_mia_escrita_da_plataforma() is
  'MIA (9010): verdadeiro quando quem escreve e a plataforma (service_role, postgres) ou um admin da plataforma logado. E quem pode marcar e desmarcar a empresa de demonstracao.';

revoke all on function public.fn_mia_escrita_da_plataforma() from public;
revoke execute on function public.fn_mia_escrita_da_plataforma() from anon, authenticated;

-- ── 3. a trava, uma função para todas as portas ─────────────────────────────
--
-- A mensagem de toda recusa começa com `organizacao_de_demonstracao:` — é por
-- ela que o código traduz o erro para a tela (lib/demonstracao/trava.ts).
create or replace function public.fn_mia_trava_da_demonstracao()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_porta text;
begin
  -- As condições baratas primeiro: só depois a consulta à empresa.
  case tg_table_name
    when 'messages' then
      if new.direction is distinct from 'outbound'
         or new.status not in ('queued', 'sending') then
        return new;
      end if;
      if tg_op = 'UPDATE' and old.status is not distinct from new.status then
        return new;
      end if;
      if not public.fn_mia_e_demonstracao(new.organization_id) then
        return new;
      end if;
      if tg_op = 'UPDATE' then
        -- Lote do vigia (ver o cabeçalho): converter, nunca abortar o lote.
        new.status := 'failed';
        new.error_code := 'organizacao_de_demonstracao';
        new.error_message := 'Empresa de demonstracao: nada sai daqui.';
        return new;
      end if;
      v_porta := 'mensagem de saida';

    when 'channel_sessions' then
      if new.archived_at is not null then return new; end if;
      v_porta := 'numero de WhatsApp conectado';

    when 'campaigns' then
      if new.status not in ('scheduled', 'running') then return new; end if;
      v_porta := 'campanha agendada ou enviando';

    when 'broadcasts' then
      if new.status not in ('agendada', 'enviando') then return new; end if;
      v_porta := 'broadcast agendado ou enviando';

    when 'automation_rules' then
      if not new.is_active
         or jsonb_typeof(new.actions) is distinct from 'array'
         or not exists (
              select 1 from jsonb_array_elements(new.actions) a
               where a ->> 'type' in ('call_webhook', 'notify_group')
            ) then
        return new;
      end if;
      v_porta := 'regra de automacao ativa com webhook ou aviso no grupo';

    when 'config_aviso_de_caso' then
      if not new.ligado then return new; end if;
      v_porta := 'aviso de caso ligado';

    when 'ad_platform_connections' then
      if not new.enabled then return new; end if;
      v_porta := 'envio de conversoes para a Meta ou o Google';

    when 'calendar_connections' then
      v_porta := 'agenda externa conectada';

    when 'push_subscriptions' then
      v_porta := 'notificacao push';

    when 'org_voice_calls' then
      if not new.enabled then return new; end if;
      v_porta := 'ligacao pelo WhatsApp';

    when 'voip_trunk_settings' then
      if not new.is_active then return new; end if;
      v_porta := 'ligacao pelo tronco SIP';

    when 'team_invites' then
      v_porta := 'convite de equipe por e-mail';

    else
      return new;
  end case;

  if not public.fn_mia_e_demonstracao(new.organization_id) then
    return new;
  end if;

  raise exception 'organizacao_de_demonstracao: % nao existe numa empresa de demonstracao', v_porta
    using errcode = '42501',
          hint = 'Esta e a empresa de demonstracao da plataforma: nada sai dela (docs/fork/cliente-modelo.md).';
end
$f$;

comment on function public.fn_mia_trava_da_demonstracao() is
  'MIA (9010): a trava da empresa de demonstracao. Recusa (42501) fila de mensagem de saida, numero vivo, campanha e broadcast agendados, regra ativa com webhook ou aviso no grupo, aviso de caso, conversoes, agenda externa, push, ligacao e convite de equipe. Em UPDATE de messages converte a fila em failed em vez de recusar (lote do vigia).';

revoke all on function public.fn_mia_trava_da_demonstracao() from public;
revoke execute on function public.fn_mia_trava_da_demonstracao() from anon, authenticated;

drop trigger if exists trg_mia_demonstracao_nao_envia on public.messages;
create trigger trg_mia_demonstracao_nao_envia
  before insert or update of status on public.messages
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_numero on public.channel_sessions;
create trigger trg_mia_demonstracao_sem_numero
  before insert or update of archived_at, organization_id on public.channel_sessions
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_campanha on public.campaigns;
create trigger trg_mia_demonstracao_sem_campanha
  before insert or update of status, organization_id on public.campaigns
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_broadcast on public.broadcasts;
create trigger trg_mia_demonstracao_sem_broadcast
  before insert or update of status, organization_id on public.broadcasts
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_regra_de_saida on public.automation_rules;
create trigger trg_mia_demonstracao_sem_regra_de_saida
  before insert or update of is_active, actions, organization_id on public.automation_rules
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_aviso_de_caso on public.config_aviso_de_caso;
create trigger trg_mia_demonstracao_sem_aviso_de_caso
  before insert or update of ligado, organization_id on public.config_aviso_de_caso
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_conversoes on public.ad_platform_connections;
create trigger trg_mia_demonstracao_sem_conversoes
  before insert or update of enabled, organization_id on public.ad_platform_connections
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_agenda_externa on public.calendar_connections;
create trigger trg_mia_demonstracao_sem_agenda_externa
  before insert or update of organization_id on public.calendar_connections
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_push on public.push_subscriptions;
create trigger trg_mia_demonstracao_sem_push
  before insert or update of organization_id on public.push_subscriptions
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_voz on public.org_voice_calls;
create trigger trg_mia_demonstracao_sem_voz
  before insert or update of enabled, organization_id on public.org_voice_calls
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_tronco on public.voip_trunk_settings;
create trigger trg_mia_demonstracao_sem_tronco
  before insert or update of is_active, organization_id on public.voip_trunk_settings
  for each row execute function public.fn_mia_trava_da_demonstracao();

drop trigger if exists trg_mia_demonstracao_sem_convite on public.team_invites;
create trigger trg_mia_demonstracao_sem_convite
  before insert or update of organization_id on public.team_invites
  for each row execute function public.fn_mia_trava_da_demonstracao();

-- ── 4. a própria marca: quem muda, e o que ela exige ────────────────────────
create or replace function public.fn_mia_marca_de_demonstracao()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_vivos text[] := array[]::text[];
begin
  -- (a) só a plataforma marca e desmarca.
  if (tg_op = 'INSERT' and new.demonstracao)
     or (tg_op = 'UPDATE' and new.demonstracao is distinct from old.demonstracao) then
    if not public.fn_mia_escrita_da_plataforma() then
      raise exception 'organizacao_de_demonstracao: so a plataforma marca ou desmarca a empresa de demonstracao'
        using errcode = '42501';
    end if;
  end if;

  if not new.demonstracao then
    return new;
  end if;

  -- (b) a empresa de demonstração não tem grupo de avisos no WhatsApp.
  if jsonb_typeof(new.settings -> 'grupo_de_avisos') = 'object' then
    raise exception 'organizacao_de_demonstracao: grupo de avisos no WhatsApp nao existe numa empresa de demonstracao'
      using errcode = '42501',
            hint = 'Esta e a empresa de demonstracao da plataforma: nada sai dela (docs/fork/cliente-modelo.md).';
  end if;

  -- (c) marcar uma empresa que já tem destino vivo é recusado, com a lista.
  if tg_op = 'UPDATE' and not old.demonstracao then
    if exists (select 1 from public.channel_sessions s
                where s.organization_id = new.id and s.archived_at is null) then
      v_vivos := array_append(v_vivos, 'numero de WhatsApp conectado');
    end if;
    if exists (select 1 from public.campaigns c
                where c.organization_id = new.id and c.status in ('scheduled', 'running')) then
      v_vivos := array_append(v_vivos, 'campanha agendada ou enviando');
    end if;
    if exists (select 1 from public.broadcasts b
                where b.organization_id = new.id and b.status in ('agendada', 'enviando')) then
      v_vivos := array_append(v_vivos, 'broadcast agendado ou enviando');
    end if;
    if exists (select 1 from public.automation_rules r
                where r.organization_id = new.id and r.is_active
                  and jsonb_typeof(r.actions) = 'array'
                  and exists (select 1 from jsonb_array_elements(r.actions) a
                               where a ->> 'type' in ('call_webhook', 'notify_group'))) then
      v_vivos := array_append(v_vivos, 'regra de automacao ativa com webhook ou aviso no grupo');
    end if;
    if exists (select 1 from public.config_aviso_de_caso a
                where a.organization_id = new.id and a.ligado) then
      v_vivos := array_append(v_vivos, 'aviso de caso ligado');
    end if;
    if exists (select 1 from public.ad_platform_connections p
                where p.organization_id = new.id and p.enabled) then
      v_vivos := array_append(v_vivos, 'envio de conversoes ligado');
    end if;
    if exists (select 1 from public.calendar_connections k
                where k.organization_id = new.id) then
      v_vivos := array_append(v_vivos, 'agenda externa conectada');
    end if;
    if exists (select 1 from public.org_voice_calls v
                where v.organization_id = new.id and v.enabled) then
      v_vivos := array_append(v_vivos, 'ligacao pelo WhatsApp');
    end if;
    if exists (select 1 from public.voip_trunk_settings t
                where t.organization_id = new.id and t.is_active) then
      v_vivos := array_append(v_vivos, 'tronco SIP ativo');
    end if;

    if cardinality(v_vivos) > 0 then
      raise exception 'organizacao_de_demonstracao: a empresa ainda tem destino vivo (%): desligue antes de marcar',
        array_to_string(v_vivos, ', ')
        using errcode = '42501';
    end if;
  end if;

  return new;
end
$f$;

comment on function public.fn_mia_marca_de_demonstracao() is
  'MIA (9010): so a plataforma muda organizations.demonstracao; empresa de demonstracao nao tem grupo de avisos; marcar empresa com destino vivo (numero, campanha, broadcast, regra de saida, aviso de caso, conversoes, agenda externa, voz, tronco) e recusado com a lista.';

revoke all on function public.fn_mia_marca_de_demonstracao() from public;
revoke execute on function public.fn_mia_marca_de_demonstracao() from anon, authenticated;

drop trigger if exists trg_mia_marca_de_demonstracao on public.organizations;
create trigger trg_mia_marca_de_demonstracao
  before insert or update of demonstracao, settings on public.organizations
  for each row execute function public.fn_mia_marca_de_demonstracao();

-- Ao marcar: o transitório é desligado (fila de saída, push, convites).
create or replace function public.fn_mia_desliga_o_transitorio_da_demonstracao()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  update public.messages m
     set status = 'failed',
         error_code = 'organizacao_de_demonstracao',
         error_message = 'Empresa de demonstracao: nada sai daqui.'
   where m.organization_id = new.id
     and m.direction = 'outbound'
     and m.status in ('queued', 'sending');

  delete from public.push_subscriptions p where p.organization_id = new.id;

  update public.team_invites i
     set revoked_at = now()
   where i.organization_id = new.id
     and i.accepted_at is null
     and i.revoked_at is null;

  return new;
end
$f$;

comment on function public.fn_mia_desliga_o_transitorio_da_demonstracao() is
  'MIA (9010): ao marcar a empresa como demonstracao, a fila de saida vira failed (organizacao_de_demonstracao), as assinaturas de push somem e os convites pendentes sao revogados.';

revoke all on function public.fn_mia_desliga_o_transitorio_da_demonstracao() from public;
revoke execute on function public.fn_mia_desliga_o_transitorio_da_demonstracao() from anon, authenticated;

drop trigger if exists trg_mia_desliga_o_transitorio_da_demonstracao on public.organizations;
create trigger trg_mia_desliga_o_transitorio_da_demonstracao
  after update of demonstracao on public.organizations
  for each row
  when (new.demonstracao and not old.demonstracao)
  execute function public.fn_mia_desliga_o_transitorio_da_demonstracao();


-- ─── 9011 · agenda do Microsoft 365, entrega 1: conexão e ocupação ───
--
-- Espelho EXATO da migration 9011 (supabase/migrations-mia/), onde está o porquê
-- inteiro. Idempotente, como todo o apêndice. Vai antes da varredura anon, que
-- fecha o arquivo.
--
-- 9011 · agenda do Microsoft 365, entrega 1: conexão e ocupação
--
-- ── O que esta migration faz ────────────────────────────────────────────────
--
-- Quem atende conecta a agenda do Outlook (conta de trabalho do Microsoft 365
-- ou pessoal outlook.com), escolhe quais agendas de lá ocupam os horários dela,
-- e os eventos dessas agendas passam a bloquear a marcação aqui: pela tela,
-- pelo encaixe e pela IA. O desenho inteiro está em docs/fork/agenda-microsoft.md.
--
-- ── Por que tabelas NOSSAS, e não as do Google do upstream ─────────────────
--
-- Três leitores do motor do Google olham `calendar_connections` sem filtrar o
-- provedor (a renovação de token, a reserva do destino e a escolha). Uma conexão
-- Microsoft ali seria renovada no endereço do Google e publicada pela API do
-- Google. E o CHECK do provedor só aceita 'google_calendar': alargá-lo seria
-- redefinir uma constraint dele (regra 3 do docs/FORK-MIA.md). Então a conta
-- Microsoft mora ao lado, com o mesmo vocabulário:
--
--   mia_microsoft_oauth_da_plataforma   o app da instalação (espelha platform_google_oauth)
--   mia_agenda_microsoft_conexoes       a conta de cada pessoa (espelha calendar_connections)
--   mia_agenda_microsoft_calendarios    as agendas da conta, fontes e destino (espelha calendar_connection_calendars)
--   mia_agenda_microsoft_eventos        a ocupação vinda do Outlook, SEM título (espelha calendar_external_events)
--
-- ── Como a ocupação chega aos leitores dele sem mexer no SQL dele ──────────
--
-- As três leituras nossas devolvem AS MESMAS COLUNAS das dele, e o código soma
-- as duas (lib/agenda-mia/ocupacao.ts):
--
--   fn_mia_agenda_ocupacao_microsoft_do_dono  ↔ fn_agenda_ocupacao_google_do_dono
--   fn_mia_agenda_conexoes_microsoft_do_dono  ↔ fn_agenda_conexoes_google_do_dono
--   fn_mia_agenda_cobertura_microsoft         ↔ fn_google_coverage
--
-- ── Um destino por pessoa, entre Google e Microsoft ────────────────────────
--
-- A regra dele é "um destino entre todas as contas". Ela passa a valer entre os
-- provedores por gatilhos NOSSOS (extensão, nunca redefinição):
--
--   · gravar um destino Google (a escolha da pessoa) apaga o destino Microsoft;
--   · o destino AUTOMÁTICO do primeiro catálogo do Google (gravado pelo servidor,
--     sem sessão) não toma o lugar de um destino Microsoft que a pessoa já tem;
--   · a escolha pela tela da MIA (`fn_mia_agenda_selecao`) grava os dois lados
--     numa transação só.
--
-- Nomes com prefixo `mia_`/`fn_mia_`: nada do upstream é tocado.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · o app da Microsoft desta instalação
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.mia_microsoft_oauth_da_plataforma (
  id smallint primary key default 1,
  client_id text,
  client_secret_encrypted bytea,
  -- A Microsoft não deixa o segredo durar mais de 24 meses. A data é informada
  -- por quem cadastra, e a tela avisa 30 dias antes: segredo vencido derruba a
  -- renovação de todas as agendas da instalação de uma vez.
  segredo_vence_em date,
  -- `common` aceita conta de trabalho e pessoal. Um id de tenant restringe a uma
  -- empresa só.
  tenant text not null default 'common',
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint mia_microsoft_oauth_da_plataforma_linha_unica check (id = 1),
  constraint mia_microsoft_oauth_da_plataforma_tenant check (tenant ~ '^[A-Za-z0-9._-]{1,100}$')
);

comment on table public.mia_microsoft_oauth_da_plataforma is
  'MIA (9011): o app do Microsoft Entra DESTA INSTALACAO (linha unica), para a agenda do Outlook. So o servidor le: RLS ligada sem policies. O segredo e cifrado por fn_encrypt_oauth e nunca volta a tela.';

alter table public.mia_microsoft_oauth_da_plataforma enable row level security;
revoke all on public.mia_microsoft_oauth_da_plataforma from anon, authenticated;
grant select, insert, update on public.mia_microsoft_oauth_da_plataforma to service_role;

drop trigger if exists trg_mia_microsoft_oauth_da_plataforma_updated_at on public.mia_microsoft_oauth_da_plataforma;
create trigger trg_mia_microsoft_oauth_da_plataforma_updated_at
  before update on public.mia_microsoft_oauth_da_plataforma
  for each row execute function public.fn_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · a conta Microsoft de cada pessoa
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.mia_agenda_microsoft_conexoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- O e-mail da conta (mail ou userPrincipalName do /me). É da própria pessoa
  -- da equipe, não de contato.
  conta_email text not null,
  -- O id estável do usuário na Microsoft (`oid`). É a chave: o e-mail pode mudar.
  microsoft_user_id text not null,
  -- 'pessoal' quando o tenant é o das contas pessoais da Microsoft.
  tipo_de_conta text not null default 'trabalho',
  tenant_id text,
  access_token_cifrado bytea,
  refresh_token_cifrado bytea,
  token_expira_em timestamptz,
  escopos text[] not null default array[]::text[],
  -- Os mesmos sete valores de calendar_connections.status (SITUACOES_DA_CONEXAO).
  status text not null default 'connecting',
  ultima_leitura_em timestamptz,
  ultimo_erro text,
  revisao_da_escolha bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mia_agenda_microsoft_conexoes_tipo check (tipo_de_conta in ('trabalho','pessoal')),
  constraint mia_agenda_microsoft_conexoes_status check (status in (
    'connecting','healthy','token_expired','scope_missing','disconnected','rate_limited','error'
  ))
);

create unique index if not exists mia_agenda_microsoft_conexoes_conta_key
  on public.mia_agenda_microsoft_conexoes (organization_id, user_id, microsoft_user_id);
create index if not exists mia_agenda_microsoft_conexoes_renovacao_idx
  on public.mia_agenda_microsoft_conexoes (token_expira_em)
  where status in ('healthy','rate_limited') and token_expira_em is not null;

comment on table public.mia_agenda_microsoft_conexoes is
  'MIA (9011): a conta Microsoft (Outlook) que UMA pessoa conectou. Espelha calendar_connections do upstream, que so aceita o Google. Tokens cifrados por fn_encrypt_oauth; so o servidor escreve.';

drop trigger if exists trg_mia_agenda_microsoft_conexoes_updated_at on public.mia_agenda_microsoft_conexoes;
create trigger trg_mia_agenda_microsoft_conexoes_updated_at
  before update on public.mia_agenda_microsoft_conexoes
  for each row execute function public.fn_set_updated_at();

alter table public.mia_agenda_microsoft_conexoes enable row level security;
drop policy if exists mia_agenda_microsoft_conexoes_dono_ou_gerente on public.mia_agenda_microsoft_conexoes;
create policy mia_agenda_microsoft_conexoes_dono_ou_gerente on public.mia_agenda_microsoft_conexoes
  for select using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and (user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager')))
  );
revoke all on public.mia_agenda_microsoft_conexoes from anon, authenticated;
-- Coluna a coluna: os tokens, mesmo cifrados, não saem pela sessão.
grant select (id, organization_id, user_id, conta_email, tipo_de_conta, status, token_expira_em,
              ultima_leitura_em, ultimo_erro, revisao_da_escolha, created_at, updated_at)
  on public.mia_agenda_microsoft_conexoes to authenticated;
grant select, insert, update, delete on public.mia_agenda_microsoft_conexoes to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · as agendas da conta: o que ocupa, e qual recebe
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.mia_agenda_microsoft_calendarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conexao_id uuid not null references public.mia_agenda_microsoft_conexoes(id) on delete cascade,
  calendario_externo_id text not null,
  nome text not null,
  -- O calendário padrão da caixa (isDefaultCalendar). Só nele a Graph v1.0 dá
  -- leitura incremental (delta); os outros são lidos inteiros a cada rodada.
  padrao boolean not null default false,
  -- No vocabulário de papéis do Google DE PROPÓSITO: é o que a tela e as regras
  -- dele já entendem. owner = da própria pessoa com escrita; writer = com
  -- escrita; reader = só leitura (não pode ser destino).
  papel text not null default 'reader',
  disponivel boolean not null default true,
  catalogo_conferido_em timestamptz,
  conta_como_ocupado boolean not null default false,
  destino boolean not null default false,
  -- allowedOnlineMeetingProviders do calendário (teamsForBusiness etc.).
  reunioes_permitidas text[] not null default array[]::text[],
  fuso text,
  -- A leitura: reserva (claim), cursor da rodada, deltaLink e cobertura.
  reserva_token uuid,
  reserva_epoca bigint not null default 0,
  reserva_ate timestamptz,
  proxima_leitura_em timestamptz not null default now(),
  ultima_leitura_em timestamptz,
  erro_de_leitura text,
  cursor_da_leitura jsonb,
  delta_link text,
  cobertura jsonb,
  -- As notificações da Graph (assinatura por calendário).
  assinatura_id text,
  assinatura_expira_em timestamptz,
  assinatura_segredo_hash text,
  assinatura_erro text,
  ultima_notificacao_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mia_agenda_microsoft_calendarios_papel check (papel in ('owner','writer','reader'))
);

create unique index if not exists mia_agenda_microsoft_calendarios_key
  on public.mia_agenda_microsoft_calendarios (organization_id, conexao_id, calendario_externo_id);
create unique index if not exists mia_agenda_microsoft_calendarios_um_destino_key
  on public.mia_agenda_microsoft_calendarios (conexao_id)
  where destino;
create unique index if not exists mia_agenda_microsoft_calendarios_assinatura_key
  on public.mia_agenda_microsoft_calendarios (assinatura_id)
  where assinatura_id is not null;
create index if not exists mia_agenda_microsoft_calendarios_a_ler_idx
  on public.mia_agenda_microsoft_calendarios (proxima_leitura_em)
  where disponivel;

comment on table public.mia_agenda_microsoft_calendarios is
  'MIA (9011): as agendas dentro de uma conta Microsoft conectada, e o que cada uma faz: ocupar horario (conta_como_ocupado) e/ou receber o que marcamos (destino). Espelha calendar_connection_calendars do upstream. Um destino por pessoa, entre Google e Microsoft.';

drop trigger if exists trg_mia_agenda_microsoft_calendarios_updated_at on public.mia_agenda_microsoft_calendarios;
create trigger trg_mia_agenda_microsoft_calendarios_updated_at
  before update on public.mia_agenda_microsoft_calendarios
  for each row execute function public.fn_set_updated_at();

alter table public.mia_agenda_microsoft_calendarios enable row level security;
drop policy if exists mia_agenda_microsoft_calendarios_dono_ou_gerente on public.mia_agenda_microsoft_calendarios;
create policy mia_agenda_microsoft_calendarios_dono_ou_gerente on public.mia_agenda_microsoft_calendarios
  for select using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and exists (
          select 1 from public.mia_agenda_microsoft_conexoes c
           where c.id = conexao_id
             and (c.user_id = auth.uid() or public.fn_role_at_least(c.organization_id, 'manager'))
        ))
  );
revoke all on public.mia_agenda_microsoft_calendarios from anon, authenticated;
grant select (id, organization_id, conexao_id, calendario_externo_id, nome, padrao, papel, disponivel,
              catalogo_conferido_em, conta_como_ocupado, destino, reunioes_permitidas, fuso,
              ultima_leitura_em, erro_de_leitura, cobertura, assinatura_expira_em, assinatura_erro,
              ultima_notificacao_em, created_at, updated_at)
  on public.mia_agenda_microsoft_calendarios to authenticated;
grant select, insert, update, delete on public.mia_agenda_microsoft_calendarios to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · a ocupação vinda do Outlook (sem título, sem descrição, sem convidado)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.mia_agenda_microsoft_eventos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conexao_id uuid not null references public.mia_agenda_microsoft_conexoes(id) on delete cascade,
  calendario_externo_id text not null,
  evento_externo_id text not null,
  inicio timestamptz,
  fim timestamptz,
  dia_inteiro boolean not null default false,
  situacao text not null default 'confirmed',
  transparencia text not null default 'opaque',
  atualizado_la_em timestamptz,
  geracao uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mia_agenda_microsoft_eventos_situacao check (situacao in ('confirmed','tentative','cancelled')),
  constraint mia_agenda_microsoft_eventos_transparencia check (transparencia in ('opaque','transparent')),
  constraint mia_agenda_microsoft_eventos_periodo check (
    situacao = 'cancelled' or (inicio is not null and fim is not null and fim > inicio)
  )
);

create unique index if not exists mia_agenda_microsoft_eventos_key
  on public.mia_agenda_microsoft_eventos (organization_id, conexao_id, calendario_externo_id, evento_externo_id);
create index if not exists mia_agenda_microsoft_eventos_ocupam_idx
  on public.mia_agenda_microsoft_eventos (organization_id, conexao_id, inicio)
  where situacao <> 'cancelled' and transparencia = 'opaque';

comment on table public.mia_agenda_microsoft_eventos is
  'MIA (9011): espelho, somente leitura, do que ja existe nas agendas do Outlook conectadas. So ocupacao (inicio, fim, situacao, transparencia): o titulo, a descricao e os convidados do evento pessoal nunca sao guardados. Espelha calendar_external_events do upstream.';

drop trigger if exists trg_mia_agenda_microsoft_eventos_updated_at on public.mia_agenda_microsoft_eventos;
create trigger trg_mia_agenda_microsoft_eventos_updated_at
  before update on public.mia_agenda_microsoft_eventos
  for each row execute function public.fn_set_updated_at();

alter table public.mia_agenda_microsoft_eventos enable row level security;
drop policy if exists mia_agenda_microsoft_eventos_da_empresa on public.mia_agenda_microsoft_eventos;
create policy mia_agenda_microsoft_eventos_da_empresa on public.mia_agenda_microsoft_eventos
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
revoke all on public.mia_agenda_microsoft_eventos from anon, authenticated;
grant select (id, organization_id, conexao_id, calendario_externo_id, evento_externo_id, inicio, fim,
              dia_inteiro, situacao, transparencia, atualizado_la_em, created_at, updated_at)
  on public.mia_agenda_microsoft_eventos to authenticated;
grant select, insert, update, delete on public.mia_agenda_microsoft_eventos to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · o catálogo: todas as agendas da conta, com o que cada uma permite
-- ═══════════════════════════════════════════════════════════════════════════
-- Ausência só depois de todas as páginas recebidas (quem chama manda a lista
-- inteira). A primeira vez de quem ainda não tem destino em lugar NENHUM marca a
-- agenda padrão como fonte e destino, como o primeiro catálogo do Google faz.
create or replace function public.fn_mia_agenda_microsoft_catalogo(
  p_org uuid, p_conexao uuid, p_itens jsonb, p_revisao text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  conn public.mia_agenda_microsoft_conexoes;
  it jsonb;
  primeira boolean;
begin
  select * into conn from public.mia_agenda_microsoft_conexoes
   where organization_id = p_org and id = p_conexao;
  if not found then
    raise exception 'microsoft_conexao_indisponivel' using errcode = 'P0002';
  end if;
  perform 1 from public.user_organizations
   where organization_id = p_org and user_id = conn.user_id and revoked_at is null
   for update;
  if not found then
    raise exception 'microsoft_dono_indisponivel' using errcode = '42501';
  end if;
  select * into conn from public.mia_agenda_microsoft_conexoes
   where organization_id = p_org and id = p_conexao for update;
  if conn.status <> 'healthy' then
    raise exception 'microsoft_conexao_indisponivel' using errcode = '42501';
  end if;
  if conn.revisao_da_escolha::text is distinct from p_revisao then
    raise exception 'microsoft_escolha_desatualizada' using errcode = '40001';
  end if;

  primeira := conn.revisao_da_escolha = 0
    and not exists (
      select 1 from public.mia_agenda_microsoft_calendarios k
        join public.mia_agenda_microsoft_conexoes c
          on c.organization_id = k.organization_id and c.id = k.conexao_id
       where k.organization_id = p_org and c.user_id = conn.user_id and k.destino)
    and not exists (
      select 1 from public.calendar_connection_calendars k
        join public.calendar_connections c
          on c.organization_id = k.organization_id and c.id = k.connection_id
       where k.organization_id = p_org and c.user_id = conn.user_id and k.is_destination);

  for it in select value from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    insert into public.mia_agenda_microsoft_calendarios (
      organization_id, conexao_id, calendario_externo_id, nome, padrao, papel, disponivel,
      catalogo_conferido_em, reunioes_permitidas, fuso, conta_como_ocupado, destino
    ) values (
      p_org, p_conexao, it->>'id',
      coalesce(nullif(btrim(it->>'nome'), ''), it->>'id'),
      coalesce((it->>'padrao')::boolean, false),
      case when it->>'papel' in ('owner','writer','reader') then it->>'papel' else 'reader' end,
      true, now(),
      coalesce(array(select jsonb_array_elements_text(coalesce(it->'reunioes', '[]'::jsonb))), array[]::text[]),
      nullif(btrim(it->>'fuso'), ''),
      primeira and coalesce((it->>'padrao')::boolean, false),
      false
    )
    on conflict (organization_id, conexao_id, calendario_externo_id) do update set
      nome = excluded.nome,
      padrao = excluded.padrao,
      papel = excluded.papel,
      disponivel = true,
      catalogo_conferido_em = excluded.catalogo_conferido_em,
      reunioes_permitidas = excluded.reunioes_permitidas,
      fuso = coalesce(excluded.fuso, mia_agenda_microsoft_calendarios.fuso),
      proxima_leitura_em = now();
  end loop;

  update public.mia_agenda_microsoft_calendarios
     set disponivel = false, catalogo_conferido_em = now()
   where organization_id = p_org and conexao_id = p_conexao
     and not exists (
       select 1 from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) v
        where v->>'id' = calendario_externo_id);

  -- Só destino com escrita: calendário só-leitura nunca recebe compromisso.
  if primeira then
    update public.mia_agenda_microsoft_calendarios
       set destino = true
     where organization_id = p_org and conexao_id = p_conexao
       and padrao and disponivel and papel in ('owner','writer');
  end if;

  update public.mia_agenda_microsoft_conexoes
     set revisao_da_escolha = revisao_da_escolha + 1
   where organization_id = p_org and id = p_conexao;
end
$$;

comment on function public.fn_mia_agenda_microsoft_catalogo(uuid, uuid, jsonb, text) is
  'MIA (9011): grava o catalogo de agendas de uma conta Microsoft (lista inteira, com papel e reunioes permitidas). Primeira vez de quem nao tem destino em lugar nenhum: a agenda padrao vira fonte e destino. Execucao so para service_role.';
revoke all on function public.fn_mia_agenda_microsoft_catalogo(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_catalogo(uuid, uuid, jsonb, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · o evento do Outlook que é compromisso nosso (anti-eco)
-- ═══════════════════════════════════════════════════════════════════════════
-- Na 9011 ainda não publicamos nada no Outlook, então nenhum evento é nosso. A
-- 9012 (publicação) redefine esta função — que é NOSSA — para olhar o vínculo.
create or replace function public.fn_mia_agenda_microsoft_evento_e_compromisso(
  p_org uuid, p_conexao uuid, p_calendario text, p_evento text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select false;
$$;
revoke all on function public.fn_mia_agenda_microsoft_evento_e_compromisso(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_evento_e_compromisso(uuid, uuid, text, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · a leitura de um calendário: reserva, página, erro, recomeço
-- ═══════════════════════════════════════════════════════════════════════════
-- O mesmo contrato de fn_google_calendar (upstream 0225), sobre as nossas
-- tabelas. Duas diferenças, as duas da Microsoft:
--   · `delta`: só o calendário padrão tem leitura incremental na Graph v1.0. Os
--     outros fazem sempre a leitura completa da janela, e a rodada termina sem
--     deltaLink (e não é erro).
--   · o vínculo com compromisso nosso é resolvido por
--     fn_mia_agenda_microsoft_evento_e_compromisso (a 9012 dá corpo a ela).
create or replace function public.fn_mia_agenda_microsoft_calendario(
  p_org uuid, p_id uuid, p_acao text, p_args jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.mia_agenda_microsoft_calendarios;
  cur jsonb;
  it jsonb;
  ger uuid;
  completa boolean;
  proxima text;
begin
  select * into k from public.mia_agenda_microsoft_calendarios
   where organization_id = p_org and id = p_id for update;
  if not found then
    raise exception 'microsoft_calendario_inexistente' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.mia_agenda_microsoft_conexoes c
      join public.user_organizations m on m.organization_id = c.organization_id and m.user_id = c.user_id
     where c.organization_id = p_org and c.id = k.conexao_id and m.revoked_at is null and c.status = 'healthy'
  ) then
    raise exception 'microsoft_conexao_indisponivel' using errcode = '42501';
  end if;

  if p_acao = 'claim' then
    if k.reserva_ate > clock_timestamp() or not k.disponivel then
      return null;
    end if;
    cur := k.cursor_da_leitura;
    if cur is null then
      completa := not k.padrao
        or k.delta_link is null
        or k.cobertura is null
        or (k.cobertura->>'completed_at')::timestamptz < now() - interval '24 hours';
      cur := jsonb_build_object(
        'generation', gen_random_uuid(),
        'mode', case when completa then 'full' else 'incremental' end,
        'delta', k.padrao,
        'base', case when completa then null else k.delta_link end,
        'page', null,
        'window_start', case when completa then now() - interval '1 day'
                             else (k.cobertura->>'window_start')::timestamptz end,
        'window_end', case when completa then now() + interval '90 days'
                           else (k.cobertura->>'window_end')::timestamptz end
      );
    end if;
    update public.mia_agenda_microsoft_calendarios
       set reserva_token = gen_random_uuid(),
           reserva_epoca = reserva_epoca + 1,
           reserva_ate = clock_timestamp() + interval '90 seconds',
           cursor_da_leitura = cur
     where organization_id = p_org and id = p_id
     returning * into k;
  else
    if k.reserva_token is distinct from (p_args->'claim'->>'token')::uuid
       or k.reserva_epoca::text is distinct from p_args->'claim'->>'epoch'
       or k.reserva_ate is null or k.reserva_ate <= clock_timestamp()
       or (p_args ? 'cursor' and k.cursor_da_leitura is distinct from p_args->'cursor') then
      raise exception 'microsoft_stale' using errcode = '40001';
    end if;

    if p_acao = 'renew' then
      update public.mia_agenda_microsoft_calendarios
         set reserva_ate = clock_timestamp() + interval '90 seconds'
       where organization_id = p_org and id = p_id
       returning * into k;
    elsif p_acao = 'release' then
      update public.mia_agenda_microsoft_calendarios
         set reserva_token = null, reserva_ate = null
       where organization_id = p_org and id = p_id;
      return 'true'::jsonb;
    elsif p_acao = 'error' then
      update public.mia_agenda_microsoft_calendarios
         set erro_de_leitura = left(p_args->>'message', 200),
             proxima_leitura_em = now() + interval '15 minutes'
       where organization_id = p_org and id = p_id;
      return 'true'::jsonb;
    elsif p_acao = 'reset' then
      update public.mia_agenda_microsoft_calendarios
         set delta_link = null, cursor_da_leitura = null,
             erro_de_leitura = 'A ocupação está desatualizada. Reconstruindo a leitura.',
             proxima_leitura_em = now()
       where organization_id = p_org and id = p_id;
      return 'true'::jsonb;
    elsif p_acao = 'item' then
      it := p_args->'item';
      ger := (k.cursor_da_leitura->>'generation')::uuid;
      if public.fn_mia_agenda_microsoft_evento_e_compromisso(
           p_org, k.conexao_id, k.calendario_externo_id, it->>'evento_externo_id') then
        delete from public.mia_agenda_microsoft_eventos
         where organization_id = p_org and conexao_id = k.conexao_id
           and calendario_externo_id = k.calendario_externo_id
           and evento_externo_id = it->>'evento_externo_id';
        return jsonb_build_object('vinculado', true);
      end if;
      -- Apagado ou cancelado lá: sai da ocupação. Não guarda lápide: a delta
      -- também anuncia exclusões de FORA da janela, e elas nunca estiveram aqui.
      if it->>'situacao' = 'cancelled' then
        delete from public.mia_agenda_microsoft_eventos
         where organization_id = p_org and conexao_id = k.conexao_id
           and calendario_externo_id = k.calendario_externo_id
           and evento_externo_id = it->>'evento_externo_id';
        return jsonb_build_object('vinculado', false);
      end if;
      insert into public.mia_agenda_microsoft_eventos (
        organization_id, conexao_id, calendario_externo_id, evento_externo_id, inicio, fim,
        dia_inteiro, situacao, transparencia, atualizado_la_em, geracao
      ) values (
        p_org, k.conexao_id, k.calendario_externo_id, it->>'evento_externo_id',
        (it->>'inicio')::timestamptz, (it->>'fim')::timestamptz,
        coalesce((it->>'dia_inteiro')::boolean, false),
        coalesce(it->>'situacao', 'confirmed'),
        coalesce(it->>'transparencia', 'opaque'),
        (it->>'atualizado_la_em')::timestamptz,
        ger
      )
      on conflict (organization_id, conexao_id, calendario_externo_id, evento_externo_id) do update set
        inicio = coalesce(excluded.inicio, mia_agenda_microsoft_eventos.inicio),
        fim = coalesce(excluded.fim, mia_agenda_microsoft_eventos.fim),
        dia_inteiro = excluded.dia_inteiro,
        situacao = excluded.situacao,
        transparencia = excluded.transparencia,
        atualizado_la_em = excluded.atualizado_la_em,
        geracao = excluded.geracao;
      return jsonb_build_object('vinculado', false);
    elsif p_acao = 'page' then
      proxima := nullif(p_args->>'next_page', '');
      if proxima is not null then
        if proxima = k.cursor_da_leitura->>'page' then
          raise exception 'microsoft_cursor_sem_progresso' using errcode = '22023';
        end if;
        update public.mia_agenda_microsoft_calendarios
           set cursor_da_leitura = jsonb_set(cursor_da_leitura, '{page}', to_jsonb(proxima)),
               proxima_leitura_em = now()
         where organization_id = p_org and id = p_id
         returning * into k;
      else
        if coalesce((k.cursor_da_leitura->>'delta')::boolean, false)
           and coalesce(p_args->>'delta_link', '') = '' then
          raise exception 'microsoft_checkpoint_ausente' using errcode = '22023';
        end if;
        -- Leitura completa: o que não apareceu nesta geração, dentro da janela,
        -- deixou de existir lá.
        if k.cursor_da_leitura->>'mode' = 'full' then
          delete from public.mia_agenda_microsoft_eventos
           where organization_id = p_org and conexao_id = k.conexao_id
             and calendario_externo_id = k.calendario_externo_id
             and geracao is distinct from (k.cursor_da_leitura->>'generation')::uuid
             and (situacao = 'cancelled'
                  or (inicio < (k.cursor_da_leitura->>'window_end')::timestamptz
                      and fim > (k.cursor_da_leitura->>'window_start')::timestamptz));
        end if;
        update public.mia_agenda_microsoft_calendarios
           set delta_link = case when coalesce((cursor_da_leitura->>'delta')::boolean, false)
                                 then p_args->>'delta_link' else null end,
               cobertura = case when cursor_da_leitura->>'mode' = 'full'
                                then jsonb_build_object(
                                       'generation', cursor_da_leitura->'generation',
                                       'window_start', cursor_da_leitura->'window_start',
                                       'window_end', cursor_da_leitura->'window_end',
                                       'completed_at', now())
                                else cobertura end,
               cursor_da_leitura = null,
               ultima_leitura_em = now(),
               erro_de_leitura = null,
               proxima_leitura_em = now() + interval '15 minutes'
         where organization_id = p_org and id = p_id
         returning * into k;
        update public.mia_agenda_microsoft_conexoes
           set ultima_leitura_em = now(), ultimo_erro = null
         where organization_id = p_org and id = k.conexao_id;
      end if;
    else
      raise exception 'microsoft_acao_invalida' using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object(
    'id', k.id, 'organization_id', k.organization_id, 'conexao_id', k.conexao_id,
    'calendario_externo_id', k.calendario_externo_id, 'padrao', k.padrao, 'fuso', k.fuso,
    'cursor', k.cursor_da_leitura,
    'claim', jsonb_build_object('token', k.reserva_token, 'epoch', k.reserva_epoca::text, 'lease_until', k.reserva_ate)
  );
end
$$;

comment on function public.fn_mia_agenda_microsoft_calendario(uuid, uuid, text, jsonb) is
  'MIA (9011): a leitura de um calendario do Outlook, com o contrato de fn_google_calendar do upstream (reserva de 90 s, cursor retomavel, geracao, cobertura, recomeco). Leitura completa apaga o que nao reapareceu na janela. Execucao so para service_role.';
revoke all on function public.fn_mia_agenda_microsoft_calendario(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_calendario(uuid, uuid, text, jsonb) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8 · as três leituras com as colunas das do Google
-- ═══════════════════════════════════════════════════════════════════════════
-- FALHA ABERTO na ausência de catálogo, como fn_google_counts_for_conflicts: o
-- evento só deixa de contar quando alguém DECLAROU que aquela agenda não ocupa.
create or replace function public.fn_mia_agenda_ocupacao_microsoft_do_dono(
  p_org uuid, p_owner uuid, p_de timestamptz, p_ate timestamptz
)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  transparency text,
  status text,
  connection_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select e.inicio, e.fim, e.transparencia, e.situacao, c.status
    from public.mia_agenda_microsoft_eventos e
    join public.mia_agenda_microsoft_conexoes c
      on c.organization_id = e.organization_id and c.id = e.conexao_id
   where (auth.uid() is null
          or p_org in (select public.fn_user_org_ids())
          or public.fn_is_platform_admin())
     and e.organization_id = p_org
     and c.user_id = p_owner
     and e.situacao <> 'cancelled'
     and not exists (
       select 1 from public.mia_agenda_microsoft_calendarios k
        where k.organization_id = e.organization_id and k.conexao_id = e.conexao_id
          and k.calendario_externo_id = e.calendario_externo_id and not k.conta_como_ocupado)
     -- Cruzamento ESTRITO, a régua de `colide`: encostar não é ocupar.
     and e.inicio < p_ate
     and e.fim > p_de;
$$;
comment on function public.fn_mia_agenda_ocupacao_microsoft_do_dono(uuid, uuid, timestamptz, timestamptz) is
  'MIA (9011): a ocupacao do Outlook de um dono numa janela, com as MESMAS cinco colunas de fn_agenda_ocupacao_google_do_dono (upstream 0260), para o codigo somar as duas. So ocupacao, nunca titulo.';
revoke all on function public.fn_mia_agenda_ocupacao_microsoft_do_dono(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.fn_mia_agenda_ocupacao_microsoft_do_dono(uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.fn_mia_agenda_conexoes_microsoft_do_dono(p_org uuid, p_owner uuid)
returns table (
  status text,
  last_sync_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.status, c.ultima_leitura_em
    from public.mia_agenda_microsoft_conexoes c
   where (auth.uid() is null
          or p_org in (select public.fn_user_org_ids())
          or public.fn_is_platform_admin())
     and c.organization_id = p_org
     and c.user_id = p_owner;
$$;
comment on function public.fn_mia_agenda_conexoes_microsoft_do_dono(uuid, uuid) is
  'MIA (9011): a situacao das contas Microsoft de um dono, com as colunas de fn_agenda_conexoes_google_do_dono (upstream), para "tem agenda que nunca foi lida" valer tambem para o Outlook.';
revoke all on function public.fn_mia_agenda_conexoes_microsoft_do_dono(uuid, uuid) from public, anon;
grant execute on function public.fn_mia_agenda_conexoes_microsoft_do_dono(uuid, uuid) to authenticated, service_role;

create or replace function public.fn_mia_agenda_cobertura_microsoft(
  p_org uuid, p_owner uuid, p_start timestamptz, p_end timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is not null and p_org not in (select public.fn_user_org_ids()) then true
    else exists (
      select 1 from public.mia_agenda_microsoft_calendarios k
        join public.mia_agenda_microsoft_conexoes c
          on c.organization_id = k.organization_id and c.id = k.conexao_id
       where k.organization_id = p_org and c.user_id = p_owner and k.conta_como_ocupado
         and (not k.disponivel or c.status <> 'healthy' or k.cobertura is null
              or k.erro_de_leitura is not null or k.ultima_leitura_em is null
              or k.ultima_leitura_em < now() - interval '30 minutes'
              or (k.cobertura->>'window_start')::timestamptz > p_start
              or (k.cobertura->>'window_end')::timestamptz < p_end))
  end;
$$;
comment on function public.fn_mia_agenda_cobertura_microsoft(uuid, uuid, timestamptz, timestamptz) is
  'MIA (9011): verdadeiro quando alguma agenda do Outlook que conta como ocupado nao foi lida por inteiro e recentemente naquele periodo (a mesma regra de fn_google_coverage do upstream). Vira o aviso de cobertura parcial; nao bloqueia a oferta.';
revoke all on function public.fn_mia_agenda_cobertura_microsoft(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.fn_mia_agenda_cobertura_microsoft(uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9 · um destino por pessoa, entre Google e Microsoft
-- ═══════════════════════════════════════════════════════════════════════════
-- (a) O destino AUTOMÁTICO do Google (o primeiro catálogo dele, gravado pelo
--     servidor sem sessão) não toma o lugar de um destino Microsoft que a pessoa
--     já tem. A escolha da pessoa (com sessão) passa.
create or replace function public.fn_mia_destino_google_automatico_respeita_o_da_microsoft()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.is_destination then
      return new;
    end if;
  end if;
  if new.is_destination and auth.uid() is null
     and exists (
       select 1 from public.mia_agenda_microsoft_calendarios k
         join public.mia_agenda_microsoft_conexoes mc
           on mc.organization_id = k.organization_id and mc.id = k.conexao_id
         join public.calendar_connections gc
           on gc.organization_id = new.organization_id and gc.id = new.connection_id
        where k.organization_id = new.organization_id and mc.user_id = gc.user_id and k.destino)
  then
    new.is_destination := false;
  end if;
  return new;
end
$$;
revoke all on function public.fn_mia_destino_google_automatico_respeita_o_da_microsoft() from public, anon, authenticated;

drop trigger if exists trg_mia_destino_google_automatico_respeita_o_da_microsoft on public.calendar_connection_calendars;
create trigger trg_mia_destino_google_automatico_respeita_o_da_microsoft
  before insert or update of is_destination on public.calendar_connection_calendars
  for each row
  when (new.is_destination)
  execute function public.fn_mia_destino_google_automatico_respeita_o_da_microsoft();

-- (b) Destino Google gravado (por qualquer caminho que passou pela regra acima)
--     apaga o destino Microsoft da mesma pessoa.
create or replace function public.fn_mia_destino_google_apaga_o_da_microsoft()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mia_agenda_microsoft_calendarios k
     set destino = false
    from public.mia_agenda_microsoft_conexoes mc, public.calendar_connections gc
   where k.organization_id = new.organization_id
     and mc.organization_id = k.organization_id and mc.id = k.conexao_id
     and gc.organization_id = new.organization_id and gc.id = new.connection_id
     and mc.user_id = gc.user_id
     and k.destino;
  return null;
end
$$;
revoke all on function public.fn_mia_destino_google_apaga_o_da_microsoft() from public, anon, authenticated;

drop trigger if exists trg_mia_destino_google_apaga_o_da_microsoft on public.calendar_connection_calendars;
create trigger trg_mia_destino_google_apaga_o_da_microsoft
  after insert or update of is_destination on public.calendar_connection_calendars
  for each row
  when (new.is_destination)
  execute function public.fn_mia_destino_google_apaga_o_da_microsoft();

-- (c) Do lado Microsoft: um destino por pessoa entre as contas Microsoft dela, e
--     destino Microsoft apaga o destino Google. Só destino com escrita.
create or replace function public.fn_mia_destino_microsoft_unico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dono uuid;
begin
  if new.papel not in ('owner','writer') or not new.disponivel then
    raise exception 'microsoft_destino_sem_escrita' using errcode = '23514';
  end if;
  select user_id into dono from public.mia_agenda_microsoft_conexoes
   where organization_id = new.organization_id and id = new.conexao_id;

  update public.mia_agenda_microsoft_calendarios k
     set destino = false
    from public.mia_agenda_microsoft_conexoes mc
   where k.organization_id = new.organization_id
     and mc.organization_id = k.organization_id and mc.id = k.conexao_id
     and mc.user_id = dono and k.id <> new.id and k.destino;

  update public.calendar_connection_calendars k
     set is_destination = false
    from public.calendar_connections gc
   where k.organization_id = new.organization_id
     and gc.organization_id = k.organization_id and gc.id = k.connection_id
     and gc.user_id = dono and k.is_destination;
  return null;
end
$$;
revoke all on function public.fn_mia_destino_microsoft_unico() from public, anon, authenticated;

drop trigger if exists trg_mia_destino_microsoft_unico on public.mia_agenda_microsoft_calendarios;
create trigger trg_mia_destino_microsoft_unico
  after insert or update of destino on public.mia_agenda_microsoft_calendarios
  for each row
  when (new.destino)
  execute function public.fn_mia_destino_microsoft_unico();

-- ═══════════════════════════════════════════════════════════════════════════
-- 10 · a escolha: fontes e UM destino, Google e Microsoft juntos
-- ═══════════════════════════════════════════════════════════════════════════
-- Chamada pela sessão da pessoa (auth.uid()). As revisões das DUAS listas são
-- conferidas antes de gravar: quem salvou uma tela velha recebe 40001 e relê.
-- Destino Google: a escolha é gravada pela fn_google_selection DELE (as regras
-- dele valem inteiras) e o lado Microsoft só atualiza fontes e zera o destino.
-- Destino Microsoft: o lado Google recebe só as fontes, sem destino, e a revisão
-- dele sobe para a tela dele saber que mudou.
create or replace function public.fn_mia_agenda_selecao(
  p_org uuid,
  p_revisoes jsonb,
  p_fontes_google uuid[],
  p_fontes_microsoft uuid[],
  p_destino_provedor text,
  p_destino uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ator uuid := auth.uid();
  esperado jsonb;
  atual jsonb;
begin
  if ator is null or not public.fn_role_at_least(p_org, 'agent') or not public.fn_support_write_allowed(p_org) then
    raise exception 'agenda_selecao_proibida' using errcode = '42501';
  end if;
  perform 1 from public.user_organizations
   where organization_id = p_org and user_id = ator and revoked_at is null
   for update;
  if not found then
    raise exception 'agenda_dono_indisponivel' using errcode = '42501';
  end if;
  if p_destino_provedor not in ('google','microsoft') or p_destino is null then
    raise exception 'agenda_destino_indisponivel' using errcode = '42501';
  end if;

  -- As revisões do lado Microsoft.
  select coalesce(jsonb_agg(value order by value->>'connection_id'), '[]'::jsonb) into esperado
    from jsonb_array_elements(coalesce(p_revisoes->'microsoft', '[]'::jsonb));
  select coalesce(jsonb_agg(jsonb_build_object('connection_id', id, 'revision', revisao_da_escolha::text) order by id::text), '[]'::jsonb)
    into atual
    from public.mia_agenda_microsoft_conexoes
   where organization_id = p_org and user_id = ator and status <> 'disconnected';
  if atual is distinct from esperado then
    raise exception 'agenda_selecao_desatualizada' using errcode = '40001';
  end if;

  -- As fontes Microsoft: agendas da própria pessoa, legíveis.
  if exists (
    select 1 from unnest(coalesce(p_fontes_microsoft, array[]::uuid[])) f(id)
     where not exists (
       select 1 from public.mia_agenda_microsoft_calendarios k
         join public.mia_agenda_microsoft_conexoes c on c.organization_id = k.organization_id and c.id = k.conexao_id
        where k.organization_id = p_org and k.id = f.id and c.user_id = ator and c.status = 'healthy' and k.disponivel)
  ) then
    raise exception 'agenda_fonte_indisponivel' using errcode = '42501';
  end if;

  if p_destino_provedor = 'google' then
    -- Tudo do lado Google pelas regras dele, inclusive a conferência de revisão.
    perform public.fn_google_selection(p_org, coalesce(p_revisoes->'google', '[]'::jsonb),
                                       coalesce(p_fontes_google, array[]::uuid[]), p_destino);
    update public.mia_agenda_microsoft_calendarios k
       set destino = false,
           conta_como_ocupado = k.id = any(coalesce(p_fontes_microsoft, array[]::uuid[])),
           proxima_leitura_em = now()
      from public.mia_agenda_microsoft_conexoes c
     where k.organization_id = p_org and c.organization_id = p_org and c.id = k.conexao_id and c.user_id = ator;
  else
    -- As revisões do lado Google (o mesmo formato que a fn_google_selection confere).
    select coalesce(jsonb_agg(value order by value->>'connection_id'), '[]'::jsonb) into esperado
      from jsonb_array_elements(coalesce(p_revisoes->'google', '[]'::jsonb));
    select coalesce(jsonb_agg(jsonb_build_object('connection_id', id, 'revision', calendar_selection_revision::text) order by id::text), '[]'::jsonb)
      into atual
      from public.calendar_connections
     where organization_id = p_org and user_id = ator and provider = 'google_calendar';
    if atual is distinct from esperado then
      raise exception 'agenda_selecao_desatualizada' using errcode = '40001';
    end if;
    if not exists (
      select 1 from public.mia_agenda_microsoft_calendarios k
        join public.mia_agenda_microsoft_conexoes c on c.organization_id = k.organization_id and c.id = k.conexao_id
       where k.organization_id = p_org and k.id = p_destino and c.user_id = ator and c.status = 'healthy'
         and k.disponivel and k.papel in ('owner','writer')
    ) then
      raise exception 'agenda_destino_indisponivel' using errcode = '42501';
    end if;
    if exists (
      select 1 from unnest(coalesce(p_fontes_google, array[]::uuid[])) f(id)
       where not exists (
         select 1 from public.calendar_connection_calendars k
           join public.calendar_connections c on c.organization_id = k.organization_id and c.id = k.connection_id
          where k.organization_id = p_org and k.id = f.id and c.user_id = ator and c.status = 'healthy' and k.available
            and k.access_role in ('owner','writer','reader','writerWithoutPrivateAccess'))
    ) then
      raise exception 'agenda_fonte_indisponivel' using errcode = '42501';
    end if;

    update public.calendar_connection_calendars k
       set is_destination = false,
           counts_for_conflicts = k.id = any(coalesce(p_fontes_google, array[]::uuid[])),
           sync_next_attempt_at = now()
      from public.calendar_connections c
     where k.organization_id = p_org and c.organization_id = p_org and k.connection_id = c.id and c.user_id = ator;
    update public.calendar_connections
       set calendar_selection_revision = calendar_selection_revision + 1
     where organization_id = p_org and user_id = ator and provider = 'google_calendar';

    update public.mia_agenda_microsoft_calendarios k
       set destino = false
      from public.mia_agenda_microsoft_conexoes c
     where k.organization_id = p_org and c.organization_id = p_org and c.id = k.conexao_id
       and c.user_id = ator and k.destino and k.id <> p_destino;
    update public.mia_agenda_microsoft_calendarios k
       set destino = k.id = p_destino,
           conta_como_ocupado = k.id = any(coalesce(p_fontes_microsoft, array[]::uuid[])),
           proxima_leitura_em = now()
      from public.mia_agenda_microsoft_conexoes c
     where k.organization_id = p_org and c.organization_id = p_org and c.id = k.conexao_id and c.user_id = ator;
  end if;

  update public.mia_agenda_microsoft_conexoes
     set revisao_da_escolha = revisao_da_escolha + 1
   where organization_id = p_org and user_id = ator and status <> 'disconnected';
end
$$;
comment on function public.fn_mia_agenda_selecao(uuid, jsonb, uuid[], uuid[], text, uuid) is
  'MIA (9011): a escolha das agendas da pessoa, Google e Microsoft juntos: fontes (o que ocupa) e UM destino. Destino Google passa pela fn_google_selection do upstream; destino Microsoft grava o nosso e tira o destino do lado Google. Revisoes das duas listas conferidas (40001 quando a tela esta velha).';
revoke all on function public.fn_mia_agenda_selecao(uuid, jsonb, uuid[], uuid[], text, uuid) from public, anon;
grant execute on function public.fn_mia_agenda_selecao(uuid, jsonb, uuid[], uuid[], text, uuid) to authenticated;


-- ─── 9012 · os sinais do cartão do funil: a objeção aberta e quem mandou a última mensagem ───
--
-- Espelho EXATO da migration 9012 (supabase/migrations-mia/), onde está o porquê
-- inteiro. Idempotente (create or replace + revoke/grant). Vai antes da varredura
-- anon, que fecha o arquivo.
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


-- ─── 9013 · o papel do contato na empresa (decisor, financeiro, usuário…) e quem é o principal ───
--
-- Espelho EXATO da migration 9013 (supabase/migrations-mia/), onde está o porquê
-- inteiro. Idempotente. Redefine SÓ a função nossa da 0264 (a última definição
-- vale). Vai antes da varredura anon, que fecha o arquivo.
--
-- ── O que muda ──────────────────────────────────────────────────────────────
--
-- A ficha da empresa passa a listar os contatos COM PAPEL e a dizer quem é o
-- contato principal; a ficha do contato, ao vincular a pessoa a uma empresa,
-- pergunta o papel, o cargo e se ela é a principal (docs/fork/cartoes-e-fichas.md).
-- O cartão do funil mostra "Carla, sócia · decisora · +2 contatos".
--
-- Duas colunas em `contacts`, ao lado de `cargo` e `setor` (0262), no mesmo
-- desenho: o vínculo contato → empresa da MIA é `contacts.empresa_id` (uma
-- empresa por pessoa), e o que descreve a pessoa DENTRO dela mora na pessoa.
--
--   · `papel_na_empresa` — vocabulário FECHADO, o mesmo do papel num negócio
--     (lib/cartoes/papel.ts): decisor, financeiro, usuario, influenciador, outro.
--     Nulo = não informado.
--   · `principal_na_empresa` — a pessoa com quem se fala primeiro na empresa.
--
-- ⚠️ Plano v2 (fase 6): a empresa única vai para o módulo do upstream
-- (companies/company_people, N:N com cargo e decisor). Quando isso acontecer,
-- estas colunas migram para o vínculo de lá. Até lá, a MIA não tem outro lugar
-- onde guardar o papel — e a ficha da empresa precisa dele agora.
--
-- ── LGPD ────────────────────────────────────────────────────────────────────
--
-- As duas são dado pessoal profissional, como `cargo`: vão ao relatório de
-- acesso (lib/lgpd/export-collector.ts) e somem na anonimização. O gatilho NOSSO
-- `fn_mia_contato_anonimizado_limpa` (0264) passa a zerá-las, e os contatos já
-- anonimizados são limpos aqui. Vigiado por tests/unit/lgpd-as-duas-pontas.test.ts.
--
-- Constraint nova sobre coluna nova: nenhum dado antigo a violar (a coluna nasce
-- nula), então o update.sh de qualquer clone passa.

alter table public.contacts
  add column if not exists papel_na_empresa text,
  add column if not exists principal_na_empresa boolean not null default false;

alter table public.contacts drop constraint if exists contacts_papel_na_empresa_check;
alter table public.contacts
  add constraint contacts_papel_na_empresa_check
  check (papel_na_empresa is null or papel_na_empresa in ('decisor', 'financeiro', 'usuario', 'influenciador', 'outro'));

comment on column public.contacts.papel_na_empresa is
  'MIA (9013): o papel desta PESSOA na empresa dela (crm_empresas): decisor, financeiro, usuario, influenciador, outro. Nulo = nao informado. Dado pessoal profissional, como cargo.';
comment on column public.contacts.principal_na_empresa is
  'MIA (9013): esta pessoa e o contato principal da empresa dela. Dado pessoal profissional, como cargo.';

create or replace function public.fn_mia_contato_anonimizado_limpa()
  returns trigger
  language plpgsql
as $$
begin
  new.cargo := null;
  new.setor := null;
  new.empresa_id := null;
  new.papel_na_empresa := null;
  new.principal_na_empresa := false;
  new.source_metadata := '{}'::jsonb;
  new.tags := '{}'::text[];
  new.consent := '{}'::jsonb;
  new.social_identity := null;
  return new;
end$$;

comment on function public.fn_mia_contato_anonimizado_limpa() is
  'Gatilho da MIA: zera cargo, setor, empresa_id, papel_na_empresa, principal_na_empresa, source_metadata, tags, consent e social_identity quando o contato é anonimizado. Ao lado de trg_contacts_anonimizado_limpa_custom_fields (do upstream), nunca por cima.';

revoke all on function public.fn_mia_contato_anonimizado_limpa() from public;
revoke execute on function public.fn_mia_contato_anonimizado_limpa() from anon;
revoke execute on function public.fn_mia_contato_anonimizado_limpa() from authenticated;

update public.contacts
   set papel_na_empresa = null,
       principal_na_empresa = false
 where is_anonymized = true
   and (papel_na_empresa is not null or principal_na_empresa);


-- ─── 9014 · agenda do Microsoft 365, entrega 2: publicação com conflitos ───
--
-- Espelho EXATO da migration 9014 (supabase/migrations-mia/), onde está o porquê
-- inteiro. Idempotente, como todo o apêndice. Vai antes da varredura anon, que
-- fecha o arquivo.
--
-- 9014 · agenda do Microsoft 365, entrega 2: publicação com conflitos
--
-- ── O que esta migration faz ────────────────────────────────────────────────
--
-- O que se marca no CRM vai para a agenda do Outlook de quem atende (quando o
-- destino dela é uma agenda do Outlook), e o que muda lá volta: remarcar ou
-- cancelar no Outlook remarca ou cancela aqui, com a atividade no negócio. Quando
-- os dois lados mudaram, vira decisão humana, como no Google do upstream.
-- Desenho: docs/fork/agenda-microsoft.md, 3.8 e 4.3.
--
-- ── Por que um espelho NOSSO do compromisso ────────────────────────────────
--
-- O vínculo do upstream mora em colunas `google_*` de `calendar_appointments`, e
-- o motor dele (`fn_google_appointment`) publica no destino da pessoa de QUALQUER
-- conexão. O compromisso que vai para o Outlook tem o vínculo dele em
-- `mia_agenda_microsoft_compromissos` (1:1 com o compromisso), e a máquina de
-- reserva e efetivação é nossa (`fn_mia_agenda_microsoft_compromisso`), com o
-- mesmo contrato da dele: reserva de 90 s com época, revisão do domínio e
-- revisão local conferidas em toda ação, escrita pendente como intenção (nunca
-- recibo), base da comparação de três vias por hash (sem dado pessoal).
--
-- A revisão local é a `google_local_revision` que o gatilho DELE já sobe a cada
-- mudança de horário, situação, título, descrição, local ou convidado: lida,
-- nunca escrita. O espelho guarda a revisão que publicou.
--
-- A volta usa a `fn_appointment_change` pública dele (como servidor), que já
-- cancela os follow-ups presos à revisão antiga e fecha os avisos da Central.
--
-- Os já publicados continuam onde estão: compromisso que já está no Google
-- (`google_event_id`) não é publicado no Outlook. Só compromisso de pé e futuro
-- é publicado: mandar o histórico da pessoa para o Outlook dela mandaria convite
-- de reunião passada para cliente.
--
-- Nomes com prefixo `mia_`/`fn_mia_`: nada do upstream é redefinido.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · o vínculo compromisso ↔ evento do Outlook
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.mia_agenda_microsoft_compromissos (
  appointment_id uuid primary key references public.calendar_appointments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conexao_id uuid references public.mia_agenda_microsoft_conexoes(id) on delete set null,
  calendario_externo_id text,
  -- O id IMUTÁVEL do evento (Prefer IdType="ImmutableId"). Nulo até a criação:
  -- quem escolhe o id é a Microsoft.
  evento_id text,
  -- O `transactionId` do POST: a Graph descarta a criação repetida.
  transacao_id uuid not null default gen_random_uuid(),
  etag text,
  base jsonb,
  conflito jsonb,
  escrita_pendente jsonb,
  reserva_token uuid,
  reserva_epoca bigint not null default 0,
  reserva_ate timestamptz,
  revisao_publicada bigint not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  erro text,
  sincronizado_em timestamptz,
  -- A reunião do Teams (entrega 3, migration 9015).
  teams_pedido boolean not null default false,
  teams_estado text not null default 'nao_pedido',
  teams_erro text,
  teams_tentativas integer not null default 0,
  teams_pronto_em timestamptz,
  -- A autorização de entrega do link dada na marcação pela IA (entrega 3).
  entrega_da_ia jsonb,
  entrega_armada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mia_agenda_microsoft_compromissos_teams_estado check (
    teams_estado in ('nao_pedido','pendente','pronto','falhou','cancelado')
  ),
  constraint mia_agenda_microsoft_compromissos_teams_erro check (
    teams_erro is null or teams_erro in ('microsoft_falhou','nao_permite','desconhecido','invalido','destino_google','sem_destino')
  )
);

create unique index if not exists mia_agenda_microsoft_compromissos_evento_key
  on public.mia_agenda_microsoft_compromissos (organization_id, conexao_id, calendario_externo_id, evento_id)
  where evento_id is not null;
create index if not exists mia_agenda_microsoft_compromissos_a_fazer_idx
  on public.mia_agenda_microsoft_compromissos (proxima_tentativa_em)
  where conexao_id is not null;

comment on table public.mia_agenda_microsoft_compromissos is
  'MIA (9014): o vinculo de um compromisso com o evento dele no Outlook (1:1), e o estado da sincronizacao: base da comparacao de tres vias por hash, conflito, escrita pendente, reserva e a revisao local publicada. Espelha as colunas google_* de calendar_appointments do upstream. Nenhum dado pessoal: o horario e o texto ficam no compromisso.';

drop trigger if exists trg_mia_agenda_microsoft_compromissos_updated_at on public.mia_agenda_microsoft_compromissos;
create trigger trg_mia_agenda_microsoft_compromissos_updated_at
  before update on public.mia_agenda_microsoft_compromissos
  for each row execute function public.fn_set_updated_at();

alter table public.mia_agenda_microsoft_compromissos enable row level security;
drop policy if exists mia_agenda_microsoft_compromissos_da_empresa on public.mia_agenda_microsoft_compromissos;
create policy mia_agenda_microsoft_compromissos_da_empresa on public.mia_agenda_microsoft_compromissos
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
revoke all on public.mia_agenda_microsoft_compromissos from anon, authenticated;
-- A autorização de entrega (fronteira do atendimento) e a reserva ficam fora.
grant select (appointment_id, organization_id, conexao_id, calendario_externo_id, evento_id, etag, conflito,
              revisao_publicada, erro, sincronizado_em, teams_pedido, teams_estado, teams_erro,
              teams_pronto_em, created_at, updated_at)
  on public.mia_agenda_microsoft_compromissos to authenticated;
grant select, insert, update, delete on public.mia_agenda_microsoft_compromissos to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · o anti-eco ganha corpo (a função é NOSSA, da 9011)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_mia_agenda_microsoft_evento_e_compromisso(
  p_org uuid, p_conexao uuid, p_calendario text, p_evento text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.mia_agenda_microsoft_compromissos
     where organization_id = p_org and conexao_id = p_conexao
       and calendario_externo_id = p_calendario and evento_id = p_evento
  );
$$;
revoke all on function public.fn_mia_agenda_microsoft_evento_e_compromisso(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_evento_e_compromisso(uuid, uuid, text, text) to service_role;

-- O tipo do compromisso é reunião do Teams? Na 9014 nenhum é; a 9015 (Teams)
-- redefine esta função, que é NOSSA.
create or replace function public.fn_mia_agenda_tipo_e_teams(p_org uuid, p_tipo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select false;
$$;
revoke all on function public.fn_mia_agenda_tipo_e_teams(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_tipo_e_teams(uuid, uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · mudança no compromisso põe o vínculo na frente da fila
-- ═══════════════════════════════════════════════════════════════════════════
-- O gatilho dele sobe `google_local_revision` e rearma o prazo do Google; este,
-- nosso, rearma o do Outlook. Sem ele, uma remarcação feita aqui esperaria a
-- próxima releitura (até 15 min) para chegar ao Outlook.
create or replace function public.fn_mia_agenda_microsoft_compromisso_mudou()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mia_agenda_microsoft_compromissos
     set proxima_tentativa_em = now()
   where appointment_id = new.id and organization_id = new.organization_id
     and proxima_tentativa_em > now();
  return null;
end
$$;
revoke all on function public.fn_mia_agenda_microsoft_compromisso_mudou() from public, anon, authenticated;

drop trigger if exists trg_mia_agenda_microsoft_compromisso_mudou on public.calendar_appointments;
create trigger trg_mia_agenda_microsoft_compromisso_mudou
  after update of google_local_revision, status on public.calendar_appointments
  for each row
  when (new.google_local_revision is distinct from old.google_local_revision or new.status is distinct from old.status)
  execute function public.fn_mia_agenda_microsoft_compromisso_mudou();

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · quem a rotina de publicação pega
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_mia_agenda_microsoft_a_publicar(p_limite integer default 50)
returns table (id uuid, organization_id uuid, user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.organization_id, a.owner_user_id
    from public.calendar_appointments a
    left join public.mia_agenda_microsoft_compromissos m on m.appointment_id = a.id
   where a.owner_user_id is not null
     and not exists (
       select 1 from public.contacts c
        where c.organization_id = a.organization_id and c.id = a.contact_id and c.is_anonymized)
     and (
       -- (a) Nunca publicado em lugar nenhum, de pé e futuro, e o destino de
       --     quem atende é uma agenda do Outlook.
       ((m.appointment_id is null or (m.conexao_id is null and m.proxima_tentativa_em <= now()))
        and a.google_event_id is null
        and a.status in ('pending','confirmed')
        and a.ends_at > now()
        and exists (
          select 1 from public.mia_agenda_microsoft_calendarios k
            join public.mia_agenda_microsoft_conexoes c
              on c.organization_id = k.organization_id and c.id = k.conexao_id
           where k.organization_id = a.organization_id and c.user_id = a.owner_user_id
             and k.destino and c.status = 'healthy'))
       -- (b) Já é do Outlook e há o que fazer: mudança daqui, releitura
       --     periódica do que ainda não passou, decisão de conflito registrada.
       or (m.conexao_id is not null and m.proxima_tentativa_em <= now()
           and (m.conflito is null or m.conflito ? 'resolution')
           and (a.ends_at > now() - interval '1 day' or a.google_local_revision > m.revisao_publicada))
     )
   order by coalesce(m.proxima_tentativa_em, a.created_at)
   limit greatest(1, least(coalesce(p_limite, 50), 200));
$$;
revoke all on function public.fn_mia_agenda_microsoft_a_publicar(integer) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_a_publicar(integer) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5 · a máquina de reserva e efetivação (o contrato de fn_google_appointment)
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_mia_agenda_microsoft_compromisso(
  p_org uuid, p_id uuid, p_acao text, p_args jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.calendar_appointments;
  m public.mia_agenda_microsoft_compromissos;
  k public.mia_agenda_microsoft_calendarios;
  contato uuid;
  reserva jsonb := p_args->'claim';
  r jsonb;
  remoto jsonb;
  mudou boolean;
  aceito boolean;
  revisao_nova bigint;
  teams boolean;
begin
  select contact_id into contato from public.calendar_appointments where organization_id = p_org and id = p_id;
  if not found then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;
  if contato is not null then
    perform public.fn_service_lock(p_org, contato);
  end if;
  select * into a from public.calendar_appointments where organization_id = p_org and id = p_id for update;
  if a.contact_id is distinct from contato then
    raise exception 'appointment_stale' using errcode = '40001';
  end if;
  if contato is not null and exists (
    select 1 from public.contacts where organization_id = p_org and id = contato and is_anonymized
  ) then
    if p_acao = 'claim' then
      return jsonb_build_object('terminal', 'redacted');
    end if;
    raise exception 'microsoft_contato_anonimizado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.user_organizations
     where organization_id = p_org and user_id = a.owner_user_id and revoked_at is null
  ) then
    raise exception 'microsoft_dono_indisponivel' using errcode = '42501';
  end if;

  select * into m from public.mia_agenda_microsoft_compromissos
   where appointment_id = p_id and organization_id = p_org for update;

  if p_acao = 'claim' then
    if found and m.reserva_ate > clock_timestamp() then
      return null;
    end if;
    if m.appointment_id is null or m.conexao_id is null then
      -- Nunca publicado: reserva o destino do Outlook de quem atende.
      if a.status not in ('pending','confirmed') or a.google_event_id is not null then
        return null;
      end if;
      select k2.* into k
        from public.mia_agenda_microsoft_calendarios k2
        join public.mia_agenda_microsoft_conexoes c
          on c.organization_id = k2.organization_id and c.id = k2.conexao_id
       where k2.organization_id = p_org and c.user_id = a.owner_user_id and k2.destino;
      if not found then
        return null;
      end if;
      teams := public.fn_mia_agenda_tipo_e_teams(p_org, a.event_type_id);
      if not k.disponivel or k.papel not in ('owner','writer') then
        insert into public.mia_agenda_microsoft_compromissos (appointment_id, organization_id, erro, proxima_tentativa_em)
        values (p_id, p_org, 'A agenda de destino no Outlook não permite publicação. Confira em Suas agendas.', now() + interval '15 minutes')
        on conflict (appointment_id) do update set erro = excluded.erro, proxima_tentativa_em = excluded.proxima_tentativa_em;
        return null;
      end if;
      insert into public.mia_agenda_microsoft_compromissos (
        appointment_id, organization_id, conexao_id, calendario_externo_id, escrita_pendente,
        teams_pedido, teams_estado, teams_erro
      ) values (
        p_id, p_org, k.conexao_id, k.calendario_externo_id, '{"reserva":true}'::jsonb,
        teams, case when teams then 'pendente' else 'nao_pedido' end, null
      )
      on conflict (appointment_id) do update set
        conexao_id = excluded.conexao_id,
        calendario_externo_id = excluded.calendario_externo_id,
        escrita_pendente = excluded.escrita_pendente,
        teams_pedido = excluded.teams_pedido or mia_agenda_microsoft_compromissos.teams_pedido,
        teams_estado = case when excluded.teams_pedido or mia_agenda_microsoft_compromissos.teams_pedido
                            then 'pendente' else 'nao_pedido' end,
        teams_erro = null,
        erro = null
      returning * into m;
    end if;
    update public.mia_agenda_microsoft_compromissos
       set reserva_token = gen_random_uuid(),
           reserva_epoca = reserva_epoca + 1,
           reserva_ate = clock_timestamp() + interval '90 seconds'
     where appointment_id = p_id
     returning * into m;
  else
    if m.appointment_id is null
       or m.reserva_token is distinct from (reserva->>'token')::uuid
       or m.reserva_epoca::text is distinct from reserva->>'epoch'
       or m.reserva_ate is null or m.reserva_ate <= clock_timestamp() then
      raise exception 'microsoft_stale' using errcode = '40001';
    end if;

    if p_acao = 'release' then
      update public.mia_agenda_microsoft_compromissos
         set reserva_token = null, reserva_ate = null
       where appointment_id = p_id;
      return 'true'::jsonb;
    end if;

    if a.revision::text is distinct from p_args->>'revision'
       or a.google_local_revision::text is distinct from p_args->>'local_revision'
       or m.evento_id is distinct from p_args->>'event_id'
       or m.conexao_id::text is distinct from p_args->>'connection_id'
       or m.calendario_externo_id is distinct from p_args->>'calendar_id' then
      raise exception 'microsoft_stale' using errcode = '40001';
    end if;

    if p_acao = 'renew' then
      if not exists (
        select 1 from public.mia_agenda_microsoft_conexoes c
          join public.mia_agenda_microsoft_calendarios k2
            on k2.organization_id = c.organization_id and k2.conexao_id = c.id
         where c.organization_id = p_org and c.id = m.conexao_id and c.user_id = a.owner_user_id
           and c.status = 'healthy' and k2.calendario_externo_id = m.calendario_externo_id
           and k2.disponivel and k2.papel in ('owner','writer')
      ) then
        raise exception 'microsoft_conexao_indisponivel' using errcode = '42501';
      end if;
      update public.mia_agenda_microsoft_compromissos
         set reserva_ate = clock_timestamp() + interval '90 seconds'
       where appointment_id = p_id
       returning * into m;
    elsif p_acao = 'error' then
      update public.mia_agenda_microsoft_compromissos
         set erro = left(p_args->>'message', 200),
             proxima_tentativa_em = now() + interval '15 minutes'
       where appointment_id = p_id;
      return 'true'::jsonb;
    elsif p_acao = 'idle' then
      update public.mia_agenda_microsoft_compromissos
         set proxima_tentativa_em = now() + interval '15 minutes'
       where appointment_id = p_id;
      return 'true'::jsonb;
    elsif p_acao = 'prepare' then
      if (m.escrita_pendente is not null and m.escrita_pendente <> '{"reserva":true}'::jsonb)
         or m.conflito is not null then
        raise exception 'microsoft_escrita_indisponivel' using errcode = '40001';
      end if;
      update public.mia_agenda_microsoft_compromissos
         set escrita_pendente = p_args->'operation'
       where appointment_id = p_id;
      return 'true'::jsonb;
    elsif p_acao = 'commit' then
      r := p_args->'result';
      remoto := r->'remote';
      revisao_nova := a.google_local_revision;
      if r ? 'operation_id' and m.escrita_pendente->>'operation_id' is distinct from r->>'operation_id' then
        raise exception 'microsoft_stale' using errcode = '40001';
      end if;
      if r ? 'apply_remote' then
        if a.status not in ('pending','confirmed') then
          raise exception 'microsoft_outcome_protected' using errcode = '40001';
        end if;
        -- Remarcar em cima de outro compromisso de quem atende não é aplicado:
        -- vira conflito para uma pessoa decidir.
        if not coalesce((remoto->>'cancelled')::boolean, false) and exists (
          select 1 from public.calendar_appointments outro
           where outro.organization_id = p_org and outro.owner_user_id = a.owner_user_id and outro.id <> a.id
             and outro.status in ('pending','confirmed')
             and outro.starts_at < (remoto->>'ends_at')::timestamptz
             and outro.ends_at > (remoto->>'starts_at')::timestamptz
        ) then
          return jsonb_build_object('overlap', true);
        end if;
        mudou := row(a.starts_at, a.ends_at, a.status = 'cancelled') is distinct from
                 row((remoto->>'starts_at')::timestamptz, (remoto->>'ends_at')::timestamptz,
                     coalesce((remoto->>'cancelled')::boolean, false));
        if mudou then
          perform public.fn_appointment_change(
            p_org, p_id, a.revision,
            jsonb_build_object('starts_at', remoto->>'starts_at', 'ends_at', remoto->>'ends_at')
            || case when coalesce((remoto->>'cancelled')::boolean, false)
                    then '{"status":"cancelled","cancellation_reason":"Cancelado no Outlook"}'::jsonb
                    else '{}'::jsonb end
          );
          insert into public.crm_lead_activities (organization_id, lead_id, contact_id, type, source_module, source_id, actor_kind, reason, payload)
          select p_org, l.lead_id, a.contact_id,
                 case when coalesce((remoto->>'cancelled')::boolean, false) then 'appointment_cancelled' else 'appointment_rescheduled' end,
                 'agenda', p_id, 'system',
                 case when coalesce((remoto->>'cancelled')::boolean, false) then 'Cancelado no Outlook' else 'Remarcado no Outlook' end,
                 jsonb_build_object('origin', 'outlook', 'appointment_id', p_id, 'resolution_actor_id', m.conflito->'resolution'->>'actor_id')
            from public.crm_lead_links l
           where l.organization_id = p_org and l.target_id = p_id and l.target_kind = 'appointment'
           group by l.lead_id;
          select * into a from public.calendar_appointments where organization_id = p_org and id = p_id;
          revisao_nova := a.google_local_revision;
        end if;
      end if;
      aceito := coalesce((r->>'ack')::boolean, false);
      update public.mia_agenda_microsoft_compromissos set
        base = case when r ? 'base' then r->'base' else base end,
        etag = case when r ? 'etag' then r->>'etag' else etag end,
        evento_id = case when r ? 'event_id' and r->>'event_id' is not null then r->>'event_id' else evento_id end,
        conflito = case when r ? 'conflict' then nullif(r->'conflict', 'null'::jsonb) else conflito end,
        escrita_pendente = case
          when coalesce((r->>'retry_creation')::boolean, false) and base is null and escrita_pendente->>'method' = 'POST'
            then '{"reserva":true}'::jsonb
          when coalesce((r->>'clear_pending')::boolean, false) then null
          else escrita_pendente end,
        revisao_publicada = case when aceito then revisao_nova else revisao_publicada end,
        sincronizado_em = case when aceito then now() else sincronizado_em end,
        erro = null,
        proxima_tentativa_em = now() + interval '5 minutes'
       where appointment_id = p_id
       returning * into m;
    else
      raise exception 'microsoft_acao_invalida' using errcode = '22023';
    end if;
  end if;

  select k2.* into k from public.mia_agenda_microsoft_calendarios k2
   where k2.organization_id = p_org and k2.conexao_id = m.conexao_id
     and k2.calendario_externo_id = m.calendario_externo_id;
  return jsonb_build_object(
    'appointment', jsonb_build_object(
      'id', a.id, 'organization_id', a.organization_id, 'owner_user_id', a.owner_user_id,
      'contact_id', a.contact_id, 'event_type_id', a.event_type_id, 'title', a.title,
      'description', a.description, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
      'time_zone', a.time_zone, 'status', a.status, 'location_kind', a.location_kind,
      'location_details', a.location_details, 'meeting_url', a.meeting_url,
      'guest_email', a.guest_email, 'revision', a.revision::text,
      'local_revision', a.google_local_revision::text, 'google_event_id', a.google_event_id
    ),
    'mirror', jsonb_build_object(
      'connection_id', m.conexao_id, 'calendar_id', m.calendario_externo_id, 'event_id', m.evento_id,
      'transaction_id', m.transacao_id, 'etag', m.etag, 'base', m.base, 'conflict', m.conflito,
      'pending', m.escrita_pendente, 'published_revision', m.revisao_publicada::text,
      'teams_requested', m.teams_pedido, 'teams_state', m.teams_estado, 'teams_attempts', m.teams_tentativas
    ),
    'meeting_providers', to_jsonb(coalesce(k.reunioes_permitidas, array[]::text[])),
    'claim', jsonb_build_object('token', m.reserva_token, 'epoch', m.reserva_epoca::text, 'lease_until', m.reserva_ate)
  );
end
$$;
comment on function public.fn_mia_agenda_microsoft_compromisso(uuid, uuid, text, jsonb) is
  'MIA (9014): a reserva e a efetivacao da publicacao de um compromisso no Outlook, com o contrato de fn_google_appointment do upstream (reserva de 90 s, revisoes conferidas, escrita pendente como intencao, volta pela fn_appointment_change com atividade "Remarcado no Outlook"/"Cancelado no Outlook"). Execucao so para service_role.';
revoke all on function public.fn_mia_agenda_microsoft_compromisso(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_compromisso(uuid, uuid, text, jsonb) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6 · a decisão de conflito, pela pessoa responsável
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_mia_agenda_microsoft_resolver(
  p_org uuid, p_id uuid, p_revision text, p_local_revision text, p_etag text, p_escolha text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.calendar_appointments;
  m public.mia_agenda_microsoft_compromissos;
  contato uuid;
begin
  if auth.uid() is null or not public.fn_role_at_least(p_org, 'agent') or not public.fn_support_write_allowed(p_org) then
    raise exception 'microsoft_decisao_proibida' using errcode = '42501';
  end if;
  select contact_id into contato from public.calendar_appointments where organization_id = p_org and id = p_id;
  if contato is not null then
    perform public.fn_service_lock(p_org, contato);
  end if;
  select * into a from public.calendar_appointments where organization_id = p_org and id = p_id for update;
  if not found or a.owner_user_id is distinct from auth.uid() then
    raise exception 'microsoft_decisao_proibida' using errcode = '42501';
  end if;
  select * into m from public.mia_agenda_microsoft_compromissos
   where appointment_id = p_id and organization_id = p_org for update;
  if not found then
    raise exception 'microsoft_decisao_proibida' using errcode = '42501';
  end if;
  if a.revision::text is distinct from p_revision
     or a.google_local_revision::text is distinct from p_local_revision
     or m.etag is distinct from p_etag then
    raise exception 'microsoft_stale' using errcode = '40001';
  end if;
  if p_escolha = 'retry' then
    if m.conflito is not null then
      raise exception 'microsoft_conflito_pede_escolha' using errcode = '40001';
    end if;
    update public.mia_agenda_microsoft_compromissos set proxima_tentativa_em = now() where appointment_id = p_id;
  else
    if p_escolha not in ('outlook','local','preserve_remote') or m.conflito is null then
      raise exception 'microsoft_escolha_invalida' using errcode = '22023';
    end if;
    update public.mia_agenda_microsoft_compromissos
       set conflito = conflito || jsonb_build_object('resolution', jsonb_build_object('choice', p_escolha, 'actor_id', auth.uid())),
           proxima_tentativa_em = now()
     where appointment_id = p_id;
  end if;
end
$$;
comment on function public.fn_mia_agenda_microsoft_resolver(uuid, uuid, text, text, text, text) is
  'MIA (9014): a pessoa responsavel decide o conflito de um compromisso com o Outlook (usar o do Outlook, manter o daqui, preservar os campos do Outlook) ou pede nova tentativa. Revisoes e etag conferidos: a decisao vale para a comparacao que ela viu.';
revoke all on function public.fn_mia_agenda_microsoft_resolver(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.fn_mia_agenda_microsoft_resolver(uuid, uuid, text, text, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7 · LGPD: anonimizar o contato para a sincronização do compromisso
-- ═══════════════════════════════════════════════════════════════════════════
-- A redação DELE (`fn_redigir_agenda_do_contato_anonimizado`) já limpa o
-- compromisso (título, descrição, local, link). Este gatilho, nosso, limpa o
-- estado da sincronização com o Outlook, como o `fn_google_redact_contact` faz
-- com as colunas google_*.
create or replace function public.fn_mia_agenda_microsoft_redige_contato()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mia_agenda_microsoft_compromissos m
     set base = null, conflito = null, escrita_pendente = null, etag = null,
         reserva_token = null, reserva_ate = null, reserva_epoca = m.reserva_epoca + 1,
         entrega_da_ia = null,
         erro = 'Contato anonimizado. Sincronização interrompida.'
    from public.calendar_appointments a
   where a.organization_id = new.organization_id and a.contact_id = new.id
     and m.appointment_id = a.id;
  return new;
end
$$;
revoke all on function public.fn_mia_agenda_microsoft_redige_contato() from public, anon, authenticated;

drop trigger if exists trg_mia_agenda_microsoft_redige_contato on public.contacts;
create trigger trg_mia_agenda_microsoft_redige_contato
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true)
  execute function public.fn_mia_agenda_microsoft_redige_contato();


-- ─── 9015 · agenda do Microsoft 365, entrega 3: Microsoft Teams ───
--
-- Espelho EXATO da migration 9015 (supabase/migrations-mia/), onde está o porquê
-- inteiro. Idempotente, como todo o apêndice. Vai antes da varredura anon, que
-- fecha o arquivo.
--
-- 9015 · agenda do Microsoft 365, entrega 3: Microsoft Teams
--
-- ── O que esta migration faz ────────────────────────────────────────────────
--
-- "Microsoft Teams" passa a ser um "onde acontece" do tipo de agendamento. Ao
-- publicar no Outlook um compromisso desse tipo, a reunião é criada no próprio
-- evento, o link vai para `calendar_appointments.meeting_url` e, quando foi a IA
-- que marcou numa conversa, o link é entregue ao cliente pelo WhatsApp pela
-- MESMA máquina de entrega do upstream (genérica desde a 0366). Desenho:
-- docs/fork/agenda-microsoft.md, 3.6 e 3.7.
--
-- ── Por que o Teams é um "Link de vídeo" marcado, e não um local novo ──────
--
-- O local é fechado por CHECK do upstream em `calendar_event_types` e
-- `calendar_appointments`; acrescentar `microsoft_teams` seria redefinir as
-- constraints dele (regra 3 do docs/FORK-MIA.md). O Teams É um link de vídeo:
-- o tipo fica `video_link` com `location_details = 'Microsoft Teams'`, e a marca
-- mora em `mia_agenda_tipos_com_teams`. Tudo o que o upstream mostra de "link de
-- vídeo" passa a mostrar o Teams, sem mexer nele.
--
-- ── Por que a entrega do link é ARMADA aqui, e não na marcação ─────────────
--
-- A entrega dele só ESPERA o link quando o local é `google_meet`; para
-- `video_link` ela enfileira na hora e mandaria a mensagem sem o link. Então a
-- marcação pela IA guarda a autorização no nosso espelho (`entrega_da_ia`) e
-- `fn_mia_agenda_microsoft_teams` arma `meeting_delivery` quando o link fica
-- pronto. Daí em diante é a máquina DELE: ela confere se o atendimento ainda é
-- o mesmo (senão marca `stale` e avisa na Central), respeita opt-out, LGPD,
-- janela e limites do canal.
--
-- Nomes com prefixo `mia_`/`fn_mia_`: nada do upstream é redefinido.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1 · quais tipos de agendamento são reunião do Teams
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.mia_agenda_tipos_com_teams (
  event_type_id uuid primary key references public.calendar_event_types(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.mia_agenda_tipos_com_teams is
  'MIA (9015): os tipos de agendamento "Link de video" que sao reuniao do Microsoft Teams. A publicacao no Outlook pede a reuniao no evento e grava o link em calendar_appointments.meeting_url. Existe porque o CHECK do local e do upstream.';

alter table public.mia_agenda_tipos_com_teams enable row level security;
drop policy if exists mia_agenda_tipos_com_teams_da_empresa on public.mia_agenda_tipos_com_teams;
create policy mia_agenda_tipos_com_teams_da_empresa on public.mia_agenda_tipos_com_teams
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
revoke all on public.mia_agenda_tipos_com_teams from anon, authenticated;
grant select on public.mia_agenda_tipos_com_teams to authenticated;
grant select, insert, update, delete on public.mia_agenda_tipos_com_teams to service_role;

-- A função da 9014 (NOSSA) ganha corpo.
create or replace function public.fn_mia_agenda_tipo_e_teams(p_org uuid, p_tipo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_tipo is not null and exists (
    select 1 from public.mia_agenda_tipos_com_teams
     where organization_id = p_org and event_type_id = p_tipo
  );
$$;
revoke all on function public.fn_mia_agenda_tipo_e_teams(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_tipo_e_teams(uuid, uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2 · o que a publicação observou da reunião, e a entrega armada
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.fn_mia_agenda_microsoft_teams(p_org uuid, p_id uuid, p_args jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.calendar_appointments;
  m public.mia_agenda_microsoft_compromissos;
  r jsonb := p_args->'result';
  contato uuid;
begin
  select contact_id into contato from public.calendar_appointments where organization_id = p_org and id = p_id;
  if contato is not null then
    perform public.fn_service_lock(p_org, contato);
  end if;
  select * into a from public.calendar_appointments where organization_id = p_org and id = p_id for update;
  select * into m from public.mia_agenda_microsoft_compromissos where appointment_id = p_id and organization_id = p_org for update;
  if a.id is null or m.appointment_id is null
     or m.reserva_token is distinct from (p_args->'claim'->>'token')::uuid
     or m.reserva_epoca::text is distinct from p_args->'claim'->>'epoch'
     or m.reserva_ate is null or m.reserva_ate <= clock_timestamp()
     or a.revision::text is distinct from p_args->>'revision'
     or a.google_local_revision::text is distinct from p_args->>'local_revision' then
    raise exception 'microsoft_stale' using errcode = '40001';
  end if;
  if not m.teams_pedido or a.status = 'cancelled' then
    return;
  end if;

  if r->>'estado' = 'pronto' then
    if coalesce(r->>'url', '') !~ '^https://teams[.](microsoft|live)[.]com/' then
      raise exception 'microsoft_teams_link_invalido' using errcode = '22023';
    end if;
    update public.mia_agenda_microsoft_compromissos
       set teams_estado = 'pronto', teams_erro = null, teams_pronto_em = coalesce(teams_pronto_em, now())
     where appointment_id = p_id;
    -- O link vai para o compromisso: tudo o que o upstream mostra e manda de
    -- "link de vídeo" passa a ser o Teams.
    update public.calendar_appointments
       set meeting_url = r->>'url'
     where organization_id = p_org and id = p_id and location_kind = 'video_link'
       and meeting_url is distinct from r->>'url';
    -- A entrega autorizada pela IA na marcação, armada agora que há link.
    if m.entrega_da_ia is not null and m.entrega_armada_em is null and a.status in ('pending','confirmed') then
      update public.calendar_appointments
         set meeting_delivery = jsonb_build_object(
               'state', 'waiting_for_link',
               'generation', gen_random_uuid(),
               'service_boundary', m.entrega_da_ia->'service_boundary',
               'source_operation_id', m.entrega_da_ia->'source_operation_id',
               'authorized_by', m.entrega_da_ia->'authorized_by')
       where organization_id = p_org and id = p_id
         and coalesce(meeting_delivery->>'state', 'none') = 'none';
      update public.mia_agenda_microsoft_compromissos set entrega_armada_em = now() where appointment_id = p_id;
    end if;
  elsif r->>'estado' = 'pendente' then
    update public.mia_agenda_microsoft_compromissos
       set teams_tentativas = teams_tentativas + 1
     where appointment_id = p_id;
  elsif r->>'estado' = 'falhou' then
    if coalesce(r->>'erro', '') not in ('microsoft_falhou','nao_permite','desconhecido','invalido') then
      raise exception 'microsoft_teams_erro_invalido' using errcode = '22023';
    end if;
    update public.mia_agenda_microsoft_compromissos
       set teams_estado = 'falhou', teams_erro = r->>'erro', teams_tentativas = teams_tentativas + 1
     where appointment_id = p_id;
    perform public.fn_meet_notice(p_org, p_id, 'meeting_failed');
  else
    raise exception 'microsoft_teams_estado_invalido' using errcode = '22023';
  end if;
end
$$;
comment on function public.fn_mia_agenda_microsoft_teams(uuid, uuid, jsonb) is
  'MIA (9015): grava o que a publicacao no Outlook observou da reuniao do Teams (pronto com o link validado, pendente, falhou) sob a mesma reserva da publicacao. Pronto: o link vai para calendar_appointments.meeting_url e, se a IA marcou numa conversa, a entrega do upstream e armada (meeting_delivery waiting_for_link). Falhou: aviso na Central (fn_meet_notice do upstream).';
revoke all on function public.fn_mia_agenda_microsoft_teams(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_teams(uuid, uuid, jsonb) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3 · o compromisso Teams que não vai para o Outlook
-- ═══════════════════════════════════════════════════════════════════════════
-- Quem atende publica no Google (ou não tem destino): o Teams não pode ser
-- criado. Uma linha no espelho registra isso (o detalhe do compromisso mostra o
-- porquê) e a Central avisa UMA vez. Se depois a pessoa escolher um destino do
-- Outlook e o compromisso ainda não estiver no Google, a publicação o pega.
create or replace function public.fn_mia_agenda_microsoft_teams_sem_outlook(p_limite integer default 50)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  n integer := 0;
begin
  for c in
    select a.id, a.organization_id, (a.google_event_id is not null) as no_google
      from public.calendar_appointments a
      join public.mia_agenda_tipos_com_teams t
        on t.organization_id = a.organization_id and t.event_type_id = a.event_type_id
     where a.status in ('pending','confirmed') and a.ends_at > now() and a.owner_user_id is not null
       and not exists (select 1 from public.mia_agenda_microsoft_compromissos m where m.appointment_id = a.id)
       and (a.google_event_id is not null or not exists (
         select 1 from public.mia_agenda_microsoft_calendarios k
           join public.mia_agenda_microsoft_conexoes cx on cx.organization_id = k.organization_id and cx.id = k.conexao_id
          where k.organization_id = a.organization_id and cx.user_id = a.owner_user_id and k.destino and cx.status = 'healthy'))
       and a.created_at < now() - interval '2 minutes'
     order by a.created_at
     limit greatest(1, least(coalesce(p_limite, 50), 200))
  loop
    insert into public.mia_agenda_microsoft_compromissos (
      appointment_id, organization_id, teams_pedido, teams_estado, teams_erro, proxima_tentativa_em
    ) values (
      c.id, c.organization_id, true, 'falhou', case when c.no_google then 'destino_google' else 'sem_destino' end,
      now() + interval '1 hour'
    ) on conflict (appointment_id) do nothing;
    begin
      perform public.fn_meet_notice(c.organization_id, c.id, 'meeting_failed');
    exception when others then
      null; -- o aviso é melhor esforço: a tela do compromisso já diz o porquê.
    end;
    n := n + 1;
  end loop;
  return n;
end
$$;
comment on function public.fn_mia_agenda_microsoft_teams_sem_outlook(integer) is
  'MIA (9015): registra os compromissos de tipo Teams que nao podem ter o Teams (quem atende publica no Google ou nao tem destino) e avisa na Central uma vez. Execucao so para service_role.';
revoke all on function public.fn_mia_agenda_microsoft_teams_sem_outlook(integer) from public, anon, authenticated;
grant execute on function public.fn_mia_agenda_microsoft_teams_sem_outlook(integer) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4 · o link do Teams sai dos estados da IA, como o do Meet
-- ═══════════════════════════════════════════════════════════════════════════
-- O upstream troca o link do Meet por um marcador nas tabelas de estado da IA
-- (`fn_meet_minimize_runtime`, 0226): o link é credencial de entrada na reunião
-- e o lugar dele é o compromisso. O gatilho NOSSO faz o mesmo com o do Teams,
-- nas mesmas seis tabelas e com os mesmos marcadores.
create or replace function public.fn_mia_teams_minimize_runtime()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new := jsonb_populate_record(
    new,
    regexp_replace(
      to_jsonb(new)::text,
      'https://teams[.](microsoft|live)[.]com/[^[:space:]"\\]+',
      case when tg_table_name = 'outbound_copies' then '[meet-link]' else '[link da reunião disponível na Agenda]' end,
      'g'
    )::jsonb
  );
  return new;
end
$$;
revoke all on function public.fn_mia_teams_minimize_runtime() from public, anon, authenticated;

do $$
declare
  tab text;
begin
  foreach tab in array array['lead_checkpoints','lead_state','lead_state_transitions','agent_cases','outbound_copies','conversations'] loop
    if to_regclass('public.' || tab) is not null then
      execute format('drop trigger if exists trg_mia_teams_minimize_runtime on public.%I', tab);
      execute format('create trigger trg_mia_teams_minimize_runtime before insert or update on public.%I for each row execute function public.fn_mia_teams_minimize_runtime()', tab);
    end if;
  end loop;
end
$$;


-- ─── 9016 · a trava da empresa de demonstração alcança a agenda do Outlook ───
--
-- Espelho EXATO da migration 9016 (supabase/migrations-mia/), onde está o porquê
-- inteiro. Idempotente, como todo o apêndice. Vai antes da varredura anon, que
-- fecha o arquivo.
--
-- 9016 · a trava da empresa de demonstração alcança a agenda do Outlook
--
-- ── O buraco que esta migration fecha ───────────────────────────────────────
--
-- A 9010 fechou a "agenda externa" da empresa de demonstração em
-- `calendar_connections`, porque o Google manda convite por e-mail aos
-- participantes. Na mesma versão, a 9011 trouxe a agenda do Outlook com uma
-- tabela NOSSA de conexões, `mia_agenda_microsoft_conexoes`, que a trava da 9010
-- não conhece (ela é uma lista por nome de tabela, e tabela que ela não conhece
-- passa). Sem esta migration, a empresa de demonstração conectaria uma conta
-- Microsoft e a publicação (9014) criaria o evento no Outlook com o e-mail do
-- contato como participante: a Microsoft manda o convite, e o Teams (9015)
-- nasce junto. Seria a primeira coisa a sair da demonstração.
--
-- ── A regra ─────────────────────────────────────────────────────────────────
--
-- Na empresa de demonstração, conta Microsoft só existe DESCONECTADA. É o mesmo
-- desenho do número de WhatsApp (só sessão arquivada): `disconnected` é o estado
-- sem token, que nenhuma rotina lê, sincroniza ou publica. Sem conexão viva não
-- há publicação, não há evento com participante, não há reunião do Teams e não
-- há link para a máquina de entrega mandar.
--
--   · `trg_mia_demonstracao_sem_agenda_microsoft` recusa (42501,
--     `organizacao_de_demonstracao:`) a conexão que nasce ou volta a ficar viva;
--   · `trg_mia_marca_de_demonstracao_agenda_microsoft` recusa marcar como
--     demonstração a empresa que ainda tem conta Microsoft viva, com a mesma
--     frase da 9010 ("ainda tem destino vivo (...): desligue antes de marcar").
--
-- ── Por que ao lado, e não dentro das funções da 9010 ───────────────────────
--
-- `fn_mia_trava_da_demonstracao` e `fn_mia_marca_de_demonstracao` são nossas e
-- poderiam ser reescritas, mas reescrever as duas inteiras para acrescentar uma
-- tabela é copiar cem linhas que a próxima mudança da trava teria de lembrar de
-- manter em dois lugares. Gatilho próprio, pendurado ao lado, com a MESMA
-- mensagem e o MESMO código: `lib/demonstracao/trava.ts` traduz as duas igual.
-- A consequência aceita: quem marca uma empresa com número vivo E conta
-- Microsoft viva recebe a lista da 9010 primeiro e a do Outlook depois.
--
-- Nomes com prefixo `fn_mia_`/`trg_mia_`: nada do upstream é redefinido.
-- Provado em tests/invariants/empresa-de-demonstracao-nao-envia.test.ts.

-- ── 1. a porta: conta Microsoft viva não nasce nem revive na demonstração ───
create or replace function public.fn_mia_demonstracao_sem_agenda_microsoft()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  -- A condição barata primeiro: desconectada pode existir (é o estado sem token).
  if new.status = 'disconnected' then
    return new;
  end if;

  if not public.fn_mia_e_demonstracao(new.organization_id) then
    return new;
  end if;

  raise exception 'organizacao_de_demonstracao: agenda do Outlook conectada nao existe numa empresa de demonstracao'
    using errcode = '42501',
          hint = 'Esta e a empresa de demonstracao da plataforma: nada sai dela (docs/fork/cliente-modelo.md).';
end
$f$;

comment on function public.fn_mia_demonstracao_sem_agenda_microsoft() is
  'MIA (9016): a trava da empresa de demonstracao (9010) na agenda do Outlook. Recusa (42501, organizacao_de_demonstracao:) a conta Microsoft que nasce ou volta a ficar viva numa empresa de demonstracao; so a desconectada (sem token) pode existir. Sem conexao viva nao ha publicacao no Outlook, convite por e-mail ao participante, reuniao do Teams nem link para entregar.';

revoke all on function public.fn_mia_demonstracao_sem_agenda_microsoft() from public;
revoke execute on function public.fn_mia_demonstracao_sem_agenda_microsoft() from anon, authenticated;

drop trigger if exists trg_mia_demonstracao_sem_agenda_microsoft on public.mia_agenda_microsoft_conexoes;
create trigger trg_mia_demonstracao_sem_agenda_microsoft
  before insert or update of organization_id, status on public.mia_agenda_microsoft_conexoes
  for each row execute function public.fn_mia_demonstracao_sem_agenda_microsoft();

-- ── 2. a marca: empresa com conta Microsoft viva não vira demonstração ──────
create or replace function public.fn_mia_marca_de_demonstracao_agenda_microsoft()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  if exists (select 1 from public.mia_agenda_microsoft_conexoes m
              where m.organization_id = new.id and m.status <> 'disconnected') then
    raise exception 'organizacao_de_demonstracao: a empresa ainda tem destino vivo (%): desligue antes de marcar',
      'agenda do Outlook conectada'
      using errcode = '42501';
  end if;
  return new;
end
$f$;

comment on function public.fn_mia_marca_de_demonstracao_agenda_microsoft() is
  'MIA (9016): marcar como demonstracao a empresa que ainda tem conta Microsoft viva (agenda do Outlook) e recusado, com a mesma frase da 9010. Pendurada ao lado de fn_mia_marca_de_demonstracao, que nao e reescrita.';

revoke all on function public.fn_mia_marca_de_demonstracao_agenda_microsoft() from public;
revoke execute on function public.fn_mia_marca_de_demonstracao_agenda_microsoft() from anon, authenticated;

drop trigger if exists trg_mia_marca_de_demonstracao_agenda_microsoft on public.organizations;
create trigger trg_mia_marca_de_demonstracao_agenda_microsoft
  before update of demonstracao on public.organizations
  for each row
  when (new.demonstracao and not old.demonstracao)
  execute function public.fn_mia_marca_de_demonstracao_agenda_microsoft();


-- ─── 9017 · conversões da Meta por etapa do funil, e a volta dos leads de formulário ───
--
-- Espelho EXATO da migration 9017 (supabase/migrations-mia/), onde está o porquê
-- inteiro. Idempotente, como todo o apêndice. Vai antes da varredura anon, que
-- fecha o arquivo.
--
-- 9017 · conversões da Meta por etapa do funil, e a volta dos leads de formulário
--
-- ── O que entra ─────────────────────────────────────────────────────────────
--
-- Até aqui a Meta só ficava sabendo da COMPRA (negócio ganho), e só de quem veio
-- de clique em anúncio para o WhatsApp. O Google Ads já tinha a régua por etapa
-- (`google_ads_conversion_rules`, migration 0436 do upstream). Esta migration dá
-- à Meta a mesma régua, em tabelas NOSSAS, ao lado (docs/fork/conversoes-da-meta.md):
--
--   · mia_conversoes_meta_regras   "quando um negócio ENTRAR nesta etapa, avise
--                                  este evento à Meta": o evento, o canal de
--                                  entrada e o valor que o evento leva
--   · mia_conversoes_meta_config   a chave POR EMPRESA "leads de formulário da
--                                  Meta voltam para a Meta", e desde quando
--   · fn_mia_solicitar_reenvio_conversao_meta   a porta do reenvio de um evento
--                                  de etapa recusado (a do upstream só conhece
--                                  `Purchase`, `QualifiedLead` e `Etapa:<uuid>`)
--
-- ── As travas, as mesmas do Google ──────────────────────────────────────────
--
--   1. Uma vez por negócio e evento. A chave do livro-razão
--      (`ad_conversion_dispatches`, único por organização + negócio + evento) é
--      `Meta:<evento>`, e não a etapa: o mesmo evento ligado em duas etapas só
--      sai na primeira, e sair e voltar à etapa não duplica.
--   2. Ligar uma regra não envia o passado. `configurada_em` é regravada pelo
--      gatilho quando a regra nasce, quando é LIGADA e quando troca de evento:
--      só o movimento de etapa posterior a ela envia.
--   3. O reenvio usa o retrato do primeiro envio (quando aconteceu e quanto
--      valia), que mora na linha do livro-razão.
--   4. Canal de entrada: todos, só WhatsApp (o negócio tem conversa vinculada) ou
--      só fora do WhatsApp. O mesmo vocabulário da regra do Google.
--
-- ── O valor do evento ───────────────────────────────────────────────────────
--
-- `modo_do_valor`: `sem_valor` (o padrão: o valor nasce vazio até alguém
-- configurar), `valor_fixo` (em centavos, na própria regra) ou
-- `valor_do_negocio` (o valor do negócio na hora; negócio sem valor envia o
-- evento de etapa sem valor). A compra continua exigindo valor, como sempre.
--
-- ── Os eventos ──────────────────────────────────────────────────────────────
--
-- A coluna guarda a NOSSA chave do evento (`novo_lead`, `lead_qualificado`,
-- `agendou`, `pediu_orcamento`, `iniciou_compra`). O nome técnico que vai para a
-- Meta mora num lugar só, no código (`lib/conversoes-meta/eventos.ts`): trocar o
-- nome técnico não reenvia o que já foi, porque a deduplicação é pela chave.
--
-- ── Leads de formulário ─────────────────────────────────────────────────────
--
-- O id do lead do formulário já é guardado na origem do negócio
-- (`crm_leads.source_metadata.meta_lead_id`, migration 9003). Com a chave
-- ligada, os eventos de etapa com regra e a venda também são informados para
-- esse lead, mesmo sem clique em anúncio de WhatsApp. `leads_de_formulario_desde`
-- é a trava de retroatividade da chave: ligar não envia o passado.
--
-- ── Quem lê e quem escreve ──────────────────────────────────────────────────
--
-- RLS por empresa, como as outras tabelas `mia_*`: gerente (ou acima) LÊ; toda
-- escrita é do servidor (a ação da tela e a ferramenta do MCP, que conferem
-- papel), pelo `service_role`. Nenhuma das duas guarda dado pessoal nem segredo:
-- a credencial da Meta continua em `ad_platform_connections`, do upstream.
--
-- ── A empresa de demonstração ───────────────────────────────────────────────
--
-- Regra pode ser gravada na empresa de demonstração; nada sai dela, porque a
-- conexão de conversões ligada não existe lá (gatilho da 9010 em
-- `ad_platform_connections`) e sem conexão o consumidor não envia. Provado em
-- tests/invariants/conversoes-da-meta-por-etapa.test.ts.
--
-- Nomes com prefixo `mia_`/`fn_mia_`/`trg_mia_`: nada do upstream é redefinido
-- (docs/FORK-MIA.md, regra 3).

-- ── 1. o que cada etapa informa à Meta ──────────────────────────────────────
create table if not exists public.mia_conversoes_meta_regras (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  stage_id            uuid not null,
  -- A NOSSA chave do evento. O nome técnico mora no código, num lugar só.
  evento              text not null,
  -- Por onde o negócio precisa ter entrado: todos, whatsapp (tem conversa
  -- vinculada) ou outros (sem conversa).
  canal               text not null default 'todos',
  modo_do_valor       text not null default 'sem_valor',
  valor_fixo_centavos bigint,
  -- Nasce DESLIGADA: gravar a regra não faz dado nenhum sair.
  ligada              boolean not null default false,
  -- A trava de retroatividade: só o movimento de etapa posterior envia.
  configurada_em      timestamptz not null default now(),
  criada_em           timestamptz not null default now(),
  atualizada_em       timestamptz not null default now(),
  atualizada_por      uuid references auth.users(id) on delete set null,
  constraint mia_conversoes_meta_regras_evento_conhecido
    check (evento in ('novo_lead', 'lead_qualificado', 'agendou', 'pediu_orcamento', 'iniciou_compra')),
  constraint mia_conversoes_meta_regras_canal_conhecido
    check (canal in ('todos', 'whatsapp', 'outros')),
  constraint mia_conversoes_meta_regras_modo_conhecido
    check (modo_do_valor in ('sem_valor', 'valor_fixo', 'valor_do_negocio')),
  -- Valor fixo sem valor não é valor fixo; e valor zero ensinaria à Meta que o
  -- evento não vale nada.
  constraint mia_conversoes_meta_regras_valor_fixo_coerente
    check (
      (modo_do_valor = 'valor_fixo' and valor_fixo_centavos is not null and valor_fixo_centavos > 0)
      or (modo_do_valor <> 'valor_fixo' and valor_fixo_centavos is null)
    )
);

alter table public.mia_conversoes_meta_regras
  drop constraint if exists mia_conversoes_meta_regras_stage_org_fk;
alter table public.mia_conversoes_meta_regras
  add constraint mia_conversoes_meta_regras_stage_org_fk
  foreign key (organization_id, stage_id)
  references public.crm_stages (organization_id, id)
  on delete cascade;

create unique index if not exists uq_mia_conversoes_meta_regras_org_etapa
  on public.mia_conversoes_meta_regras (organization_id, stage_id);

comment on table public.mia_conversoes_meta_regras is
  'MIA (9017): qual evento cada etapa ABERTA do funil informa a Meta quando um negocio entra nela, com o canal de entrada e o valor do evento. A chave do livro-razao ad_conversion_dispatches e Meta:<evento>: uma vez por negocio e evento. Gerente le; so o servidor escreve.';
comment on column public.mia_conversoes_meta_regras.evento is
  'A chave do evento na casa (novo_lead, lead_qualificado, agendou, pediu_orcamento, iniciou_compra). O nome tecnico enviado a Meta mora em lib/conversoes-meta/eventos.ts.';
comment on column public.mia_conversoes_meta_regras.configurada_em is
  'Trava de retroatividade: so movimentos de etapa posteriores enviam. Regravada pelo gatilho quando a regra nasce, e LIGADA ou troca de evento ou de etapa.';
comment on column public.mia_conversoes_meta_regras.modo_do_valor is
  'sem_valor (padrao), valor_fixo (valor_fixo_centavos) ou valor_do_negocio (o valor do negocio na hora; sem valor, o evento sai sem valor).';

create or replace function public.fn_mia_marcar_configuracao_regra_meta()
returns trigger
language plpgsql
set search_path = public
as $f$
begin
  if tg_op = 'INSERT' then
    new.configurada_em := now();
  elsif new.stage_id is distinct from old.stage_id
     or new.evento is distinct from old.evento
     or (new.ligada and not old.ligada) then
    new.configurada_em := now();
  else
    new.configurada_em := old.configurada_em;
  end if;
  new.atualizada_em := now();
  return new;
end
$f$;

comment on function public.fn_mia_marcar_configuracao_regra_meta() is
  'MIA (9017): carimba configurada_em quando a regra de conversao da Meta nasce, e ligada ou troca de evento ou de etapa. E a trava que impede ligar uma regra de despejar o historico do funil na Meta.';

revoke all on function public.fn_mia_marcar_configuracao_regra_meta() from public;
revoke execute on function public.fn_mia_marcar_configuracao_regra_meta() from anon, authenticated;
grant execute on function public.fn_mia_marcar_configuracao_regra_meta() to service_role;

drop trigger if exists trg_mia_marcar_configuracao_regra_meta on public.mia_conversoes_meta_regras;
create trigger trg_mia_marcar_configuracao_regra_meta
  before insert or update on public.mia_conversoes_meta_regras
  for each row execute function public.fn_mia_marcar_configuracao_regra_meta();

-- ── 2. a chave por empresa: leads de formulário voltam para a Meta ──────────
create table if not exists public.mia_conversoes_meta_config (
  organization_id           uuid primary key references public.organizations(id) on delete cascade,
  leads_de_formulario       boolean not null default false,
  -- Desde quando a chave está ligada. Nulo com a chave desligada.
  leads_de_formulario_desde timestamptz,
  atualizada_em             timestamptz not null default now(),
  atualizada_por            uuid references auth.users(id) on delete set null
);

comment on table public.mia_conversoes_meta_config is
  'MIA (9017): a chave POR EMPRESA das conversoes da Meta. leads_de_formulario ligada: os eventos de etapa com regra e a venda tambem sao informados para o lead que veio de formulario da Meta, pelo id do lead guardado. Sem linha, ou desligada: lead de formulario nao volta para a Meta.';
comment on column public.mia_conversoes_meta_config.leads_de_formulario_desde is
  'Trava de retroatividade da chave: so o que acontecer depois de ligar e informado. Carimbada pelo gatilho ao ligar; nula com a chave desligada.';

create or replace function public.fn_mia_marcar_chave_de_formulario_meta()
returns trigger
language plpgsql
set search_path = public
as $f$
begin
  if not new.leads_de_formulario then
    new.leads_de_formulario_desde := null;
  elsif tg_op = 'INSERT' or not old.leads_de_formulario then
    new.leads_de_formulario_desde := now();
  else
    new.leads_de_formulario_desde := old.leads_de_formulario_desde;
  end if;
  new.atualizada_em := now();
  return new;
end
$f$;

comment on function public.fn_mia_marcar_chave_de_formulario_meta() is
  'MIA (9017): carimba leads_de_formulario_desde quando a chave e ligada, e a zera quando e desligada. Ligar a chave nao envia o passado.';

revoke all on function public.fn_mia_marcar_chave_de_formulario_meta() from public;
revoke execute on function public.fn_mia_marcar_chave_de_formulario_meta() from anon, authenticated;
grant execute on function public.fn_mia_marcar_chave_de_formulario_meta() to service_role;

drop trigger if exists trg_mia_marcar_chave_de_formulario_meta on public.mia_conversoes_meta_config;
create trigger trg_mia_marcar_chave_de_formulario_meta
  before insert or update on public.mia_conversoes_meta_config
  for each row execute function public.fn_mia_marcar_chave_de_formulario_meta();

-- ── 3. RLS: gerente lê a própria empresa; só o servidor escreve ─────────────
alter table public.mia_conversoes_meta_regras enable row level security;
alter table public.mia_conversoes_meta_config enable row level security;

drop policy if exists mia_conversoes_meta_regras_select on public.mia_conversoes_meta_regras;
create policy mia_conversoes_meta_regras_select on public.mia_conversoes_meta_regras
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists mia_conversoes_meta_config_select on public.mia_conversoes_meta_config;
create policy mia_conversoes_meta_config_select on public.mia_conversoes_meta_config
  for select to authenticated
  using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- O default ACL do Supabase dá ALL a anon e authenticated em toda tabela nova;
-- o `grant select` sozinho não o desfaz (lição da 9001).
revoke all on public.mia_conversoes_meta_regras from anon, authenticated;
revoke all on public.mia_conversoes_meta_config from anon, authenticated;

grant select on public.mia_conversoes_meta_regras to authenticated;
grant select on public.mia_conversoes_meta_config to authenticated;

grant select, insert, update, delete on public.mia_conversoes_meta_regras to service_role;
grant select, insert, update, delete on public.mia_conversoes_meta_config to service_role;

-- ── 4. o reenvio de um evento de etapa da Meta ──────────────────────────────
--
-- Ao lado de `fn_solicitar_reenvio_conversao` (do upstream), que só conhece
-- `Purchase`, `QualifiedLead` e `Etapa:<uuid>`. As mesmas exigências, mais duas
-- da Meta: só reenvia o que tem o RETRATO (quando aconteceu) e foi de fato um
-- evento (linha que diz "anterior à regra" ou "formulário desligado" não é
-- pendência, é decisão), e evento com mais de 7 dias não volta, porque a Meta o
-- recusa de qualquer jeito.
--
-- O tipo do evento emitido é NOSSO (`conversao_meta.retry_requested`): com o
-- do upstream, o consumidor de venda dele leria um nome que não conhece como se
-- fosse o reenvio de uma compra.
create or replace function public.fn_mia_solicitar_reenvio_conversao_meta(p_org uuid, p_lead uuid, p_event text)
returns boolean
language plpgsql
set search_path = public
as $f$
declare
  v_linha public.ad_conversion_dispatches%rowtype;
begin
  if p_event is null or p_event !~ '^Meta:[a-z_]{3,40}$' then
    return false;
  end if;

  select * into v_linha from public.ad_conversion_dispatches
   where organization_id = p_org and lead_id = p_lead and event_name = p_event
     for update;
  if not found or v_linha.status = 'sent' then
    return false;
  end if;

  if v_linha.event_occurred_at is null
     or v_linha.reason in ('anterior_a_regra', 'anterior_a_chave', 'formulario_desligado') then
    return false;
  end if;

  if v_linha.event_occurred_at < now() - interval '7 days' then
    return false;
  end if;

  if exists (
    select 1 from public.event_log
     where organization_id = p_org and entity_id = p_lead
       and event_type = 'conversao_meta.retry_requested'
       and status in ('pending', 'processing')
       and payload ->> 'event_name' = p_event
  ) then
    return false;
  end if;

  perform public.emit_event('conversao_meta.retry_requested', 'crm_lead', p_lead,
    jsonb_build_object('event_name', p_event), '{}'::jsonb, p_org);

  update public.ad_conversion_dispatches
     set reason = 'reprocessamento_solicitado', attempted_at = now()
   where id = v_linha.id and organization_id = p_org;

  return true;
end
$f$;

comment on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) is
  'MIA (9017): agenda o reenvio de um evento de etapa da Meta (Meta:<evento>) que nao foi enviado. So reenvia o que tem retrato do primeiro envio, que foi de fato um evento e que tem ate 7 dias; nao duplica pedido pendente. Emite conversao_meta.retry_requested. So o service_role executa.';

revoke all on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) from public;
revoke execute on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) from anon, authenticated;
grant execute on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) to service_role;

-- Tabelas e função novas: o PostgREST precisa reler o schema para enxergá-las.
-- ─── 9018 · documentos e obrigações com vencimento ───
--
-- Espelho EXATO da migration 9018 (supabase/migrations-mia/), onde está o porquê
-- inteiro. Idempotente, como todo o apêndice. Vai antes da varredura anon, que
-- fecha o arquivo.
--
-- 9018 · documentos e obrigações com vencimento
--
-- ── O que muda ──────────────────────────────────────────────────────────────
--
-- Tem cliente que precisa pedir ou avisar os PRÓPRIOS clientes de renovar
-- documentação (alvará, AVCB, licença sanitária, CNH, certificado digital) e de
-- cumprir o que se repete (relatório mensal, renovação anual do contrato,
-- revisão semestral). Até aqui isso morava numa planilha ao lado do sistema.
-- Passa a morar numa lista só, "Obrigações", com dois tipos: DOCUMENTO (o
-- cliente entrega, ou tem validade) e ATIVIDADE RECORRENTE (algo que se repete).
-- A regra inteira está em docs/fork/obrigacoes.md.
--
-- ── As cinco tabelas, e por que cinco ───────────────────────────────────────
--
--   mia_obrigacoes_tipos      o CATÁLOGO por organização e funil: o tipo traz
--                             validade, recorrência, avisos, quem entrega e a
--                             quem se liga. É só o ponto de partida: tudo é
--                             copiado para o item e editável nele.
--   mia_obrigacoes            o ITEM. Guarda as DATAS, nunca a situação: "a
--                             pedir", "vencendo", "vencido" são calculados pelas
--                             datas (lib/obrigacoes/situacao.ts), num lugar só,
--                             para a tela, o servidor, a automação e o MCP
--                             dizerem a mesma coisa. Uma coluna de situação
--                             envelheceria sozinha à meia-noite.
--   mia_obrigacoes_ciclos     o HISTÓRICO: ao receber a versão nova (ou marcar
--                             feita), o ciclo que terminou vem para cá com as
--                             datas e o arquivo dele, e o item segue com o novo.
--   mia_obrigacoes_propostas  o que o AGENTE DE IA propõe: "o cliente mandou um
--                             arquivo; é o alvará pedido?". Ele nunca marca
--                             recebido. Uma pessoa confirma ou diz que não é.
--   mia_obrigacoes_avisos     a TRAVA dos avisos: cada regra de automação
--                             dispara UMA vez por item, ciclo e data medida. A
--                             linha nasce na mesma transação do evento.
--
-- ── A quem o item se liga ───────────────────────────────────────────────────
--
-- A negócio, empresa e/ou contato: pelo menos um. O que é da EMPRESA aparece em
-- todos os negócios dela; o que é do CONTATO acompanha a pessoa; o que é do
-- NEGÓCIO fica só nele (a herança é leitura, em lib/obrigacoes/heranca.ts).
-- As três chaves são `on delete set null`: apagar o negócio não leva o alvará
-- que também é da empresa. O item que fica sem dono nenhum sai (gatilho), e o
-- arquivo dele vai para a fila de remoção do upstream (`storage_redaction_queue`).
--
-- ── As datas são DIAS ───────────────────────────────────────────────────────
--
-- `date`, e não `timestamptz`: validade de alvará é um dia do calendário, e o
-- "hoje" que decide a situação é o do fuso da empresa. Instante com fuso faria o
-- documento vencer um dia antes para quem está a oeste do servidor.
--
-- ── Quem vê e quem grava ────────────────────────────────────────────────────
--
-- Leitura: quem é da organização E enxerga o negócio ligado (a régua de
-- visibilidade de `crm_leads` vale por dentro da policy; contato e empresa são
-- vistos pela organização inteira). Escrita: `agent` em diante, com as travas do
-- suporte somente leitura plantadas por `fn_aplicar_travas_de_suporte` (a função
-- do upstream, chamada, nunca copiada). O catálogo é configuração: `manager`.
-- Os avisos só o servidor grava.
--
-- ── O arquivo ───────────────────────────────────────────────────────────────
--
-- Bucket PRIVADO `mia-obrigacoes`, sem policy: só o servidor lê e escreve, e a
-- tela recebe um link assinado de vida curta depois que a rota conferiu o papel
-- e leu o item pela RLS de quem pediu (o desenho do anexo de nota interna).
--
-- ── LGPD ────────────────────────────────────────────────────────────────────
--
-- Anonimizar o contato leva junto, na MESMA transação: os itens ligados a ele
-- saem inteiros; os dos negócios dele ficam sem arquivo e sem observação; e todo
-- arquivo vai para a fila de remoção. O relatório de acesso entrega as três
-- tabelas (lib/lgpd/export-collector.ts). Documento de saúde (atestado, laudo,
-- exame) é dado sensível e fica FORA dos modelos de tipo.
--
-- Nomes com prefixo `mia_`/`fn_mia_`/`trg_mia_`: nada do upstream é redefinido.
-- Provado em tests/invariants/obrigacoes.test.ts.

-- ── 1. o catálogo de tipos ──────────────────────────────────────────────────
create table if not exists public.mia_obrigacoes_tipos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Nulo = o tipo vale para a organização inteira, em qualquer funil.
  pipeline_id uuid references public.crm_pipelines(id) on delete cascade,
  nome text not null,
  nome_curto text,
  categoria text not null,
  quem_entrega text not null default 'cliente',
  recorrencia text not null default 'unica',
  recorrencia_meses integer,
  validade_meses integer not null default 0,
  avisos_dias integer[] not null default '{}'::integer[],
  dias_sem_resposta integer not null default 5,
  liga_a text not null default 'negocio',
  pede_arquivo boolean not null default true,
  -- De qual modelo de segmento o tipo veio (lib/obrigacoes/catalogo.ts). Nulo = criado à mão.
  segmento text,
  posicao integer not null default 0,
  arquivado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references auth.users(id) on delete set null,
  constraint mia_obrigacoes_tipos_nome check (length(btrim(nome)) between 1 and 120),
  constraint mia_obrigacoes_tipos_categoria check (categoria in ('documento', 'atividade')),
  constraint mia_obrigacoes_tipos_quem check (quem_entrega in ('cliente', 'nos')),
  constraint mia_obrigacoes_tipos_recorrencia check (recorrencia in ('unica', 'mensal', 'anual', 'n_meses')),
  constraint mia_obrigacoes_tipos_n_meses check (
    (recorrencia = 'n_meses' and recorrencia_meses between 1 and 240)
    or (recorrencia <> 'n_meses' and recorrencia_meses is null)
  ),
  constraint mia_obrigacoes_tipos_validade check (validade_meses between 0 and 600),
  constraint mia_obrigacoes_tipos_avisos check (
    coalesce(array_length(avisos_dias, 1), 0) <= 3
    and 0 < all (avisos_dias) and 3650 >= all (avisos_dias)
  ),
  constraint mia_obrigacoes_tipos_sem_resposta check (dias_sem_resposta between 1 and 365),
  constraint mia_obrigacoes_tipos_liga_a check (liga_a in ('negocio', 'empresa', 'contato'))
);

comment on table public.mia_obrigacoes_tipos is
  'MIA (9018): o catalogo de tipos de obrigacao por organizacao e funil (pipeline_id nulo = vale para todos os funis). O tipo e so o ponto de partida: validade, recorrencia, avisos e quem entrega sao copiados para o item e editaveis nele.';

-- Um nome por funil (e um por organização quando o tipo é de todos os funis).
create unique index if not exists uq_mia_obrigacoes_tipos_nome
  on public.mia_obrigacoes_tipos (
    organization_id,
    coalesce(pipeline_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(nome))
  )
  where arquivado_em is null;

-- ── 2. os itens ─────────────────────────────────────────────────────────────
create table if not exists public.mia_obrigacoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tipo_id uuid references public.mia_obrigacoes_tipos(id) on delete set null,
  nome text not null,
  nome_curto text,
  categoria text not null,
  lead_id uuid references public.crm_leads(id) on delete set null,
  empresa_id uuid references public.crm_empresas(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  quem_entrega text not null default 'cliente',
  recorrencia text not null default 'unica',
  recorrencia_meses integer,
  validade_meses integer not null default 0,
  avisos_dias integer[] not null default '{30,15,7}'::integer[],
  dias_sem_resposta integer not null default 5,
  -- documento
  pedido_em date,
  prazo_em date,
  cobrado_em date,
  recebido_em date,
  valido_ate date,
  renovado_em date,
  -- atividade recorrente
  proxima_em date,
  feita_em date,
  -- Sobe a cada renovação (documento recebido de novo) e a cada atividade feita.
  ciclo integer not null default 1,
  arquivo_path text,
  arquivo_nome text,
  arquivo_mime text,
  arquivo_bytes bigint,
  responsavel_user_id uuid references auth.users(id) on delete set null,
  observacao text,
  -- De onde o item veio: 'tela', 'mcp', 'demonstracao' ou 'importacao:<origem>'.
  origem text not null default 'tela',
  -- A chave de reexecução da importação: tipo + a quem está ligado.
  chave_natural text,
  -- Nenhum aviso com data de disparo anterior a este dia: é o que impede uma
  -- base migrada de planilha de disparar avisos atrasados no dia em que entra.
  sem_aviso_antes_de date not null default current_date,
  arquivado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  constraint mia_obrigacoes_nome check (length(btrim(nome)) between 1 and 120),
  constraint mia_obrigacoes_categoria check (categoria in ('documento', 'atividade')),
  constraint mia_obrigacoes_quem check (quem_entrega in ('cliente', 'nos')),
  constraint mia_obrigacoes_recorrencia check (recorrencia in ('unica', 'mensal', 'anual', 'n_meses')),
  constraint mia_obrigacoes_n_meses check (
    (recorrencia = 'n_meses' and recorrencia_meses between 1 and 240)
    or (recorrencia <> 'n_meses' and recorrencia_meses is null)
  ),
  constraint mia_obrigacoes_validade check (validade_meses between 0 and 600),
  constraint mia_obrigacoes_avisos check (
    coalesce(array_length(avisos_dias, 1), 0) <= 3
    and 0 < all (avisos_dias) and 3650 >= all (avisos_dias)
  ),
  constraint mia_obrigacoes_sem_resposta check (dias_sem_resposta between 1 and 365),
  constraint mia_obrigacoes_ciclo check (ciclo >= 1),
  -- Cada categoria só usa as datas dela: a função da situação lê por categoria,
  -- e uma data da outra ficaria guardada sem ninguém mostrar.
  constraint mia_obrigacoes_datas_da_categoria check (
    (categoria = 'documento' and proxima_em is null and feita_em is null)
    or (categoria = 'atividade' and pedido_em is null and prazo_em is null and cobrado_em is null
        and recebido_em is null and valido_ate is null and renovado_em is null and arquivo_path is null)
  ),
  constraint mia_obrigacoes_arquivo_no_espaco_da_empresa check (
    arquivo_path is null or split_part(arquivo_path, '/', 1) = organization_id::text
  )
);

comment on table public.mia_obrigacoes is
  'MIA (9018): documentos e atividades recorrentes com vencimento, ligados a negocio, empresa e/ou contato. A SITUACAO NAO E COLUNA: e calculada pelas datas em lib/obrigacoes/situacao.ts. Datas sao dias do calendario (date), lidos no fuso da empresa.';
comment on column public.mia_obrigacoes.ciclo is
  'MIA (9018): o ciclo em vigor. Sobe quando o documento e recebido de novo (renovacao) e quando a atividade e marcada feita; o ciclo que terminou vai para mia_obrigacoes_ciclos.';
comment on column public.mia_obrigacoes.sem_aviso_antes_de is
  'MIA (9018): nenhum gatilho de automacao dispara para este item com data de disparo anterior a este dia. Nasce com o dia da criacao: item migrado de planilha nao dispara aviso atrasado.';

create index if not exists idx_mia_obrigacoes_org on public.mia_obrigacoes (organization_id) where arquivado_em is null;
create index if not exists idx_mia_obrigacoes_lead on public.mia_obrigacoes (lead_id) where lead_id is not null;
create index if not exists idx_mia_obrigacoes_empresa on public.mia_obrigacoes (empresa_id) where empresa_id is not null;
create index if not exists idx_mia_obrigacoes_contato on public.mia_obrigacoes (contact_id) where contact_id is not null;
create index if not exists idx_mia_obrigacoes_valido_ate on public.mia_obrigacoes (organization_id, valido_ate) where valido_ate is not null and arquivado_em is null;
create index if not exists idx_mia_obrigacoes_proxima_em on public.mia_obrigacoes (organization_id, proxima_em) where proxima_em is not null and arquivado_em is null;
create index if not exists idx_mia_obrigacoes_pedido_em on public.mia_obrigacoes (organization_id, pedido_em) where pedido_em is not null and arquivado_em is null;
create unique index if not exists uq_mia_obrigacoes_chave_natural
  on public.mia_obrigacoes (organization_id, chave_natural)
  where chave_natural is not null and arquivado_em is null;

-- ── 3. o histórico dos ciclos ───────────────────────────────────────────────
create table if not exists public.mia_obrigacoes_ciclos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  obrigacao_id uuid not null references public.mia_obrigacoes(id) on delete cascade,
  ciclo integer not null,
  -- Como o ciclo terminou: 'recebido' (chegou a versão nova) ou 'feita'.
  como text not null,
  pedido_em date,
  recebido_em date,
  valido_ate date,
  proxima_em date,
  feita_em date,
  arquivo_path text,
  arquivo_nome text,
  arquivo_mime text,
  arquivo_bytes bigint,
  encerrado_em timestamptz not null default now(),
  encerrado_por_user_id uuid references auth.users(id) on delete set null,
  constraint mia_obrigacoes_ciclos_como check (como in ('recebido', 'feita')),
  constraint mia_obrigacoes_ciclos_um_por_ciclo unique (obrigacao_id, ciclo)
);

comment on table public.mia_obrigacoes_ciclos is
  'MIA (9018): o historico de um item. Cada linha e um ciclo que terminou (documento renovado, atividade feita), com as datas e o arquivo daquele ciclo.';

create index if not exists idx_mia_obrigacoes_ciclos_org on public.mia_obrigacoes_ciclos (organization_id);

-- ── 4. a proposta do agente de IA ───────────────────────────────────────────
create table if not exists public.mia_obrigacoes_propostas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  obrigacao_id uuid not null references public.mia_obrigacoes(id) on delete cascade,
  ciclo integer not null,
  -- Quem mandou o arquivo. Some junto com a pessoa na anonimização.
  contact_id uuid references public.contacts(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  -- A mensagem que trouxe o arquivo. O arquivo continua NA CONVERSA: só é
  -- copiado para a área das obrigações quando uma pessoa confirma.
  message_id uuid references public.messages(id) on delete set null,
  arquivo_nome text,
  arquivo_mime text,
  situacao text not null default 'pendente',
  proposta_por_agente_id uuid,
  decidida_em timestamptz,
  decidida_por_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint mia_obrigacoes_propostas_situacao check (situacao in ('pendente', 'confirmada', 'recusada', 'superada'))
);

comment on table public.mia_obrigacoes_propostas is
  'MIA (9018): o agente de IA PROPOE que um arquivo recebido na conversa e o documento pedido; uma pessoa confirma ou recusa. O agente nunca marca recebido. Enquanto ha proposta pendente, o gatilho "documento nao enviado" fica segurado.';

-- Uma proposta pendente por item: a mais nova substitui a anterior.
create unique index if not exists uq_mia_obrigacoes_propostas_pendente
  on public.mia_obrigacoes_propostas (obrigacao_id)
  where situacao = 'pendente';
create index if not exists idx_mia_obrigacoes_propostas_org on public.mia_obrigacoes_propostas (organization_id, situacao);
create index if not exists idx_mia_obrigacoes_propostas_contato on public.mia_obrigacoes_propostas (contact_id) where contact_id is not null;

-- ── 5. a trava dos avisos ───────────────────────────────────────────────────
create table if not exists public.mia_obrigacoes_avisos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  obrigacao_id uuid not null references public.mia_obrigacoes(id) on delete cascade,
  regra_id uuid not null references public.automation_rules(id) on delete cascade,
  gatilho text not null,
  ciclo integer not null,
  -- A data MEDIDA: o "válido até", o "pedido em", a próxima data ou o dia do
  -- recebimento. Corrigir a data rearma o aviso; a mesma data avisa uma vez.
  ancora date not null,
  -- "Documento não enviado" com arquivo do cliente esperando confirmação: a
  -- linha nasce segurada, sem evento, e é solta quando a proposta é decidida.
  segurado boolean not null default false,
  event_id uuid references public.event_log(id) on delete set null,
  disparado_em timestamptz,
  created_at timestamptz not null default now(),
  constraint mia_obrigacoes_avisos_gatilho check (gatilho ~ '^obrigacao\.[a-z_]+$'),
  constraint mia_obrigacoes_avisos_uma_vez unique (obrigacao_id, regra_id, gatilho, ciclo, ancora)
);

comment on table public.mia_obrigacoes_avisos is
  'MIA (9018): a trava de "uma vez por item e ciclo" dos cinco gatilhos de obrigacao. A linha nasce na MESMA transacao do evento (fn_mia_obrigacao_disparar). So o servidor grava.';

create index if not exists idx_mia_obrigacoes_avisos_org on public.mia_obrigacoes_avisos (organization_id);
create index if not exists idx_mia_obrigacoes_avisos_segurados on public.mia_obrigacoes_avisos (organization_id) where segurado;

-- ── 6. quem vê e quem grava ─────────────────────────────────────────────────
alter table public.mia_obrigacoes_tipos enable row level security;
alter table public.mia_obrigacoes enable row level security;
alter table public.mia_obrigacoes_ciclos enable row level security;
alter table public.mia_obrigacoes_propostas enable row level security;
alter table public.mia_obrigacoes_avisos enable row level security;

revoke all on table public.mia_obrigacoes_tipos from anon, authenticated;
revoke all on table public.mia_obrigacoes from anon, authenticated;
revoke all on table public.mia_obrigacoes_ciclos from anon, authenticated;
revoke all on table public.mia_obrigacoes_propostas from anon, authenticated;
revoke all on table public.mia_obrigacoes_avisos from anon, authenticated;

grant select, insert, update, delete on table public.mia_obrigacoes_tipos to authenticated;
grant select, insert, update, delete on table public.mia_obrigacoes to authenticated;
grant select, insert, update, delete on table public.mia_obrigacoes_ciclos to authenticated;
grant select, insert, update, delete on table public.mia_obrigacoes_propostas to authenticated;
-- Os avisos só o servidor grava: a sessão lê, para o histórico do item.
grant select on table public.mia_obrigacoes_avisos to authenticated;

grant all on table public.mia_obrigacoes_tipos to service_role;
grant all on table public.mia_obrigacoes to service_role;
grant all on table public.mia_obrigacoes_ciclos to service_role;
grant all on table public.mia_obrigacoes_propostas to service_role;
grant all on table public.mia_obrigacoes_avisos to service_role;

drop policy if exists "mia_obrigacoes_tipos_select" on public.mia_obrigacoes_tipos;
drop policy if exists "mia_obrigacoes_tipos_escrita" on public.mia_obrigacoes_tipos;
create policy "mia_obrigacoes_tipos_select" on public.mia_obrigacoes_tipos
  for select using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()))
  );
-- O catálogo é configuração do funil: gerente em diante.
create policy "mia_obrigacoes_tipos_escrita" on public.mia_obrigacoes_tipos
  for all using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  ) with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

drop policy if exists "mia_obrigacoes_select" on public.mia_obrigacoes;
drop policy if exists "mia_obrigacoes_insert" on public.mia_obrigacoes;
drop policy if exists "mia_obrigacoes_update" on public.mia_obrigacoes;
drop policy if exists "mia_obrigacoes_delete" on public.mia_obrigacoes;
-- O `exists` em `crm_leads` roda com a RLS de quem pergunta: o item de um
-- negócio que a pessoa não enxerga também não aparece para ela.
create policy "mia_obrigacoes_select" on public.mia_obrigacoes
  for select using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and (lead_id is null
             or exists (select 1 from public.crm_leads l where l.id = mia_obrigacoes.lead_id)))
  );
create policy "mia_obrigacoes_insert" on public.mia_obrigacoes
  for insert with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (lead_id is null
             or exists (select 1 from public.crm_leads l where l.id = mia_obrigacoes.lead_id)))
  );
create policy "mia_obrigacoes_update" on public.mia_obrigacoes
  for update using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (lead_id is null
             or exists (select 1 from public.crm_leads l where l.id = mia_obrigacoes.lead_id)))
  ) with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent'))
  );
create policy "mia_obrigacoes_delete" on public.mia_obrigacoes
  for delete using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (lead_id is null
             or exists (select 1 from public.crm_leads l where l.id = mia_obrigacoes.lead_id)))
  );

-- Ciclos e propostas seguem o item: quem vê o item vê o histórico dele.
drop policy if exists "mia_obrigacoes_ciclos_select" on public.mia_obrigacoes_ciclos;
drop policy if exists "mia_obrigacoes_ciclos_escrita" on public.mia_obrigacoes_ciclos;
create policy "mia_obrigacoes_ciclos_select" on public.mia_obrigacoes_ciclos
  for select using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and exists (select 1 from public.mia_obrigacoes o where o.id = mia_obrigacoes_ciclos.obrigacao_id))
  );
create policy "mia_obrigacoes_ciclos_escrita" on public.mia_obrigacoes_ciclos
  for all using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and exists (select 1 from public.mia_obrigacoes o where o.id = mia_obrigacoes_ciclos.obrigacao_id))
  ) with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and exists (select 1 from public.mia_obrigacoes o
                     where o.id = mia_obrigacoes_ciclos.obrigacao_id
                       and o.organization_id = mia_obrigacoes_ciclos.organization_id))
  );

drop policy if exists "mia_obrigacoes_propostas_select" on public.mia_obrigacoes_propostas;
drop policy if exists "mia_obrigacoes_propostas_escrita" on public.mia_obrigacoes_propostas;
create policy "mia_obrigacoes_propostas_select" on public.mia_obrigacoes_propostas
  for select using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and exists (select 1 from public.mia_obrigacoes o where o.id = mia_obrigacoes_propostas.obrigacao_id))
  );
create policy "mia_obrigacoes_propostas_escrita" on public.mia_obrigacoes_propostas
  for all using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and exists (select 1 from public.mia_obrigacoes o where o.id = mia_obrigacoes_propostas.obrigacao_id))
  ) with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and exists (select 1 from public.mia_obrigacoes o
                     where o.id = mia_obrigacoes_propostas.obrigacao_id
                       and o.organization_id = mia_obrigacoes_propostas.organization_id))
  );

drop policy if exists "mia_obrigacoes_avisos_select" on public.mia_obrigacoes_avisos;
create policy "mia_obrigacoes_avisos_select" on public.mia_obrigacoes_avisos
  for select using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and exists (select 1 from public.mia_obrigacoes o where o.id = mia_obrigacoes_avisos.obrigacao_id))
  );

-- ── 7. a área de arquivo privada ────────────────────────────────────────────
--
-- Sem policy em `storage.objects`, como `internal-media` e `whatsapp-media`: só
-- o servidor (service_role) lê e grava; a tela recebe link assinado. 25 MB: é
-- documento digitalizado, não vídeo.
insert into storage.buckets (id, name, public, file_size_limit)
values ('mia-obrigacoes', 'mia-obrigacoes', false, 26214400)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- ── 8. o item precisa de dono, e o item sem dono sai ────────────────────────
create or replace function public.fn_mia_obrigacao_exige_dono()
returns trigger
language plpgsql
set search_path = public
as $f$
begin
  if new.lead_id is null and new.empresa_id is null and new.contact_id is null then
    raise exception 'mia_obrigacao_sem_dono: ligue o item a um negocio, a uma empresa ou a um contato'
      using errcode = '23514';
  end if;
  return new;
end
$f$;

comment on function public.fn_mia_obrigacao_exige_dono() is
  'MIA (9018): o item de obrigacao nasce ligado a pelo menos um de negocio, empresa ou contato. E gatilho de INSERT, e nao CHECK: as tres chaves sao on delete set null, e um CHECK impediria apagar o negocio de um item que so tem ele.';

revoke all on function public.fn_mia_obrigacao_exige_dono() from public;
revoke execute on function public.fn_mia_obrigacao_exige_dono() from anon, authenticated;

drop trigger if exists trg_mia_obrigacao_exige_dono on public.mia_obrigacoes;
create trigger trg_mia_obrigacao_exige_dono
  before insert on public.mia_obrigacoes
  for each row execute function public.fn_mia_obrigacao_exige_dono();

create or replace function public.fn_mia_obrigacao_sem_dono_sai()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  if new.lead_id is null and new.empresa_id is null and new.contact_id is null then
    delete from public.mia_obrigacoes where id = new.id;
  end if;
  return null;
end
$f$;

comment on function public.fn_mia_obrigacao_sem_dono_sai() is
  'MIA (9018): quando o ultimo dono de um item some (negocio, empresa ou contato apagado: as chaves sao on delete set null), o item sai junto. O gatilho de DELETE enfileira o arquivo dele para remocao.';

revoke all on function public.fn_mia_obrigacao_sem_dono_sai() from public;
revoke execute on function public.fn_mia_obrigacao_sem_dono_sai() from anon, authenticated;

drop trigger if exists trg_mia_obrigacao_sem_dono_sai on public.mia_obrigacoes;
create trigger trg_mia_obrigacao_sem_dono_sai
  after update of lead_id, empresa_id, contact_id on public.mia_obrigacoes
  for each row execute function public.fn_mia_obrigacao_sem_dono_sai();

-- ── 9. arquivo que ninguém mais aponta vai para a fila de remoção ───────────
--
-- A fila é a do upstream (`storage_redaction_queue`), que já sabe tirar de
-- qualquer bucket. Três momentos: o item sai; o arquivo do item é trocado sem
-- ir para o histórico; o histórico perde o arquivo.
create or replace function public.fn_mia_obrigacao_arquivo_orfao()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_saindo boolean := (tg_op = 'DELETE');
  v_caminhos text[];
begin
  -- Organização sendo apagada: a fila referencia a organização, e ela já não
  -- existe a esta altura da cascata. Os arquivos saem com o espaço dela.
  if not exists (select 1 from public.organizations g where g.id = old.organization_id) then
    return old;
  end if;

  if v_saindo then
    -- Só a tabela dos itens tem gatilho de DELETE: o arquivo do ciclo em vigor
    -- e os do histórico, que a cascata vai levar junto.
    select array_agg(x.caminho) into v_caminhos
      from (
        select old.arquivo_path as caminho
        union
        select c.arquivo_path from public.mia_obrigacoes_ciclos c where c.obrigacao_id = old.id
      ) x
     where x.caminho is not null;
  else
    v_caminhos := array[old.arquivo_path];
  end if;

  if v_caminhos is null then
    return old;
  end if;

  insert into public.storage_redaction_queue (organization_id, bucket, object_path)
  select old.organization_id, 'mia-obrigacoes', x.caminho
    from unnest(v_caminhos) as x(caminho)
   where x.caminho is not null
     -- O arquivo que foi para o histórico, ou que outro item aponta, segue em uso.
     and not exists (
       select 1 from public.mia_obrigacoes_ciclos c
        where c.arquivo_path = x.caminho
          and not (v_saindo and c.obrigacao_id = old.id)
     )
     and not exists (
       select 1 from public.mia_obrigacoes o
        where o.arquivo_path = x.caminho
          and not (v_saindo and o.id = old.id)
     )
  on conflict (bucket, object_path) do update
    set status = 'pending',
        attempts = 0,
        enqueued_at = now(),
        processed_at = null,
        error_message = null
    where storage_redaction_queue.status in ('deleted', 'skipped');

  return old;
end
$f$;

comment on function public.fn_mia_obrigacao_arquivo_orfao() is
  'MIA (9018): o arquivo de uma obrigacao que nada mais aponta (item apagado, arquivo trocado sem ir ao historico, historico sem arquivo) entra em storage_redaction_queue com o bucket mia-obrigacoes. Sem isto o arquivo ficaria no bucket sem ninguem capaz de acha-lo.';

revoke all on function public.fn_mia_obrigacao_arquivo_orfao() from public;
revoke execute on function public.fn_mia_obrigacao_arquivo_orfao() from anon, authenticated;

drop trigger if exists trg_mia_obrigacao_arquivo_orfao_item on public.mia_obrigacoes;
create trigger trg_mia_obrigacao_arquivo_orfao_item
  before delete on public.mia_obrigacoes
  for each row execute function public.fn_mia_obrigacao_arquivo_orfao();

drop trigger if exists trg_mia_obrigacao_arquivo_trocado on public.mia_obrigacoes;
create trigger trg_mia_obrigacao_arquivo_trocado
  after update of arquivo_path on public.mia_obrigacoes
  for each row
  when (old.arquivo_path is not null and old.arquivo_path is distinct from new.arquivo_path)
  execute function public.fn_mia_obrigacao_arquivo_orfao();

drop trigger if exists trg_mia_obrigacao_arquivo_do_ciclo on public.mia_obrigacoes_ciclos;
create trigger trg_mia_obrigacao_arquivo_do_ciclo
  after update of arquivo_path on public.mia_obrigacoes_ciclos
  for each row
  when (old.arquivo_path is not null and old.arquivo_path is distinct from new.arquivo_path)
  execute function public.fn_mia_obrigacao_arquivo_orfao();

-- ── 10. fechar o ciclo: receber a versão nova, marcar feita ─────────────────
--
-- Numa transação só: o ciclo que termina vai para o histórico e o item segue
-- com as datas novas. A CONTA da próxima data (somar meses, o fim do mês) é do
-- TypeScript (lib/obrigacoes/ciclo.ts), no mesmo módulo que a tela usa para
-- mostrar a prévia; aqui só se grava o que ele calculou.
--
-- `security invoker`: roda com a RLS de quem chama. Não é definer, e por isso
-- não dá a ninguém o que a policy não dá.
create or replace function public.fn_mia_obrigacao_fechar_ciclo(
  p_obrigacao uuid,
  p_ciclo_esperado integer,
  p_como text,
  p_dia date,
  p_valido_ate date default null,
  p_proxima_em date default null,
  p_arquivo jsonb default null,
  p_ator uuid default null,
  p_proposta uuid default null
) returns integer
language plpgsql
security invoker
set search_path = public
as $f$
declare
  v public.mia_obrigacoes%rowtype;
  v_tinha boolean;
  v_ciclo integer;
begin
  select * into v from public.mia_obrigacoes where id = p_obrigacao for update;
  if not found then
    raise exception 'mia_obrigacao_nao_encontrada' using errcode = 'P0002';
  end if;
  -- Duas pessoas confirmando o mesmo recebimento: a segunda encontra o ciclo
  -- já fechado e é recusada, em vez de fechar o ciclo seguinte sem querer.
  if v.ciclo <> p_ciclo_esperado then
    raise exception 'mia_obrigacao_mudou: o item ja esta no ciclo %', v.ciclo using errcode = '40001';
  end if;
  if p_dia is null then
    raise exception 'mia_obrigacao_sem_dia' using errcode = '22004';
  end if;

  if p_como = 'recebido' then
    if v.categoria <> 'documento' then
      raise exception 'mia_obrigacao_categoria: so documento e recebido' using errcode = '22023';
    end if;
    v_tinha := v.recebido_em is not null or v.valido_ate is not null;
    if v_tinha then
      insert into public.mia_obrigacoes_ciclos
        (organization_id, obrigacao_id, ciclo, como, pedido_em, recebido_em, valido_ate,
         arquivo_path, arquivo_nome, arquivo_mime, arquivo_bytes, encerrado_por_user_id)
      values
        (v.organization_id, v.id, v.ciclo, 'recebido', v.pedido_em, v.recebido_em, v.valido_ate,
         v.arquivo_path, v.arquivo_nome, v.arquivo_mime, v.arquivo_bytes, p_ator);
    end if;
    v_ciclo := v.ciclo + case when v_tinha then 1 else 0 end;
    update public.mia_obrigacoes
       set recebido_em = p_dia,
           valido_ate = p_valido_ate,
           pedido_em = null,
           prazo_em = null,
           cobrado_em = null,
           renovado_em = case when v_tinha then p_dia else null end,
           arquivo_path = p_arquivo->>'path',
           arquivo_nome = p_arquivo->>'nome',
           arquivo_mime = p_arquivo->>'mime',
           arquivo_bytes = nullif(p_arquivo->>'bytes', '')::bigint,
           ciclo = v_ciclo,
           updated_at = now(),
           updated_by_user_id = p_ator
     where id = v.id;
    -- A proposta que levou a este recebimento é a confirmada; outra pendente
    -- do mesmo item deixou de fazer sentido.
    update public.mia_obrigacoes_propostas
       set situacao = case when id = p_proposta then 'confirmada' else 'superada' end,
           decidida_em = now(),
           decidida_por_user_id = p_ator
     where obrigacao_id = v.id and situacao = 'pendente';
  elsif p_como = 'feita' then
    if v.categoria <> 'atividade' then
      raise exception 'mia_obrigacao_categoria: so atividade e marcada feita' using errcode = '22023';
    end if;
    insert into public.mia_obrigacoes_ciclos
      (organization_id, obrigacao_id, ciclo, como, proxima_em, feita_em, encerrado_por_user_id)
    values
      (v.organization_id, v.id, v.ciclo, 'feita', v.proxima_em, p_dia, p_ator);
    v_ciclo := v.ciclo + 1;
    update public.mia_obrigacoes
       set feita_em = p_dia,
           proxima_em = p_proxima_em,
           ciclo = v_ciclo,
           updated_at = now(),
           updated_by_user_id = p_ator
     where id = v.id;
  else
    raise exception 'mia_obrigacao_como: use recebido ou feita' using errcode = '22023';
  end if;

  return v_ciclo;
end
$f$;

comment on function public.fn_mia_obrigacao_fechar_ciclo(uuid, integer, text, date, date, date, jsonb, uuid, uuid) is
  'MIA (9018): fecha o ciclo de uma obrigacao numa transacao: o ciclo que termina vai para mia_obrigacoes_ciclos e o item segue com as datas novas. SECURITY INVOKER: vale a RLS de quem chama. Recusa (40001) quando o item ja mudou de ciclo.';

revoke all on function public.fn_mia_obrigacao_fechar_ciclo(uuid, integer, text, date, date, date, jsonb, uuid, uuid) from public;
revoke execute on function public.fn_mia_obrigacao_fechar_ciclo(uuid, integer, text, date, date, date, jsonb, uuid, uuid) from anon;
grant execute on function public.fn_mia_obrigacao_fechar_ciclo(uuid, integer, text, date, date, date, jsonb, uuid, uuid) to authenticated, service_role;

-- ── 11. disparar um aviso: a trava e o evento na mesma transação ────────────
--
-- Devolve o id do evento, ou nulo quando a regra já disparou para este item,
-- ciclo e data (ou quando o aviso nasceu segurado). Só o servidor chama: quem
-- decide o dia é a varredura (app/api/v1/cron/obrigacoes-avisos).
create or replace function public.fn_mia_obrigacao_disparar(
  p_organization_id uuid,
  p_obrigacao uuid,
  p_regra uuid,
  p_gatilho text,
  p_ciclo integer,
  p_ancora date,
  p_payload jsonb default '{}'::jsonb,
  p_segurar boolean default false
) returns uuid
language plpgsql
security invoker
set search_path = public
as $f$
declare
  v_aviso uuid;
  v_evento uuid;
  v_segurado boolean;
begin
  insert into public.mia_obrigacoes_avisos
    (organization_id, obrigacao_id, regra_id, gatilho, ciclo, ancora, segurado)
  values
    (p_organization_id, p_obrigacao, p_regra, p_gatilho, p_ciclo, p_ancora, p_segurar)
  on conflict (obrigacao_id, regra_id, gatilho, ciclo, ancora) do nothing
  returning id into v_aviso;

  if v_aviso is null then
    -- Já existe. Só há o que fazer se ele estava SEGURADO e agora pode sair.
    if p_segurar then
      return null;
    end if;
    select a.id, a.segurado into v_aviso, v_segurado
      from public.mia_obrigacoes_avisos a
     where a.obrigacao_id = p_obrigacao and a.regra_id = p_regra and a.gatilho = p_gatilho
       and a.ciclo = p_ciclo and a.ancora = p_ancora
       for update;
    if not coalesce(v_segurado, false) then
      return null;
    end if;
  elsif p_segurar then
    return null;
  end if;

  v_evento := public.emit_event(
    p_gatilho,
    'mia_obrigacao',
    p_obrigacao,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('rule_id', p_regra),
    jsonb_build_object('actor_kind', 'system', 'source', 'obrigacoes'),
    p_organization_id
  );

  update public.mia_obrigacoes_avisos
     set segurado = false, event_id = v_evento, disparado_em = now()
   where id = v_aviso;

  return v_evento;
end
$f$;

comment on function public.fn_mia_obrigacao_disparar(uuid, uuid, uuid, text, integer, date, jsonb, boolean) is
  'MIA (9018): emite o evento de um gatilho de obrigacao UMA vez por regra, item, ciclo e data medida: a linha da trava e o evento nascem na mesma transacao. Com p_segurar, a trava nasce sem evento e e solta na proxima chamada sem p_segurar. So o servidor chama.';

revoke all on function public.fn_mia_obrigacao_disparar(uuid, uuid, uuid, text, integer, date, jsonb, boolean) from public;
revoke execute on function public.fn_mia_obrigacao_disparar(uuid, uuid, uuid, text, integer, date, jsonb, boolean) from anon, authenticated;
grant execute on function public.fn_mia_obrigacao_disparar(uuid, uuid, uuid, text, integer, date, jsonb, boolean) to service_role;

-- ── 12. LGPD: anonimizar o contato leva os itens e os arquivos ──────────────
create or replace function public.fn_mia_obrigacoes_do_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  -- Os arquivos primeiro: os dos itens ligados a pessoa e os dos negocios dela,
  -- do ciclo em vigor e do historico.
  insert into public.storage_redaction_queue (organization_id, bucket, object_path)
  select new.organization_id, 'mia-obrigacoes', x.caminho
    from (
      select o.arquivo_path as caminho
        from public.mia_obrigacoes o
       where o.organization_id = new.organization_id
         and (o.contact_id = new.id
              or o.lead_id in (select l.id from public.crm_leads l where l.contact_id = new.id))
      union
      select c.arquivo_path
        from public.mia_obrigacoes_ciclos c
        join public.mia_obrigacoes o on o.id = c.obrigacao_id
       where o.organization_id = new.organization_id
         and (o.contact_id = new.id
              or o.lead_id in (select l.id from public.crm_leads l where l.contact_id = new.id))
    ) x
   where x.caminho is not null
  on conflict (bucket, object_path) do update
    set status = 'pending',
        attempts = 0,
        enqueued_at = now(),
        processed_at = null,
        error_message = null
    where storage_redaction_queue.status in ('deleted', 'skipped');

  -- O que a pessoa mandou para o agente conferir.
  delete from public.mia_obrigacoes_propostas
   where organization_id = new.organization_id and contact_id = new.id;

  -- O que e DA PESSOA sai inteiro, com o historico (cascata).
  delete from public.mia_obrigacoes
   where organization_id = new.organization_id and contact_id = new.id;

  -- O que e dos NEGOCIOS dela fica como registro do negocio, sem arquivo e sem
  -- texto livre: o tipo e as datas nao identificam ninguem.
  update public.mia_obrigacoes_ciclos
     set arquivo_path = null, arquivo_nome = null, arquivo_mime = null, arquivo_bytes = null
   where organization_id = new.organization_id
     and obrigacao_id in (
       select o.id from public.mia_obrigacoes o
        where o.lead_id in (select l.id from public.crm_leads l where l.contact_id = new.id)
     );
  update public.mia_obrigacoes
     set arquivo_path = null, arquivo_nome = null, arquivo_mime = null, arquivo_bytes = null,
         observacao = null, updated_at = now()
   where organization_id = new.organization_id
     and lead_id in (select l.id from public.crm_leads l where l.contact_id = new.id);

  return new;
end
$f$;

comment on function public.fn_mia_obrigacoes_do_contato_anonimizado() is
  'MIA (9018): anonimizar o contato leva as obrigacoes dele. Os itens ligados a pessoa saem inteiros (com historico e propostas); os dos negocios dela ficam sem arquivo e sem observacao; todo arquivo vai para storage_redaction_queue com o bucket mia-obrigacoes. Na mesma transacao da anonimizacao.';

revoke all on function public.fn_mia_obrigacoes_do_contato_anonimizado() from public;
revoke execute on function public.fn_mia_obrigacoes_do_contato_anonimizado() from anon, authenticated;

drop trigger if exists trg_mia_obrigacoes_do_contato_anonimizado on public.contacts;
create trigger trg_mia_obrigacoes_do_contato_anonimizado
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true and old.is_anonymized is distinct from true)
  execute function public.fn_mia_obrigacoes_do_contato_anonimizado();

-- ── 13. fusão: os itens seguem a ficha que ficou ────────────────────────────
create or replace function public.fn_mia_obrigacoes_seguem_o_contato_mesclado()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  update public.mia_obrigacoes
     set contact_id = new.is_merged_into, updated_at = now()
   where organization_id = new.organization_id and contact_id = new.id;
  update public.mia_obrigacoes_propostas
     set contact_id = new.is_merged_into
   where organization_id = new.organization_id and contact_id = new.id;
  return new;
end
$f$;

comment on function public.fn_mia_obrigacoes_seguem_o_contato_mesclado() is
  'MIA (9018): contato mesclado em outro (is_merged_into): as obrigacoes e as propostas dele passam para a ficha que ficou, em vez de ficarem presas na lapide.';

revoke all on function public.fn_mia_obrigacoes_seguem_o_contato_mesclado() from public;
revoke execute on function public.fn_mia_obrigacoes_seguem_o_contato_mesclado() from anon, authenticated;

drop trigger if exists trg_mia_obrigacoes_seguem_o_contato_mesclado on public.contacts;
create trigger trg_mia_obrigacoes_seguem_o_contato_mesclado
  after update of is_merged_into on public.contacts
  for each row
  when (new.is_merged_into is not null and new.is_merged_into is distinct from old.is_merged_into)
  execute function public.fn_mia_obrigacoes_seguem_o_contato_mesclado();

create or replace function public.fn_mia_obrigacoes_seguem_a_empresa_mesclada()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
begin
  update public.mia_obrigacoes
     set empresa_id = new.mesclada_com, updated_at = now()
   where organization_id = new.organization_id and empresa_id = new.id;
  return new;
end
$f$;

comment on function public.fn_mia_obrigacoes_seguem_a_empresa_mesclada() is
  'MIA (9018): empresa mesclada em outra (mesclada_com, 0263): as obrigacoes dela passam para a empresa que ficou.';

revoke all on function public.fn_mia_obrigacoes_seguem_a_empresa_mesclada() from public;
revoke execute on function public.fn_mia_obrigacoes_seguem_a_empresa_mesclada() from anon, authenticated;

drop trigger if exists trg_mia_obrigacoes_seguem_a_empresa_mesclada on public.crm_empresas;
create trigger trg_mia_obrigacoes_seguem_a_empresa_mesclada
  after update of mesclada_com on public.crm_empresas
  for each row
  when (new.mesclada_com is not null and new.mesclada_com is distinct from old.mesclada_com)
  execute function public.fn_mia_obrigacoes_seguem_a_empresa_mesclada();

-- ── 14. as travas do suporte somente leitura alcançam as tabelas novas ──────
--
-- A função é do upstream e é CHAMADA, não copiada (docs/FORK-MIA.md, regra 3):
-- as quatro tabelas que a sessão grava ganham as três restritivas; a dos avisos,
-- que só o servidor grava, fica sem nenhuma.
do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

notify pgrst, 'reload schema';


-- ─── 9019 · as conversões da Meta por etapa seguem as do upstream ───
--
-- Espelho EXATO da migration 9019 (supabase/migrations-mia/), onde está o porquê
-- inteiro. Idempotente, como todo o apêndice. Vai antes da varredura anon, que
-- fecha o arquivo.
--
-- 9019 · as conversões da Meta por etapa seguem as do upstream
--
-- ── O que aconteceu ─────────────────────────────────────────────────────────
--
-- Na .70 (01/10/2026) a MIA pôs no ar a régua da Meta por etapa, em tabelas
-- nossas (9017). Dois dias depois o upstream lançou a dele (1.70, migration
-- 0524, PR #2087): a mesma régua, na tabela `meta_ads_conversion_rules`, com o
-- consumidor `lib/conversoes/etapa-meta.handler.ts` e a tela "O que cada etapa
-- do funil informa à Meta". Pela doutrina do fork ("nunca dois caminhos para a
-- mesma coisa", docs/FORK-MIA.md), a dele virou a principal na .72.
--
-- Os dois consumidores ligados mandariam o mesmo movimento de etapa à Meta duas
-- vezes (chaves diferentes no livro-razão: `Meta:<evento>` e `MetaEtapa:<uuid>`).
-- Por isso o nosso saiu do registro, e esta migration deixa a 9017 inerte no que
-- ela tinha de régua.
--
-- ── O que fica de pé ────────────────────────────────────────────────────────
--
--   · `mia_conversoes_meta_config`: a chave por empresa "leads de formulário da
--     Meta voltam para a Meta". O upstream não tem lead de formulário; o
--     consumidor `conversoes.meta_formulario` (lib/conversoes-meta/) a lê e
--     informa os eventos da régua do UPSTREAM e a venda para esse lead, pela API
--     de conversões para CRM, no mesmo livro-razão e com a mesma chave.
--
-- ── O que fica obsoleto (e não é apagado agora) ─────────────────────────────
--
--   · `mia_conversoes_meta_regras` e o gatilho que carimba `configurada_em`;
--   · `fn_mia_solicitar_reenvio_conversao_meta`: o reenvio de um evento de etapa
--     da Meta é o do upstream (`fn_solicitar_reenvio_conversao`, que aceita
--     `MetaEtapa:<uuid>` desde a 0524). A nossa passa a devolver `false` e não
--     emite mais `conversao_meta.retry_requested`, que ficou sem consumidor.
--
-- Nomes com prefixo `mia_`/`fn_mia_`: só objetos NOSSOS são tocados
-- (docs/FORK-MIA.md, regra 3).

-- ── 1. a régua da 9017 fica obsoleta ────────────────────────────────────────
comment on table public.mia_conversoes_meta_regras is
  'OBSOLETA desde a .72 (MIA 9019): a regua da Meta por etapa e a do upstream (meta_ads_conversion_rules, migration 0524). Nenhum codigo le nem grava esta tabela; pode sair numa fusao futura. Era (9017): qual evento cada etapa aberta informava a Meta.';

comment on function public.fn_mia_marcar_configuracao_regra_meta() is
  'OBSOLETA desde a .72 (MIA 9019): carimbava configurada_em em mia_conversoes_meta_regras, que nao tem mais uso. A trava equivalente do upstream e fn_marcar_configuracao_regra_meta (0524).';

-- ── 2. o reenvio nosso fica inerte ──────────────────────────────────────────
--
-- Mesma assinatura, corpo novo: devolve `false` (o mesmo "não há o que
-- reenviar" que ela já respondia) e não emite evento nenhum.
create or replace function public.fn_mia_solicitar_reenvio_conversao_meta(p_org uuid, p_lead uuid, p_event text)
returns boolean
language plpgsql
set search_path = public
as $f$
begin
  return false;
end
$f$;

comment on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) is
  'OBSOLETA desde a .72 (MIA 9019): devolve false e nao emite evento. O reenvio de um evento de etapa da Meta e o do upstream (fn_solicitar_reenvio_conversao, MetaEtapa:<uuid>, 0524). Pode sair numa fusao futura.';

revoke all on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) from public;
revoke execute on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) from anon, authenticated;
grant execute on function public.fn_mia_solicitar_reenvio_conversao_meta(uuid, uuid, text) to service_role;

-- ── 3. a chave dos formulários continua, com o comentário em dia ─────────────
comment on table public.mia_conversoes_meta_config is
  'MIA (9017, revista na 9019): a chave POR EMPRESA "leads de formulario da Meta voltam para a Meta". Ligada, os eventos da regua do upstream (meta_ads_conversion_rules, 0524) e a venda tambem sao informados para o negocio SEM atribuicao de anuncio que nasceu de formulario da Meta, pelo id do lead guardado (consumidor conversoes.meta_formulario). Sem linha, ou desligada: lead de formulario nao volta para a Meta.';

-- ── 4. aviso, se a régua obsoleta tiver alguma linha ────────────────────────
--
-- Em produção ela estava vazia (05/10/2026). Se uma instalação tiver regra
-- gravada ali, ela NÃO é copiada para a régua do upstream: os eventos não são
-- os mesmos (a 9017 tinha `Schedule` e `SubmitApplication`, fora da lista da
-- Meta para anúncio de WhatsApp), e copiar ligada uma regra que alguém escolheu
-- noutra régua seria decidir por ele. O aviso diz quantas são, para alguém
-- refazê-las na tela.
do $f$
declare
  v_quantas integer;
begin
  select count(*) into v_quantas from public.mia_conversoes_meta_regras;
  if v_quantas > 0 then
    raise notice 'MIA 9019: % regra(s) na regua obsoleta mia_conversoes_meta_regras. Refaca-as em Configuracoes > Conversoes (regua do upstream).', v_quantas;
  end if;
end
$f$;

notify pgrst, 'reload schema';


-- ---- VARREDURA anon: função nova nasce exposta em quem ATUALIZA (migration 0116) ----
--
-- ⚠️ ESTE BLOCO É, DE PROPÓSITO, O ÚLTIMO DO ARQUIVO. Apêndice novo entra ANTES

-- dele — quem o empurrar para o meio desarma a cura para tudo que vier depois.
-- Vigiado por `tests/unit/varredura-anon-e-o-ultimo-bloco.test.ts`.
--
-- A 0108 revogou anon numa LISTA de 8 funções, medida num banco instalado do
-- ZERO. Quem ATUALIZA tem outro estado: o `ALTER DEFAULT PRIVILEGES ... GRANT
-- ALL ON FUNCTIONS TO anon` do corpo deste arquivo grava uma entrada em
-- `pg_default_acl` que fica no catálogo PARA SEMPRE, e a partir daí toda função
-- criada em `public` nasce com EXECUTE para anon — inclusive as deste apêndice.
--
-- Medido numa VPS real (2026-08-07), comparando com o que um install fresco
-- produz: 6 definer expostas a anon e 5 a authenticated, entre elas
-- `fn_decrypt_oauth` — alcançável pela anon key, que vai para o browser.
--
-- Lista conserta o estoque e reabre no próximo `create function`. Esta varredura
-- é auto-curativa e roda DEPOIS de tudo que cria função, então cura no mesmo run
-- em que o defeito nasceria. Desfazer o ALTER DEFAULT PRIVILEGES não serve: ele
-- vem do `pg_dump` do Supabase e é reescrito a cada re-aplicação.
--
-- As duas origens de EXECUTE (a mesma lição da 0108): grant DIRETO a anon, que
-- `revoke from public` não remove; e grant a PUBLIC, do qual anon HERDA, que
-- `revoke from anon` não remove. O privilégio EFETIVO de authenticated e
-- service_role é medido ANTES e devolvido depois — tira anon sem tirar leitura.
do $$
declare
  f record;
  tinha_auth boolean;
  tinha_service boolean;
begin
  if to_regrole('anon') is null then
    return;
  end if;

  for f in
    select p.oid, p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
  loop
    tinha_auth := to_regrole('authenticated') is not null
                  and has_function_privilege('authenticated', f.oid, 'EXECUTE');
    tinha_service := to_regrole('service_role') is not null
                     and has_function_privilege('service_role', f.oid, 'EXECUTE');

    execute format('revoke execute on function %s from public, anon', f.assinatura);

    if tinha_auth then
      execute format('grant execute on function %s to authenticated', f.assinatura);
    end if;
    if tinha_service then
      execute format('grant execute on function %s to service_role', f.assinatura);
    end if;
  end loop;
end $$;

-- regra 2 (authenticated): as 5 que o update abriu e o install não abre. Aqui não
-- cabe varredura — `authenticated` PRECISA de EXECUTE nos helpers de RLS e em
-- `retrieve_top_k_chunks` (num install fresco ele tem). É julgamento por função,
-- e o alvo de cada linha é o valor que um install fresco produz, medido.
revoke execute on function public.fn_audit_log_row() from authenticated;
revoke execute on function public.fn_decrypt_oauth(bytea) from authenticated;
revoke execute on function public.fn_encrypt_oauth(text) from authenticated;
revoke execute on function public.fn_lgpd_cascade_redact_contact(uuid, uuid, uuid) from authenticated;
revoke execute on function public.fn_update_budget_consumption() from authenticated;

grant execute on function public.fn_audit_log_row() to service_role;
grant execute on function public.fn_decrypt_oauth(bytea) to service_role;
grant execute on function public.fn_encrypt_oauth(text) to service_role;
grant execute on function public.fn_lgpd_cascade_redact_contact(uuid, uuid, uuid) to service_role;
grant execute on function public.fn_update_budget_consumption() to service_role;
