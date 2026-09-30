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

revoke all on public.tenant_wallet_ledger from anon;
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

revoke all on public.tenant_broadcast_pricing from anon;
grant select on public.tenant_broadcast_pricing to authenticated;
grant select, insert, update on public.tenant_broadcast_pricing to service_role;
