-- manifest: A SESSÃO NÃO LÊ CUSTO, TOKENS, PROVEDOR NEM MODELO DE IA (MIA-251 G; desenho na MIA-285, ponto 4, opção A, passos 2, 4 e 5). A 9173 fechou a escrita; a leitura seguia aberta: qualquer membro da empresa, pelo PostgREST, lia `cost_cents`, os tokens, o provedor e o modelo de cada chamada em `llm_calls`, `agent_turn_traces` e `ai_agent_runs`, o que a resposta da API já escondia desde a MIA-262 (`semIaDaPlataforma`). `fn_mia_colunas_de_ia_fechadas()` (NOSSA, 9173) ganha o passo 2: nas três tabelas, `revoke select` da tabela de `anon` e `authenticated` (inclusive concessão de outro concedente, e SELECT de coluna fechada ou de `anon` solto) e `grant select (colunas)` a `authenticated`, com a lista calculada por `information_schema.columns` menos as fechadas: `cost_cents`, `provider`, `model`, `entrada_do_primeiro_passo` e toda coluna com `tokens` no nome (a mesma regra de `lib/ai/colunas-de-ia-fechadas.ts`). Como o `baseline-mia.sql` chama a função a cada implantação, coluna nova do upstream ganha SELECT na implantação seguinte e só as fechadas ficam de fora; o `GRANT ALL` do corpo do baseline do upstream reabre a tabela a cada passada e ela fecha de novo. A escrita da 9173 fica como estava, inclusive o `update (tool_calls)` da anonimização LGPD (o PostgREST grava com `RETURNING 1` e o filtro usa `id` e `organization_id`, que seguem abertos). A chave primária `id` segue aberta, e o Realtime de `ai_agent_runs` (`hooks/ai/useAgentRuns.ts`) continua entregando a linha, sem as colunas fechadas (`realtime.apply_rls` só manda as colunas com `has_column_privilege` e só recusa quando a chave primária fica de fora). Os leitores que precisam da coluna fechada são rotas da plataforma (`podeVerCusto`) e passam a ler pelo cliente admin depois do portão; a `fn_uso_de_ia` (invoker, do upstream) também, porque soma custo e tokens. Devolve quantas concessões de escrita ou de leitura fechada sobraram (0 = fechado). Provado em tests/invariants/custo-de-ia-a-sessao-nao-le.test.ts, na cerca tests/unit/colunas-de-custo-fora-da-sessao.test.ts e numa conferência do scripts/ensaio-de-banco.sh.
--
-- 9175 · a sessão não lê custo, tokens, provedor nem modelo de IA
--
-- Nome NOSSO (`fn_mia_*`): estender, nunca redefinir (docs/FORK-MIA.md, regra 3).
-- A função é nossa (9173) e é refeita aqui com o passo 2. Nada do upstream é
-- redefinido: só `revoke` e `grant` nas tabelas dele, a política restritiva de
-- nome nosso da 9173 e a chamada da função de travas dele.
-- Idempotente: rodar de novo não muda nada.

create or replace function public.fn_mia_colunas_de_ia_fechadas()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_abertas integer;
  v_tabela text;
  v_colunas text;
  -- A mesma regra de `lib/ai/colunas-de-ia-fechadas.ts`: estas pelo nome, e
  -- toda coluna com `tokens` no nome (a cerca confere que as duas batem).
  v_fechadas constant text[] := array['cost_cents', 'provider', 'model', 'entrada_do_primeiro_passo'];
  v_leitura constant text[] := array['llm_calls', 'agent_turn_traces', 'ai_agent_runs'];
