-- 0262 — cargo e setor na PESSOA, campos adicionais na EMPRESA
--
-- Duas pontas que sobraram da entidade empresa (migration 0255).
--
-- ── Cargo e setor ficam no CONTATO, e não na empresa ──────────────────────
--
-- Parece detalhe e decide a modelagem: cargo é da PESSOA dentro da empresa, não
-- da empresa. Três contatos da mesma empresa têm três cargos, e um deles pode
-- ser o contador que nem trabalha lá. Guardar na empresa obrigaria a inventar
-- uma tabela de vínculo para responder o que duas colunas respondem.
--
-- E é a informação que decide COM QUEM falar: numa lista de cinco pessoas da
-- mesma empresa, "quem é o decisor" é a única pergunta que o vendedor faz antes
-- de escolher o número que vai chamar.
--
-- ── Campos adicionais: `jsonb`, como no contato e no lead ─────────────────
--
-- Pedido direto do Gabriel: poder acrescentar informação em EMPRESA e em LEAD
-- sem esperar migration. O lead já tinha (`crm_leads.custom_fields`), o contato
-- já tinha, a empresa não.
--
-- As DEFINIÇÕES (quais campos existem, com que rótulo) continuam em
-- `crm_pipelines.settings.fields` — o mesmo lugar que o contato e o lead já
-- usam. Criar um segundo registro de definições só para empresa faria o
-- operador cadastrar "CNPJ do grupo" duas vezes e as duas divergirem.

alter table public.contacts
  add column if not exists cargo text,
  add column if not exists setor text;

comment on column public.contacts.cargo is
  'O cargo desta PESSOA na empresa dela (crm_empresas). Fica no contato e nao na empresa porque tres contatos da mesma empresa tem tres cargos — e um deles pode ser o contador, que nem trabalha la.';

alter table public.crm_empresas
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

comment on column public.crm_empresas.custom_fields is
  'Campos adicionais da empresa. As DEFINICOES moram em crm_pipelines.settings.fields, o mesmo lugar do contato e do lead — um segundo registro de definicoes faria o operador cadastrar o mesmo campo duas vezes e as duas divergirem.';

-- "Quem é o decisor nesta empresa" é a pergunta que estas colunas respondem, e
-- ela sempre chega junto do filtro por empresa. Parcial: a maioria dos contatos
-- não tem cargo, e indexar nulo seria pagar por linha que nunca é procurada.
create index if not exists idx_contacts_empresa_cargo
  on public.contacts (organization_id, empresa_id, cargo)
  where empresa_id is not null and cargo is not null;

notify pgrst, 'reload schema';
