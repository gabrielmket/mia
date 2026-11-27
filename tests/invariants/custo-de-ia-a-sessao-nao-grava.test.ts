import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * FORK MIA (MIA-251 D) · migration 9173: O CUSTO DE IA SÓ O SERVIDOR GRAVA.
 *
 * Até a 9173, `authenticated` tinha INSERT e UPDATE em `llm_calls` e em
 * `ai_agent_runs`, e a política `tenant_isolation_<tabela>_all` (FOR ALL) deixava
 * o membro gravar na própria empresa. Um `update llm_calls set cost_cents = 0`
 * pela sessão zerava o gasto do mês, que é de onde saem o teto do plano
 * (`fn_gasto_de_ia_do_mes`) e o "IA do mês" da cobrança.
 *
 * O que este arquivo prova, com a sessão de um MEMBRO da empresa (role +
 * `request.jwt.claims`, o caminho do PostgREST):
 *   1. insert, update e delete em `llm_calls` dão 42501 (permission denied);
 *   2. em `ai_agent_runs`, só `update (tool_calls)` passa: é a anonimização LGPD
 *      (`lib/lgpd/cascata.ts`), e ela continua gravando;
 *   3. o servidor continua gravando o custo: `service_role` (o cliente admin) e o
 *      dono das tabelas (o pool do motor);
 *   4. a leitura não muda nesta migration (os passos 2, 4 e 5 do desenho da
 *      MIA-285 são outra subtarefa);
 *   5. o `GRANT ALL` do corpo do baseline do upstream, que volta a cada
 *      implantação, é fechado de novo por `fn_mia_colunas_de_ia_fechadas()`.
 */

const ORG = "f9173000-0000-4000-8000-000000000001";
const MEMBRO = "f9173000-1111-4000-8000-000000000001";
const SESSAO = "f9173000-2222-4000-8000-000000000001";
const AGENTE = "f9173000-3333-4000-8000-000000000001";
const VERSAO = "f9173000-4444-4000-8000-000000000001";
const RUN = "f9173000-5555-4000-8000-000000000001";
const CHAMADA = "f9173000-6666-4000-8000-000000000001";

const COMO_MEMBRO = `
  set role authenticated;
  select set_config('request.jwt.claims', '{"sub":"${MEMBRO}","role":"authenticated"}', false);
`;

/** Roda como o membro e devolve a mensagem do erro (ou `null` se passou). */
function erroComoMembro(dml: string): string | null {
  try {
    sql(`${COMO_MEMBRO}\n${dml}`);
    return null;
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return String(err.stderr ?? err.message ?? e);
  }
}

function privilegio(papel: string, tabela: string, priv: string): boolean {
  return lastLine(sql(`select has_table_privilege('${papel}', 'public.${tabela}', '${priv}')::text;`)) === "true";
}

