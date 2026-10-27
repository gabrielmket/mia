-- manifest: O PAGAMENTO NO INÍCIO, PARTE 2 (.96): O PASSO "PAGAMENTO" DA ENTRADA PAGA. `mia_pagamento_inicial` é o retrato do primeiro pagamento de uma empresa que nasceu num plano de entrada paga (0 dia de teste, `cobranca_assinaturas.pagamento_inicial_pendente` do upstream): o plano da cobrança gerada, a forma escolhida (Pix, cartão digitado na tela pelo checkout transparente do Asaas, boleto), a cobrança no Asaas (a primeira da assinatura, `pagamento_ref`), o Pix copia e cola, a linha digitável e o PDF do boleto, os 4 últimos números e a bandeira do cartão (devolvidos pelo Asaas; o número inteiro e o código de segurança NUNCA são gravados), as recusas do cartão, a última leitura direta no Asaas (a trava das releituras da tela) e o lembrete do dia seguinte (um só, decisão 6). Quem decide que pagou continua sendo a releitura do upstream (`sincronizar`), nunca o corpo do aviso. `mia_nota_da_assinatura` diz para qual assinatura do Asaas o fork já pediu a nota fiscal NA CONFIRMAÇÃO do pagamento (`invoiceSettings` com `ON_PAYMENT_CONFIRMATION`, decisão 8): Pix vencido, boleto cancelado e cobrança refeita nunca geram nota. As duas são só do servidor; o administrador da empresa e a plataforma leem a primeira. LGPD: cascata com a empresa, e a empresa redigida perde as duas pelo gatilho `trg_mia_pagamento_inicial_sai_com_a_empresa_redigida`. Só objetos nossos.
--
-- 9121 · o passo do pagamento
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: aplicar duas vezes dá zero erro.

-- ── 1. o primeiro pagamento da entrada paga ─────────────────────────────────
create table if not exists public.mia_pagamento_inicial (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- O plano com que a cobrança foi gerada. Trocar de plano antes de pagar (decisão 7)
  -- cancela a cobrança no Asaas e refaz.
  plano_id uuid references public.cobranca_planos(id) on delete set null,
  situacao text not null default 'sem_cobranca',
  forma text,
  -- A cobrança no Asaas (`pay_...`, a primeira da assinatura) e a assinatura (`sub_...`).
  pagamento_ref text,
  assinatura_ref text,
  valor_cents integer,
  vence_em date,
  fatura_url text,
  pix_copia_e_cola text,
  pix_gerado_em timestamptz,
  boleto_linha text,
  boleto_url text,
  boleto_gerado_em timestamptz,
  -- Do cartão, só o que o Asaas devolve depois de cobrar: os 4 últimos números e a bandeira.
  cartao_final text,
  cartao_bandeira text,
  cartao_recusas integer not null default 0,
  cartao_recusado_em timestamptz,
  -- As próximas mensalidades caem no cartão? 'ok' ou 'falhou' (a pessoa troca depois).
  cartao_recorrente text,
  -- A reserva curta de quem está gerando ou cobrando agora (dois cliques, duas abas).
  reserva_ate timestamptz,
  gerada_em timestamptz,
  pago_em timestamptz,
  forma_paga text,
  -- A última leitura DIRETA no Asaas pela tela (a trava: no máximo uma a cada poucos segundos).
  conferido_em timestamptz,
  lembrete_enviado_em timestamptz,
  cobrancas_refeitas integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mia_pagamento_inicial_situacao
    check (situacao in ('sem_cobranca', 'aguardando', 'em_analise', 'recusado', 'pago')),
  constraint mia_pagamento_inicial_forma check (forma is null or forma in ('pix', 'cartao', 'boleto')),
  constraint mia_pagamento_inicial_forma_paga check (forma_paga is null or forma_paga in ('pix', 'cartao', 'boleto', 'outra')),
  constraint mia_pagamento_inicial_cartao_final check (cartao_final is null or cartao_final ~ '^[0-9]{4}$'),
  constraint mia_pagamento_inicial_cartao_bandeira check (cartao_bandeira is null or cartao_bandeira ~ '^[A-Z_]{2,30}$'),
  constraint mia_pagamento_inicial_cartao_recorrente check (cartao_recorrente is null or cartao_recorrente in ('ok', 'falhou')),
  constraint mia_pagamento_inicial_ref_quando_aguarda
    check (situacao in ('sem_cobranca', 'pago') or pagamento_ref is not null),
  constraint mia_pagamento_inicial_valor check (valor_cents is null or valor_cents > 0)
);

