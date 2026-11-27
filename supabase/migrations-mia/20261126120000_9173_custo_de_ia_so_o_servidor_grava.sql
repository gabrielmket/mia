-- manifest: O CUSTO DE IA SÓ O SERVIDOR GRAVA (MIA-251 D; desenho na MIA-285, ponto 4, opção A, passos 1 e 3; dívida item 15). Em produção `authenticated` tinha INSERT e UPDATE em `llm_calls` e em `ai_agent_runs` (o `GRANT ALL` do corpo do baseline do upstream, mais a política `tenant_isolation_<tabela>_all` do laço genérico), e qualquer membro da empresa, pelo PostgREST, reescrevia `cost_cents` e os tokens das chamadas dela: um `update llm_calls set cost_cents = 0` zerava o gasto do mês, que é a régua do teto do plano (`fn_gasto_de_ia_do_mes`, `orcamento.ts`) e do "IA do mês" da cobrança. Função NOSSA `fn_mia_colunas_de_ia_fechadas()` (invoker, só o baseline e esta migration a chamam, sem EXECUTE para anon e authenticated): tira de `anon` e `authenticated` INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES e TRIGGER nas duas tabelas (TRUNCATE passa por cima da RLS), inclusive concessão de outro concedente, e devolve a `authenticated` só `update (tool_calls)` em `ai_agent_runs`, que é o que a anonimização LGPD grava pela sessão (`lib/lgpd/cascata.ts`, passo 6). A leitura NÃO muda nesta migration (passos 2, 4 e 5 do desenho, outra subtarefa depois da MIA-262); o lugar dela na função está marcado. `agent_turn_traces` já está fechada desde a 0721 do upstream e não é tocada. Os escritores do custo (o motor pelo pool e as rotas pelo cliente admin) não passam por `authenticated`. A função roda a cada implantação no fim do `baseline-mia.sql`: o `GRANT ALL` do corpo do baseline do upstream reabre a escrita a cada passada e ela fecha de novo. Devolve quantas concessões de escrita sobraram (0 = fechado). Provado em tests/invariants/custo-de-ia-a-sessao-nao-grava.test.ts, na cerca tests/unit/custo-de-ia-fora-da-escrita-da-sessao.test.ts e numa conferência do scripts/ensaio-de-banco.sh.
--
-- 9173 · o custo de IA só o servidor grava
--
-- Nome NOSSO (`fn_mia_*`): estender, nunca redefinir (docs/FORK-MIA.md, regra 3).
-- Nada do upstream é redefinido: só `revoke` e `grant` nas tabelas dele.
-- Idempotente: rodar de novo não muda nada.

create or replace function public.fn_mia_colunas_de_ia_fechadas()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_abertas integer;
begin
  -- ── passo 1 · a escrita ───────────────────────────────────────────────────
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
  end if;

  -- ── passo 2 · a leitura das colunas (MIA-251, depois da MIA-262) ──────────
  -- Entra aqui: `revoke select` da tabela e `grant select (colunas)` calculado
  -- por `information_schema.columns` menos custo, tokens, provedor e modelo.

  -- O que sobrou de escrita para a sessão, fora o `update (tool_calls)`.
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
    ) sobrou;

  if v_abertas > 0 then
    raise warning 'MIA (9173): % concessão(ões) de escrita da sessão em llm_calls/ai_agent_runs continuam abertas', v_abertas;
  end if;
  return v_abertas;
end;
$$;

comment on function public.fn_mia_colunas_de_ia_fechadas() is
  'MIA (9173): tira de anon e authenticated a escrita em llm_calls e ai_agent_runs (insert, update, delete, truncate, references, trigger, inclusive de outro concedente) e devolve a authenticated so update (tool_calls) em ai_agent_runs, para a anonimizacao LGPD. A leitura das colunas de custo entra aqui depois (passo 2 da MIA-251). Chamada pela 9173 e no fim do baseline-mia.sql, antes da varredura anon. Devolve quantas concessoes de escrita sobraram (0 = fechado). Idempotente.';

revoke execute on function public.fn_mia_colunas_de_ia_fechadas() from public, anon, authenticated;

select public.fn_mia_colunas_de_ia_fechadas();

notify pgrst, 'reload schema';
