-- manifest: EMPRESA ÚNICA, PARTE 3 DE 3: as regras do protótipo aprovado (15/10/2026) no banco. A verdade passa a ser o vínculo do upstream (`company_people`, com o nosso `papel`), e o contato guarda um ESPELHO da empresa que aparece no cartão (`contacts.empresa_id`, `cargo`, `setor`, `papel_na_empresa`, `principal_na_empresa`), mantido por gatilho, para toda leitura de antes continuar valendo. Funções que a sessão chama (security definer, papel conferido dentro, `auth.uid()` nulo = servidor): `fn_mia_gravar_empresa` (criar e editar empresa com o que é só nosso numa transação só; atendente, gestor e agente criam, decisão do protótipo; CNPJ repetido é RECUSADO com `cnpj_ja_cadastrado` e o id da que já existe no detalhe; os dados da Receita entram por `receita`, que só a tela consulta), `fn_mia_vincular_pessoa` (o contato numa empresa, com papel, cargo, setor, principal e se é a empresa do cartão; contato pode estar em várias), `fn_mia_desvincular_pessoa`, `fn_mia_juntar_numeros` (vários números = uma pessoa: os vínculos se somam), `fn_mia_separar_numero` (o desfazer: o número leva uma cópia dos vínculos), `fn_mia_excluir_empresa` (gestor; RECUSA com `empresa_com_negocio_aberto` quando há negócio aberto; sem ele exclui, as pessoas ficam como contato sem empresa e os negócios encerrados ficam no histórico sem empresa) e `fn_mesclar_empresas` (NOSSA, da 0263, redefinida para `companies`: gestor; os vínculos vão para a vencedora, quem estava nas duas fica com um só, toda chave para `companies` lida do catálogo é repontada, a vencedora só herda o que não tem, a perdedora vira lápide em `mia_companies_mescladas` e sai). Gatilhos nossos: `trg_mia_vinculo_antes` (papel e `is_decision_maker` dizem a mesma coisa; quem vira principal tira o de antes, um por empresa), `trg_mia_vinculo_depois` (o espelho dos contatos da pessoa), `trg_mia_contato_empresa_vira_vinculo` (quem escreve direto no contato, o jeito de antes, vira vínculo: empresa nova = vínculo novo e empresa do cartão; "sem empresa" = sai o vínculo com a do cartão), `trg_mia_contato_ganhou_pessoa`, `trg_mia_contato_mesclado_leva_os_vinculos` (fusão de contatos junta as pessoas), `trg_mia_negocio_e_a_empresa` (negócio novo sem empresa herda a do cartão do contato, decisão do protótipo; empresa de outra organização é recusada) e `trg_mia_empresa_unica_contato_anonimizado` (LGPD: o vínculo sai quando nenhum outro número vivo fala pela pessoa; com outro número vivo fica, e o upstream já redige cargo e nome). Uma chave de transação (`mia.empresa_unica`) impede o eco entre os gatilhos. Nenhum objeto do upstream é redefinido: só gatilhos e funções com nome nosso sobre as tabelas dele. Provado em tests/invariants/empresa-unica.test.ts e no invariante do upstream companies-people-rls (o agente segue sem INSERT direto em `companies`).
--
-- 9026 · empresa única: funções e gatilhos
--
-- `mia`: só objetos NOSSOS (docs/FORK-MIA.md, regra 3); `fn_mesclar_empresas` é
-- nossa desde a 0263. O desenho inteiro está em docs/fork/empresa-unica.md.
--
-- ── A chave de transação ──────────────────────────────────────────────────
--
-- O espelho escreve no contato, e escrever no contato (o jeito de antes) vira
-- vínculo. Sem freio, um chamaria o outro. Quem escreve dos dois lados liga
-- `mia.empresa_unica = 'propagando'` e devolve o valor de antes ao sair; o
-- tradutor do contato não age enquanto ela está ligada. É o mesmo molde de
-- `deskcomm.desfecho_pelo_negocio` do upstream.

-- ─── o espelho: o contato mostra a empresa do cartão ────────────────────────