comment on table public.mia_pagamento_inicial is
  'MIA (9121): o primeiro pagamento da entrada paga (o passo Pagamento do inicio). Guarda a cobranca no Asaas, o Pix copia e cola, a linha do boleto e, do cartao, so os 4 ultimos numeros e a bandeira devolvidos pelo Asaas. O numero e o codigo de seguranca nunca sao gravados. Le: admin da empresa e a plataforma. Escreve: so o servidor.';

create index if not exists idx_mia_pagamento_inicial_aguardando
  on public.mia_pagamento_inicial (situacao, gerada_em)
  where situacao in ('aguardando', 'em_analise', 'recusado');

alter table public.mia_pagamento_inicial enable row level security;
drop policy if exists mia_pagamento_inicial_admin_le on public.mia_pagamento_inicial;
create policy mia_pagamento_inicial_admin_le on public.mia_pagamento_inicial
  for select to authenticated
  using (public.fn_role_at_least(organization_id, 'admin') or public.fn_is_platform_admin());
revoke all on public.mia_pagamento_inicial from anon, authenticated;
grant select on public.mia_pagamento_inicial to authenticated;
grant select, insert, update, delete on public.mia_pagamento_inicial to service_role;

drop trigger if exists trg_mia_pagamento_inicial_touch on public.mia_pagamento_inicial;
create trigger trg_mia_pagamento_inicial_touch
  before update on public.mia_pagamento_inicial
  for each row execute function public.fn_touch_updated_at();

-- ── 2. a nota fiscal pedida na confirmação do pagamento ─────────────────────
create table if not exists public.mia_nota_da_assinatura (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- A assinatura do Asaas (`sub_...`) para a qual a configuração foi gravada.
  assinatura_ref text not null,
  configurada_em timestamptz,
  tentativas integer not null default 0,
  -- Só o código do Asaas, nunca a descrição.
  ultimo_erro text,
  updated_at timestamptz not null default now(),
  constraint mia_nota_da_assinatura_erro check (ultimo_erro is null or char_length(ultimo_erro) <= 80)
);

comment on table public.mia_nota_da_assinatura is
  'MIA (9121): para qual assinatura do Asaas o fork ja pediu a nota fiscal na confirmacao do pagamento (invoiceSettings ON_PAYMENT_CONFIRMATION). Assinatura nova (troca de plano, cobranca refeita) e configurada de novo pela rodada. So o servidor.';

alter table public.mia_nota_da_assinatura enable row level security;
revoke all on public.mia_nota_da_assinatura from anon, authenticated;
grant select, insert, update, delete on public.mia_nota_da_assinatura to service_role;

drop trigger if exists trg_mia_nota_da_assinatura_touch on public.mia_nota_da_assinatura;
create trigger trg_mia_nota_da_assinatura_touch
  before update on public.mia_nota_da_assinatura
  for each row execute function public.fn_touch_updated_at();

-- ── 3. LGPD: a empresa redigida perde o retrato do pagamento ────────────────
create or replace function public.fn_mia_pagamento_inicial_sai_com_a_empresa_redigida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'redacted' and old.status is distinct from 'redacted' then
    delete from public.mia_pagamento_inicial where organization_id = new.id;
    delete from public.mia_nota_da_assinatura where organization_id = new.id;
  end if;
  return null;
end;
$$;

revoke execute on function public.fn_mia_pagamento_inicial_sai_com_a_empresa_redigida() from public, anon, authenticated;

drop trigger if exists trg_mia_pagamento_inicial_sai_com_a_empresa_redigida on public.organizations;
create trigger trg_mia_pagamento_inicial_sai_com_a_empresa_redigida
  after update of status on public.organizations
  for each row execute function public.fn_mia_pagamento_inicial_sai_com_a_empresa_redigida();

notify pgrst, 'reload schema';
