-- manifest: CUPONS, PARCEIROS E COMISSÃO, PARTE 1 (.98): OS PARCEIROS, OS CUPONS E O CUPOM DE CADA EMPRESA (protótipo "Cupons e parceiros" aprovado pelo Gabriel em 27/10/2026, versão 9). `mia_parceiros` é quem indica: nome, CPF ou CNPJ, e-mail do extrato, chave Pix, a comissão da mensalidade (% e prazo de 6, 12 ou 24 meses, ou enquanto o cliente pagar) e a do setup (%, venda única). `mia_cupons` é o código que o parceiro divulga (`app.iamia.com.br/precos?cupom=CODIGO`): desconto em % ou em R$ por 1, 3, 6, 12 ou todas as mensalidades, ou dias grátis; o desconto no setup (nenhum, % ou R$); os planos em que vale; validade; limite de usos; o parceiro e a comissão própria (vazia usa a do parceiro). Cupom não se apaga: pausa (a FK do uso é `restrict`). `mia_cupom_da_empresa` é o cupom de cada cliente (um só), com o RETRATO do combinado no dia em que entrou (o desconto, os planos) e o da comissão, fixado no primeiro pagamento (mudar a comissão do parceiro vale só para os clientes novos). `fn_mia_aplicar_cupom` é a régua única: inexistente, pausado, vencido, esgotado (limite sob trava da linha do cupom), fora do plano, plano escondido, um cupom por cliente e, depois do primeiro pagamento, só a Time troca; o cupom de dias grátis usa o MESMO mecanismo do teste do plano (vale o maior, sem somar; a entrada paga vira teste e a empresa é liberada). `mia_cupom_do_cadastro` é a passagem do cadastro público (a empresa ainda não existe) e o gatilho ADIADO `trg_mia_cupom_nasce_com_a_empresa` aplica o cupom no fim da transação que cria a empresa, depois de o gatilho da entrada paga do upstream (0679) ter criado a assinatura. Os dados do parceiro são só da plataforma (RLS ligada, sem política); LGPD: `fn_mia_anonimizar_parceiro` (9132) apaga nome, documento, e-mail e Pix e tira o anexo dos repasses (o arquivo sai do armazenamento pelo servidor). Só objetos nossos; nenhum objeto do upstream é redefinido.
--
-- 9130 · os parceiros e os cupons
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: aplicar duas vezes dá zero erro.

-- ── 1. os parceiros ─────────────────────────────────────────────────────────
create table if not exists public.mia_parceiros (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  -- 'cpf' (recibo) ou 'cnpj' (nota). Nulo só no parceiro anonimizado.
  tipo_documento text,
  -- Só os caracteres: CPF com 11 dígitos; CNPJ com 14 (o alfanumérico da Receita).
  documento text,
  -- Para onde vai o extrato do mês.
  email text,
  chave_pix text,
  -- A comissão da MENSALIDADE: o percentual e por quantos meses de cada cliente
  -- (6, 12 ou 24); nulo = enquanto o cliente pagar.
  comissao_pct numeric(5,2) not null,
  comissao_meses integer,
  -- A comissão do SETUP de implantação: venda única, paga uma vez.
  comissao_setup_pct numeric(5,2) not null default 0,
  ativo boolean not null default true,
  anonimizado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint mia_parceiros_nome check (char_length(btrim(nome)) between 2 and 120),
  constraint mia_parceiros_dados check (
    anonimizado_em is not null
    or (
      ((tipo_documento = 'cpf' and documento ~ '^[0-9]{11}$')
        or (tipo_documento = 'cnpj' and documento ~ '^[0-9A-Z]{12}[0-9]{2}$'))
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      and char_length(email) <= 160
      and char_length(btrim(coalesce(chave_pix, ''))) between 1 and 140
    )
  ),
  constraint mia_parceiros_comissao check (comissao_pct >= 0 and comissao_pct <= 100),
  constraint mia_parceiros_comissao_setup check (comissao_setup_pct >= 0 and comissao_setup_pct <= 100),
  constraint mia_parceiros_meses check (comissao_meses is null or comissao_meses in (6, 12, 24))
);