create or replace function public.fn_mia_espelhar_empresa_da_pessoa(p_pessoa uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text;
  v_cartao uuid;
  v_cargo text;
  v_setor text;
  v_papel text;
  v_principal boolean;
begin
  if p_pessoa is null then
    return;
  end if;
  v_antes := coalesce(current_setting('mia.empresa_unica', true), '');
  perform set_config('mia.empresa_unica', 'propagando', true);

  -- A empresa do cartão é a que um número vivo da pessoa já mostra, se ela
  -- ainda é vínculo; senão a do vínculo mais antigo; senão nenhuma.
  select ct.empresa_id into v_cartao
    from public.contacts ct
    join public.company_people cp on cp.person_id = ct.person_id and cp.company_id = ct.empresa_id
   where ct.person_id = p_pessoa
     and ct.is_merged_into is null
     and not ct.is_anonymized
   order by ct.updated_at desc, ct.id
   limit 1;
  if v_cartao is null then
    select cp.company_id into v_cartao
      from public.company_people cp
     where cp.person_id = p_pessoa
     order by cp.created_at, cp.id
     limit 1;
  end if;

  if v_cartao is not null then
    select cp.job_title, cp.department, cp.papel, cp.is_primary
      into v_cargo, v_setor, v_papel, v_principal
      from public.company_people cp
     where cp.person_id = p_pessoa and cp.company_id = v_cartao;
  end if;

  update public.contacts ct set
    empresa_id = v_cartao,
    cargo = v_cargo,
    setor = v_setor,
    papel_na_empresa = v_papel,
    principal_na_empresa = coalesce(v_principal, false)
   where ct.person_id = p_pessoa
     and ct.is_merged_into is null
     and not ct.is_anonymized
     and (ct.empresa_id is distinct from v_cartao
          or ct.cargo is distinct from v_cargo
          or ct.setor is distinct from v_setor
          or ct.papel_na_empresa is distinct from v_papel
          or ct.principal_na_empresa is distinct from coalesce(v_principal, false));

  perform set_config('mia.empresa_unica', v_antes, true);
end $$;

comment on function public.fn_mia_espelhar_empresa_da_pessoa(uuid) is
  'MIA (9026): recalcula o espelho de todos os numeros vivos de uma pessoa (contacts.empresa_id = a empresa do cartao, mais cargo, setor, papel e principal do vinculo dela). Chamada pelos gatilhos e pelas funcoes da empresa unica.';

-- Uma pessoa nova a partir de um contato. Chamada com a chave ligada.
create or replace function public.fn_mia_nova_pessoa_do_contato(p_contato uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pessoa uuid;
  ct record;
begin
  select id, organization_id, name, display_name, phone_number, email
    into ct
    from public.contacts
   where id = p_contato;
  if not found then
    raise exception using errcode = 'P0002', message = 'contato_nao_encontrado';
  end if;
  insert into public.people (organization_id, full_name, normalized_name, email)
  values (
    ct.organization_id,
    coalesce(nullif(btrim(coalesce(ct.name, '')), ''), nullif(btrim(coalesce(ct.display_name, '')), ''),
             nullif(btrim(coalesce(ct.phone_number, '')), ''), 'Contato sem nome'),
    public.fn_mia_nome_de_empresa_comparavel(coalesce(ct.name, ct.display_name)),
    nullif(btrim(coalesce(ct.email, '')), '')
  )
  returning id into v_pessoa;
  update public.contacts set person_id = v_pessoa where id = p_contato;
  return v_pessoa;
end $$;

-- Junta duas pessoas: a que sai entrega os vínculos e os números à que fica.
create or replace function public.fn_mia_unir_pessoas(p_fica uuid, p_sai uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text;
  l record;
  fk record;
  v_ja uuid;
  v_sai public.people%rowtype;
begin
  if p_fica is null or p_sai is null or p_fica = p_sai then
    return;
  end if;
  select * into v_sai from public.people where id = p_sai;
  if not found then
    return;
  end if;
  v_antes := coalesce(current_setting('mia.empresa_unica', true), '');
  perform set_config('mia.empresa_unica', 'propagando', true);

  -- Os números primeiro: o espelho de quem fica já os enxerga.
  update public.contacts set person_id = p_fica where person_id = p_sai;

  for l in select * from public.company_people where person_id = p_sai order by created_at, id loop
    select id into v_ja from public.company_people where person_id = p_fica and company_id = l.company_id;
    if v_ja is not null then
      update public.company_people set
        job_title = coalesce(job_title, l.job_title),
        department = coalesce(department, l.department),
        papel = coalesce(papel, l.papel),
        notes = coalesce(notes, l.notes),
        is_primary = is_primary or l.is_primary
       where id = v_ja;
      delete from public.company_people where id = l.id;
    else
      update public.company_people set person_id = p_fica where id = l.id;
    end if;
  end loop;

  -- Qualquer outra chave para `people` (a linha de planilha do upstream, e a que
  -- vier depois), lida do catálogo.
  for fk in
    select n.nspname as esquema, c.relname as tabela, a.attname as coluna
      from pg_catalog.pg_constraint co
      join pg_catalog.pg_class c on c.oid = co.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = co.conrelid and a.attnum = co.conkey[1]
     where co.contype = 'f'
       and co.confrelid = 'public.people'::regclass
       and array_length(co.conkey, 1) = 1
       and c.relkind = 'r'
       and not (n.nspname = 'public' and c.relname in ('contacts', 'company_people'))
  loop
    execute format('update %I.%I set %I = $1 where %I = $2', fk.esquema, fk.tabela, fk.coluna, fk.coluna)
      using p_fica, p_sai;
  end loop;

  update public.people set
    email = coalesce(email, v_sai.email),
    notes = coalesce(notes, v_sai.notes)
   where id = p_fica;
  delete from public.people where id = p_sai;

  perform public.fn_mia_espelhar_empresa_da_pessoa(p_fica);
  perform set_config('mia.empresa_unica', v_antes, true);
end $$;

-- ─── gatilhos no vínculo (`company_people`, do upstream) ────────────────────

create or replace function public.fn_mia_vinculo_antes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- O papel e o "decide" do upstream dizem a mesma coisa: quem escreve um, o
  -- outro acompanha. A planilha do upstream escreve só `is_decision_maker`.
  if tg_op = 'INSERT' then
    if new.papel is not null then
      new.is_decision_maker := (new.papel = 'decisor');
    elsif new.is_decision_maker then
      new.papel := 'decisor';
    end if;
  else
    if new.papel is distinct from old.papel then
      new.is_decision_maker := coalesce(new.papel = 'decisor', false);
    elsif new.is_decision_maker is distinct from old.is_decision_maker then
      if new.is_decision_maker then
        new.papel := 'decisor';
      elsif old.papel = 'decisor' then
        new.papel := null;
      end if;
    end if;
  end if;

  -- Um principal por empresa: quem passa a ser principal tira o de antes.
  if new.is_primary
     and (tg_op = 'INSERT' or not old.is_primary or new.company_id is distinct from old.company_id) then
    update public.company_people
       set is_primary = false
     where company_id = new.company_id
       and is_primary
       and id is distinct from new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_mia_vinculo_antes on public.company_people;
create trigger trg_mia_vinculo_antes
  before insert or update on public.company_people
  for each row execute function public.fn_mia_vinculo_antes();

create or replace function public.fn_mia_vinculo_depois()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.fn_mia_espelhar_empresa_da_pessoa(old.person_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.person_id is distinct from old.person_id) then
    perform public.fn_mia_espelhar_empresa_da_pessoa(new.person_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_mia_vinculo_depois on public.company_people;
create trigger trg_mia_vinculo_depois
  after insert or delete or update of company_id, person_id, job_title, department, papel, is_primary
  on public.company_people
  for each row execute function public.fn_mia_vinculo_depois();

-- ─── gatilhos no contato ────────────────────────────────────────────────────

-- Quem escreve a empresa direto no contato (o jeito de antes: o cadastro, a
-- ferramenta do agente, a importação, um SQL de semente) continua funcionando,
-- e a escrita vira vínculo.
create or replace function public.fn_mia_contato_empresa_vira_vinculo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text;
  v_pessoa uuid;
  v_vinculo uuid;
begin
  if coalesce(current_setting('mia.empresa_unica', true), '') = 'propagando' then
    return null;
  end if;
  if new.is_anonymized or new.is_merged_into is not null then
    return null;
  end if;
  if tg_op = 'INSERT' and new.empresa_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and old.empresa_id is not distinct from new.empresa_id
     and old.cargo is not distinct from new.cargo
     and old.setor is not distinct from new.setor
     and old.papel_na_empresa is not distinct from new.papel_na_empresa
     and old.principal_na_empresa is not distinct from new.principal_na_empresa then
    return null;
  end if;

  v_antes := coalesce(current_setting('mia.empresa_unica', true), '');
  perform set_config('mia.empresa_unica', 'propagando', true);
  v_pessoa := new.person_id;

  if new.empresa_id is null then
    -- "Sem empresa" no cadastro: sai o vínculo com a empresa que estava no
    -- cartão. Se a pessoa estiver em outra, ela passa a ser a do cartão.
    if tg_op = 'UPDATE' and old.empresa_id is not null and v_pessoa is not null then
      delete from public.company_people where person_id = v_pessoa and company_id = old.empresa_id;
    end if;
    perform public.fn_mia_espelhar_empresa_da_pessoa(v_pessoa);
  else
    if v_pessoa is null then
      v_pessoa := public.fn_mia_nova_pessoa_do_contato(new.id);
    end if;
    select id into v_vinculo
      from public.company_people
     where company_id = new.empresa_id and person_id = v_pessoa;
    if v_vinculo is null then
      insert into public.company_people (organization_id, company_id, person_id, job_title, department, papel, is_primary)
      values (new.organization_id, new.empresa_id, v_pessoa,
              nullif(btrim(coalesce(new.cargo, '')), ''), nullif(btrim(coalesce(new.setor, '')), ''),
              new.papel_na_empresa, coalesce(new.principal_na_empresa, false));
    else
      -- O vínculo que já existe muda só no que ESTA escrita mudou.
      update public.company_people set
        job_title = case when tg_op = 'INSERT' or old.cargo is distinct from new.cargo
                         then nullif(btrim(coalesce(new.cargo, '')), '') else job_title end,
        department = case when tg_op = 'INSERT' or old.setor is distinct from new.setor
                          then nullif(btrim(coalesce(new.setor, '')), '') else department end,
        papel = case when tg_op = 'INSERT' or old.papel_na_empresa is distinct from new.papel_na_empresa
                     then new.papel_na_empresa else papel end,
        is_primary = case when tg_op = 'INSERT' or old.principal_na_empresa is distinct from new.principal_na_empresa
                          then coalesce(new.principal_na_empresa, false) else is_primary end
       where id = v_vinculo;
    end if;
    -- Os outros números da pessoa mostram a mesma empresa no cartão.
    update public.contacts
       set empresa_id = new.empresa_id
     where person_id = v_pessoa
       and id <> new.id
       and is_merged_into is null
       and not is_anonymized
       and empresa_id is distinct from new.empresa_id;
    perform public.fn_mia_espelhar_empresa_da_pessoa(v_pessoa);
  end if;

  perform set_config('mia.empresa_unica', v_antes, true);
  return null;
end $$;

drop trigger if exists trg_mia_contato_empresa_vira_vinculo on public.contacts;
create trigger trg_mia_contato_empresa_vira_vinculo
  after insert or update of empresa_id, cargo, setor, papel_na_empresa, principal_na_empresa
  on public.contacts
  for each row execute function public.fn_mia_contato_empresa_vira_vinculo();

-- O contato que ganha (ou perde) a pessoa passa a mostrar a empresa dela. É o
-- caminho da planilha do upstream, que cria a pessoa, o vínculo e só depois
-- liga o telefone a ela.
create or replace function public.fn_mia_contato_ganhou_pessoa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text;
begin
  if coalesce(current_setting('mia.empresa_unica', true), '') = 'propagando' then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.person_id is not distinct from old.person_id then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.person_id is not null then
    perform public.fn_mia_espelhar_empresa_da_pessoa(old.person_id);
  end if;
  if new.person_id is not null then
    perform public.fn_mia_espelhar_empresa_da_pessoa(new.person_id);
  elsif new.empresa_id is not null and not new.is_anonymized and new.is_merged_into is null then
    -- Sem pessoa não há vínculo, e o cartão fica sem empresa.
    v_antes := coalesce(current_setting('mia.empresa_unica', true), '');
    perform set_config('mia.empresa_unica', 'propagando', true);
    update public.contacts
       set empresa_id = null, cargo = null, setor = null, papel_na_empresa = null, principal_na_empresa = false
     where id = new.id;
    perform set_config('mia.empresa_unica', v_antes, true);
  end if;
  return null;
end $$;

drop trigger if exists trg_mia_contato_ganhou_pessoa on public.contacts;
create trigger trg_mia_contato_ganhou_pessoa
  after insert or update of person_id on public.contacts
  for each row execute function public.fn_mia_contato_ganhou_pessoa();

-- Fusão de contatos (`fn_mesclar_contatos`, do upstream): o número que vira
-- lápide é a mesma pessoa do que fica, e os vínculos dela vão junto.
create or replace function public.fn_mia_contato_mesclado_leva_os_vinculos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text;
  v_fica uuid;
begin
  if new.person_id is null then
    return null;
  end if;
  select person_id into v_fica from public.contacts where id = new.is_merged_into;
  if v_fica is null then
    v_antes := coalesce(current_setting('mia.empresa_unica', true), '');
    perform set_config('mia.empresa_unica', 'propagando', true);
    update public.contacts set person_id = new.person_id where id = new.is_merged_into;
    perform public.fn_mia_espelhar_empresa_da_pessoa(new.person_id);
    perform set_config('mia.empresa_unica', v_antes, true);
  elsif v_fica <> new.person_id then
    perform public.fn_mia_unir_pessoas(v_fica, new.person_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_mia_contato_mesclado_leva_os_vinculos on public.contacts;
create trigger trg_mia_contato_mesclado_leva_os_vinculos
  after update of is_merged_into on public.contacts
  for each row
  when (new.is_merged_into is not null and old.is_merged_into is null)
  execute function public.fn_mia_contato_mesclado_leva_os_vinculos();

-- LGPD: anonimizar o contato limpa o vínculo dele (o protótipo: "anonimizar um
-- contato continua limpando cargo, papel e vínculo"). Quando outro número VIVO
-- fala pela mesma pessoa, o vínculo fica: anonimizar é irreversível e é por
-- número, e o upstream já trocou o nome da pessoa e apagou cargo e
-- departamento (`trg_redigir_b2b_ao_anonimizar`).
create or replace function public.fn_mia_empresa_unica_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.person_id is null then
    return null;
  end if;
  if not exists (
    select 1 from public.contacts
     where person_id = new.person_id
       and id <> new.id
       and not is_anonymized
       and is_merged_into is null
  ) then
    delete from public.company_people where person_id = new.person_id;
  end if;
  return null;
end $$;

drop trigger if exists trg_mia_empresa_unica_contato_anonimizado on public.contacts;
create trigger trg_mia_empresa_unica_contato_anonimizado
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true and old.is_anonymized is distinct from true)
  execute function public.fn_mia_empresa_unica_contato_anonimizado();

-- ─── gatilho no negócio (`crm_leads`, do upstream) ──────────────────────────

-- O negócio novo sem empresa herda a do cartão do contato (decisão do
-- protótipo: "a empresa do contato entra sozinha e pode ser tirada"). Vale para
-- todo caminho que cria negócio: a tela, o agente, a automação, a importação.
-- Quem tira na tela grava `null` depois de criar (app/api/v1/leads/_handler.ts).
create or replace function public.fn_mia_negocio_e_a_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.empresa_id is null and new.contact_id is not null then
    select ct.empresa_id into new.empresa_id
      from public.contacts ct
     where ct.id = new.contact_id
       and ct.organization_id = new.organization_id;
  end if;
  if new.empresa_id is not null
     and (tg_op = 'INSERT'
          or new.empresa_id is distinct from old.empresa_id
          or new.organization_id is distinct from old.organization_id)
     and not exists (select 1 from public.companies
                      where id = new.empresa_id and organization_id = new.organization_id) then
    raise exception using errcode = '23503', message = 'negocio_com_empresa_de_outra_organizacao';
  end if;
  return new;
end $$;

drop trigger if exists trg_mia_negocio_e_a_empresa on public.crm_leads;
create trigger trg_mia_negocio_e_a_empresa
  before insert or update of empresa_id, organization_id on public.crm_leads
  for each row execute function public.fn_mia_negocio_e_a_empresa();

-- ─── as portas de escrita da sessão ─────────────────────────────────────────

-- Criar e editar empresa. Atendente, gestor e o agente criam (decisão do
-- protótipo); o upstream deixa só o gestor criar pela tabela, e a regra dele
-- continua valendo para quem escreve direto (companies-people-rls).
create or replace function public.fn_mia_gravar_empresa(
  p_organization_id uuid,
  p_empresa_id uuid,
  p_dados jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_empresa_id;
  v_criada boolean := false;
  v_tem_cnpj boolean;
  v_cnpj text;
  v_dup uuid;
  v_receita jsonb;
  v_tem_receita boolean;
  v_nome text;
begin
  if p_organization_id is null then
    raise exception using errcode = '22023', message = 'organizacao_obrigatoria';
  end if;
  if auth.uid() is not null and not public.fn_role_at_least(p_organization_id, 'agent') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;
  if jsonb_typeof(p_dados) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'dados_invalidos';
  end if;

  v_tem_cnpj := p_dados ? 'cnpj';
  if v_tem_cnpj and nullif(btrim(coalesce(p_dados->>'cnpj', '')), '') is not null then
    v_cnpj := public.fn_mia_cnpj_normalizado(p_dados->>'cnpj');
    if v_cnpj is null then
      raise exception using errcode = '22023', message = 'cnpj_invalido';
    end if;
  end if;
  v_receita := case when jsonb_typeof(p_dados->'receita') = 'object' then p_dados->'receita' else '{}'::jsonb end;
  v_tem_receita := v_receita <> '{}'::jsonb;

  if v_id is not null then
    perform 1 from public.companies where id = v_id and organization_id = p_organization_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'empresa_nao_encontrada';
    end if;
  end if;

  -- CNPJ repetido é recusado, e a recusa diz qual empresa já o tem.
  if v_cnpj is not null then
    select id into v_dup
      from public.companies
     where organization_id = p_organization_id
       and normalized_cnpj = v_cnpj
       and id is distinct from v_id
     limit 1;
    if v_dup is not null then
      raise exception using errcode = '23505', message = 'cnpj_ja_cadastrado', detail = v_dup::text;
    end if;
  end if;

  if v_id is null then
    v_nome := coalesce(nullif(btrim(coalesce(p_dados->>'nome', '')), ''),
                       nullif(btrim(coalesce(p_dados->>'razao_social', '')), ''),
                       nullif(btrim(coalesce(v_receita->>'trade_name', '')), ''),
                       nullif(btrim(coalesce(v_receita->>'legal_name', '')), ''));
    if v_nome is null then
      raise exception using errcode = '22023', message = 'empresa_sem_nome';
    end if;
    insert into public.companies (organization_id, trade_name, enrichment_status, created_by)
    values (p_organization_id, v_nome, 'pending', auth.uid())
    returning id into v_id;
    v_criada := true;
  end if;

  update public.companies co set
    trade_name = case
      when p_dados ? 'nome' and nullif(btrim(coalesce(p_dados->>'nome', '')), '') is not null
        then btrim(p_dados->>'nome')
      when v_tem_receita and nullif(btrim(coalesce(co.trade_name, '')), '') is null
        then nullif(btrim(coalesce(v_receita->>'trade_name', '')), '')
      else co.trade_name end,
    legal_name = case
      when p_dados ? 'razao_social' then nullif(btrim(coalesce(p_dados->>'razao_social', '')), '')
      when v_tem_receita and v_receita ? 'legal_name' then nullif(btrim(coalesce(v_receita->>'legal_name', '')), '')
      else co.legal_name end,
    cnpj = case when v_tem_cnpj then public.fn_mia_cnpj_formatado(v_cnpj) else co.cnpj end,
    normalized_cnpj = case when v_tem_cnpj then v_cnpj else co.normalized_cnpj end,
    phone = case
      when p_dados ? 'telefone' then nullif(btrim(coalesce(p_dados->>'telefone', '')), '')
      when v_tem_receita and co.phone is null then nullif(btrim(coalesce(v_receita->>'phone', '')), '')
      else co.phone end,
    email = case
      when p_dados ? 'email' then nullif(btrim(coalesce(p_dados->>'email', '')), '')
      when v_tem_receita and co.email is null then nullif(btrim(coalesce(v_receita->>'email', '')), '')
      else co.email end,
    registration_status = case when v_tem_receita then nullif(v_receita->>'registration_status', '') else co.registration_status end,
    legal_nature = case when v_tem_receita then nullif(v_receita->>'legal_nature', '') else co.legal_nature end,
    company_size = case when v_tem_receita then nullif(v_receita->>'company_size', '') else co.company_size end,
    share_capital = case when v_tem_receita then nullif(v_receita->>'share_capital', '')::numeric else co.share_capital end,
    opened_at = case when v_tem_receita then nullif(v_receita->>'opened_at', '')::date else co.opened_at end,
    main_cnae_code = case when v_tem_receita then nullif(v_receita->>'main_cnae_code', '') else co.main_cnae_code end,
    main_cnae_description = case when v_tem_receita then nullif(v_receita->>'main_cnae_description', '') else co.main_cnae_description end,
    secondary_cnaes = case when v_tem_receita then coalesce(v_receita->'secondary_cnaes', '[]'::jsonb) else co.secondary_cnaes end,
    street = case when v_tem_receita then nullif(v_receita->>'street', '') else co.street end,
    number = case when v_tem_receita then nullif(v_receita->>'number', '') else co.number end,
    complement = case when v_tem_receita then nullif(v_receita->>'complement', '') else co.complement end,
    district = case when v_tem_receita then nullif(v_receita->>'district', '') else co.district end,
    city = case when v_tem_receita then nullif(v_receita->>'city', '') else co.city end,
    state = case when v_tem_receita then nullif(v_receita->>'state', '') else co.state end,
    zip_code = case when v_tem_receita then nullif(v_receita->>'zip_code', '') else co.zip_code end,
    enrichment_status = case when v_tem_receita then 'completed' else co.enrichment_status end,
    enrichment_error = case when v_tem_receita then null else co.enrichment_error end,
    enriched_at = case when v_tem_receita then now() else co.enriched_at end,
    brasilapi_raw = case
      when v_tem_receita and jsonb_typeof(p_dados->'receita_bruta') = 'object' then p_dados->'receita_bruta'
      else co.brasilapi_raw end
  where co.id = v_id;

  if (select coalesce(nullif(btrim(coalesce(trade_name, '')), ''), nullif(btrim(coalesce(legal_name, '')), ''))
        from public.companies where id = v_id) is null then
    raise exception using errcode = '22023', message = 'empresa_sem_nome';
  end if;

  if p_dados ?| array['site', 'endereco', 'observacoes', 'tags', 'custom_fields'] then
    insert into public.mia_companies_extra (company_id, organization_id, site, endereco, observacoes, tags, custom_fields)
    values (
      v_id, p_organization_id,
      nullif(btrim(coalesce(p_dados->>'site', '')), ''),
      nullif(btrim(coalesce(p_dados->>'endereco', '')), ''),
      nullif(btrim(coalesce(p_dados->>'observacoes', '')), ''),
      case when jsonb_typeof(p_dados->'tags') = 'array'
           then array(select distinct btrim(t) from jsonb_array_elements_text(p_dados->'tags') t where btrim(t) <> '')
           else '{}'::text[] end,
      case when jsonb_typeof(p_dados->'custom_fields') = 'object' then p_dados->'custom_fields' else '{}'::jsonb end
    )
    on conflict (company_id) do update set
      site = case when p_dados ? 'site' then excluded.site else public.mia_companies_extra.site end,
      endereco = case when p_dados ? 'endereco' then excluded.endereco else public.mia_companies_extra.endereco end,
      observacoes = case when p_dados ? 'observacoes' then excluded.observacoes else public.mia_companies_extra.observacoes end,
      tags = case when p_dados ? 'tags' then excluded.tags else public.mia_companies_extra.tags end,
      custom_fields = case when p_dados ? 'custom_fields' then excluded.custom_fields else public.mia_companies_extra.custom_fields end;
  end if;

  return jsonb_build_object('id', v_id, 'criada', v_criada);
end $$;

-- O contato numa empresa: cria o vínculo ou muda o que vier em `p_dados`
-- (papel, cargo, setor, principal, no_cartao). Contato pode estar em várias.
create or replace function public.fn_mia_vincular_pessoa(
  p_organization_id uuid,
  p_contato_id uuid,
  p_empresa_id uuid,
  p_dados jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text;
  ct record;
  v_pessoa uuid;
  v_vinculo uuid;
  v_criado boolean := false;
  v_papel text;
  v_tem_cartao boolean;
begin
  if auth.uid() is not null and not public.fn_role_at_least(p_organization_id, 'agent') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;
  p_dados := coalesce(p_dados, '{}'::jsonb);
  if jsonb_typeof(p_dados) <> 'object' then
    raise exception using errcode = '22023', message = 'dados_invalidos';
  end if;
  if p_dados ? 'papel' then
    v_papel := nullif(btrim(coalesce(p_dados->>'papel', '')), '');
    if v_papel is not null and v_papel not in ('decisor', 'financeiro', 'usuario', 'influenciador', 'outro') then
      raise exception using errcode = '22023', message = 'papel_invalido';
    end if;
  end if;

  select id, person_id, is_anonymized, is_merged_into into ct
    from public.contacts
   where id = p_contato_id and organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'contato_nao_encontrado';
  end if;
  if ct.is_anonymized then
    raise exception using errcode = '22023', message = 'contato_anonimizado';
  end if;
  if ct.is_merged_into is not null then
    raise exception using errcode = '22023', message = 'contato_mesclado';
  end if;
  if not exists (select 1 from public.companies where id = p_empresa_id and organization_id = p_organization_id) then
    raise exception using errcode = 'P0002', message = 'empresa_nao_encontrada';
  end if;

  v_antes := coalesce(current_setting('mia.empresa_unica', true), '');
  perform set_config('mia.empresa_unica', 'propagando', true);

  v_pessoa := ct.person_id;
  if v_pessoa is null then
    v_pessoa := public.fn_mia_nova_pessoa_do_contato(p_contato_id);
  end if;

  select id into v_vinculo from public.company_people where company_id = p_empresa_id and person_id = v_pessoa;
  if v_vinculo is null then
    insert into public.company_people (organization_id, company_id, person_id, job_title, department, papel, is_primary)
    values (
      p_organization_id, p_empresa_id, v_pessoa,
      nullif(btrim(coalesce(p_dados->>'cargo', '')), ''),
      nullif(btrim(coalesce(p_dados->>'setor', '')), ''),
      v_papel,
      coalesce((p_dados->>'principal')::boolean, false)
    )
    returning id into v_vinculo;
    v_criado := true;
  else
    update public.company_people set
      job_title = case when p_dados ? 'cargo' then nullif(btrim(coalesce(p_dados->>'cargo', '')), '') else job_title end,
      department = case when p_dados ? 'setor' then nullif(btrim(coalesce(p_dados->>'setor', '')), '') else department end,
      papel = case when p_dados ? 'papel' then v_papel else papel end,
      is_primary = case when p_dados ? 'principal' then coalesce((p_dados->>'principal')::boolean, false) else is_primary end
     where id = v_vinculo;
  end if;

  -- A empresa do cartão: a pedida, ou esta quando a pessoa ainda não mostra nenhuma.
  select exists (
    select 1 from public.contacts c2
      join public.company_people cp on cp.person_id = c2.person_id and cp.company_id = c2.empresa_id
     where c2.person_id = v_pessoa and c2.is_merged_into is null and not c2.is_anonymized
  ) into v_tem_cartao;
  if coalesce((p_dados->>'no_cartao')::boolean, false) or not v_tem_cartao then
    update public.contacts
       set empresa_id = p_empresa_id
     where person_id = v_pessoa
       and is_merged_into is null
       and not is_anonymized
       and empresa_id is distinct from p_empresa_id;
  end if;
  perform public.fn_mia_espelhar_empresa_da_pessoa(v_pessoa);

  perform set_config('mia.empresa_unica', v_antes, true);
  return jsonb_build_object('vinculo_id', v_vinculo, 'pessoa_id', v_pessoa, 'criado', v_criado);
end $$;

-- Tira o contato (a pessoa dele) de uma empresa. Os negócios de antes ficam
-- como estavam.
create or replace function public.fn_mia_desvincular_pessoa(
  p_organization_id uuid,
  p_contato_id uuid,
  p_empresa_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pessoa uuid;
  v_n integer;
begin
  if auth.uid() is not null and not public.fn_role_at_least(p_organization_id, 'agent') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;
  select person_id into v_pessoa
    from public.contacts
   where id = p_contato_id and organization_id = p_organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'contato_nao_encontrado';
  end if;
  if v_pessoa is null then
    return jsonb_build_object('removido', false);
  end if;
  delete from public.company_people
   where person_id = v_pessoa and company_id = p_empresa_id and organization_id = p_organization_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('removido', v_n > 0);
end $$;

-- Vários números da mesma pessoa viram uma pessoa só (decisão do protótipo).
-- Cada número segue com a sua conversa; a empresa e os vínculos são um só.
create or replace function public.fn_mia_juntar_numeros(
  p_organization_id uuid,
  p_contato_id uuid,
  p_outro_contato_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text;
  a record;
  b record;
  v_pessoa uuid;
  v_cartao uuid;
begin
  if auth.uid() is not null and not public.fn_role_at_least(p_organization_id, 'agent') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;
  if p_contato_id is null or p_outro_contato_id is null or p_contato_id = p_outro_contato_id then
    raise exception using errcode = '22023', message = 'escolha_dois_numeros';
  end if;
  perform 1 from public.contacts
   where organization_id = p_organization_id and id in (p_contato_id, p_outro_contato_id)
   order by id for update;
  select id, person_id, empresa_id, is_anonymized, is_merged_into into a
    from public.contacts where id = p_contato_id and organization_id = p_organization_id;
  if not found then raise exception using errcode = 'P0002', message = 'contato_nao_encontrado'; end if;
  select id, person_id, empresa_id, is_anonymized, is_merged_into into b
    from public.contacts where id = p_outro_contato_id and organization_id = p_organization_id;
  if not found then raise exception using errcode = 'P0002', message = 'contato_nao_encontrado'; end if;
  if a.is_anonymized or b.is_anonymized then
    raise exception using errcode = '22023', message = 'contato_anonimizado';
  end if;
  if a.is_merged_into is not null or b.is_merged_into is not null then
    raise exception using errcode = '22023', message = 'contato_mesclado';
  end if;

  v_antes := coalesce(current_setting('mia.empresa_unica', true), '');
  perform set_config('mia.empresa_unica', 'propagando', true);

  v_cartao := coalesce(a.empresa_id, b.empresa_id);
  if a.person_id is null and b.person_id is null then
    v_pessoa := public.fn_mia_nova_pessoa_do_contato(a.id);
    update public.contacts set person_id = v_pessoa where id = b.id;
  elsif a.person_id is null then
    v_pessoa := b.person_id;
    update public.contacts set person_id = v_pessoa where id = a.id;
  elsif b.person_id is null then
    v_pessoa := a.person_id;
    update public.contacts set person_id = v_pessoa where id = b.id;
  else
    v_pessoa := a.person_id;
    perform public.fn_mia_unir_pessoas(a.person_id, b.person_id);
  end if;

  -- O cartão fica com a empresa do número escolhido primeiro.
  if v_cartao is not null
     and exists (select 1 from public.company_people where person_id = v_pessoa and company_id = v_cartao) then
    update public.contacts
       set empresa_id = v_cartao
     where person_id = v_pessoa and is_merged_into is null and not is_anonymized
       and empresa_id is distinct from v_cartao;
  end if;
  perform public.fn_mia_espelhar_empresa_da_pessoa(v_pessoa);

  perform set_config('mia.empresa_unica', v_antes, true);
  return jsonb_build_object(
    'pessoa_id', v_pessoa,
    'numeros', (select count(*) from public.contacts
                 where person_id = v_pessoa and is_merged_into is null and not is_anonymized)
  );
end $$;

-- O desfazer de juntar: o número sai da pessoa e leva uma CÓPIA dos vínculos
-- (sem ser o principal de nenhuma empresa), para não sumir de onde estava.
create or replace function public.fn_mia_separar_numero(
  p_organization_id uuid,
  p_contato_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text;
  ct record;
  v_nova uuid;
begin
  if auth.uid() is not null and not public.fn_role_at_least(p_organization_id, 'agent') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;
  select id, person_id, organization_id into ct
    from public.contacts
   where id = p_contato_id and organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'contato_nao_encontrado';
  end if;
  if ct.person_id is null then
    return jsonb_build_object('separado', false, 'motivo', 'sem_pessoa');
  end if;
  if not exists (select 1 from public.contacts
                  where person_id = ct.person_id and id <> ct.id
                    and is_merged_into is null and not is_anonymized) then
    return jsonb_build_object('separado', false, 'motivo', 'unico_numero');
  end if;

  v_antes := coalesce(current_setting('mia.empresa_unica', true), '');
  perform set_config('mia.empresa_unica', 'propagando', true);

  insert into public.people (organization_id, full_name, normalized_name, email)
  select p.organization_id, p.full_name, p.normalized_name, null
    from public.people p where p.id = ct.person_id
  returning id into v_nova;
  insert into public.company_people (organization_id, company_id, person_id, job_title, department, papel, is_primary)
  select organization_id, company_id, v_nova, job_title, department, papel, false
    from public.company_people
   where person_id = ct.person_id;
  update public.contacts set person_id = v_nova where id = ct.id;
  perform public.fn_mia_espelhar_empresa_da_pessoa(v_nova);
  perform public.fn_mia_espelhar_empresa_da_pessoa(ct.person_id);

  perform set_config('mia.empresa_unica', v_antes, true);
  return jsonb_build_object('separado', true, 'pessoa_id', v_nova);
end $$;

-- Excluir empresa: RECUSA com negócio aberto (decisão do protótipo). Sem ele,
-- a empresa sai; as pessoas ficam como contato sem empresa (ou com a outra
-- delas no cartão), os negócios encerrados ficam no histórico sem empresa.
create or replace function public.fn_mia_excluir_empresa(
  p_organization_id uuid,
  p_empresa_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_abertos integer;
  v_pessoas integer;
  v_negocios integer;
  v_obrigacoes integer;
begin
  if auth.uid() is not null and not public.fn_role_at_least(p_organization_id, 'manager') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;
  perform 1 from public.companies
   where id = p_empresa_id and organization_id = p_organization_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'empresa_nao_encontrada';
  end if;

  select count(*) into v_abertos
    from public.crm_leads
   where organization_id = p_organization_id and empresa_id = p_empresa_id and status = 'open';
  if v_abertos > 0 then
    raise exception using errcode = 'P0001', message = 'empresa_com_negocio_aberto', detail = v_abertos::text;
  end if;

  select count(*) into v_pessoas from public.company_people where company_id = p_empresa_id;
  select count(*) into v_negocios
    from public.crm_leads where organization_id = p_organization_id and empresa_id = p_empresa_id;
  select count(*) into v_obrigacoes
    from public.mia_obrigacoes
   where organization_id = p_organization_id and empresa_id = p_empresa_id
     and lead_id is null and contact_id is null;

  delete from public.companies where id = p_empresa_id and organization_id = p_organization_id;

  return jsonb_build_object(
    'excluida', true,
    'pessoas_sem_empresa', v_pessoas,
    'negocios_no_historico', v_negocios,
    'obrigacoes_que_sairam', v_obrigacoes
  );
end $$;

-- Juntar duas fichas da MESMA empresa. Nossa desde a 0263; agora sobre
-- `companies`. Mesmo contrato e mesmas recusas (a rota já as traduz).
create or replace function public.fn_mesclar_empresas(
  p_organization_id uuid,
  p_vencedora uuid,
  p_perdedora uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text;
  v_venc public.companies%rowtype;
  v_perd public.companies%rowtype;
  v_extra public.mia_companies_extra%rowtype;
  v_alvo record;
  l record;
  v_ja uuid;
  v_movidas integer;
  v_repontado jsonb := '{}'::jsonb;
  v_sem_endereco boolean;
begin
  if auth.uid() is not null and not public.fn_role_at_least(p_organization_id, 'manager') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;
  if p_vencedora is null or p_perdedora is null or p_vencedora = p_perdedora then
    raise exception using errcode = '22023', message = 'selecao_de_mesclagem_invalida';
  end if;

  -- As duas travadas sempre na mesma ordem: duas fusões em sentidos opostos
  -- fariam deadlock sem isto.
  perform 1 from public.companies
   where organization_id = p_organization_id and id in (p_vencedora, p_perdedora)
   order by id for update;
  select * into v_venc from public.companies where organization_id = p_organization_id and id = p_vencedora;
  if not found then
    raise exception using errcode = '22023', message = 'empresa_nao_encontrada';
  end if;
  select * into v_perd from public.companies where organization_id = p_organization_id and id = p_perdedora;
  if not found then
    if exists (select 1 from public.mia_companies_mescladas where id = p_perdedora and organization_id = p_organization_id) then
      raise exception using errcode = '22023', message = 'empresa_ja_mesclada';
    end if;
    raise exception using errcode = '22023', message = 'empresa_nao_encontrada';
  end if;

  v_antes := coalesce(current_setting('mia.empresa_unica', true), '');
  perform set_config('mia.empresa_unica', 'propagando', true);

  -- 1 · toda chave que aponta para `companies`, lida do catálogo (a que alguém
  --     criar depois entra sozinha): negócios, a empresa do cartão dos
  --     contatos, obrigações, linhas de planilha, lápides antigas, de-para.
  --     ANTES dos vínculos: quando o vínculo muda de empresa, o espelho do
  --     contato já encontra a vencedora no cartão e não troca por outra.
  for v_alvo in
    select n.nspname as esquema, c.relname as tabela, a.attname as coluna
      from pg_catalog.pg_constraint co
      join pg_catalog.pg_class c on c.oid = co.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = co.conrelid and a.attnum = co.conkey[1]
     where co.contype = 'f'
       and co.confrelid = 'public.companies'::regclass
       and array_length(co.conkey, 1) = 1
       and c.relkind = 'r'
       and not (n.nspname = 'public' and c.relname in ('company_people', 'mia_companies_extra'))
     order by 2, 3
  loop
    execute format('update %I.%I set %I = $1 where %I = $2', v_alvo.esquema, v_alvo.tabela, v_alvo.coluna, v_alvo.coluna)
      using p_vencedora, p_perdedora;
    get diagnostics v_movidas = row_count;
    if v_movidas > 0 then
      v_repontado := v_repontado || jsonb_build_object(v_alvo.tabela || '.' || v_alvo.coluna, v_movidas);
    end if;
  end loop;

  -- 2 · as pessoas: o vínculo da perdedora vai para a vencedora; quem estava
  --     nas duas fica com um só, e o que a vencedora já sabia vale.
  for l in select * from public.company_people where company_id = p_perdedora order by created_at, id loop
    select id into v_ja from public.company_people where company_id = p_vencedora and person_id = l.person_id;
    if v_ja is not null then
      update public.company_people set
        job_title = coalesce(job_title, l.job_title),
        department = coalesce(department, l.department),
        papel = coalesce(papel, l.papel),
        notes = coalesce(notes, l.notes)
       where id = v_ja;
      delete from public.company_people where id = l.id;
    else
      update public.company_people set
        company_id = p_vencedora,
        is_primary = l.is_primary
          and not exists (select 1 from public.company_people p2 where p2.company_id = p_vencedora and p2.is_primary)
       where id = l.id;
    end if;
  end loop;

  -- 3 · o que a vencedora não tem, ela herda; o que ela tem, fica. O CNPJ sai
  --     da perdedora antes de entrar na vencedora (é único por organização).
  if v_venc.normalized_cnpj is null and v_perd.normalized_cnpj is not null then
    update public.companies set normalized_cnpj = null, cnpj = null where id = p_perdedora;
  end if;
  v_sem_endereco := v_venc.street is null and v_venc.city is null and v_venc.zip_code is null;
  update public.companies set
    trade_name = coalesce(nullif(btrim(coalesce(trade_name, '')), ''), v_perd.trade_name),
    legal_name = coalesce(legal_name, v_perd.legal_name),
    cnpj = case when normalized_cnpj is null then v_perd.cnpj else cnpj end,
    normalized_cnpj = coalesce(normalized_cnpj, v_perd.normalized_cnpj),
    phone = coalesce(phone, v_perd.phone),
    email = coalesce(email, v_perd.email),
    registration_status = coalesce(registration_status, v_perd.registration_status),
    legal_nature = coalesce(legal_nature, v_perd.legal_nature),
    company_size = coalesce(company_size, v_perd.company_size),
    share_capital = coalesce(share_capital, v_perd.share_capital),
    opened_at = coalesce(opened_at, v_perd.opened_at),
    main_cnae_code = coalesce(main_cnae_code, v_perd.main_cnae_code),
    main_cnae_description = coalesce(main_cnae_description, v_perd.main_cnae_description),
    secondary_cnaes = case when secondary_cnaes = '[]'::jsonb then v_perd.secondary_cnaes else secondary_cnaes end,
    street = case when v_sem_endereco then v_perd.street else street end,
    number = case when v_sem_endereco then v_perd.number else number end,
    complement = case when v_sem_endereco then v_perd.complement else complement end,
    district = case when v_sem_endereco then v_perd.district else district end,
    city = case when v_sem_endereco then v_perd.city else city end,
    state = case when v_sem_endereco then v_perd.state else state end,
    zip_code = case when v_sem_endereco then v_perd.zip_code else zip_code end,
    enrichment_status = case when enriched_at is null and v_perd.enriched_at is not null then v_perd.enrichment_status else enrichment_status end,
    brasilapi_raw = case when enriched_at is null and v_perd.enriched_at is not null then v_perd.brasilapi_raw else brasilapi_raw end,
    enriched_at = coalesce(enriched_at, v_perd.enriched_at)
   where id = p_vencedora;

  select * into v_extra from public.mia_companies_extra where company_id = p_perdedora;
  if found then
    insert into public.mia_companies_extra (company_id, organization_id, site, endereco, observacoes, tags, custom_fields)
    values (p_vencedora, p_organization_id, v_extra.site, v_extra.endereco, v_extra.observacoes, v_extra.tags, v_extra.custom_fields)
    on conflict (company_id) do update set
      site = coalesce(public.mia_companies_extra.site, excluded.site),
      endereco = coalesce(public.mia_companies_extra.endereco, excluded.endereco),
      observacoes = coalesce(public.mia_companies_extra.observacoes, excluded.observacoes),
      -- Etiquetas e campos se SOMAM: são acréscimo, não identidade.
      tags = (select array(select distinct unnest(public.mia_companies_extra.tags || excluded.tags))),
      custom_fields = excluded.custom_fields || public.mia_companies_extra.custom_fields;
  end if;

  -- 4 · a lápide, e a perdedora sai.
  insert into public.mia_companies_mescladas (id, organization_id, mesclada_com, mesclada_em, motivo, nome, cnpj, dados, mesclada_por)
  values (
    p_perdedora, p_organization_id, p_vencedora, now(), 'mesclagem',
    coalesce(nullif(btrim(coalesce(v_perd.trade_name, '')), ''), v_perd.legal_name),
    v_perd.normalized_cnpj,
    to_jsonb(v_perd) - 'brasilapi_raw',
    auth.uid()
  )
  on conflict (id) do update set
    mesclada_com = excluded.mesclada_com,
    mesclada_em = excluded.mesclada_em,
    motivo = excluded.motivo;
  delete from public.companies where id = p_perdedora;

  for l in select distinct person_id from public.company_people where company_id = p_vencedora loop
    perform public.fn_mia_espelhar_empresa_da_pessoa(l.person_id);
  end loop;

  perform set_config('mia.empresa_unica', v_antes, true);
  return jsonb_build_object('vencedora', p_vencedora, 'perdedora', p_perdedora, 'repontado', v_repontado);
end $$;

-- ─── quem executa o quê ─────────────────────────────────────────────────────

-- As portas da sessão: a sessão chama, e a função confere o papel dentro.
revoke all on function public.fn_mia_gravar_empresa(uuid, uuid, jsonb) from public, anon;
revoke all on function public.fn_mia_vincular_pessoa(uuid, uuid, uuid, jsonb) from public, anon;
revoke all on function public.fn_mia_desvincular_pessoa(uuid, uuid, uuid) from public, anon;
revoke all on function public.fn_mia_juntar_numeros(uuid, uuid, uuid) from public, anon;
revoke all on function public.fn_mia_separar_numero(uuid, uuid) from public, anon;
revoke all on function public.fn_mia_excluir_empresa(uuid, uuid) from public, anon;
revoke all on function public.fn_mesclar_empresas(uuid, uuid, uuid) from public, anon;
grant execute on function public.fn_mia_gravar_empresa(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.fn_mia_vincular_pessoa(uuid, uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.fn_mia_desvincular_pessoa(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.fn_mia_juntar_numeros(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.fn_mia_separar_numero(uuid, uuid) to authenticated, service_role;
grant execute on function public.fn_mia_excluir_empresa(uuid, uuid) to authenticated, service_role;
grant execute on function public.fn_mesclar_empresas(uuid, uuid, uuid) to authenticated, service_role;

-- As internas e as de gatilho: só o servidor (e o dono, que os gatilhos usam).
revoke all on function public.fn_mia_espelhar_empresa_da_pessoa(uuid) from public, anon, authenticated;
revoke all on function public.fn_mia_nova_pessoa_do_contato(uuid) from public, anon, authenticated;
revoke all on function public.fn_mia_unir_pessoas(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_mia_vinculo_antes() from public, anon, authenticated;
revoke all on function public.fn_mia_vinculo_depois() from public, anon, authenticated;
revoke all on function public.fn_mia_contato_empresa_vira_vinculo() from public, anon, authenticated;
revoke all on function public.fn_mia_contato_ganhou_pessoa() from public, anon, authenticated;
revoke all on function public.fn_mia_contato_mesclado_leva_os_vinculos() from public, anon, authenticated;
revoke all on function public.fn_mia_empresa_unica_contato_anonimizado() from public, anon, authenticated;
revoke all on function public.fn_mia_negocio_e_a_empresa() from public, anon, authenticated;
grant execute on function public.fn_mia_espelhar_empresa_da_pessoa(uuid) to service_role;
grant execute on function public.fn_mia_nova_pessoa_do_contato(uuid) to service_role;
grant execute on function public.fn_mia_unir_pessoas(uuid, uuid) to service_role;
grant execute on function public.fn_mia_vinculo_antes() to service_role;
grant execute on function public.fn_mia_vinculo_depois() to service_role;
grant execute on function public.fn_mia_contato_empresa_vira_vinculo() to service_role;
grant execute on function public.fn_mia_contato_ganhou_pessoa() to service_role;
grant execute on function public.fn_mia_contato_mesclado_leva_os_vinculos() to service_role;
grant execute on function public.fn_mia_empresa_unica_contato_anonimizado() to service_role;
grant execute on function public.fn_mia_negocio_e_a_empresa() to service_role;

notify pgrst, 'reload schema';