function privilegioDaColuna(papel: string, tabela: string, coluna: string, priv: string): boolean {
  return (
    lastLine(sql(`select has_column_privilege('${papel}', 'public.${tabela}', '${coluna}', '${priv}')::text;`)) ===
    "true"
  );
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${MEMBRO}', 'custo-9173@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'custo-9173', 'Custo 9173', 'Custo 9173') on conflict (id) do nothing;
    -- admin da empresa: o papel mais alto do tenant, e mesmo assim não grava custo.
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${MEMBRO}', '${ORG}', 'admin', now()) on conflict do nothing;

    insert into public.channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
      values ('${SESSAO}', '${ORG}', 'custo-9173', 'WORKING', '\\x00'::bytea) on conflict (id) do nothing;
    insert into public.ai_agents (id, organization_id, name, system_prompt)
      values ('${AGENTE}', '${ORG}', 'custo-9173', 'system') on conflict (id) do nothing;
    insert into public.ai_agent_versions
      (id, organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id, status)
      values ('${VERSAO}', '${ORG}', '${AGENTE}', 1, 'system', 'openai', 'modelo-ficticio', '${SESSAO}', 'published')
      on conflict (id) do nothing;
    insert into public.ai_agent_runs
      (id, organization_id, agent_id, agent_version_id, status, cost_cents, tool_calls)
      values ('${RUN}', '${ORG}', '${AGENTE}', '${VERSAO}', 'completed', 12,
              '[{"name":"crm_get_lead","args":{"nome":"Fulano Ficticio"}}]'::jsonb)
      on conflict (id) do nothing;
    insert into public.llm_calls (id, organization_id, purpose, provider, model, cost_cents, latency_ms)
      values ('${CHAMADA}', '${ORG}', 'agent_turn', 'openai', 'modelo-ficticio', 250, 100)
      on conflict (id) do nothing;
  `);
});

describe("9173 · o custo de IA só o servidor grava", () => {
  it("controle: o membro LÊ as linhas da empresa (sem isso, todo 'não gravou' passaria por vazio)", () => {
    expect(lastLine(sql(`${COMO_MEMBRO}\nselect count(*)::text from public.llm_calls where organization_id = '${ORG}';`))).toBe("1");
    expect(lastLine(sql(`${COMO_MEMBRO}\nselect count(*)::text from public.ai_agent_runs where organization_id = '${ORG}';`))).toBe("1");
  });

  it("catálogo: anon e authenticated sem escrita nas duas tabelas; só update (tool_calls) em ai_agent_runs", () => {
    for (const papel of ["anon", "authenticated"]) {
      for (const tabela of ["llm_calls", "ai_agent_runs"]) {
        for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "REFERENCES"]) {
          expect.soft(privilegio(papel, tabela, priv), `${papel} tem ${priv} em ${tabela}`).toBe(false);
        }
      }
    }
    expect(privilegioDaColuna("authenticated", "ai_agent_runs", "tool_calls", "UPDATE")).toBe(true);
    for (const coluna of ["cost_cents", "tokens_in", "tokens_out", "status"]) {
      expect.soft(privilegioDaColuna("authenticated", "ai_agent_runs", coluna, "UPDATE"), coluna).toBe(false);
    }
    // A leitura fica como estava (passo 2 do desenho é outra subtarefa).
    expect(privilegio("authenticated", "llm_calls", "SELECT")).toBe(true);
    expect(privilegio("authenticated", "ai_agent_runs", "SELECT")).toBe(true);
    // E o servidor continua gravando.
    expect(privilegio("service_role", "llm_calls", "INSERT")).toBe(true);
    expect(privilegio("service_role", "ai_agent_runs", "UPDATE")).toBe(true);
  });

  it("o membro não zera, não insere e não apaga custo em llm_calls (42501)", () => {
    const tentativas = [
      `update public.llm_calls set cost_cents = 0 where organization_id = '${ORG}';`,
      `insert into public.llm_calls (organization_id, purpose, provider, model, cost_cents, latency_ms)
         values ('${ORG}', 'agent_turn', 'openai', 'modelo-ficticio', 0, 0);`,
      `delete from public.llm_calls where organization_id = '${ORG}';`,
    ];
    for (const dml of tentativas) {
      expect.soft(erroComoMembro(dml), dml).toMatch(/permission denied for table llm_calls/);
    }
    expect(lastLine(sql(`select cost_cents::text from public.llm_calls where id = '${CHAMADA}';`))).toBe("250");
    expect(lastLine(sql(`select count(*)::text from public.llm_calls where organization_id = '${ORG}';`))).toBe("1");
  });

  it("o membro não reescreve custo nem tokens do run, nem cria ou apaga run (42501)", () => {
    const tentativas = [
      `update public.ai_agent_runs set cost_cents = 0 where id = '${RUN}';`,
      `update public.ai_agent_runs set tokens_in = 0, tool_calls = '[]'::jsonb where id = '${RUN}';`,
      `insert into public.ai_agent_runs (organization_id, agent_id, agent_version_id, status)
         values ('${ORG}', '${AGENTE}', '${VERSAO}', 'completed');`,
      `delete from public.ai_agent_runs where id = '${RUN}';`,
    ];
    for (const dml of tentativas) {
      expect.soft(erroComoMembro(dml), dml).toMatch(/permission denied for table ai_agent_runs/);
    }
    expect(lastLine(sql(`select cost_cents::text from public.ai_agent_runs where id = '${RUN}';`))).toBe("12.0000");
  });

  it("a anonimização LGPD continua gravando tool_calls pela sessão", () => {
    // A forma exata de `lib/lgpd/cascata.ts` (passo 6): só `tool_calls`, filtrando a empresa e o run.
    expect(
      erroComoMembro(
        `update public.ai_agent_runs set tool_calls = '[{"name":"crm_get_lead"}]'::jsonb
          where organization_id = '${ORG}' and id = '${RUN}';`,
      ),
    ).toBeNull();
    expect(lastLine(sql(`select tool_calls::text from public.ai_agent_runs where id = '${RUN}';`))).toBe(
      '[{"name": "crm_get_lead"}]',
    );
  });

  it("o servidor continua gravando o custo: service_role (cliente admin) e o dono (pool do motor)", () => {
    sql(`
      set role service_role;
      insert into public.llm_calls (organization_id, purpose, provider, model, cost_cents, latency_ms)
        values ('${ORG}', 'agent_turn', 'openai', 'modelo-ficticio', 7, 10);
      update public.ai_agent_runs set cost_cents = 13 where id = '${RUN}';
      reset role;
      insert into public.llm_calls (organization_id, purpose, provider, model, cost_cents, latency_ms)
        values ('${ORG}', 'classifier', 'openai', 'modelo-ficticio', 3, 10);
    `);
    expect(lastLine(sql(`select count(*)::text from public.llm_calls where organization_id = '${ORG}';`))).toBe("3");
    expect(lastLine(sql(`select cost_cents::text from public.ai_agent_runs where id = '${RUN}';`))).toBe("13.0000");
  });

  it("o GRANT ALL que volta a cada implantação é fechado de novo, e a função é idempotente", () => {
    // O corpo do baseline do upstream faz `GRANT ALL ON TABLE ai_agent_runs TO authenticated`
    // a cada passada; o bloco da 9173 no fim do baseline-mia.sql fecha de novo.
    sql(`grant all on table public.llm_calls, public.ai_agent_runs to anon, authenticated;`);
    expect(privilegio("authenticated", "llm_calls", "UPDATE")).toBe(true);

    expect(lastLine(sql(`select public.fn_mia_colunas_de_ia_fechadas()::text;`))).toBe("0");
    expect(lastLine(sql(`select public.fn_mia_colunas_de_ia_fechadas()::text;`))).toBe("0");

    expect(privilegio("authenticated", "llm_calls", "UPDATE")).toBe(false);
    expect(privilegio("authenticated", "ai_agent_runs", "TRUNCATE")).toBe(false);
    expect(privilegioDaColuna("authenticated", "ai_agent_runs", "tool_calls", "UPDATE")).toBe(true);
    expect(erroComoMembro(`update public.llm_calls set cost_cents = 0 where organization_id = '${ORG}';`)).toMatch(
      /permission denied for table llm_calls/,
    );
  });

  it("concessão de coluna solta também é tirada; só o tool_calls fica", () => {
    sql(`grant update (cost_cents) on table public.llm_calls to authenticated;
         grant update (cost_cents) on table public.ai_agent_runs to authenticated;`);
    expect(privilegioDaColuna("authenticated", "llm_calls", "cost_cents", "UPDATE")).toBe(true);
    expect(lastLine(sql(`select public.fn_mia_colunas_de_ia_fechadas()::text;`))).toBe("0");
    expect(privilegioDaColuna("authenticated", "llm_calls", "cost_cents", "UPDATE")).toBe(false);
    expect(privilegioDaColuna("authenticated", "ai_agent_runs", "cost_cents", "UPDATE")).toBe(false);
    expect(privilegioDaColuna("authenticated", "ai_agent_runs", "tool_calls", "UPDATE")).toBe(true);
  });

  it("a função não é chamável pela sessão", () => {
    for (const papel of ["anon", "authenticated"]) {
      expect(
        lastLine(
          sql(`select has_function_privilege('${papel}', 'public.fn_mia_colunas_de_ia_fechadas()', 'EXECUTE')::text;`),
        ),
        papel,
      ).toBe("false");
    }
  });
});