comment on table public.mia_parceiros is
  'MIA (9130): quem indica clientes pelos cupons. Nome, CPF ou CNPJ, e-mail do extrato, chave Pix, comissao da mensalidade (% e meses; nulo = enquanto pagar) e do setup (%, venda unica). So a plataforma (RLS sem politica, service_role). LGPD: fn_mia_anonimizar_parceiro.';

-- Um parceiro por documento: é a chave do "garantir" do MCP.
create unique index if not exists mia_parceiros_documento
  on public.mia_parceiros (documento) where documento is not null;

alter table public.mia_parceiros enable row level security;
revoke all on public.mia_parceiros from anon, authenticated;
grant select, insert, update, delete on public.mia_parceiros to service_role;

drop trigger if exists trg_mia_parceiros_touch on public.mia_parceiros;
create trigger trg_mia_parceiros_touch
  before update on public.mia_parceiros
  for each row execute function public.fn_touch_updated_at();

-- ── 2. os cupons ────────────────────────────────────────────────────────────
create table if not exists public.mia_cupons (
  id uuid primary key default gen_random_uuid(),
  -- Letras e números, sem espaço: é o que vai no link do parceiro.
  codigo text not null,
  -- 'pct' (desconto em %), 'reais' (desconto em R$) ou 'dias' (dias grátis).
  beneficio text not null,
  -- O percentual, os reais ou os dias.
  valor numeric(10,2) not null,
  -- Por quantas mensalidades vale o desconto (1, 3, 6 ou 12); nulo = todas. Nulo nos dias grátis.
  meses integer,
  -- O desconto no SETUP de implantação, separado do da mensalidade.
  setup_tipo text not null default 'nenhum',
  setup_valor numeric(10,2) not null default 0,
  -- Os planos em que vale (ids de cobranca_planos).
  planos uuid[] not null,
  -- Vale até este dia, inclusive (dia civil de São Paulo). Nulo = sem prazo.
  vale_ate date,
  -- Quantas empresas podem usar. Nulo = sem limite.
  limite_de_usos integer,
  parceiro_id uuid references public.mia_parceiros(id) on delete restrict,
  -- A comissão deste cupom; nula = a do parceiro.
  comissao_pct numeric(5,2),
  -- Pausado = false. Cupom não se apaga.
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint mia_cupons_codigo check (codigo ~ '^[A-Z0-9]{3,20}$'),
  constraint mia_cupons_beneficio check (beneficio in ('pct', 'reais', 'dias')),
  constraint mia_cupons_valor check (
    (beneficio = 'pct' and valor > 0 and valor < 100)
    or (beneficio = 'reais' and valor > 0 and valor <= 100000)
    or (beneficio = 'dias' and valor >= 1 and valor <= 365 and valor = trunc(valor))
  ),
  constraint mia_cupons_meses check (
    (beneficio = 'dias' and meses is null)
    or (beneficio <> 'dias' and (meses is null or meses in (1, 3, 6, 12)))
  ),
  constraint mia_cupons_setup check (
    (setup_tipo = 'nenhum' and setup_valor = 0)
    or (setup_tipo = 'pct' and setup_valor > 0 and setup_valor <= 100)
    or (setup_tipo = 'reais' and setup_valor > 0 and setup_valor <= 1000000)
  ),
  constraint mia_cupons_planos check (cardinality(planos) between 1 and 50),
  constraint mia_cupons_limite check (limite_de_usos is null or limite_de_usos >= 1),
  constraint mia_cupons_comissao check (
    comissao_pct is null or (parceiro_id is not null and comissao_pct >= 0 and comissao_pct <= 100)
  )
);

comment on table public.mia_cupons is
  'MIA (9130): os cupons de assinatura. Desconto em % ou R$ por N mensalidades (nulo = todas) ou dias gratis; desconto no setup; planos; validade; limite de usos; parceiro e comissao propria. Nao se apaga: pausa (ativo = false). So a plataforma.';

create unique index if not exists mia_cupons_codigo_unico on public.mia_cupons (codigo);

