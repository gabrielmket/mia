-- manifest: O PAGAMENTO NO INÍCIO, PARTE 1 (.96): OS DADOS FISCAIS DA EMPRESA. `mia_dados_fiscais` guarda, uma linha por empresa, em nome de quem sai a cobrança e a nota fiscal do Asaas (protótipo aprovado em 27/10/2026, decisões 4 e 8): empresa (CNPJ, inclusive o alfanumérico) ou pessoa física (CPF), razão social ou nome completo, endereço com CEP, inscrições municipal e estadual (opcionais) e o WhatsApp de quem assina. Só o administrador da empresa e a plataforma leem (RLS); quem escreve é o servidor, depois de conferir papel e documento (`lib/dados-fiscais/`). `mia_dados_fiscais_do_cadastro` é a passagem do cadastro público: quando a pessoa preenche o formulário a empresa ainda não existe (nasce na confirmação do e-mail ou na aprovação da Time), então os dados esperam pelo usuário e o gatilho `trg_mia_dados_fiscais_nascem_com_a_empresa` os leva para a empresa no INSERT dela (o mesmo `created_by` que o gatilho da entrada paga do upstream, 0679, usa) e apaga a passagem; passagem com mais de 30 dias sai na próxima empresa que nascer. LGPD: apagar a empresa ou o usuário leva junto (`on delete cascade`), e a empresa redigida (`organizations.status = 'redacted'`) perde os dados fiscais pelo gatilho `trg_mia_dados_fiscais_saem_com_a_empresa_redigida`. Só objetos nossos; nenhum objeto do upstream é redefinido.
--
-- 9120 · os dados fiscais
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: aplicar duas vezes dá zero erro.

-- ── 1. os dados fiscais de cada empresa ─────────────────────────────────────
create table if not exists public.mia_dados_fiscais (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- 'pj' = empresa (CNPJ); 'pf' = pessoa física (CPF).
  tipo text not null,
  -- Só os caracteres do documento: CPF com 11 dígitos; CNPJ com 14 (12 dígitos ou
  -- letras maiúsculas e 2 dígitos verificadores, o CNPJ alfanumérico da Receita).
  documento text not null,
  -- PJ: a razão social. PF: o nome completo. É o nome que sai na nota.
  razao_social text not null,
  cep text not null,
  logradouro text not null,
  numero text not null,
  complemento text,
  bairro text not null,
  cidade text not null,
  uf text not null,
  inscricao_municipal text,
  inscricao_estadual text,
  -- O WhatsApp de quem assina, só dígitos com o país (o Asaas pede um telefone
  -- para o pagamento com cartão).
  telefone text,
  -- Quando o cliente no Asaas recebeu ESTA versão dos dados. Nulo ou mais velho
  -- que `updated_at` = a próxima rodada leva ao Asaas (as próximas notas saem certas).
  asaas_sincronizado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint mia_dados_fiscais_tipo check (tipo in ('pj', 'pf')),
  constraint mia_dados_fiscais_documento check (
    (tipo = 'pf' and documento ~ '^[0-9]{11}$')
    or (tipo = 'pj' and documento ~ '^[0-9A-Z]{12}[0-9]{2}$')
  ),
  constraint mia_dados_fiscais_razao check (char_length(btrim(razao_social)) between 2 and 120),
  constraint mia_dados_fiscais_cep check (cep ~ '^[0-9]{8}$'),
  constraint mia_dados_fiscais_uf check (uf ~ '^[A-Z]{2}$'),
  constraint mia_dados_fiscais_tamanhos check (
    char_length(btrim(logradouro)) between 1 and 120
    and char_length(btrim(numero)) between 1 and 20
    and char_length(coalesce(complemento, '')) <= 80
    and char_length(btrim(bairro)) between 1 and 80
    and char_length(btrim(cidade)) between 1 and 80
    and char_length(coalesce(inscricao_municipal, '')) <= 30
    and char_length(coalesce(inscricao_estadual, '')) <= 30
  ),
  constraint mia_dados_fiscais_telefone check (telefone is null or telefone ~ '^[0-9]{10,15}$')
);

comment on table public.mia_dados_fiscais is
  'MIA (9120): em nome de quem sai a cobranca e a nota fiscal do Asaas (CNPJ ou CPF, razao social ou nome, endereco, inscricoes, WhatsApp de quem assina). Le: admin da empresa e a plataforma. Escreve: so o servidor (lib/dados-fiscais). LGPD: cascata com a empresa e apagado quando a empresa e redigida.';

alter table public.mia_dados_fiscais enable row level security;
drop policy if exists mia_dados_fiscais_admin_le on public.mia_dados_fiscais;
create policy mia_dados_fiscais_admin_le on public.mia_dados_fiscais
  for select to authenticated
  using (public.fn_role_at_least(organization_id, 'admin') or public.fn_is_platform_admin());
revoke all on public.mia_dados_fiscais from anon, authenticated;
grant select on public.mia_dados_fiscais to authenticated;
grant select, insert, update, delete on public.mia_dados_fiscais to service_role;

drop trigger if exists trg_mia_dados_fiscais_touch on public.mia_dados_fiscais;
create trigger trg_mia_dados_fiscais_touch
  before update on public.mia_dados_fiscais
  for each row execute function public.fn_touch_updated_at();

