-- manifest: O DISPARO DE E-MAIL MARKETING, PARTE 5 (.89): o motor, a trava da demonstracao e a LGPD, em funcoes e gatilhos NOSSOS. (1) `fn_mia_email_reivindicar(campanha, lote, limite)`: o worker pega os proximos pendentes com `for update skip locked` (duas rodadas nunca pegam a mesma linha) e os marca `enviando` no lote. (2) `fn_mia_email_cobrar(campanha)`: debita a carteira (`tenant_wallet_ledger`, `ref_kind = 'email_lote'`, `ref_id` = o lote) com a soma do preco congelado de cada e-mail ACEITO pela Amazon, so de lote que terminou (nenhuma linha `enviando`), idempotente pelo indice unico da 0244 (`on conflict do nothing`); uma linha por lote e nao por e-mail porque o saldo e lido do extrato inteiro e uma linha por e-mail estouraria o teto de leitura em duas campanhas. (3) `fn_mia_email_voltar_a_receber(org, hash)`: a unica porta de saida da supressao de e-mail, usada so pela pagina de preferencias da propria pessoa; nao tira rejeicao (o endereco nao existe). (4) A trava da demonstracao: gatilho `trg_mia_email_demonstracao_nao_envia` recusa (42501, `organizacao_de_demonstracao:`) campanha de e-mail agendada ou enviando e teste de envio numa empresa de demonstracao. (5) A anonimizacao: gatilho `trg_mia_email_marketing_contato_anonimizado` (after update of is_anonymized em contacts) apaga o endereco copiado dos destinatarios e a origem, a evidencia e o texto aceito do registro de consentimento, e solta o contato; o hash fica (uma vez so por endereco, e o veto da supressao). Todas `security definer` com search_path fixo, so service_role executa. Nenhum objeto do upstream e tocado.
--
-- 9064 · o motor do disparo de e-mail, a trava da demonstração e a LGPD
--
-- Só objetos NOSSOS (docs/FORK-MIA.md, regra 3). Idempotente: `create or
-- replace` e `drop trigger if exists`.

-- ── 1. o worker reivindica um lote ─────────────────────────────────────────
create or replace function public.fn_mia_email_reivindicar(
  p_campanha uuid,
  p_lote uuid,
  p_limite integer
)
returns setof public.mia_email_destinatarios
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  if p_limite is null or p_limite < 1 then
    return;
  end if;
  return query
  with alvo as (
    select d.id
      from public.mia_email_destinatarios d
     where d.campanha_id = p_campanha
       and d.status = 'pendente'
     order by d.created_at, d.id
     limit least(p_limite, 500)
     for update skip locked
  )
  update public.mia_email_destinatarios d
     set status = 'enviando',
         lote_id = p_lote,
         tentativas = d.tentativas + 1,
         updated_at = now()
    from alvo
   where d.id = alvo.id
  returning d.*;
end
$f$;

comment on function public.fn_mia_email_reivindicar(uuid, uuid, integer) is
  'MIA (9064): o worker do disparo de e-mail pega ate p_limite (teto 500) destinatarios pendentes da campanha, com for update skip locked, e os marca enviando no lote p_lote. Duas rodadas ao mesmo tempo nunca pegam a mesma linha. So service_role.';

revoke all on function public.fn_mia_email_reivindicar(uuid, uuid, integer) from public;
revoke execute on function public.fn_mia_email_reivindicar(uuid, uuid, integer) from anon, authenticated;
grant execute on function public.fn_mia_email_reivindicar(uuid, uuid, integer) to service_role;

