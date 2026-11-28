import { beforeAll, describe, expect, it } from "vitest";

import { COLUNAS_DE_IA_FECHADAS } from "@/lib/ai/colunas-de-ia-fechadas";

import { lastLine, sql } from "./gov-helpers";

/**
 * FORK MIA (MIA-251 G) · migration 9175: A SESSÃO NÃO LÊ CUSTO, TOKENS, PROVEDOR
 * NEM MODELO DE IA.
 *
 * A 9173 fechou a escrita; a leitura seguia aberta: o membro da empresa lia,
 * pelo PostgREST, `cost_cents`, os tokens, o provedor e o modelo de cada chamada.
 * A 9175 troca o SELECT da tabela pelo SELECT coluna por coluna, sem essas.
 *
 * O que este arquivo prova, com a sessão de um MEMBRO da empresa (role +
 * `request.jwt.claims`, o caminho do PostgREST), nas três tabelas:
 *   1. pedir custo, tokens, provedor ou modelo dá 42501, e `select *` também;
 *      filtrar por elas também;
 *   2. `select id, status` (e o resto aberto) continua respondendo;
 *   3. a anonimização LGPD continua gravando `tool_calls`, na forma do PostgREST;
 *   4. o servidor (service_role, o cliente admin das rotas da plataforma) lê tudo;
 *   5. `fn_uso_de_ia` (invoker) pela sessão dá 42501 e pelo admin soma;
 *   6. o Realtime de `ai_agent_runs` segue entregando a linha, sem as fechadas:
 *      a chave primária fica aberta e a linha é montada só com as colunas que o
 *      papel lê (o critério de `realtime.apply_rls`);
 *   7. coluna nova do upstream ganha SELECT na passada seguinte, e a de tokens não;
 *      o `GRANT ALL` que volta a cada implantação é fechado de novo.
 */

const ORG = "f9175000-0000-4000-8000-000000000001";
const MEMBRO = "f9175000-1111-4000-8000-000000000001";
const SESSAO = "f9175000-2222-4000-8000-000000000001";
const AGENTE = "f9175000-3333-4000-8000-000000000001";
const VERSAO = "f9175000-4444-4000-8000-000000000001";
const RUN = "f9175000-5555-4000-8000-000000000001";
const CHAMADA = "f9175000-6666-4000-8000-000000000001";
const TRACO = "f9175000-7777-4000-8000-000000000001";

const TABELAS = ["llm_calls", "agent_turn_traces", "ai_agent_runs"] as const;

