-- 9013 · o papel do contato na empresa (decisor, financeiro, usuário…) e quem é o principal
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
