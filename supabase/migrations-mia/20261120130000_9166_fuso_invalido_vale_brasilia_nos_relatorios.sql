-- manifest: O FUSO DOS RELATÓRIOS, UMA REGRA SÓ (MIA-102; docs/fork/relatorios.md). Fuso da organização vazio OU com nome que o Postgres não conhece vale `America/Sao_Paulo`, o mesmo padrão da coluna `organizations.timezone` e de `fusoUtilizavel` (lib/tempo/fusos.ts) no TypeScript. Antes, o preparo do motor (`fn_mia_relatorio_preparar`, 9041) só recuava quando o fuso estava vazio: com `America/Sao_Pualo` gravado, o `at time zone` levantava erro e o montador e os painéis prontos não abriam. A conferência é pelo `pg_timezone_names`, UMA vez por pedido (o preparo lê uma linha de `organizations`), sem `exception` por linha. Não usa a `fn_fuso_valido` do upstream (9404) porque ela tem EXECUTE só para `service_role`, e o preparo roda como quem pergunta (`security invoker`); a regra é a mesma, escrita ao lado. Redefine só função NOSSA (`fn_mia_relatorio_preparar`), mesma assinatura e mesmas permissões, espelhada no baseline-mia.sql. Não muda o fuso de nenhuma organização gravada. Provado em tests/invariants/fuso-invalido-nos-relatorios.test.ts.
--
-- 9166 · fuso vazio ou inválido vale Brasília nos relatórios montados
--
-- `fn_mia_`: só objeto NOSSO é redefinido (docs/FORK-MIA.md, regra 3).
-- Idempotente: `create or replace`, e as permissões reemitidas como na 9041. O
-- corpo é o da última definição (9041); o que muda está marcado "9166".

create or replace function public.fn_mia_relatorio_preparar(
  p_org uuid,
  p_fonte text,
  p_medidas text[],
  p_dim1 text,
  p_dim2 text,
  p_filtros jsonb,
  p_periodo text,
  p_de date,
  p_ate date,
  p_agora timestamptz
) returns jsonb
language plpgsql
stable
set search_path = ''
as $f$
declare
  v_catalogo jsonb := public.fn_mia_relatorio_catalogo();
  v_fonte jsonb := v_catalogo -> p_fonte;
  v_filtros jsonb := '{}'::jsonb;
  v_medidas text[];
  v_chave text;
  v_valor jsonb;
  v_fuso text;
  v_moeda text;
  v_janela jsonb;
  v_funil uuid;
  v_funil_info jsonb;
  v_precisa text[];