begin
  -- ── passo 1 · a escrita (9173) ────────────────────────────────────────────
  -- Revogar o privilégio da TABELA leva junto o da coluna do mesmo concedente
  -- (por isso o `grant update (tool_calls)` vem depois, e é refeito a cada vez).
  if to_regclass('public.llm_calls') is not null then
    revoke insert, update, delete, truncate, references, trigger
      on table public.llm_calls from anon, authenticated;
  end if;
  if to_regclass('public.ai_agent_runs') is not null then
    revoke insert, update, delete, truncate, references, trigger
      on table public.ai_agent_runs from anon, authenticated;
  end if;

  -- O `revoke` só tira o que quem roda concedeu (o superusuário, como dono).
  -- Concessão feita por outro papel sobrevive: tira em nome dele. Sem poder
  -- virar aquele papel, avisa e segue; a contagem do fim mostra o que sobrou.
  for r in
    select c.relname as tabela, null::text as coluna, g.rolname as concedente,
           e.rolname as papel, x.privilege_type as privilegio
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) x
      join pg_roles e on e.oid = x.grantee
      join pg_roles g on g.oid = x.grantor
     where n.nspname = 'public'
       and c.relname in ('llm_calls', 'ai_agent_runs')
       and e.rolname in ('anon', 'authenticated')
       and x.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    union all
    select c.relname, a.attname::text, g.rolname, e.rolname, x.privilege_type
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join lateral aclexplode(a.attacl) x
      join pg_roles e on e.oid = x.grantee
      join pg_roles g on g.oid = x.grantor
     where n.nspname = 'public'
       and c.relname in ('llm_calls', 'ai_agent_runs')
       and e.rolname in ('anon', 'authenticated')
       and x.privilege_type in ('INSERT', 'UPDATE', 'REFERENCES')
  loop
    begin
      execute format('set local role %I', r.concedente);
      if r.coluna is null then
        execute format('revoke %s on table public.%I from %I', r.privilegio, r.tabela, r.papel);
      else
        execute format('revoke %s (%I) on table public.%I from %I', r.privilegio, r.coluna, r.tabela, r.papel);
      end if;
      reset role;
    exception when others then
      raise warning 'MIA (9173): não consegui tirar % de % em %.% (concedido por %): %',
        r.privilegio, r.papel, r.tabela, coalesce(r.coluna, '*'), r.concedente, sqlerrm;
    end;
  end loop;

  -- A anonimização LGPD redige `tool_calls` com a sessão do usuário que pediu
  -- (`app/api/v1/lgpd/anonymize/route.ts` → `lib/lgpd/cascata.ts`). É a única
  -- escrita da sessão nas duas tabelas, e só nessa coluna.
  if to_regclass('public.ai_agent_runs') is not null then
    grant update (tool_calls) on table public.ai_agent_runs to authenticated;

    -- O suporte em modo somente leitura segue travado nessa escrita que sobrou.
    -- As `support_write_*` do upstream só ficam em tabela que `authenticated`
    -- grava INTEIRA (`fn_aplicar_travas_de_suporte`, 0274): sem o update da
    -- tabela, ela as tira daqui. Esta trava é NOSSA, de nome próprio, e a função
    -- dele não a toca.
    if to_regprocedure('public.fn_support_write_allowed(uuid)') is not null then
      drop policy if exists mia_suporte_somente_leitura_tool_calls on public.ai_agent_runs;
      create policy mia_suporte_somente_leitura_tool_calls on public.ai_agent_runs
        as restrictive for update to authenticated
        using (public.fn_support_write_allowed(organization_id))
        with check (public.fn_support_write_allowed(organization_id));
    end if;
  end if;

  -- As travas do suporte convergem aqui, e não na próxima chamada da função do
  -- upstream (toda provisionadora de módulo a chama): sem isto, provisionar um
  -- módulo tiraria as `support_write_*` de `ai_agent_runs` e mudaria o núcleo.
  if to_regprocedure('public.fn_aplicar_travas_de_suporte()') is not null then
    perform public.fn_aplicar_travas_de_suporte();
  end if;

  -- ── passo 2 · a leitura das colunas (9175, MIA-251 G) ─────────────────────
  -- Revogar o SELECT da TABELA leva junto o SELECT de coluna do mesmo concedente:
  -- a lista de colunas é refeita do zero a cada vez, e coluna nova do upstream
  -- entra nela na implantação seguinte.
  foreach v_tabela in array v_leitura loop
    if to_regclass('public.' || v_tabela) is not null then
      execute format('revoke select on table public.%I from anon, authenticated', v_tabela);
    end if;
  end loop;

  -- SELECT de outro concedente: na tabela inteira, de coluna fechada, e qualquer
  -- um de `anon` (que não lê nada destas tabelas).
  for r in
    select c.relname as tabela, null::text as coluna, g.rolname as concedente, e.rolname as papel
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) x
      join pg_roles e on e.oid = x.grantee
      join pg_roles g on g.oid = x.grantor
     where n.nspname = 'public'
       and c.relname = any(v_leitura)
       and e.rolname in ('anon', 'authenticated')
       and x.privilege_type = 'SELECT'
    union all
    select c.relname, a.attname::text, g.rolname, e.rolname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join lateral aclexplode(a.attacl) x
      join pg_roles e on e.oid = x.grantee
      join pg_roles g on g.oid = x.grantor
     where n.nspname = 'public'
       and c.relname = any(v_leitura)
       and e.rolname in ('anon', 'authenticated')
       and x.privilege_type = 'SELECT'
       and (e.rolname = 'anon' or a.attname::text = any(v_fechadas) or strpos(a.attname::text, 'tokens') > 0)
  loop
    begin
      execute format('set local role %I', r.concedente);
      if r.coluna is null then
        execute format('revoke select on table public.%I from %I', r.tabela, r.papel);
      else
        execute format('revoke select (%I) on table public.%I from %I', r.coluna, r.tabela, r.papel);
      end if;
      reset role;
    exception when others then
      raise warning 'MIA (9175): não consegui tirar SELECT de % em %.% (concedido por %): %',
        r.papel, r.tabela, coalesce(r.coluna, '*'), r.concedente, sqlerrm;
    end;
  end loop;

  -- A sessão lê o resto: status, erro, tempo, ids, ferramentas. A chave
  -- primária fica aberta, e é ela que o Realtime exige para entregar a linha.
  foreach v_tabela in array v_leitura loop
    if to_regclass('public.' || v_tabela) is null then
      continue;
    end if;
    select string_agg(quote_ident(col.column_name::text), ', ' order by col.ordinal_position)
      into v_colunas
      from information_schema.columns col
     where col.table_schema = 'public'
       and col.table_name = v_tabela
       and not (col.column_name::text = any(v_fechadas) or strpos(col.column_name::text, 'tokens') > 0);
    if v_colunas is not null then
      execute format('grant select (%s) on table public.%I to authenticated', v_colunas, v_tabela);
    end if;
  end loop;

  -- O que sobrou: escrita da sessão fora o `update (tool_calls)`, e leitura da
  -- tabela inteira, de coluna fechada ou de `anon`.
  select count(*) into v_abertas
    from (
      select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(c.relacl) x
        join pg_roles e on e.oid = x.grantee
       where n.nspname = 'public'
         and c.relname in ('llm_calls', 'ai_agent_runs')
         and e.rolname in ('anon', 'authenticated')
         and x.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
      union all
      select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        cross join lateral aclexplode(a.attacl) x
        join pg_roles e on e.oid = x.grantee
       where n.nspname = 'public'
         and c.relname in ('llm_calls', 'ai_agent_runs')
         and e.rolname in ('anon', 'authenticated')
         and x.privilege_type in ('INSERT', 'UPDATE', 'REFERENCES')
         and not (c.relname = 'ai_agent_runs' and a.attname = 'tool_calls'
                  and e.rolname = 'authenticated' and x.privilege_type = 'UPDATE')
      union all
      select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(c.relacl) x
        join pg_roles e on e.oid = x.grantee
       where n.nspname = 'public'
         and c.relname = any(v_leitura)
         and e.rolname in ('anon', 'authenticated')
         and x.privilege_type = 'SELECT'
      union all
      select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        cross join lateral aclexplode(a.attacl) x
        join pg_roles e on e.oid = x.grantee
       where n.nspname = 'public'
         and c.relname = any(v_leitura)
         and e.rolname in ('anon', 'authenticated')
         and x.privilege_type = 'SELECT'
         and (e.rolname = 'anon' or a.attname::text = any(v_fechadas) or strpos(a.attname::text, 'tokens') > 0)
    ) sobrou;

  if v_abertas > 0 then
    raise warning 'MIA (9175): % concessão(ões) da sessão em llm_calls/agent_turn_traces/ai_agent_runs continuam abertas (escrita, ou leitura de custo, tokens, provedor ou modelo)', v_abertas;
  end if;
  return v_abertas;
