-- manifest: CUPONS, PARCEIROS E COMISSÃO, PARTE 3 (.97): AS COMISSÕES E OS REPASSES (decisões 1 a 4, 10 e 11 do protótipo "Cupons e parceiros", aprovado em 27/10/2026). `mia_comissoes` é o lançamento de cada cobrança PAGA de um cliente de parceiro: a mensalidade (dentro do prazo da comissão) e o setup (venda única), com a conta inteira gravada no dia: o valor pago (já com o desconto), a alíquota do Simples vigente (Admin › Cobrança, um campo para todo o sistema; mudar vale para os pagamentos seguintes), o imposto, a taxa REAL do Asaas daquela cobrança (valor menos o `netValue`), o líquido, o percentual e a comissão; um por cobrança e tipo. Estorno ou chargeback de cobrança já comissionada vira um lançamento NEGATIVO, que desconta no repasse seguinte. Créditos, Broadcast e e-mail avulso não geram comissão; setup vendido sem parceiro também não. `mia_repasses` fecha o mês de cada parceiro (no dia 1, configurável): o total, o extrato mandado por e-mail, o anexo da nota (CNPJ) ou do recibo (CPF) que a Time guarda até o dia 5, e o pagamento por Pix feito por fora até o dia 10, com a data e quem marcou; sem o anexo NÃO dá para marcar como pago (CHECK). O anexo mora no bucket PRIVADO `mia-repasses` (sem política em `storage.objects`: só o servidor, com link assinado). Só a plataforma lê e escreve (RLS ligada, sem política). LGPD do parceiro (uma pessoa): `fn_mia_anonimizar_parceiro` apaga nome, documento, e-mail e chave Pix, pausa o parceiro e tira a referência do anexo dos repasses (o servidor apaga o arquivo do armazenamento antes); os valores ficam, como registro financeiro. Nenhum objeto do upstream é redefinido.
--
-- 9132 · as comissões e os repasses
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: aplicar duas vezes dá zero erro.

-- ── 1. o repasse do mês de cada parceiro ────────────────────────────────────
create table if not exists public.mia_repasses (
  id uuid primary key default gen_random_uuid(),
  parceiro_id uuid not null references public.mia_parceiros(id) on delete restrict,
  -- O mês fechado: o primeiro dia dele.
  competencia date not null,
  total_cents integer not null,
  fechado_em timestamptz not null default now(),
  -- O extrato por e-mail ao parceiro.
  extrato_enviado_em timestamptz,
  extrato_erro text,
  -- A nota (CNPJ) ou o recibo (CPF) que o parceiro manda e a Time anexa.
  anexo_path text,
  anexo_nome text,
  anexo_tipo text,
  anexo_em timestamptz,
  anexo_por uuid references auth.users(id) on delete set null,
  -- LGPD: o anexo do parceiro anonimizado sai (o registro do repasse fica).
  anexo_removido_em timestamptz,
  -- O Pix feito por fora pela Time.
  pago_em timestamptz,
  pago_por uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint mia_repasses_competencia check (extract(day from competencia) = 1),
  constraint mia_repasses_um_por_mes unique (parceiro_id, competencia),
  constraint mia_repasses_total check (total_cents > 0),
  -- Sem a nota ou o recibo, o repasse fica "aguardando nota" e não vira pago.
  constraint mia_repasses_pago_com_anexo check (pago_em is null or anexo_em is not null),
  constraint mia_repasses_extrato_erro check (extrato_erro is null or char_length(extrato_erro) <= 80)
);

comment on table public.mia_repasses is
  'MIA (9132): o repasse do mes de cada parceiro: total, extrato por e-mail, anexo da nota ou recibo (bucket privado mia-repasses) e o Pix marcado como pago (data e quem marcou). Sem anexo nao vira pago (CHECK). So a plataforma.';

create index if not exists mia_repasses_competencia_idx on public.mia_repasses (competencia);

alter table public.mia_repasses enable row level security;
revoke all on public.mia_repasses from anon, authenticated;
grant select, insert, update, delete on public.mia_repasses to service_role;

drop trigger if exists trg_mia_repasses_touch on public.mia_repasses;
create trigger trg_mia_repasses_touch
  before update on public.mia_repasses
  for each row execute function public.fn_touch_updated_at();