/** As colunas fechadas que cada tabela tem hoje (a regra: as nomeadas e toda com `tokens`). */
const FECHADAS: Record<(typeof TABELAS)[number], string[]> = {
  llm_calls: ["provider", "model", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_cents", "entrada_do_primeiro_passo"],
  agent_turn_traces: ["provider", "model", "tokens_in", "tokens_out", "cost_cents"],
  ai_agent_runs: ["tokens_in", "tokens_out", "cost_cents"],
};

/** O que a sessão continua lendo: status, erro e tempo. */
const ABERTAS: Record<(typeof TABELAS)[number], string[]> = {
  llm_calls: ["id", "organization_id", "purpose", "status", "error_code", "latency_ms", "created_at", "agent_id"],
  agent_turn_traces: ["id", "organization_id", "status", "error_code", "latency_ms", "ferramentas", "created_at"],
  ai_agent_runs: ["id", "organization_id", "agent_id", "status", "error_code", "latency_ms", "tool_calls", "is_dry_run", "started_at"],
};

const COMO_MEMBRO = `
  set role authenticated;
  select set_config('request.jwt.claims', '{"sub":"${MEMBRO}","role":"authenticated"}', false);
`;

/** Roda como o membro e devolve a mensagem do erro (ou `null` se passou). */
function erroComoMembro(consulta: string): string | null {
  try {
    sql(`${COMO_MEMBRO}\n${consulta}`);
    return null;
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return String(err.stderr ?? err.message ?? e);
  }
}

const comoMembro = (consulta: string) => lastLine(sql(`${COMO_MEMBRO}\n${consulta}`));

function privilegio(papel: string, tabela: string, priv: string): boolean {
  return lastLine(sql(`select has_table_privilege('${papel}', 'public.${tabela}', '${priv}')::text;`)) === "true";
}

function leColuna(papel: string, tabela: string, coluna: string): boolean {
  return (
    lastLine(sql(`select has_column_privilege('${papel}', 'public.${tabela}', '${coluna}', 'SELECT')::text;`)) === "true"
  );
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${MEMBRO}', 'custo-9175@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'custo-9175', 'Custo 9175', 'Custo 9175') on conflict (id) do nothing;
    -- admin da empresa: o papel mais alto do tenant, e mesmo assim não lê custo.
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${MEMBRO}', '${ORG}', 'admin', now()) on conflict do nothing;

    insert into public.channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
      values ('${SESSAO}', '${ORG}', 'custo-9175', 'WORKING', '\\x00'::bytea) on conflict (id) do nothing;
    insert into public.ai_agents (id, organization_id, name, system_prompt)
      values ('${AGENTE}', '${ORG}', 'custo-9175', 'system') on conflict (id) do nothing;
    insert into public.ai_agent_versions
      (id, organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id, status)
      values ('${VERSAO}', '${ORG}', '${AGENTE}', 1, 'system', 'openai', 'modelo-ficticio', '${SESSAO}', 'published')
      on conflict (id) do nothing;
    insert into public.ai_agent_runs
      (id, organization_id, agent_id, agent_version_id, status, tokens_in, tokens_out, cost_cents, tool_calls)
      values ('${RUN}', '${ORG}', '${AGENTE}', '${VERSAO}', 'completed', 100, 20, 12,
              '[{"name":"crm_get_lead","args":{"nome":"Fulano Ficticio"}}]'::jsonb)
      on conflict (id) do nothing;
    insert into public.llm_calls
      (id, organization_id, purpose, provider, model, input_tokens, output_tokens, cost_cents, latency_ms, status, created_at)
      values ('${CHAMADA}', '${ORG}', 'agent_turn', 'openai', 'modelo-ficticio', 1200, 300, 250, 100, 'ok', now() - interval '1 hour')
      on conflict (id) do nothing;
    insert into public.agent_turn_traces
      (id, organization_id, preview_run_id, is_dry_run, status, provider, model, tokens_in, tokens_out, cost_cents, latency_ms)
      values ('${TRACO}', '${ORG}', 'previa-9175', true, 'completed', 'openai', 'modelo-ficticio', 100, 20, 7, 50)
      on conflict (id) do nothing;
  `);
});

describe("9175 · a sessão não lê custo, tokens, provedor nem modelo de IA", () => {
  it("controle: as linhas existem e o servidor lê tudo (sem isso, todo 42501 abaixo passaria por vazio)", () => {
    expect(lastLine(sql(`select count(*)::text from public.llm_calls where organization_id = '${ORG}';`))).toBe("1");
    expect(
      lastLine(
        sql(`set role service_role;
             select provider || '|' || model || '|' || input_tokens || '|' || cost_cents from public.llm_calls where id = '${CHAMADA}';`),
      ),
    ).toBe("openai|modelo-ficticio|1200|250");
    expect(
      lastLine(sql(`set role service_role; select tokens_in || '|' || cost_cents from public.ai_agent_runs where id = '${RUN}';`)),
    ).toBe("100|12.0000");
    expect(
      lastLine(sql(`set role service_role; select provider || '|' || cost_cents from public.agent_turn_traces where id = '${TRACO}';`)),
    ).toBe("openai|7");
  });

  it("catálogo: sem SELECT da tabela; as fechadas de fora e as abertas dentro; anon sem nada", () => {
    for (const tabela of TABELAS) {
      expect.soft(privilegio("authenticated", tabela, "SELECT"), `authenticated tem SELECT da tabela ${tabela}`).toBe(false);
      expect.soft(privilegio("anon", tabela, "SELECT"), `anon tem SELECT da tabela ${tabela}`).toBe(false);
      for (const coluna of FECHADAS[tabela]) {
        expect.soft(leColuna("authenticated", tabela, coluna), `authenticated lê ${tabela}.${coluna}`).toBe(false);
      }
      for (const coluna of ABERTAS[tabela]) {
        expect.soft(leColuna("authenticated", tabela, coluna), `authenticated deixou de ler ${tabela}.${coluna}`).toBe(true);
        expect.soft(leColuna("anon", tabela, coluna), `anon lê ${tabela}.${coluna}`).toBe(false);
      }
      expect.soft(privilegio("service_role", tabela, "SELECT"), `service_role perdeu SELECT em ${tabela}`).toBe(true);
    }
    // A regra do código é a do banco: toda coluna das três que o código chama de fechada está fechada.
    const fechadasNoBanco = sql(`
      select c.table_name || '.' || c.column_name
        from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name in ('llm_calls', 'agent_turn_traces', 'ai_agent_runs')
         and (c.column_name = any(array[${COLUNAS_DE_IA_FECHADAS.map((x) => `'${x}'`).join(", ")}]) or c.column_name like '%tokens%')
         and has_column_privilege('authenticated', ('public.' || c.table_name)::regclass, c.column_name, 'SELECT')
       order by 1;`).trim();
    expect(fechadasNoBanco).toBe("");
  });

  it("o membro não lê custo, tokens, provedor nem modelo (42501), nem com select *", () => {
    for (const tabela of TABELAS) {
      for (const coluna of FECHADAS[tabela]) {
        expect
          .soft(erroComoMembro(`select ${coluna} from public.${tabela} where organization_id = '${ORG}';`), `${tabela}.${coluna}`)
          .toMatch(new RegExp(`permission denied for table ${tabela}`));
      }
      expect.soft(erroComoMembro(`select * from public.${tabela};`), `${tabela} *`).toMatch(/permission denied/);
    }
  });

  it("filtrar ou ordenar por coluna fechada também é recusado (o WHERE pede SELECT)", () => {
    expect(erroComoMembro(`select count(*) from public.llm_calls where input_tokens > 100000;`)).toMatch(/permission denied/);
    expect(erroComoMembro(`select id from public.llm_calls where provider = 'openai';`)).toMatch(/permission denied/);
    expect(erroComoMembro(`select id from public.ai_agent_runs order by cost_cents;`)).toMatch(/permission denied/);
  });

  it("status, erro e tempo continuam pela sessão, só da própria empresa", () => {
    expect(comoMembro(`select id || '|' || status from public.llm_calls where organization_id = '${ORG}';`)).toBe(`${CHAMADA}|ok`);
    expect(comoMembro(`select id || '|' || status from public.ai_agent_runs where organization_id = '${ORG}';`)).toBe(`${RUN}|completed`);
    expect(comoMembro(`select id || '|' || status from public.agent_turn_traces where organization_id = '${ORG}';`)).toBe(`${TRACO}|completed`);
    // A forma da rota de Execuções pela sessão: as colunas abertas, com o filtro dela.
    expect(
      comoMembro(`select count(*)::text from (
                    select id, purpose, status, error_code, error_message, http_status, origem_da_escolha, latency_ms, created_at
                      from public.llm_calls where organization_id = '${ORG}' order by created_at desc limit 100) x;`),
    ).toBe("1");
    // count(*) não pede coluna: o contador das telas continua.
    expect(comoMembro(`select count(*)::text from public.llm_calls;`)).toBe("1");
  });

  it("a anonimização LGPD continua gravando tool_calls pela sessão, na forma do PostgREST", () => {
    // `lib/lgpd/cascata.ts` (passo 6): `.update({ tool_calls }).eq(org).eq(id)`, sem `.select()`.
    // O PostgREST monta `RETURNING 1` quando não há select (SqlFragment.returningF).
    expect(
      erroComoMembro(`
        with pgrst_source as (
          update public.ai_agent_runs set tool_calls = '[{"name":"crm_get_lead"}]'::jsonb
           where organization_id = '${ORG}' and id = '${RUN}'
          returning 1)
        select count(*) from pgrst_source;`),
    ).toBeNull();
    expect(lastLine(sql(`select tool_calls::text from public.ai_agent_runs where id = '${RUN}';`))).toBe('[{"name": "crm_get_lead"}]');
  });

  it("fn_uso_de_ia pela sessão dá 42501; pelo cliente admin soma o custo da empresa", () => {
    const chamada = `select public.fn_uso_de_ia('${ORG}', now() - interval '30 days', now() + interval '1 day', null, null)::text;`;
    expect(erroComoMembro(chamada)).toMatch(/permission denied for table llm_calls/);
    const uso = JSON.parse(lastLine(sql(`set role service_role;\n${chamada}`))) as { totais: { chamadas: number; custo_cents: number } };
    expect(uso.totais.chamadas).toBe(1);
    expect(uso.totais.custo_cents).toBe(250);
  });

  it("Realtime de ai_agent_runs: a linha segue chegando ao membro, sem as colunas fechadas", () => {
    // A tabela continua publicada: o hook `useAgentRuns` não perde a assinatura.
    expect(
      lastLine(sql(`select count(*)::text from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ai_agent_runs';`)),
    ).toBe("1");
    // `realtime.apply_rls` recusa (401) só quando a chave primária fica sem SELECT.
    expect(
      lastLine(
        sql(`select bool_and(has_column_privilege('authenticated', c.conrelid, a.attname, 'SELECT'))::text
               from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
              where c.conrelid = 'public.ai_agent_runs'::regclass and c.contype = 'p';`),
      ),
    ).toBe("true");
    // E monta o `record` só com as colunas que o papel lê, sob a RLS dele: a mesma
    // seleção aqui, como o membro, entrega status e não entrega custo nem tokens.
    const colunas = lastLine(
      sql(`select string_agg(quote_ident(attname), ', ' order by attnum) from pg_attribute
            where attrelid = 'public.ai_agent_runs'::regclass and attnum > 0 and not attisdropped
              and has_column_privilege('authenticated', attrelid, attname, 'SELECT');`),
    );
    const registro = JSON.parse(comoMembro(`select to_jsonb(r)::text from (select ${colunas} from public.ai_agent_runs where id = '${RUN}') r;`)) as Record<string, unknown>;
    expect(registro).toMatchObject({ id: RUN, status: "completed", agent_id: AGENTE, is_dry_run: false });
    for (const coluna of FECHADAS.ai_agent_runs) expect(registro, coluna).not.toHaveProperty(coluna);
  });

  it("coluna nova do upstream ganha SELECT na passada seguinte; a de tokens não", () => {
    sql(`alter table public.llm_calls add column if not exists coluna_nova_9175 text;
         alter table public.llm_calls add column if not exists outros_tokens_9175 integer;`);
    expect(leColuna("authenticated", "llm_calls", "coluna_nova_9175")).toBe(false);
    expect(lastLine(sql(`select public.fn_mia_colunas_de_ia_fechadas()::text;`))).toBe("0");
    expect(leColuna("authenticated", "llm_calls", "coluna_nova_9175")).toBe(true);
    expect(leColuna("authenticated", "llm_calls", "outros_tokens_9175")).toBe(false);
    sql(`alter table public.llm_calls drop column coluna_nova_9175, drop column outros_tokens_9175;`);
  });

  it("o GRANT ALL que volta a cada implantação, e o SELECT de coluna solto, são fechados de novo", () => {
    sql(`grant all on table public.llm_calls, public.agent_turn_traces, public.ai_agent_runs to anon, authenticated;
         grant select (cost_cents) on table public.ai_agent_runs to authenticated;
         grant select (id) on table public.llm_calls to anon;`);
    expect(privilegio("authenticated", "llm_calls", "SELECT")).toBe(true);
    expect(lastLine(sql(`select public.fn_mia_colunas_de_ia_fechadas()::text;`))).toBe("0");
    expect(lastLine(sql(`select public.fn_mia_colunas_de_ia_fechadas()::text;`))).toBe("0");
    for (const tabela of TABELAS) expect.soft(privilegio("authenticated", tabela, "SELECT"), tabela).toBe(false);
    expect(leColuna("authenticated", "ai_agent_runs", "cost_cents")).toBe(false);
    expect(leColuna("anon", "llm_calls", "id")).toBe(false);
    expect(leColuna("authenticated", "llm_calls", "status")).toBe(true);
    // A escrita da 9173 continua como estava.
    expect(privilegio("authenticated", "llm_calls", "UPDATE")).toBe(false);
    expect(
      lastLine(sql(`select has_column_privilege('authenticated', 'public.ai_agent_runs', 'tool_calls', 'UPDATE')::text;`)),
    ).toBe("true");
    expect(erroComoMembro(`select cost_cents from public.llm_calls;`)).toMatch(/permission denied for table llm_calls/);
  });

  it("a função continua fora do alcance da sessão", () => {
    for (const papel of ["anon", "authenticated"]) {
      expect(
        lastLine(sql(`select has_function_privilege('${papel}', 'public.fn_mia_colunas_de_ia_fechadas()', 'EXECUTE')::text;`)),
        papel,
      ).toBe("false");
    }
  });
});
