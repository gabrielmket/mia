-- 0263 — juntar duas fichas da MESMA empresa
--
-- A entidade empresa nasceu na 0255 e ganhou duas portas de criação: a tela e,
-- desde agora, o agente (`crm_registrar_empresa_do_contato`). A segunda cria
-- ficha a partir do que o cliente DITOU numa conversa — e por mais frouxo que
-- seja o casamento por nome, duas grafias distantes ("Padaria do Zé" e "Panif.
-- Zé Ltda") vão nascer separadas.
--
-- Sem fusão, o conserto seria apagar uma das duas — e apagar leva junto o
-- vínculo dos contatos e dos negócios (`on delete set null`). O operador
-- resolveria a duplicata perdendo o histórico, que é o oposto do que a entidade
-- existe para dar.
--
-- ── Por que uma FUNÇÃO, e não uns `update` na rota ────────────────────────
--
-- Mesma razão de `fn_mesclar_contatos` (0215): fusão não tem desfazer. Em
-- TypeScript, com um `update` por tabela, cada timeout deixaria uma fusão pela
-- metade — contatos repontados e negócios não, ou o contrário. Aqui é uma
-- transação só.
--
-- E as FKs vêm de `pg_constraint`, não de uma lista escrita à mão: hoje são
-- duas (`contacts.empresa_id`, `crm_leads.empresa_id`); a terceira que alguém
-- criar entra sozinha. Lista à mão envelhece em silêncio, e o sintoma seria uma
-- ficha órfã que ninguém liga à fusão feita meses antes.
--
-- ── Lápide, e não DELETE ──────────────────────────────────────────────────
--
-- A perdedora fica, marcada. Apagar responderia "essa empresa nunca existiu" a
-- quem for conferir por que um negócio antigo aponta para outro nome — e é
-- exatamente essa a pergunta de quem desconfia de uma fusão.

alter table public.crm_empresas
  add column if not exists mesclada_em timestamptz,
  add column if not exists mesclada_com uuid references public.crm_empresas(id) on delete set null;

comment on column public.crm_empresas.mesclada_com is
  'A empresa que VENCEU a fusao. Preenchida = esta ficha e lapide: some das listas e do seletor, mas responde "para onde foi" a quem conferir um negocio antigo.';

-- As listas e o seletor leem por aqui: lápide não aparece.
create index if not exists idx_crm_empresas_vivas
  on public.crm_empresas (organization_id, lower(nome))
  where mesclada_em is null;

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
  v_vencedora public.crm_empresas%rowtype;
  v_perdedora public.crm_empresas%rowtype;
  v_alvo record;
  v_movidas integer;
  v_repontado jsonb := '{}'::jsonb;
begin
  -- 1 · Autorização. `manager`, o mesmo piso da fusão de contatos: é destrutivo
  --     na prática. Sessão de service role (auth.uid() nulo) não passa por
  --     aqui — quem resolve a org nesse caminho é a rota.
  if auth.uid() is not null
     and not public.fn_role_at_least(p_organization_id, 'manager') then
    raise exception using errcode = '42501', message = 'insufficient_role';
  end if;

  if p_vencedora is null or p_perdedora is null or p_vencedora = p_perdedora then
    raise exception using errcode = '22023', message = 'selecao_de_mesclagem_invalida';
  end if;

  -- 2 · Trava as DUAS na mesma ordem sempre (id crescente): duas fusões
  --     simultâneas em sentidos opostos fariam deadlock sem isto.
  select * into v_vencedora from public.crm_empresas
   where organization_id = p_organization_id and id = least(p_vencedora, p_perdedora)
   for update;
  select * into v_perdedora from public.crm_empresas
   where organization_id = p_organization_id and id = greatest(p_vencedora, p_perdedora)
   for update;

  -- Reordena para os papéis certos depois do lock.
  if v_vencedora.id <> p_vencedora then
    select * into v_vencedora from public.crm_empresas
     where organization_id = p_organization_id and id = p_vencedora;
    select * into v_perdedora from public.crm_empresas
     where organization_id = p_organization_id and id = p_perdedora;
  end if;

  if v_vencedora.id is null or v_perdedora.id is null then
    raise exception using errcode = '22023', message = 'empresa_nao_encontrada';
  end if;
  if v_perdedora.mesclada_em is not null then
    raise exception using errcode = '22023', message = 'empresa_ja_mesclada';
  end if;

  -- 3 · Reponta TODA FK que aponta para `crm_empresas`, derivada do catálogo.
  for v_alvo in
    select n.nspname as esquema, c.relname as tabela, a.attname as coluna
      from pg_catalog.pg_constraint co
      join pg_catalog.pg_class c on c.oid = co.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = co.conrelid and a.attnum = co.conkey[1]
     where co.contype = 'f'
       and co.confrelid = 'public.crm_empresas'::regclass
       -- A auto-referência da lápide (`mesclada_com`) fica de fora: repontá-la
       -- reescreveria o histórico de fusões anteriores.
       and co.conrelid <> 'public.crm_empresas'::regclass
       and array_length(co.conkey, 1) = 1
       and c.relkind = 'r'
       and n.nspname = 'public'
     order by 2, 3
  loop
    execute format(
      'update %I.%I set %I = $1 where %I = $2',
      v_alvo.esquema, v_alvo.tabela, v_alvo.coluna, v_alvo.coluna
    ) using p_vencedora, p_perdedora;
    get diagnostics v_movidas = row_count;
    v_repontado := v_repontado || jsonb_build_object(v_alvo.tabela, v_movidas);
  end loop;

  -- 4 · O que a vencedora NÃO tem, ela herda. Nada é perdido por fundir, e o
  --     que ela já tem nunca é sobrescrito — quem escolheu a vencedora escolheu
  --     os dados dela.
  update public.crm_empresas set
    cnpj        = coalesce(cnpj, v_perdedora.cnpj),
    site        = coalesce(site, v_perdedora.site),
    telefone    = coalesce(telefone, v_perdedora.telefone),
    email       = coalesce(email, v_perdedora.email),
    endereco    = coalesce(endereco, v_perdedora.endereco),
    observacoes = coalesce(observacoes, v_perdedora.observacoes),
    -- Tags e campos extras se SOMAM: são acréscimo, não identidade, e perder
    -- uma tag numa fusão é perder segmentação sem ninguém notar.
    tags          = (select array(select distinct unnest(tags || v_perdedora.tags))),
    custom_fields = v_perdedora.custom_fields || custom_fields,
    updated_at  = now()
   where organization_id = p_organization_id and id = p_vencedora;

  -- 5 · A lápide.
  update public.crm_empresas
     set mesclada_em = now(), mesclada_com = p_vencedora, updated_at = now()
   where organization_id = p_organization_id and id = p_perdedora;

  return jsonb_build_object(
    'vencedora', p_vencedora,
    'perdedora', p_perdedora,
    'repontado', v_repontado
  );
end; $$;

revoke all on function public.fn_mesclar_empresas(uuid,uuid,uuid) from public, anon;
grant execute on function public.fn_mesclar_empresas(uuid,uuid,uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