-- ── 2. a comissão de cada cobrança paga ─────────────────────────────────────
create table if not exists public.mia_comissoes (
  id uuid primary key default gen_random_uuid(),
  parceiro_id uuid not null references public.mia_parceiros(id) on delete restrict,
  -- A empresa que pagou. Apagada a empresa, o lançamento fica (é registro financeiro).
  organization_id uuid references public.organizations(id) on delete set null,
  -- 'mensalidade', 'setup' ou 'estorno' (negativo, de um lançamento anterior).
  tipo text not null,
  -- A cobrança no Asaas (pay_...).
  pagamento_ref text not null,
  estorno_de uuid references public.mia_comissoes(id) on delete restrict,
  -- O dia do pagamento (ou do estorno), em São Paulo, e o mês em que ele conta.
  pago_em date not null,
  competencia date not null,
  -- A conta inteira, gravada no dia (o extrato mostra; mudar a alíquota depois não mexe).
  valor_pago_cents integer not null,
  aliquota_pct numeric(5,2) not null,
  imposto_cents integer not null,
  taxa_cents integer not null,
  liquido_cents integer not null,
  comissao_pct numeric(5,2) not null,
  comissao_cents integer not null,
  repasse_id uuid references public.mia_repasses(id) on delete set null,
  criado_em timestamptz not null default now(),
  constraint mia_comissoes_tipo check (tipo in ('mensalidade', 'setup', 'estorno')),
  constraint mia_comissoes_uma_por_cobranca unique (pagamento_ref, tipo),
  constraint mia_comissoes_competencia check (extract(day from competencia) = 1),
  constraint mia_comissoes_estorno check ((tipo = 'estorno') = (estorno_de is not null)),
  constraint mia_comissoes_sinal check (
    (tipo = 'estorno' and comissao_cents <= 0) or (tipo <> 'estorno' and comissao_cents >= 0)
  ),
  constraint mia_comissoes_percentuais check (
    aliquota_pct >= 0 and aliquota_pct <= 100 and comissao_pct >= 0 and comissao_pct <= 100
  )
);

comment on table public.mia_comissoes is
  'MIA (9132): a comissao de cada cobranca paga de cliente de parceiro (mensalidade no prazo e setup), sobre o LIQUIDO: valor pago com desconto, menos o imposto (aliquota do Simples vigente), menos a taxa real do Asaas (valor - netValue). Estorno ou chargeback vira lancamento negativo. Uma por cobranca e tipo. So a plataforma.';

create index if not exists mia_comissoes_parceiro_aberto on public.mia_comissoes (parceiro_id, competencia) where repasse_id is null;
create index if not exists mia_comissoes_org on public.mia_comissoes (organization_id);
create index if not exists mia_comissoes_repasse on public.mia_comissoes (repasse_id) where repasse_id is not null;

alter table public.mia_comissoes enable row level security;
revoke all on public.mia_comissoes from anon, authenticated;
grant select, insert, update, delete on public.mia_comissoes to service_role;

-- ── 3. a área privada dos anexos ────────────────────────────────────────────
-- Sem policy em `storage.objects`, como `mia-obrigacoes`: só o servidor
-- (service_role) lê e grava; a tela recebe link assinado. 10 MB: nota em PDF,
-- XML ou a foto do recibo.
insert into storage.buckets (id, name, public, file_size_limit)
values ('mia-repasses', 'mia-repasses', false, 10485760)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- ── 4. LGPD: o parceiro anonimizado ─────────────────────────────────────────
-- O pedido do titular (o parceiro é uma pessoa: CPF, e-mail, Pix). Os números do
-- repasse e das comissões ficam (registro financeiro, sem dado da pessoa); o
-- anexo (nota ou recibo) sai: o servidor apaga o arquivo do armazenamento ANTES
-- e esta função tira a referência. Devolve quantos repasses perderam o anexo.
create or replace function public.fn_mia_anonimizar_parceiro(p_parceiro uuid, p_ator uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_anexos integer := 0;
begin
  perform 1 from public.mia_parceiros where id = p_parceiro for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  update public.mia_parceiros
     set nome = 'Parceiro anonimizado',
         tipo_documento = null,
         documento = null,
         email = null,
         chave_pix = null,
         ativo = false,
         anonimizado_em = coalesce(anonimizado_em, now()),
         updated_by = p_ator
   where id = p_parceiro;
  update public.mia_repasses
     set anexo_path = null, anexo_nome = null, anexo_removido_em = now()
   where parceiro_id = p_parceiro and anexo_path is not null;
  get diagnostics v_anexos = row_count;
  return jsonb_build_object('ok', true, 'anexos_removidos', v_anexos);
end;
$$;

comment on function public.fn_mia_anonimizar_parceiro(uuid, uuid) is
  'MIA (9132): LGPD do parceiro. Apaga nome, documento, e-mail e chave Pix, pausa o parceiro e tira o anexo dos repasses (o servidor apaga o arquivo antes). Os valores ficam (registro financeiro). So o servidor.';

revoke all on function public.fn_mia_anonimizar_parceiro(uuid, uuid) from public;
revoke execute on function public.fn_mia_anonimizar_parceiro(uuid, uuid) from anon, authenticated;
grant execute on function public.fn_mia_anonimizar_parceiro(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
