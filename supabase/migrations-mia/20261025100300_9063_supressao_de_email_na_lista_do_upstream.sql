-- manifest: O DISPARO DE E-MAIL MARKETING, PARTE 4 (.89): a SUPRESSAO de e-mail mora na lista de exclusao do upstream (`campaign_suppressions`, 0376), ESTENDIDA com duas colunas nossas: `tipo_de_endereco` ('telefone', o padrao de toda linha que ja existe, ou 'email') e `motivo` ('descadastro', 'rejeicao', 'reclamacao', 'manual', 'importada'). O hash de e-mail e o SHA-256 do endereco em minusculas, guardado na mesma coluna `recipient_address_hash` (o telefone normalizado tem `+` e digitos, o e-mail tem `@`: os dois nunca casam). O gatilho do upstream que solta o contato e a cauda na anonimizacao continua valendo, e o HASH fica: o veto sobrevive. Gatilho NOVO nosso `trg_mia_supressao_de_email_so_acrescenta` (BEFORE UPDATE OR DELETE, funcao `fn_mia_supressao_de_email_so_acrescenta`): linha de e-mail nao sai pela tela nem pela API (42501), e nao troca de endereco nem de tipo; so a propria pessoa volta a receber, pela funcao `fn_mia_email_voltar_a_receber` (9064), que liga a chave de transacao `mia.email_marketing.reinscricao`. A cascata da exclusao da empresa (on delete cascade) passa. Nenhum objeto do upstream e redefinido: colunas, constraints e gatilho sao acrescimos.
--
-- 9063 · a supressão de e-mail na lista de exclusão do upstream
--
-- `campaign_suppressions` é do upstream e recebe só ACRÉSCIMO (docs/FORK-MIA.md,
-- regra 3): duas colunas, duas constraints com nome nosso, um gatilho nosso.

alter table public.campaign_suppressions
  add column if not exists tipo_de_endereco text not null default 'telefone';
alter table public.campaign_suppressions
  add column if not exists motivo text;

do $f$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'campaign_suppressions_mia_tipo_check'
       and conrelid = 'public.campaign_suppressions'::regclass
  ) then
    alter table public.campaign_suppressions
      add constraint campaign_suppressions_mia_tipo_check
      check (tipo_de_endereco in ('telefone', 'email'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'campaign_suppressions_mia_motivo_check'
       and conrelid = 'public.campaign_suppressions'::regclass
  ) then
    alter table public.campaign_suppressions
      add constraint campaign_suppressions_mia_motivo_check
      check (motivo is null or motivo in ('descadastro', 'rejeicao', 'reclamacao', 'manual', 'importada'));
  end if;
end
$f$;

comment on column public.campaign_suppressions.tipo_de_endereco is
  'MIA (9063): de que endereco e o hash: telefone (o padrao, toda linha do upstream) ou email (SHA-256 do endereco em minusculas, lib/email-marketing/supressao.ts).';
comment on column public.campaign_suppressions.motivo is
  'MIA (9063): por que o e-mail entrou na supressao: descadastro (a pessoa pediu), rejeicao (permanente, ou temporaria em 3 campanhas seguidas), reclamacao (marcou como spam), manual (pediu a equipe), importada (da ferramenta anterior). Codigo, nao texto livre: sobrevive a anonimizacao.';

create index if not exists idx_campaign_suppressions_mia_email
  on public.campaign_suppressions (organization_id, tipo_de_endereco, created_at desc);

-- ── a linha de e-mail só acrescenta ────────────────────────────────────────
--
-- Se a equipe pudesse tirar alguém da lista, a supressão viraria sugestão. Quem
-- desfaz é a própria pessoa, pela página de preferências, e só por
-- `fn_mia_email_voltar_a_receber`, que liga a chave desta transação.
--
-- `pg_trigger_depth() > 1` é a exclusão da EMPRESA em cascata (o gatilho de
-- chave estrangeira apaga as linhas de dentro de outro gatilho): apagar a
-- empresa apaga a lista dela, e isso não é tirar alguém da lista.
create or replace function public.fn_mia_supressao_de_email_so_acrescenta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  if old.tipo_de_endereco is distinct from 'email' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if coalesce(current_setting('mia.email_marketing.reinscricao', true), '') = 'pelo_titular' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'supressao_de_email_so_acrescenta: um endereco de e-mail nao sai da lista de supressao pela equipe'
      using errcode = '42501',
            hint = 'So a propria pessoa volta a receber, pelo link de um e-mail que ja recebeu (docs/fork/email-marketing.md).';
  end if;

  -- UPDATE: a anonimização do upstream solta contato, cauda e motivo em texto, e
  -- isso continua livre. Trocar o endereço, o tipo ou a empresa da linha não.
  if new.recipient_address_hash is distinct from old.recipient_address_hash
     or new.tipo_de_endereco is distinct from old.tipo_de_endereco
     or new.organization_id is distinct from old.organization_id then
    raise exception 'supressao_de_email_so_acrescenta: a linha de e-mail da lista de supressao nao troca de endereco nem de tipo'
      using errcode = '42501';
  end if;
  return new;
end
$f$;

comment on function public.fn_mia_supressao_de_email_so_acrescenta() is
  'MIA (9063): a linha de e-mail de campaign_suppressions so acrescenta: nao sai (42501) e nao troca de endereco, tipo ou empresa. Passa a cascata da exclusao da empresa (pg_trigger_depth > 1) e a reinscricao pela propria pessoa (chave mia.email_marketing.reinscricao, ligada por fn_mia_email_voltar_a_receber). A anonimizacao do upstream (soltar contato, cauda e reason) continua livre.';

revoke all on function public.fn_mia_supressao_de_email_so_acrescenta() from public;
revoke execute on function public.fn_mia_supressao_de_email_so_acrescenta() from anon, authenticated;

drop trigger if exists trg_mia_supressao_de_email_so_acrescenta on public.campaign_suppressions;
create trigger trg_mia_supressao_de_email_so_acrescenta
  before update or delete on public.campaign_suppressions
  for each row execute function public.fn_mia_supressao_de_email_so_acrescenta();