alter table public.mia_cupons enable row level security;
revoke all on public.mia_cupons from anon, authenticated;
grant select, insert, update, delete on public.mia_cupons to service_role;

drop trigger if exists trg_mia_cupons_touch on public.mia_cupons;
create trigger trg_mia_cupons_touch
  before update on public.mia_cupons
  for each row execute function public.fn_touch_updated_at();

-- ── 3. o cupom de cada empresa ──────────────────────────────────────────────
create table if not exists public.mia_cupom_da_empresa (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- Cupom usado nunca se apaga: a FK recusa.
  cupom_id uuid not null references public.mia_cupons(id) on delete restrict,
  -- O parceiro do cliente: vem do cupom e não muda sozinho (a Time troca na ficha).
  parceiro_id uuid references public.mia_parceiros(id) on delete restrict,
  -- Desde quando o parceiro é deste cliente: só os pagamentos a partir deste dia
  -- geram comissão para ele (a troca pela Time não paga o passado ao novo).
  parceiro_desde timestamptz not null default now(),
  -- O COMBINADO no dia em que o cupom entrou: o cliente fica com ele mesmo que o
  -- cupom mude ou pause depois.
  codigo text not null,
  beneficio text not null,
  valor numeric(10,2) not null,
  meses integer,
  setup_tipo text not null,
  setup_valor numeric(10,2) not null,
  planos uuid[] not null,
  -- A COMISSÃO, fixada no primeiro pagamento (mensalidade ou setup).
  comissao_pct numeric(5,2),
  comissao_meses integer,
  comissao_setup_pct numeric(5,2),
  termos_fixados_em timestamptz,
  -- O vencimento da primeira mensalidade paga: o início da janela da comissão.
  primeira_mensalidade_em date,
  origem text not null,
  aplicado_em timestamptz not null default now(),
  aplicado_por uuid references auth.users(id) on delete set null,
  -- Os dias grátis que o cupom deu (o maior entre o teste do plano e o cupom).
  dias_aplicados integer,
  -- O desconto no Asaas: a última conferência e quando acabou (o preço cheio voltou).
  desconto_conferido_em timestamptz,
  desconto_encerrado_em timestamptz,
  -- A última leitura das cobranças para a comissão.
  comissoes_lidas_em timestamptz,
  updated_at timestamptz not null default now(),
  constraint mia_cupom_da_empresa_origem check (origem in ('cadastro', 'pagamento', 'time')),
  constraint mia_cupom_da_empresa_beneficio check (beneficio in ('pct', 'reais', 'dias')),
  constraint mia_cupom_da_empresa_setup check (setup_tipo in ('nenhum', 'pct', 'reais'))
);

comment on table public.mia_cupom_da_empresa is
  'MIA (9130): o cupom de cada empresa (um por cliente) e o parceiro ligado a ela, com o retrato do desconto combinado e a comissao fixada no primeiro pagamento. So o servidor (RLS sem politica). Escrita pela fn_mia_aplicar_cupom e pela Time (ficha da empresa, com MFA e Audit Log).';

create index if not exists mia_cupom_da_empresa_cupom on public.mia_cupom_da_empresa (cupom_id);
create index if not exists mia_cupom_da_empresa_parceiro on public.mia_cupom_da_empresa (parceiro_id) where parceiro_id is not null;

alter table public.mia_cupom_da_empresa enable row level security;
revoke all on public.mia_cupom_da_empresa from anon, authenticated;
grant select, insert, update, delete on public.mia_cupom_da_empresa to service_role;

drop trigger if exists trg_mia_cupom_da_empresa_touch on public.mia_cupom_da_empresa;
create trigger trg_mia_cupom_da_empresa_touch
  before update on public.mia_cupom_da_empresa
  for each row execute function public.fn_touch_updated_at();

-- ── 4. a passagem do cadastro público ───────────────────────────────────────
-- A conta existe (GoTrue) e a empresa ainda não: o código espera pelo usuário.
create table if not exists public.mia_cupom_do_cadastro (
  user_id uuid primary key references auth.users(id) on delete cascade,
  codigo text not null,
  created_at timestamptz not null default now(),
  constraint mia_cupom_do_cadastro_codigo check (codigo ~ '^[A-Z0-9]{3,20}$')
);

