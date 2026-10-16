-- manifest: EMPRESA ÚNICA, PARTE 2 DE 3: a cópia do cadastro antigo (`crm_empresas`, 0255) para o do upstream (`companies`), sem perder nem duplicar nada, idempotente em toda passada do baseline. Numa transação só (um `do`): (0) as chaves estrangeiras que apontam para `crm_empresas` (`contacts.empresa_id`, `crm_leads.empresa_id`, `mia_obrigacoes.empresa_id`, lidas do catálogo) saem; (1) cada empresa VIVA ainda sem registro em `mia_companies_de_para` vai para `companies` com o MESMO id, ou casa com uma que já existe na organização, primeiro pelo CNPJ (só dígitos) e, sem CNPJ, pelo nome comparável quando o par é único dos dois lados (é o caso das demonstrações, que gravavam a mesma empresa nos dois cadastros com ids diferentes); quem casa completa só o que a de lá não tem e ganha lápide `de_para` em `mia_companies_mescladas`; site, endereço, observações, etiquetas e campos adicionais vão para `mia_companies_extra`; (2) as lápides antigas (`mesclada_em`) seguem a cadeia até a viva e entram como lápide `mesclagem`; (3) as linhas que apontavam para uma empresa que casou passam a apontar para a que ficou; (4) as chaves voltam, agora para `companies(id)` com o mesmo `on delete` (nome `<tabela>_<coluna>_mia_companies_fkey`); (5) `crm_empresas` deixa de aceitar escrita da sessão (sai a policy de escrita e o privilégio; leitura e dados ficam até a entrega 5); (6) cada contato com empresa ganha pessoa (`people`, `contacts.person_id`) e vínculo (`company_people`) com cargo, setor, papel e principal, um principal por empresa; (7) contato com pessoa e vínculo mas sem empresa no cartão ganha a do vínculo mais antigo; (8) o espelho do contato (`empresa_id`, `cargo`, `setor`, `papel_na_empresa`, `principal_na_empresa`) passa a ser o do vínculo da empresa do cartão, e o papel `decisor` acompanha `is_decision_maker`. Rodar de novo não muda nenhuma linha: o registro de-para pula o que já foi, e o resto só escreve onde há diferença. Medido no ensaio do banco de produção (scratchpad/ensaio78-empresas.sh) e provado em tests/invariants/empresa-unica.test.ts.
--
-- 9025 · empresa única: a cópia dos dados
--
-- `mia`: só objetos NOSSOS e dados. A ordem importa e é esta por um motivo
-- só: a chave estrangeira. Enquanto `contacts.empresa_id` aponta para
-- `crm_empresas`, ninguém pode passar a apontar para uma empresa que só existe
-- em `companies`; por isso as chaves saem PRIMEIRO e voltam por último, tudo
-- na mesma transação (se algo falhar no meio, nada muda e a próxima passada
-- tenta de novo).
--
-- Os gatilhos de vínculo da 9026 vêm DEPOIS deste bloco no arquivo: na primeira
-- passada eles ainda não existem, e a cópia escreve o estado final à mão. Nas
-- seguintes eles existem, e a cópia não tem mais o que copiar.

do $copia$
declare
  e record;
  c record;
  fk record;
  fa record;
  v_cnpj text;
  v_nome text;
  v_alvo uuid;
  v_como text;
  v_pessoa uuid;
  v_hops int;
  v_atual uuid;
  v_principal boolean;
  v_n bigint;