begin
  -- ── quem pergunta ──
  if auth.uid() is not null
     and not public.fn_is_platform_admin()
     and public.fn_user_role_in_org(p_org) is null then
    raise exception 'sem_vinculo_com_a_organizacao' using errcode = '42501';
  end if;

  -- ── o pedido ──
  if v_fonte is null or left(p_fonte, 1) = '_' then
    raise exception 'fonte_desconhecida: %', p_fonte using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct m order by m), '{}') into v_medidas
    from unnest(coalesce(p_medidas, '{}')) m where m is not null;
  if cardinality(v_medidas) = 0 or cardinality(v_medidas) > 6 then
    raise exception 'medidas: de uma a seis' using errcode = '22023';
  end if;
  foreach v_chave in array v_medidas loop
    if not (v_fonte -> 'medidas') ? v_chave then
      raise exception 'medida_desconhecida_para_a_fonte: % em %', v_chave, p_fonte using errcode = '22023';
    end if;
  end loop;
  if p_dim1 is not null and not (v_fonte -> 'dims') ? p_dim1 then
    raise exception 'agrupamento_desconhecido_para_a_fonte: % em %', p_dim1, p_fonte using errcode = '22023';
  end if;
  if p_dim2 is not null and (p_dim1 is null or not (v_fonte -> 'dims') ? p_dim2 or p_dim2 = p_dim1) then
    raise exception 'segundo_agrupamento_invalido: %', p_dim2 using errcode = '22023';
  end if;

  -- ── os filtros, normalizados ──
  if p_filtros is not null and jsonb_typeof(p_filtros) <> 'object' then
    raise exception 'filtros: um objeto' using errcode = '22023';
  end if;
  for v_chave, v_valor in select f.key, f.value from jsonb_each(coalesce(p_filtros, '{}'::jsonb)) f loop
    -- As chaves internas são do motor: quem pergunta não as escolhe.
    continue when left(v_chave, 2) = '__';
    if not (v_fonte -> 'filtros') ? v_chave then
      raise exception 'filtro_desconhecido_para_a_fonte: % em %', v_chave, p_fonte using errcode = '22023';
    end if;
    continue when jsonb_typeof(v_valor) = 'null';
    if jsonb_typeof(v_valor) = 'array' then
      if (v_catalogo -> '_um_valor_so') ? v_chave then
        raise exception 'filtro_de_um_valor_so: %', v_chave using errcode = '22023';
      end if;
      continue when jsonb_array_length(v_valor) = 0;
      if jsonb_array_length(v_valor) > 50 then
        raise exception 'filtro_com_mais_de_50_valores: %', v_chave using errcode = '22023';
      end if;
      if exists (select 1 from jsonb_array_elements(v_valor) e where jsonb_typeof(e) <> 'string') then
        raise exception 'filtro_lista_so_de_texto: %', v_chave using errcode = '22023';
      end if;
      if jsonb_array_length(v_valor) = 1 then
        v_valor := v_valor -> 0;
      end if;
    end if;
    v_filtros := v_filtros || jsonb_build_object(v_chave, v_valor);
  end loop;

  -- "Chegaram até a etapa" é o funil: agrupando por etapa, sozinha ou com a
  -- soma do valor de quem chegou (9041).
  if 'chegaram' = any(v_medidas)
     and (exists (select 1 from unnest(v_medidas) m where m not in ('chegaram', 'soma'))
          or p_dim1 is distinct from 'etapa' or p_dim2 is not null) then
    raise exception 'chegaram_so_agrupando_por_etapa_com_a_soma_no_maximo' using errcode = '22023';
  end if;

  -- Anúncios: o que foi informado à Meta e ao Google é de gestor e
  -- administrador (o piso das telas de Conversões e de Meta Ads).
  if p_fonte = 'anuncios' and auth.uid() is not null
     and not public.fn_is_platform_admin()
     and not public.fn_role_at_least(p_org, 'manager') then
    raise exception 'anuncios_so_para_gestor_ou_administrador' using errcode = '42501';
  end if;

  -- ── a empresa: fuso e moeda ──
  -- 9166: fuso vazio OU que o Postgres não conhece vale Brasília (o padrão da
  -- coluna), em vez de levantar erro no `at time zone` e o relatório não abrir.
  -- O `pg_timezone_names` é lido uma vez por pedido, aqui, e não por linha.
  select coalesce((select z.name from pg_timezone_names z where z.name = btrim(o.timezone)),
                  'America/Sao_Paulo'),
         coalesce(nullif(btrim(o.currency), ''), 'BRL')
    into v_fuso, v_moeda
    from public.organizations o
   where o.id = p_org;
  if v_fuso is null then
    raise exception 'organizacao_inexistente' using errcode = '22023';
  end if;

  -- ── o período ──
  v_janela := public.fn_mia_relatorio_janela(v_fuso, p_periodo, p_de, p_ate,
                                             coalesce((v_fonte->>'futuro')::boolean, false), p_agora);
  if v_janela->>'periodo' <> 'tudo' then
    if (p_dim1 = 'dia' or p_dim2 = 'dia') and (v_janela->>'dias')::int > 400 then
      raise exception 'agrupar_por_dia_ate_400_dias' using errcode = '22023';
    end if;
    if (p_dim1 = 'semana' or p_dim2 = 'semana') and (v_janela->>'dias')::int > 1830 then
      raise exception 'agrupar_por_semana_ate_cinco_anos' using errcode = '22023';
    end if;
  end if;

  -- ── o funil (negócios por etapa, ou filtrados por funil) ──
  if p_fonte = 'negocios'
     and (p_dim1 = 'etapa' or p_dim2 = 'etapa' or v_filtros ? 'funil') then
    v_funil := nullif(v_filtros->>'funil', '')::uuid;
    if v_funil is null then
      select p.id into v_funil
        from public.crm_pipelines p
       where p.organization_id = p_org and not p.is_archived
       order by p.is_default desc, p.position, p.created_at
       limit 1;
    end if;
    select jsonb_build_object('id', p.id, 'nome', p.name, 'vocabulario', p.vocabulary)
      into v_funil_info
      from public.crm_pipelines p
     where p.id = v_funil and p.organization_id = p_org;
    if v_funil_info is null then
      raise exception 'funil_inexistente' using errcode = '22023';
    end if;
    v_filtros := v_filtros || jsonb_build_object('funil', v_funil::text);
  end if;

  -- O que as linhas precisam calcular: os agrupamentos e os filtros do pedido.
  select coalesce(array_agg(distinct x), '{}') into v_precisa
    from unnest(array[p_dim1, p_dim2] || array(select jsonb_object_keys(v_filtros))) x
   where x is not null;

  return jsonb_build_object(
    'medidas', to_jsonb(v_medidas),
    'filtros', v_filtros,
    'precisa', to_jsonb(v_precisa),
    'fuso', v_fuso,
    'moeda', v_moeda,
    'janela', v_janela,
    'funil', v_funil_info
  );
end;
$f$;

comment on function public.fn_mia_relatorio_preparar(uuid, text, text[], text, text, jsonb, text, date, date, timestamptz) is
  'MIA (9041, 9166): o preparo de um pedido ao motor de relatorios, a regua unica do motor (fn_mia_relatorio) e da lista (fn_mia_relatorio_lista): a guarda de vinculo (42501), o catalogo (22023), os filtros normalizados, o fuso e a moeda da empresa (9166: fuso vazio ou que o Postgres nao conhece vale America/Sao_Paulo), a janela do periodo e o funil.';


revoke all on function public.fn_mia_relatorio_preparar(uuid, text, text[], text, text, jsonb, text, date, date, timestamptz) from public;
revoke execute on function public.fn_mia_relatorio_preparar(uuid, text, text[], text, text, jsonb, text, date, date, timestamptz) from anon;
grant execute on function public.fn_mia_relatorio_preparar(uuid, text, text[], text, text, jsonb, text, date, date, timestamptz) to authenticated, service_role;