comment on table public.mia_cupom_do_cadastro is
  'MIA (9130): o cupom do cadastro publico esperando a empresa nascer. O gatilho adiado trg_mia_cupom_nasce_com_a_empresa aplica e apaga a linha; com mais de 30 dias, sai. So o servidor.';

alter table public.mia_cupom_do_cadastro enable row level security;
revoke all on public.mia_cupom_do_cadastro from anon, authenticated;
grant select, insert, update, delete on public.mia_cupom_do_cadastro to service_role;

-- ── 5. a régua única de aplicar um cupom ────────────────────────────────────
-- Devolve {ok, motivo, ...}. Motivos: cobranca_desligada, inexistente, pausado,
-- vencido, isenta, ja_tem_cupom, ja_pagou, plano_escondido, fora_do_plano,
-- esgotado. A linha do cupom é travada (`for update`): duas empresas usando o
-- último uso ao mesmo tempo, uma leva e a outra recebe "esgotado".
-- `p_origem = 'time'` (a ficha da empresa) troca o cupom de quem já tem e vale
-- depois do primeiro pagamento; o cadastro e o passo do pagamento, não.
-- Dias grátis: o MESMO teste do plano (estado trial até `trial_ate`), vale o
-- maior, sem somar. Só para quem nunca pagou e ainda não tem assinatura no
-- Asaas (o servidor cancela a cobrança em aberto antes de chamar).
create or replace function public.fn_mia_aplicar_cupom(p_org uuid, p_codigo text, p_origem text, p_ator uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
  c public.mia_cupons%rowtype;
  a public.cobranca_assinaturas%rowtype;
  v_oferecido boolean;
  v_usos integer;
  v_atual public.mia_cupom_da_empresa%rowtype;
  v_tinha boolean := false;
  v_inicio timestamptz;
  v_fim timestamptz;
  v_dias integer := null;
  v_status text;
  v_kind text;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_origem is null or p_origem not in ('cadastro', 'pagamento', 'time') then
    raise exception 'origem_invalida' using errcode = '22023';
  end if;
  if not public.fn_cobranca_ligada() then
    return jsonb_build_object('ok', false, 'motivo', 'cobranca_desligada');
  end if;
  select * into c from public.mia_cupons where codigo = v_codigo for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'inexistente', 'codigo', v_codigo);
  end if;
  if not c.ativo then
    return jsonb_build_object('ok', false, 'motivo', 'pausado', 'codigo', c.codigo);
  end if;
  if c.vale_ate is not null and c.vale_ate < v_hoje then
    return jsonb_build_object('ok', false, 'motivo', 'vencido', 'codigo', c.codigo, 'vale_ate', c.vale_ate);
  end if;
  select * into a from public.cobranca_assinaturas where organization_id = p_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'isenta', 'codigo', c.codigo);
  end if;
  select * into v_atual from public.mia_cupom_da_empresa where organization_id = p_org for update;
  if found then
    v_tinha := true;
    if v_atual.cupom_id = c.id then
      return jsonb_build_object('ok', true, 'ja_estava', true, 'codigo', c.codigo, 'beneficio', c.beneficio);
    end if;
    if p_origem <> 'time' then
      return jsonb_build_object('ok', false, 'motivo', 'ja_tem_cupom', 'codigo', c.codigo, 'atual', v_atual.codigo);
    end if;
  end if;
  if p_origem <> 'time' and (a.proximo_vencimento is not null or a.periodo_pago_desde is not null) then
    return jsonb_build_object('ok', false, 'motivo', 'ja_pagou', 'codigo', c.codigo);
  end if;
  select p.oferecido_ao_cliente into v_oferecido from public.cobranca_planos p where p.id = a.plano_id;
  if not coalesce(v_oferecido, false) then
    return jsonb_build_object('ok', false, 'motivo', 'plano_escondido', 'codigo', c.codigo);
  end if;
  if not (a.plano_id = any (c.planos)) then
    return jsonb_build_object('ok', false, 'motivo', 'fora_do_plano', 'codigo', c.codigo, 'planos', to_jsonb(c.planos));
  end if;
  select count(*) into v_usos from public.mia_cupom_da_empresa u where u.cupom_id = c.id;
  if c.limite_de_usos is not null and v_usos >= c.limite_de_usos then
    return jsonb_build_object('ok', false, 'motivo', 'esgotado', 'codigo', c.codigo);
  end if;

  if v_tinha then
    delete from public.mia_cupom_da_empresa where organization_id = p_org;
  end if;
  insert into public.mia_cupom_da_empresa
    (organization_id, cupom_id, parceiro_id, codigo, beneficio, valor, meses, setup_tipo, setup_valor,
     planos, origem, aplicado_por,
     comissao_pct, comissao_meses, comissao_setup_pct, termos_fixados_em, primeira_mensalidade_em)
  values
    (p_org, c.id, c.parceiro_id, c.codigo, c.beneficio, c.valor, c.meses, c.setup_tipo, c.setup_valor,
     c.planos, p_origem, p_ator,
     -- A troca pela Time depois do primeiro pagamento mantém o início da janela.
     null, null, null, null,
     case when v_tinha then v_atual.primeira_mensalidade_em else null end);

  -- Dias grátis: o mesmo teste do plano; vale o maior, sem somar.
  if c.beneficio = 'dias'
     and a.proximo_vencimento is null and a.periodo_pago_desde is null
     and a.provedor_assinatura_id is null then
    -- A entrada paga conta os dias de agora (ainda não usou nada); o plano com
    -- teste conta do começo do teste, e fica o fim que for maior.
    v_inicio := case when a.pagamento_inicial_pendente then now() else a.created_at end;
    v_fim := v_inicio + make_interval(days => c.valor::integer);
    if v_fim > now() and (a.pagamento_inicial_pendente or a.trial_ate is null or v_fim > a.trial_ate) then
      update public.cobranca_assinaturas
         set estado = 'trial',
             trial_ate = v_fim,
             pagamento_inicial_pendente = false,
             vencida_desde = null,
             ultimo_aviso = null,
             ultimo_aviso_em = null,
             updated_at = now()
       where organization_id = p_org;
      v_dias := c.valor::integer;
      update public.mia_cupom_da_empresa set dias_aplicados = v_dias where organization_id = p_org;
      select o.status, o.suspended_kind into v_status, v_kind from public.organizations o where o.id = p_org;
      if v_status = 'suspended' and v_kind = 'cobranca' then
        perform public.fn_reativar_organizacao(p_org, 'cobranca', p_ator);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'ja_estava', false,
    'codigo', c.codigo,
    'beneficio', c.beneficio,
    'parceiro_id', c.parceiro_id,
    'trocou', v_tinha,
    'dias_aplicados', v_dias
  );
