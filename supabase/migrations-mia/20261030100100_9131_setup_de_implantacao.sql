-- manifest: CUPONS, PARCEIROS E COMISSÃO, PARTE 2 (.97): O SETUP DE IMPLANTAÇÃO (decisão 10 do protótipo "Cupons e parceiros", aprovado em 27/10/2026). Venda ÚNICA e OPCIONAL: o cliente marca "Quero que a Time implante para mim" no passo do pagamento e paga uma cobrança AVULSA no Asaas, separada da mensalidade, com a nota fiscal do serviço próprio do setup (configuração da nota na Conexão). `mia_plano_setup` guarda o preço do setup de cada plano (Admin › Cobrança › Módulos dos planos), ao lado de `cobranca_planos` (do upstream), sem tocá-la. `mia_setup_da_empresa` é a venda de cada empresa (uma): o preço cheio, o desconto do cupom (separado do da mensalidade, definido no próprio cupom), o valor cobrado, a cobrança no Asaas, o Pix, a situação (aguardando, pago, cortesia quando o desconto zera o valor, cancelado, estornado), o pagamento e a nota pedida na confirmação. Só o servidor (RLS ligada, sem política). Nenhum objeto do upstream é redefinido.
--
-- 9131 · o setup de implantação
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: aplicar duas vezes dá zero erro.

-- ── 1. o preço do setup de cada plano ───────────────────────────────────────
create table if not exists public.mia_plano_setup (
  plano_id uuid primary key references public.cobranca_planos(id) on delete cascade,
  -- O preço cheio do setup, em centavos. Sem linha (ou zero) = o plano não oferece setup.
  preco_cents integer not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint mia_plano_setup_preco check (preco_cents >= 0 and preco_cents <= 100000000)
);

comment on table public.mia_plano_setup is
  'MIA (9131): o preco do setup de implantacao de cada plano (venda unica e opcional, no passo do pagamento). Da INSTALACAO: so a plataforma (RLS sem politica).';

alter table public.mia_plano_setup enable row level security;
revoke all on public.mia_plano_setup from anon, authenticated;
grant select, insert, update, delete on public.mia_plano_setup to service_role;

drop trigger if exists trg_mia_plano_setup_touch on public.mia_plano_setup;
create trigger trg_mia_plano_setup_touch
  before update on public.mia_plano_setup
  for each row execute function public.fn_touch_updated_at();

-- ── 2. o setup vendido a cada empresa ───────────────────────────────────────
create table if not exists public.mia_setup_da_empresa (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  plano_id uuid references public.cobranca_planos(id) on delete set null,
  -- O preço cheio do plano no pedido, o desconto do cupom e o que foi cobrado.
  preco_cents integer not null,
  desconto_cents integer not null default 0,
  valor_cents integer not null,
  -- 'aguardando' (cobrança aberta), 'pago', 'cortesia' (o desconto zerou o
  -- valor: nada a cobrar), 'cancelado' (desistiu antes de pagar) ou 'estornado'.
  situacao text not null,
  -- O cliente no Asaas (cus_...) e a cobrança avulsa (pay_...) com a fatura dela.
  cliente_ref text,
  pagamento_ref text,
  fatura_url text,
  pix_copia_e_cola text,
  pix_gerado_em timestamptz,
  pedido_em timestamptz not null default now(),
  pedido_por uuid references auth.users(id) on delete set null,
  pago_em timestamptz,
  forma_paga text,
  -- A nota do setup, pedida ao Asaas quando o pagamento confirma.
  nota_ref text,
  nota_pedida_em timestamptz,
  nota_tentativas integer not null default 0,
  nota_erro text,
  conferido_em timestamptz,
  updated_at timestamptz not null default now(),
  constraint mia_setup_da_empresa_situacao check (situacao in ('aguardando', 'pago', 'cortesia', 'cancelado', 'estornado')),
  constraint mia_setup_da_empresa_valores check (
    preco_cents >= 0 and desconto_cents >= 0 and valor_cents >= 0 and valor_cents = preco_cents - desconto_cents
  ),
  constraint mia_setup_da_empresa_cobranca check (situacao <> 'aguardando' or pagamento_ref is not null),
  constraint mia_setup_da_empresa_nota_erro check (nota_erro is null or char_length(nota_erro) <= 80)
);

comment on table public.mia_setup_da_empresa is
  'MIA (9131): o setup de implantacao vendido a cada empresa (venda unica): preco cheio, desconto do cupom, valor cobrado, a cobranca avulsa no Asaas, a situacao, o pagamento e a nota do servico do setup. So o servidor (RLS sem politica).';

alter table public.mia_setup_da_empresa enable row level security;
revoke all on public.mia_setup_da_empresa from anon, authenticated;
grant select, insert, update, delete on public.mia_setup_da_empresa to service_role;

drop trigger if exists trg_mia_setup_da_empresa_touch on public.mia_setup_da_empresa;
create trigger trg_mia_setup_da_empresa_touch
  before update on public.mia_setup_da_empresa
  for each row execute function public.fn_touch_updated_at();

notify pgrst, 'reload schema';
