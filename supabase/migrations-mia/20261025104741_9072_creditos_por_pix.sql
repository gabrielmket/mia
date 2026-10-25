-- manifest: A JORNADA DE ASSINATURA, PARTE 3 (.90): CRÉDITOS POR PIX pelo mesmo Asaas da cobrança. `mia_pacotes_de_creditos` são os pacotes que a empresa pode comprar (valor em centavos, a partir de R$ 5,00, o mínimo do boleto/Pix do Asaas), configurados pelo MCP (`plataforma_garantir_planos`), nunca no código. `mia_compras_de_creditos` é cada compra: a cobrança avulsa no Asaas (`pagamento_ref`, o link da fatura), a situação (`aguardando` → `paga`, ou `cancelada`/`expirada`) e o lançamento na carteira. O valor só entra na carteira (`tenant_wallet_ledger`, `ref_kind = 'compra_pix'`, `ref_id` = a compra) quando a RELEITURA no Asaas diz pago — nunca pelo corpo do aviso — e o índice único da carteira faz a confirmação repetida não lançar duas vezes; a função `fn_mia_confirmar_compra_de_creditos` lança e marca numa transação só. Só compra quem já é cliente do Asaas (assinou o plano); a empresa isenta segue recebendo crédito pela Time. Só do servidor (RLS ligada, sem política). Nenhum objeto do upstream é tocado.
--
-- 9072 · créditos por Pix
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente.

-- ── 1. os pacotes à venda ───────────────────────────────────────────────────
create table if not exists public.mia_pacotes_de_creditos (
  id uuid primary key default gen_random_uuid(),
  valor_cents bigint not null,
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint mia_pacotes_de_creditos_valor check (valor_cents between 500 and 10000000)
);

comment on table public.mia_pacotes_de_creditos is
  'MIA (9072): os pacotes de credito (Broadcast e e-mail) que a empresa compra por Pix pelo Asaas da instalacao. Valor e dado, configurado pelo MCP. Desativar tira da tela e nao mexe em compra feita.';

create unique index if not exists uq_mia_pacotes_de_creditos_valor_ativo
  on public.mia_pacotes_de_creditos (valor_cents) where ativo;

alter table public.mia_pacotes_de_creditos enable row level security;
revoke all on public.mia_pacotes_de_creditos from anon, authenticated;
grant select, insert, update on public.mia_pacotes_de_creditos to service_role;

drop trigger if exists trg_mia_pacotes_de_creditos_touch on public.mia_pacotes_de_creditos;
create trigger trg_mia_pacotes_de_creditos_touch
  before update on public.mia_pacotes_de_creditos
  for each row execute function public.fn_touch_updated_at();

-- ── 2. cada compra ──────────────────────────────────────────────────────────
create table if not exists public.mia_compras_de_creditos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  valor_cents bigint not null,
  provedor text not null default 'asaas',
  modo text,
  -- A cobrança avulsa no Asaas (`pay_...`). Nula só no instante entre a reserva
  -- e a resposta do provedor (`criando`).
  pagamento_ref text,
  link text,
  pix_copia_e_cola text,
  status text not null default 'criando',
  criada_por uuid references auth.users(id) on delete set null,
  criada_em timestamptz not null default now(),
  paga_em timestamptz,
  encerrada_em timestamptz,
  relida_em timestamptz,
  updated_at timestamptz not null default now(),
  constraint mia_compras_de_creditos_valor check (valor_cents between 500 and 10000000),
  constraint mia_compras_de_creditos_provedor check (provedor in ('asaas')),
  constraint mia_compras_de_creditos_modo check (modo is null or modo in ('teste', 'producao')),
  constraint mia_compras_de_creditos_status
    check (status in ('criando', 'aguardando', 'paga', 'cancelada', 'expirada')),
  constraint mia_compras_de_creditos_ref_quando_aguarda
    check (status = 'criando' or status in ('cancelada', 'expirada') or pagamento_ref is not null)
);

comment on table public.mia_compras_de_creditos is
  'MIA (9072): cada compra de credito por Pix. O valor entra na carteira (tenant_wallet_ledger, ref_kind compra_pix) so quando a releitura no Asaas diz pago, por fn_mia_confirmar_compra_de_creditos. Nenhum dado do pagador fica aqui: o CPF/CNPJ esta so no Asaas. So o servidor le e escreve.';

create unique index if not exists uq_mia_compras_de_creditos_ref
  on public.mia_compras_de_creditos (pagamento_ref) where pagamento_ref is not null;
create index if not exists idx_mia_compras_de_creditos_org
  on public.mia_compras_de_creditos (organization_id, criada_em desc);
create index if not exists idx_mia_compras_de_creditos_aguardando
  on public.mia_compras_de_creditos (status, criada_em) where status in ('criando', 'aguardando');

alter table public.mia_compras_de_creditos enable row level security;
revoke all on public.mia_compras_de_creditos from anon, authenticated;
grant select, insert, update on public.mia_compras_de_creditos to service_role;

drop trigger if exists trg_mia_compras_de_creditos_touch on public.mia_compras_de_creditos;
create trigger trg_mia_compras_de_creditos_touch
  before update on public.mia_compras_de_creditos
  for each row execute function public.fn_touch_updated_at();

-- ── 3. confirmar: o lançamento e a marca numa transação só ──────────────────
-- Chamada DEPOIS de a releitura no Asaas dizer pago (lib/carteira/compra-pelo-asaas.ts).
-- Trava a linha; compra já paga devolve a mesma resposta sem lançar de novo; o
-- índice único da carteira (organization_id, ref_kind, ref_id) é a segunda trava.
create or replace function public.fn_mia_confirmar_compra_de_creditos(p_compra uuid, p_pago_em timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.mia_compras_de_creditos%rowtype;
  v_lancamento uuid;
begin
  select * into v from public.mia_compras_de_creditos where id = p_compra for update;
  if not found then
    raise exception 'compra_inexistente' using errcode = '22023';
  end if;
  if v.status = 'paga' then
    return jsonb_build_object('mudou', false, 'status', 'paga', 'organization_id', v.organization_id);
  end if;
  if v.status not in ('aguardando', 'criando', 'expirada', 'cancelada') or v.pagamento_ref is null then
    raise exception 'compra_sem_pagamento' using errcode = '22023';
  end if;

  insert into public.tenant_wallet_ledger (organization_id, tipo, amount_cents, currency, occurred_at, ref_kind, ref_id, note)
  values (v.organization_id, 'credito', v.valor_cents, 'BRL', coalesce(p_pago_em, now()), 'compra_pix', v.id::text,
          'Créditos comprados por Pix')
  on conflict (organization_id, ref_kind, ref_id) where ref_kind is not null and ref_id is not null do nothing
  returning id into v_lancamento;

  update public.mia_compras_de_creditos
     set status = 'paga', paga_em = coalesce(p_pago_em, now()), relida_em = now()
   where id = v.id;

  return jsonb_build_object('mudou', true, 'status', 'paga', 'organization_id', v.organization_id,
                            'lancou', v_lancamento is not null, 'valor_cents', v.valor_cents);
end;
$$;

revoke execute on function public.fn_mia_confirmar_compra_de_creditos(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.fn_mia_confirmar_compra_de_creditos(uuid, timestamptz) to service_role;

notify pgrst, 'reload schema';