end;
$$;

comment on function public.fn_mia_aplicar_cupom(uuid, text, text, uuid) is
  'MIA (9130): a regua unica do cupom (inexistente, pausado, vencido, esgotado, fora do plano, plano escondido, um por cliente, ja pagou) e o retrato do combinado. Dias gratis: o teste do plano, vale o maior. So o servidor.';

revoke all on function public.fn_mia_aplicar_cupom(uuid, text, text, uuid) from public;
revoke execute on function public.fn_mia_aplicar_cupom(uuid, text, text, uuid) from anon, authenticated;
grant execute on function public.fn_mia_aplicar_cupom(uuid, text, text, uuid) to service_role;

-- ── 5b. tirar o cupom antes de pagar ────────────────────────────────────────
-- "Tirar o cupom" no passo do pagamento: só antes do primeiro pagamento (depois,
-- só a Time troca). O cupom de dias grátis que mudou o teste devolve a empresa
-- ao plano: com teste, o fim do teste do plano; sem teste (entrada paga), a
-- espera do primeiro pagamento, parada como o upstream faz no cadastro (0679).
-- O servidor cancela antes a cobrança em aberto no Asaas.
create or replace function public.fn_mia_tirar_cupom(p_org uuid, p_ator uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  u public.mia_cupom_da_empresa%rowtype;
  a public.cobranca_assinaturas%rowtype;
  v_trial integer;
begin
  select * into a from public.cobranca_assinaturas where organization_id = p_org for update;
  select * into u from public.mia_cupom_da_empresa where organization_id = p_org for update;
  if not found then
    return jsonb_build_object('ok', true, 'mudou', false);
  end if;
  if a.organization_id is not null and (a.proximo_vencimento is not null or a.periodo_pago_desde is not null) then
    return jsonb_build_object('ok', false, 'motivo', 'ja_pagou');
  end if;
  delete from public.mia_cupom_da_empresa where organization_id = p_org;
  if u.dias_aplicados is not null and a.organization_id is not null and a.provedor_assinatura_id is null then
    select p.trial_dias into v_trial from public.cobranca_planos p where p.id = a.plano_id;
    if coalesce(v_trial, 0) = 0 then
      update public.cobranca_assinaturas
         set estado = 'trial', trial_ate = now(), pagamento_inicial_pendente = true,
             vencida_desde = null, ultimo_aviso = null, ultimo_aviso_em = null, updated_at = now()
       where organization_id = p_org;
      perform public.fn_suspender_organizacao(p_org, 'cobranca', 'Aguardando o primeiro pagamento', p_ator);
    else
      update public.cobranca_assinaturas
         set estado = 'trial', trial_ate = a.created_at + make_interval(days => v_trial), updated_at = now()
       where organization_id = p_org;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'mudou', true, 'codigo', u.codigo, 'tinha_dias', u.dias_aplicados is not null);