-- ── 2. a passagem do cadastro público ───────────────────────────────────────
-- A conta existe (GoTrue) e a empresa ainda não: os dados esperam pelo usuário.
create table if not exists public.mia_dados_fiscais_do_cadastro (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tipo text not null,
  documento text not null,
  razao_social text not null,
  cep text not null,
  logradouro text not null,
  numero text not null,
  complemento text,
  bairro text not null,
  cidade text not null,
  uf text not null,
  inscricao_municipal text,
  inscricao_estadual text,
  telefone text,
  created_at timestamptz not null default now(),
  constraint mia_dados_fiscais_do_cadastro_tipo check (tipo in ('pj', 'pf')),
  constraint mia_dados_fiscais_do_cadastro_documento check (
    (tipo = 'pf' and documento ~ '^[0-9]{11}$')
    or (tipo = 'pj' and documento ~ '^[0-9A-Z]{12}[0-9]{2}$')
  ),
  constraint mia_dados_fiscais_do_cadastro_razao check (char_length(btrim(razao_social)) between 2 and 120),
  constraint mia_dados_fiscais_do_cadastro_cep check (cep ~ '^[0-9]{8}$'),
  constraint mia_dados_fiscais_do_cadastro_uf check (uf ~ '^[A-Z]{2}$'),
  constraint mia_dados_fiscais_do_cadastro_tamanhos check (
    char_length(btrim(logradouro)) between 1 and 120
    and char_length(btrim(numero)) between 1 and 20
    and char_length(coalesce(complemento, '')) <= 80
    and char_length(btrim(bairro)) between 1 and 80
    and char_length(btrim(cidade)) between 1 and 80
    and char_length(coalesce(inscricao_municipal, '')) <= 30
    and char_length(coalesce(inscricao_estadual, '')) <= 30
  ),
  constraint mia_dados_fiscais_do_cadastro_telefone check (telefone is null or telefone ~ '^[0-9]{10,15}$')
);

comment on table public.mia_dados_fiscais_do_cadastro is
  'MIA (9120): os dados fiscais do cadastro publico esperando a empresa nascer. O gatilho trg_mia_dados_fiscais_nascem_com_a_empresa os leva para mia_dados_fiscais e apaga a linha; com mais de 30 dias, sai. So o servidor.';

alter table public.mia_dados_fiscais_do_cadastro enable row level security;
revoke all on public.mia_dados_fiscais_do_cadastro from anon, authenticated;
grant select, insert, update, delete on public.mia_dados_fiscais_do_cadastro to service_role;

-- ── 3. a empresa nasce com os dados do cadastro ─────────────────────────────
-- AFTER INSERT em organizations, pendurado AO LADO do gatilho da entrada paga do
-- upstream (0679), nunca dentro dele. Quem criou é o `created_by` (o cadastro
-- aberto, a aprovação da Time e a recuperação em /get-started gravam o próprio
-- usuário). A razão social vira o `legal_name` quando ele ainda é o nome fantasia.
create or replace function public.fn_mia_dados_fiscais_nascem_com_a_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.mia_dados_fiscais_do_cadastro%rowtype;
begin
  if new.created_by is null then
    return null;
  end if;
  delete from public.mia_dados_fiscais_do_cadastro
   where created_at < now() - interval '30 days';
  select * into v from public.mia_dados_fiscais_do_cadastro where user_id = new.created_by;
  if not found then
    return null;
  end if;
  insert into public.mia_dados_fiscais
    (organization_id, tipo, documento, razao_social, cep, logradouro, numero, complemento,
     bairro, cidade, uf, inscricao_municipal, inscricao_estadual, telefone, updated_by)
  values
    (new.id, v.tipo, v.documento, v.razao_social, v.cep, v.logradouro, v.numero, v.complemento,
     v.bairro, v.cidade, v.uf, v.inscricao_municipal, v.inscricao_estadual, v.telefone, new.created_by)
  on conflict (organization_id) do nothing;
  delete from public.mia_dados_fiscais_do_cadastro where user_id = new.created_by;
  update public.organizations
     set legal_name = v.razao_social
   where id = new.id
     and (legal_name is null or legal_name = display_name);
  return null;
end;
$$;

revoke execute on function public.fn_mia_dados_fiscais_nascem_com_a_empresa() from public, anon, authenticated;

drop trigger if exists trg_mia_dados_fiscais_nascem_com_a_empresa on public.organizations;
create trigger trg_mia_dados_fiscais_nascem_com_a_empresa
  after insert on public.organizations
  for each row execute function public.fn_mia_dados_fiscais_nascem_com_a_empresa();

-- ── 4. LGPD: a empresa redigida perde os dados fiscais ──────────────────────
-- A anonimização da empresa inteira (lgpd-redact-worker, pedido `store_redact`)
-- termina trocando `organizations.status` para 'redacted'. O que é dela aqui sai
-- na mesma escrita. Apagar a empresa ou o usuário já leva tudo (cascade).
create or replace function public.fn_mia_dados_fiscais_saem_com_a_empresa_redigida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'redacted' and old.status is distinct from 'redacted' then
    delete from public.mia_dados_fiscais where organization_id = new.id;
  end if;
  return null;
end;
$$;

revoke execute on function public.fn_mia_dados_fiscais_saem_com_a_empresa_redigida() from public, anon, authenticated;

drop trigger if exists trg_mia_dados_fiscais_saem_com_a_empresa_redigida on public.organizations;
create trigger trg_mia_dados_fiscais_saem_com_a_empresa_redigida
  after update of status on public.organizations
  for each row execute function public.fn_mia_dados_fiscais_saem_com_a_empresa_redigida();

notify pgrst, 'reload schema';