-- ── 2. a cobrança por lote ─────────────────────────────────────────────────
--
-- Envia → marca a linha com o id da Amazon e o preço → cobra o LOTE. Lote com
-- linha ainda `enviando` espera: cobrá-lo pela metade e marcar o resto depois
-- faria o resto bater no índice único e sair de graça.
create or replace function public.fn_mia_email_cobrar(p_campanha uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  v_org uuid;
  v_nome text;
  v_lote record;
  v_total bigint := 0;
begin
  select c.organization_id, c.nome into v_org, v_nome
    from public.mia_email_campanhas c
   where c.id = p_campanha;
  if v_org is null then
    return 0;
  end if;

  for v_lote in
    select d.lote_id, count(*) as quantos, coalesce(sum(coalesce(d.cobrado_cents, 0)), 0) as soma
      from public.mia_email_destinatarios d
     where d.campanha_id = p_campanha
       and d.cobrado = false
       and d.ses_message_id is not null
       and d.lote_id is not null
       and not exists (
         select 1 from public.mia_email_destinatarios x
          where x.campanha_id = p_campanha
            and x.lote_id = d.lote_id
            and x.status = 'enviando'
       )
     group by d.lote_id
  loop
    if v_lote.soma > 0 then
      insert into public.tenant_wallet_ledger (organization_id, tipo, amount_cents, ref_kind, ref_id, note)
      values (
        v_org, 'debito', v_lote.soma, 'email_lote', v_lote.lote_id::text,
        left(v_nome, 80) || ' · ' || v_lote.quantos || ' e-mail(s)'
      )
      on conflict do nothing;
      v_total := v_total + v_lote.soma;
    end if;
    update public.mia_email_destinatarios
       set cobrado = true
     where campanha_id = p_campanha
       and lote_id = v_lote.lote_id
       and cobrado = false
       and ses_message_id is not null;
  end loop;
  return v_total;
end
$f$;

comment on function public.fn_mia_email_cobrar(uuid) is
  'MIA (9064): debita da carteira (tenant_wallet_ledger, ref_kind email_lote, ref_id = lote) a soma do preco congelado dos e-mails ACEITOS pela Amazon de cada lote terminado da campanha, e marca as linhas como cobradas. Idempotente pelo indice unico da carteira (on conflict do nothing). Rejeicao depois do aceite nao estorna. So service_role.';

revoke all on function public.fn_mia_email_cobrar(uuid) from public;
revoke execute on function public.fn_mia_email_cobrar(uuid) from anon, authenticated;
grant execute on function public.fn_mia_email_cobrar(uuid) to service_role;

-- ── 3. voltar a receber: só a própria pessoa ───────────────────────────────
create or replace function public.fn_mia_email_voltar_a_receber(p_org uuid, p_hash text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  v_quantos integer;
begin
  perform set_config('mia.email_marketing.reinscricao', 'pelo_titular', true);
  delete from public.campaign_suppressions
   where organization_id = p_org
     and recipient_address_hash = p_hash
     and tipo_de_endereco = 'email'
     and coalesce(motivo, '') <> 'rejeicao';
  get diagnostics v_quantos = row_count;
  perform set_config('mia.email_marketing.reinscricao', '', true);
  return v_quantos;
end
$f$;

comment on function public.fn_mia_email_voltar_a_receber(uuid, text) is
  'MIA (9064): a unica porta de saida da supressao de e-mail, chamada so pela pagina de preferencias da propria pessoa (token assinado conferido no servidor). Nao tira rejeicao: o endereco nao existe. So service_role.';

revoke all on function public.fn_mia_email_voltar_a_receber(uuid, text) from public;
revoke execute on function public.fn_mia_email_voltar_a_receber(uuid, text) from anon, authenticated;
grant execute on function public.fn_mia_email_voltar_a_receber(uuid, text) to service_role;

-- ── 4. a trava da demonstração ─────────────────────────────────────────────
--
-- A mesma pergunta da 9010 (`fn_mia_e_demonstracao`) e a mesma forma de recusa
-- (42501 com a mensagem começando por `organizacao_de_demonstracao:`), que
-- `lib/demonstracao/trava.ts` traduz para a tela. Função própria, e não um ramo
-- a mais em `fn_mia_trava_da_demonstracao`: a campanha de e-mail é peça nova, e
-- a trava dela nasce com ela.
create or replace function public.fn_mia_email_demonstracao_nao_envia()
returns trigger
language plpgsql
security definer
set search_path = public
as $f$
declare
  v_porta text;
begin
  if tg_table_name = 'mia_email_campanhas' then
    if new.status not in ('agendada', 'enviando') then
      return new;
    end if;
    v_porta := 'campanha de e-mail agendada ou enviando';
  elsif tg_table_name = 'mia_email_testes' then
    v_porta := 'envio de teste de e-mail';
  else
    return new;
  end if;

  if not public.fn_mia_e_demonstracao(new.organization_id) then
    return new;
  end if;

  raise exception 'organizacao_de_demonstracao: % nao existe numa empresa de demonstracao', v_porta
    using errcode = '42501',
          hint = 'Esta e a empresa de demonstracao da plataforma: nada sai dela (docs/fork/cliente-modelo.md).';
end
$f$;

comment on function public.fn_mia_email_demonstracao_nao_envia() is
  'MIA (9064): a trava da empresa de demonstracao no disparo de e-mail. Recusa (42501) campanha de e-mail agendada ou enviando e o registro de um envio de teste. Rascunho, pausa e cancelamento seguem livres.';

revoke all on function public.fn_mia_email_demonstracao_nao_envia() from public;
revoke execute on function public.fn_mia_email_demonstracao_nao_envia() from anon, authenticated;

drop trigger if exists trg_mia_email_demonstracao_nao_envia on public.mia_email_campanhas;
create trigger trg_mia_email_demonstracao_nao_envia
  before insert or update of status on public.mia_email_campanhas
  for each row execute function public.fn_mia_email_demonstracao_nao_envia();

drop trigger if exists trg_mia_email_demonstracao_nao_envia on public.mia_email_testes;
create trigger trg_mia_email_demonstracao_nao_envia
  before insert on public.mia_email_testes
  for each row execute function public.fn_mia_email_demonstracao_nao_envia();

-- ── 5. a anonimização ──────────────────────────────────────────────────────
--
-- Gatilho NOSSO, pendurado no fato (`is_anonymized` virando verdadeiro), como o
-- `trg_redigir_exclusoes_anonimizado` do upstream: vale para a cascata e para a
-- rota direta. A cascata do upstream (`fn_lgpd_cascade_redact_contact`) não é
-- redefinida (docs/FORK-MIA.md, regra 3).
create or replace function public.fn_mia_redigir_email_marketing_do_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  if new.is_anonymized is not true or coalesce(old.is_anonymized, false) is true then
    return new;
  end if;

  -- 1 · o endereço copiado em cada campanha. O hash fica: é ele que mantém
  --     "uma vez só por endereço" na campanha e casa com a supressão.
  update public.mia_email_destinatarios
     set email = null,
         contact_id = null
   where organization_id = new.organization_id
     and contact_id = new.id;

  -- 2 · o registro de consentimento: sai o que pode identificar (origem,
  --     evidência, texto aceito) e o vínculo; ficam o tipo, a data e a versão.
  update public.mia_email_consentimentos
     set origem = null,
         evidencia = null,
         texto_aceito = null,
         contact_id = null
   where organization_id = new.organization_id
     and contact_id = new.id;

  return new;
end
$f$;

comment on function public.fn_mia_redigir_email_marketing_do_contato_anonimizado() is
  'MIA (9064): quando o contato e anonimizado, apaga o endereco copiado de mia_email_destinatarios e a origem, a evidencia e o texto aceito de mia_email_consentimentos, e solta o contato das duas. O hash fica (a supressao e o uma-vez-so por endereco continuam valendo). O consentimento vigente (contacts.consent) ja e zerado pela anonimizacao do upstream.';

revoke all on function public.fn_mia_redigir_email_marketing_do_contato_anonimizado() from public;
revoke execute on function public.fn_mia_redigir_email_marketing_do_contato_anonimizado() from anon, authenticated;

drop trigger if exists trg_mia_email_marketing_contato_anonimizado on public.contacts;
create trigger trg_mia_email_marketing_contato_anonimizado
  after update of is_anonymized on public.contacts
  for each row
  execute function public.fn_mia_redigir_email_marketing_do_contato_anonimizado();

-- Quem JÁ foi anonimizado antes desta migration não tem linha nestas tabelas
-- (elas nascem nesta entrega): não há o que curar.

notify pgrst, 'reload schema';