end;
$$;

comment on function public.fn_mia_tirar_cupom(uuid, uuid) is
  'MIA (9130): tira o cupom da empresa antes do primeiro pagamento; o cupom de dias gratis devolve a empresa ao teste do plano (ou a entrada paga). So o servidor.';

revoke all on function public.fn_mia_tirar_cupom(uuid, uuid) from public;
revoke execute on function public.fn_mia_tirar_cupom(uuid, uuid) from anon, authenticated;
grant execute on function public.fn_mia_tirar_cupom(uuid, uuid) to service_role;

-- ── 6. a empresa nasce com o cupom do cadastro ──────────────────────────────
-- Gatilho ADIADO (constraint trigger, initially deferred): roda no fim da
-- transação que cria a empresa, DEPOIS de o gatilho da entrada paga do upstream
-- (`trg_trial_na_criacao_da_org`, 0679) criar a assinatura e, no plano sem teste,
-- parar a empresa. Pendurado ao lado, nunca dentro dele. O cupom que não vale
-- mais (pausado, vencido, esgotado entre o cadastro e a confirmação) só sai da
-- passagem: a empresa nasce sem cupom, nunca é recusada por ele.
create or replace function public.fn_mia_cupom_nasce_com_a_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codigo text;
begin
  if new.created_by is null then
    return null;
  end if;
  delete from public.mia_cupom_do_cadastro where created_at < now() - interval '30 days';
  select codigo into v_codigo from public.mia_cupom_do_cadastro where user_id = new.created_by;
  if not found then
    return null;
  end if;
  delete from public.mia_cupom_do_cadastro where user_id = new.created_by;
  begin
    perform public.fn_mia_aplicar_cupom(new.id, v_codigo, 'cadastro', new.created_by);
  exception when others then
    raise warning 'mia: cupom do cadastro nao aplicado (%)', sqlstate;
  end;
  return null;
end;
$$;

revoke execute on function public.fn_mia_cupom_nasce_com_a_empresa() from public, anon, authenticated;

drop trigger if exists trg_mia_cupom_nasce_com_a_empresa on public.organizations;
create constraint trigger trg_mia_cupom_nasce_com_a_empresa
  after insert on public.organizations
  deferrable initially deferred
  for each row execute function public.fn_mia_cupom_nasce_com_a_empresa();

notify pgrst, 'reload schema';