begin
  -- Os gatilhos da 9026 (nas passadas seguintes) não devem traduzir as escritas
  -- desta cópia de volta para vínculo: ela escreve os dois lados.
  perform set_config('mia.empresa_unica', 'propagando', true);

  -- ── 0 · as chaves estrangeiras que apontam para o cadastro antigo saem ───
  create temp table if not exists _mia_fks_de_crm_empresas (
    esquema text, tabela text, coluna text, acao "char"
  ) on commit drop;
  delete from _mia_fks_de_crm_empresas;

  for fk in
    select n.nspname as esquema, cl.relname as tabela, a.attname as coluna,
           co.conname as nome, co.confdeltype as acao
      from pg_catalog.pg_constraint co
      join pg_catalog.pg_class cl on cl.oid = co.conrelid
      join pg_catalog.pg_namespace n on n.oid = cl.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = co.conrelid and a.attnum = co.conkey[1]
     where co.contype = 'f'
       and co.confrelid = 'public.crm_empresas'::regclass
       and co.conrelid <> 'public.crm_empresas'::regclass
       and array_length(co.conkey, 1) = 1
  loop
    insert into _mia_fks_de_crm_empresas values (fk.esquema, fk.tabela, fk.coluna, fk.acao);
    execute format('alter table %I.%I drop constraint %I', fk.esquema, fk.tabela, fk.nome);
  end loop;

  -- ── 1 · as empresas vivas ainda sem destino ────────────────────────────
  for e in
    select ce.*
      from public.crm_empresas ce
     where ce.mesclada_em is null
       and not exists (select 1 from public.mia_companies_de_para d where d.crm_empresa_id = ce.id)
     order by ce.organization_id, ce.created_at, ce.id
  loop
    v_cnpj := public.fn_mia_cnpj_normalizado(e.cnpj);
    v_nome := public.fn_mia_nome_de_empresa_comparavel(e.nome);
    v_alvo := null;
    v_como := null;

    -- Já está em `companies` com o mesmo id (passada anterior interrompida).
    if exists (select 1 from public.companies where id = e.id) then
      v_alvo := e.id;
      v_como := 'copiada';
    end if;

    -- O mesmo CNPJ na mesma organização: é a mesma empresa.
    if v_alvo is null and v_cnpj is not null then
      select id into v_alvo
        from public.companies
       where organization_id = e.organization_id and normalized_cnpj = v_cnpj
       limit 1;
      if v_alvo is not null then v_como := 'casada_por_cnpj'; end if;
    end if;

    -- Sem CNPJ que case, o nome comparável, e só quando o par é ÚNICO dos dois
    -- lados: duas homônimas de qualquer lado e nenhuma casa (vira cópia, e a
    -- tela mostra as duas como "possível duplicada").
    if v_alvo is null and v_nome is not null
       and (select count(*) from public.crm_empresas o
             where o.organization_id = e.organization_id
               and o.mesclada_em is null
               and public.fn_mia_nome_de_empresa_comparavel(o.nome) = v_nome) = 1
       and (select count(*) from public.companies c2
             where c2.organization_id = e.organization_id
               and (public.fn_mia_nome_de_empresa_comparavel(c2.trade_name) = v_nome
                    or public.fn_mia_nome_de_empresa_comparavel(c2.legal_name) = v_nome)) = 1
    then
      select c2.id into v_alvo
        from public.companies c2
       where c2.organization_id = e.organization_id
         and (public.fn_mia_nome_de_empresa_comparavel(c2.trade_name) = v_nome
              or public.fn_mia_nome_de_empresa_comparavel(c2.legal_name) = v_nome)
         -- CNPJs diferentes são empresas diferentes (matriz e filial).
         and (v_cnpj is null or c2.normalized_cnpj is null or c2.normalized_cnpj = v_cnpj)
         -- Uma empresa do upstream recebe no máximo uma das antigas.
         and not exists (select 1 from public.mia_companies_de_para d
                          where d.company_id = c2.id and d.como in ('casada_por_cnpj', 'casada_por_nome'))
       limit 1;
      if v_alvo is not null then v_como := 'casada_por_nome'; end if;
    end if;

    if v_alvo is null then
      insert into public.companies (
        id, organization_id, trade_name, cnpj, normalized_cnpj, phone, email,
        enrichment_status, created_by, created_at, updated_at
      ) values (
        e.id, e.organization_id, e.nome,
        public.fn_mia_cnpj_formatado(v_cnpj), v_cnpj,
        nullif(btrim(coalesce(e.telefone, '')), ''), nullif(btrim(coalesce(e.email, '')), ''),
        'pending', e.created_by_user_id, e.created_at, e.updated_at
      );
      v_alvo := e.id;
      v_como := 'copiada';
    else
      -- Quem casou completa só o que a de lá NÃO tem: os dados da Receita e o
      -- que alguém já escreveu no upstream ficam como estão.
      update public.companies co set
        trade_name = coalesce(nullif(btrim(co.trade_name), ''), e.nome),
        phone = coalesce(co.phone, nullif(btrim(coalesce(e.telefone, '')), '')),
        email = coalesce(co.email, nullif(btrim(coalesce(e.email, '')), '')),
        normalized_cnpj = case
          when co.normalized_cnpj is null and v_cnpj is not null
               and not exists (select 1 from public.companies o
                                where o.organization_id = co.organization_id
                                  and o.normalized_cnpj = v_cnpj and o.id <> co.id)
            then v_cnpj else co.normalized_cnpj end,
        cnpj = case
          when co.normalized_cnpj is null and v_cnpj is not null
               and not exists (select 1 from public.companies o
                                where o.organization_id = co.organization_id
                                  and o.normalized_cnpj = v_cnpj and o.id <> co.id)
            then public.fn_mia_cnpj_formatado(v_cnpj) else co.cnpj end
      where co.id = v_alvo
        and (nullif(btrim(co.trade_name), '') is null
             or (co.phone is null and nullif(btrim(coalesce(e.telefone, '')), '') is not null)
             or (co.email is null and nullif(btrim(coalesce(e.email, '')), '') is not null)
             or (co.normalized_cnpj is null and v_cnpj is not null));
    end if;

    -- O que é só nosso, ao lado.
    insert into public.mia_companies_extra (company_id, organization_id, site, endereco, observacoes, tags, custom_fields)
    values (
      v_alvo, e.organization_id,
      nullif(btrim(coalesce(e.site, '')), ''),
      nullif(btrim(coalesce(e.endereco, '')), ''),
      nullif(btrim(coalesce(e.observacoes, '')), ''),
      coalesce(e.tags, '{}'::text[]),
      coalesce(e.custom_fields, '{}'::jsonb)
    )
    on conflict (company_id) do update set
      site = coalesce(public.mia_companies_extra.site, excluded.site),
      endereco = coalesce(public.mia_companies_extra.endereco, excluded.endereco),
      observacoes = coalesce(public.mia_companies_extra.observacoes, excluded.observacoes),
      tags = (select array(select distinct unnest(public.mia_companies_extra.tags || excluded.tags))),
      custom_fields = excluded.custom_fields || public.mia_companies_extra.custom_fields;

    insert into public.mia_companies_de_para (crm_empresa_id, organization_id, company_id, como)
    values (e.id, e.organization_id, v_alvo, v_como);

    if v_alvo <> e.id then
      insert into public.mia_companies_mescladas (id, organization_id, mesclada_com, mesclada_em, motivo, nome, cnpj, dados)
      values (e.id, e.organization_id, v_alvo, now(), 'de_para', e.nome, v_cnpj,
              jsonb_build_object('origem', 'crm_empresas', 'como', v_como))
      on conflict (id) do nothing;
    end if;
  end loop;

  -- ── 2 · as lápides antigas seguem a cadeia até a viva ──────────────────
  for e in
    select ce.*
      from public.crm_empresas ce
     where ce.mesclada_em is not null
       and not exists (select 1 from public.mia_companies_de_para d where d.crm_empresa_id = ce.id)
  loop
    v_atual := e.mesclada_com;
    v_hops := 0;
    while v_atual is not null and v_hops < 20 loop
      exit when exists (select 1 from public.crm_empresas where id = v_atual and mesclada_em is null);
      select mesclada_com into v_atual from public.crm_empresas where id = v_atual;
      v_hops := v_hops + 1;
    end loop;
    select d.company_id into v_alvo from public.mia_companies_de_para d where d.crm_empresa_id = v_atual;
    if not found then v_alvo := null; end if;

    insert into public.mia_companies_de_para (crm_empresa_id, organization_id, company_id, como)
    values (e.id, e.organization_id, v_alvo, 'lapide');
    insert into public.mia_companies_mescladas (id, organization_id, mesclada_com, mesclada_em, motivo, nome, cnpj, dados)
    values (e.id, e.organization_id, v_alvo, e.mesclada_em, 'mesclagem', e.nome,
            public.fn_mia_cnpj_normalizado(e.cnpj), jsonb_build_object('origem', 'crm_empresas'))
    on conflict (id) do nothing;
  end loop;

  -- ── 3 · quem apontava para uma empresa que casou passa para a que ficou ─
  for fa in select * from _mia_fks_de_crm_empresas loop
    execute format(
      'update %I.%I t set %I = d.company_id
         from public.mia_companies_de_para d
        where t.%I = d.crm_empresa_id and d.company_id is not null and d.company_id <> d.crm_empresa_id',
      fa.esquema, fa.tabela, fa.coluna, fa.coluna);
    -- Lápide sem destino (cadeia quebrada): o vínculo fica vazio, como o
    -- `on delete set null` faria. Não acontece com dado coerente; existe para a
    -- chave voltar sem recusa.
    execute format(
      'update %I.%I t set %I = null
        where t.%I is not null and not exists (select 1 from public.companies c where c.id = t.%I)',
      fa.esquema, fa.tabela, fa.coluna, fa.coluna, fa.coluna);
    get diagnostics v_n = row_count;
    if v_n > 0 then
      raise notice 'empresa unica: % linha(s) de %.% sem empresa de destino ficaram sem empresa', v_n, fa.tabela, fa.coluna;
    end if;
  end loop;

  -- ── 4 · as chaves voltam, agora para `companies` ────────────────────────
  for fa in select * from _mia_fks_de_crm_empresas loop
    if not exists (
      select 1 from pg_catalog.pg_constraint
       where conname = format('%s_%s_mia_companies_fkey', fa.tabela, fa.coluna)
    ) then
      execute format(
        'alter table %I.%I add constraint %I foreign key (%I) references public.companies(id) on delete %s',
        fa.esquema, fa.tabela, format('%s_%s_mia_companies_fkey', fa.tabela, fa.coluna), fa.coluna,
        case fa.acao when 'n' then 'set null' when 'c' then 'cascade' when 'r' then 'restrict'
                     when 'd' then 'set default' else 'no action' end);
    end if;
  end loop;

  -- ── 6 · cada contato com empresa ganha pessoa e vínculo ────────────────
  for c in
    select ct.id, ct.organization_id, ct.person_id, ct.empresa_id, ct.cargo, ct.setor,
           ct.papel_na_empresa, ct.principal_na_empresa, ct.name, ct.display_name, ct.phone_number, ct.email
      from public.contacts ct
     where ct.empresa_id is not null
       and ct.is_merged_into is null
       and not ct.is_anonymized
       and (ct.person_id is null
            or not exists (select 1 from public.company_people cp
                            where cp.person_id = ct.person_id and cp.company_id = ct.empresa_id))
     order by ct.organization_id, ct.created_at, ct.id
  loop
    v_pessoa := c.person_id;
    if v_pessoa is null then
      insert into public.people (organization_id, full_name, normalized_name, email)
      values (
        c.organization_id,
        coalesce(nullif(btrim(coalesce(c.name, '')), ''), nullif(btrim(coalesce(c.display_name, '')), ''),
                 nullif(btrim(coalesce(c.phone_number, '')), ''), 'Contato sem nome'),
        public.fn_mia_nome_de_empresa_comparavel(coalesce(c.name, c.display_name)),
        nullif(btrim(coalesce(c.email, '')), '')
      )
      returning id into v_pessoa;
      update public.contacts set person_id = v_pessoa where id = c.id;
    end if;

    v_principal := coalesce(c.principal_na_empresa, false)
      and not exists (select 1 from public.company_people
                       where company_id = c.empresa_id and is_primary and person_id <> v_pessoa);

    insert into public.company_people (
      organization_id, company_id, person_id, job_title, department, papel, is_decision_maker, is_primary
    ) values (
      c.organization_id, c.empresa_id, v_pessoa, c.cargo, c.setor, c.papel_na_empresa,
      coalesce(c.papel_na_empresa = 'decisor', false), v_principal
    )
    on conflict (company_id, person_id) do update set
      job_title = coalesce(public.company_people.job_title, excluded.job_title),
      department = coalesce(public.company_people.department, excluded.department),
      papel = coalesce(public.company_people.papel, excluded.papel),
      is_decision_maker = public.company_people.is_decision_maker or excluded.is_decision_maker,
      is_primary = public.company_people.is_primary or excluded.is_primary;
  end loop;

  -- O papel e o "decide" do upstream dizem a mesma coisa.
  update public.company_people
     set papel = 'decisor'
   where papel is null and is_decision_maker;

  -- ── 7 · pessoa com vínculo e contato sem empresa no cartão ─────────────
  update public.contacts ct
     set empresa_id = x.company_id
    from (
      select distinct on (person_id) person_id, company_id
        from public.company_people
       order by person_id, created_at, id
    ) x
   where ct.person_id = x.person_id
     and ct.empresa_id is null
     and ct.is_merged_into is null
     and not ct.is_anonymized;

  -- ── 8 · o espelho do contato é o vínculo da empresa do cartão ──────────
  update public.contacts ct
     set cargo = cp.job_title,
         setor = cp.department,
         papel_na_empresa = cp.papel,
         principal_na_empresa = cp.is_primary
    from public.company_people cp
   where cp.person_id = ct.person_id
     and cp.company_id = ct.empresa_id
     and ct.is_merged_into is null
     and not ct.is_anonymized
     and (ct.cargo is distinct from cp.job_title
          or ct.setor is distinct from cp.department
          or ct.papel_na_empresa is distinct from cp.papel
          or ct.principal_na_empresa is distinct from cp.is_primary);

  perform set_config('mia.empresa_unica', '', true);
end
$copia$;

-- ── 5 · o cadastro antigo não aceita mais escrita da sessão ─────────────────
--
-- Fica para leitura e para a entrega 5 (aposentadoria). Escrever nele agora
-- seria escrever num lugar que nenhuma tela lê: melhor recusar alto.
drop policy if exists "crm_empresas_escrita" on public.crm_empresas;
revoke insert, update, delete on public.crm_empresas from anon, authenticated;

comment on table public.crm_empresas is
  'APOSENTADA (9025, empresa unica): os dados foram copiados para companies (mia_companies_de_para diz para onde foi cada linha). Leitura so; nenhuma escrita da sessao. Sai de vez na entrega 5.';

notify pgrst, 'reload schema';