end;
$$;

comment on function public.fn_mia_colunas_de_ia_fechadas() is
  'MIA (9173, 9175): (1) tira de anon e authenticated a escrita em llm_calls e ai_agent_runs (insert, update, delete, truncate, references, trigger, inclusive de outro concedente) e devolve a authenticated so update (tool_calls) em ai_agent_runs, para a anonimizacao LGPD, com a restritiva nossa mia_suporte_somente_leitura_tool_calls no lugar das support_write_* do upstream (e chama fn_aplicar_travas_de_suporte para o catalogo convergir); (2) em llm_calls, agent_turn_traces e ai_agent_runs tira o SELECT da tabela e concede a authenticated o SELECT coluna por coluna, menos cost_cents, provider, model, entrada_do_primeiro_passo e toda coluna com tokens no nome (a regra de lib/ai/colunas-de-ia-fechadas.ts), calculado por information_schema.columns a cada chamada. Chamada pela 9173, pela 9175 e no fim do baseline-mia.sql, antes da varredura anon. Devolve quantas concessoes de escrita ou de leitura fechada sobraram (0 = fechado). Idempotente.';

revoke execute on function public.fn_mia_colunas_de_ia_fechadas() from public, anon, authenticated;

select public.fn_mia_colunas_de_ia_fechadas();

notify pgrst, 'reload schema';
