import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { countAs, lastLine, sql } from "./gov-helpers";

/**
 * FORK MIA (9090 e 9091) — AS TRILHAS DO "ME MOSTRA COMO" E A LISTA DE
 * MELHORIAS NO BANCO.
 *
 * Contra o Postgres de verdade (o molde do baseline + baseline-mia), com o papel
 * `authenticated` e o JWT de cada pessoa, como o PostgREST faz:
 *
 *   - o progresso é da PESSOA: ela grava e lê a própria linha; gestor e
 *     administrador leem as da empresa; o atendente não vê a dos outros; outra
 *     empresa vê zero; anon nada; ninguém apaga pela sessão;
 *   - a linha nasce da própria pessoa e com a hora do banco, por mais que o
 *     pedido mande outra coisa; empresa, pessoa e trilha não mudam;
 *   - `lembrada_em` não é da sessão, e zera a cada pausa nova (lembrar uma vez
 *     POR PAUSA);
 *   - a configuração das trilhas: a empresa lê, a sessão não grava;
 *   - a lista de melhorias: só o servidor; o título é a chave;
 *   - a retenção só o servidor executa;
 *   - as duas migrations aplicam duas vezes sem erro.
 */

const ORG_A = "90909090-0000-4000-8000-00000000000a";
const ORG_B = "90909090-0000-4000-8000-00000000000b";
const ADMIN_A = "90909090-1111-4000-8000-0000000000a1";
const GESTOR_A = "90909090-1111-4000-8000-0000000000a2";
const AT_A = "90909090-1111-4000-8000-0000000000a3";
const ADMIN_B = "90909090-1111-4000-8000-0000000000b1";

/** Uma escrita como `usuario` (`anon`, `servidor` ou o uuid de alguém): `n:<linhas>` ou o SQLSTATE. */
function executar(usuario: string, dml: string): string {
  const papel = usuario === "anon" ? "anon" : usuario === "servidor" ? "service_role" : "authenticated";
  const claims = papel === "authenticated" ? `select set_config('request.jwt.claims', '{"sub":"${usuario}"}', false);` : "";
  return lastLine(
    sql(`
      set role ${papel};
      ${claims}
      do $$
      declare n int;
      begin
        begin
          ${dml};
          get diagnostics n = row_count;
          perform set_config('inv.r9090', 'n:' || n, false);
        exception when others then
          perform set_config('inv.r9090', sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9090');
    `),
  );
}

function valor(consulta: string): string {
  return lastLine(sql(consulta));
}

const COMECAR = (org: string, trilha: string, quem = "") =>
  `insert into public.mia_assistente_trilhas (organization_id, ${quem ? "user_id, " : ""}trilha, comecou_em, lembrada_em)
   values ('${org}', ${quem ? `'${quem}', ` : ""}'${trilha}', '2000-01-01T00:00:00Z', now())`;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ADMIN_A}', 'trilhas-admin-a@invariant.test'),
      ('${GESTOR_A}', 'trilhas-gestor-a@invariant.test'),
      ('${AT_A}', 'trilhas-at-a@invariant.test'),
      ('${ADMIN_B}', 'trilhas-admin-b@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'trilhas-9090-a', 'Trilhas A', 'Trilhas A'),
      ('${ORG_B}', 'trilhas-9090-b', 'Trilhas B', 'Trilhas B')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ADMIN_A}', '${ORG_A}', 'admin', now()),
      ('${GESTOR_A}', '${ORG_A}', 'manager', now()),
      ('${AT_A}', '${ORG_A}', 'agent', now()),
      ('${ADMIN_B}', '${ORG_B}', 'admin', now())
      on conflict do nothing;
    insert into public.mia_assistente_trilhas_config (organization_id, desligadas, recomendada)
      values ('${ORG_A}', '{email}', 'numero') on conflict (organization_id) do nothing;
  `);
});

describe("9090 · o progresso é da pessoa", () => {
  it("cada um começa a própria trilha pela sessão (controle positivo)", () => {
    expect(executar(AT_A, COMECAR(ORG_A, "respostas"))).toBe("n:1");
    expect(executar(GESTOR_A, COMECAR(ORG_A, "funil"))).toBe("n:1");
  });

  it("⭐ a linha nasce da própria pessoa e com a hora do banco, por mais que o pedido mande outra coisa", () => {
    expect(executar(AT_A, COMECAR(ORG_A, "importar", GESTOR_A))).toBe("n:1");
    expect(valor(`select user_id from public.mia_assistente_trilhas where organization_id = '${ORG_A}' and trilha = 'importar';`)).toBe(AT_A);
    expect(valor(`select (comecou_em > now() - interval '1 hour')::text from public.mia_assistente_trilhas where trilha = 'importar' and organization_id = '${ORG_A}';`)).toBe("true");
    expect(valor(`select coalesce(lembrada_em::text, 'nulo') from public.mia_assistente_trilhas where trilha = 'importar' and organization_id = '${ORG_A}';`)).toBe("nulo");
  });

  it("o atendente vê só a dele; a gestora e o administrador veem as da empresa; outra empresa vê zero; anon nada", () => {
    expect(countAs(AT_A, `select count(*) from public.mia_assistente_trilhas where organization_id = '${ORG_A}';`)).toBe(2);
    expect(countAs(GESTOR_A, `select count(*) from public.mia_assistente_trilhas where organization_id = '${ORG_A}';`)).toBe(3);
    expect(countAs(ADMIN_A, `select count(*) from public.mia_assistente_trilhas where organization_id = '${ORG_A}';`)).toBe(3);
    expect(countAs(ADMIN_B, `select count(*) from public.mia_assistente_trilhas where organization_id = '${ORG_A}';`)).toBe(0);
    expect(executar("anon", `perform 1 from public.mia_assistente_trilhas limit 1`)).toBe("42501");
  });

  it("ninguém grava na linha de outro, nem em outra empresa", () => {
    expect(executar(AT_A, `update public.mia_assistente_trilhas set passo = 2 where trilha = 'funil' and organization_id = '${ORG_A}'`)).toBe("n:0");
    expect(executar(ADMIN_B, COMECAR(ORG_A, "numero"))).toBe("42501");
  });

  it("⭐ empresa, pessoa e trilha não mudam depois; a sessão não apaga", () => {
    expect(executar(AT_A, `update public.mia_assistente_trilhas set trilha = 'funil' where trilha = 'respostas' and organization_id = '${ORG_A}'`)).toBe("23514");
    expect(executar(AT_A, `update public.mia_assistente_trilhas set user_id = '${GESTOR_A}' where trilha = 'respostas' and organization_id = '${ORG_A}'`)).toBe("23514");
    expect(executar(AT_A, `delete from public.mia_assistente_trilhas where trilha = 'respostas'`)).toBe("42501");
  });

  it("trilha com nome fora do molde e situação inventada não cabem", () => {
    expect(executar(AT_A, COMECAR(ORG_A, "Trilha Inventada"))).toBe("23514");
    expect(executar(AT_A, `update public.mia_assistente_trilhas set situacao = 'concluida' where trilha = 'respostas' and organization_id = '${ORG_A}'`)).toBe("23514");
    // Feita sem a data, pausada sem a data: recusado.
    expect(executar(AT_A, `update public.mia_assistente_trilhas set situacao = 'feita' where trilha = 'respostas' and organization_id = '${ORG_A}'`)).toBe("23514");
  });

  it("⭐ lembrar UMA vez por pausa: a sessão não escreve `lembrada_em`, e a pausa nova a zera", () => {
    expect(
      executar(AT_A, `update public.mia_assistente_trilhas set situacao = 'pausada', pausou_em = now(), passo = 2 where trilha = 'respostas' and organization_id = '${ORG_A}'`),
    ).toBe("n:1");
    // O resumo da manhã (o servidor) lembra.
    expect(executar("servidor", `update public.mia_assistente_trilhas set lembrada_em = now() where trilha = 'respostas' and organization_id = '${ORG_A}'`)).toBe("n:1");
    // A sessão tenta apagar a marca sem pausar de novo: fica.
    executar(AT_A, `update public.mia_assistente_trilhas set lembrada_em = null where trilha = 'respostas' and organization_id = '${ORG_A}'`);
    expect(valor(`select (lembrada_em is not null)::text from public.mia_assistente_trilhas where trilha = 'respostas' and organization_id = '${ORG_A}';`)).toBe("true");
    // Retoma e pausa de novo: a marca zera, e o próximo resumo lembra outra vez.
    executar(AT_A, `update public.mia_assistente_trilhas set situacao = 'andando' where trilha = 'respostas' and organization_id = '${ORG_A}'`);
    executar(AT_A, `update public.mia_assistente_trilhas set situacao = 'pausada', pausou_em = now() where trilha = 'respostas' and organization_id = '${ORG_A}'`);
    expect(valor(`select coalesce(lembrada_em::text, 'nulo') from public.mia_assistente_trilhas where trilha = 'respostas' and organization_id = '${ORG_A}';`)).toBe("nulo");
  });

  it("começar de novo (mais uma vez) renova o \"desde\" pela hora do banco", () => {
    executar("servidor", `update public.mia_assistente_trilhas set comecou_em = '2001-01-01T00:00:00Z' where trilha = 'funil' and organization_id = '${ORG_A}'`);
    expect(executar(GESTOR_A, `update public.mia_assistente_trilhas set vezes = vezes + 1, situacao = 'andando', passo = 0 where trilha = 'funil' and organization_id = '${ORG_A}'`)).toBe("n:1");
    expect(valor(`select (comecou_em > now() - interval '1 hour')::text from public.mia_assistente_trilhas where trilha = 'funil' and organization_id = '${ORG_A}';`)).toBe("true");
  });
});

describe("9090 · a configuração das trilhas", () => {
  it("a empresa lê; outra empresa vê zero; a sessão não grava (nem o administrador)", () => {
    expect(countAs(AT_A, `select count(*) from public.mia_assistente_trilhas_config where organization_id = '${ORG_A}';`)).toBe(1);
    expect(countAs(ADMIN_B, `select count(*) from public.mia_assistente_trilhas_config where organization_id = '${ORG_A}';`)).toBe(0);
    expect(executar(ADMIN_A, `update public.mia_assistente_trilhas_config set me_mostra_como = false where organization_id = '${ORG_A}'`)).toBe("42501");
    expect(executar(ADMIN_B, `insert into public.mia_assistente_trilhas_config (organization_id) values ('${ORG_B}')`)).toBe("42501");
  });
});

describe("9091 · a lista de melhorias do produto", () => {
  it("só o servidor; o título é a chave, sem diferença de maiúscula", () => {
    expect(executar(ADMIN_A, `perform 1 from public.mia_melhorias_do_produto limit 1`)).toBe("42501");
    expect(executar("anon", `perform 1 from public.mia_melhorias_do_produto limit 1`)).toBe("42501");
    expect(executar("servidor", `insert into public.mia_melhorias_do_produto (titulo, evidencia, origem) values ('Trilha do número: mostrar Aparelhos conectados', '38 pontos de queda', 'trilha')`)).toBe("n:1");
    expect(executar("servidor", `insert into public.mia_melhorias_do_produto (titulo) values ('  trilha do número: mostrar aparelhos conectados  ')`)).toBe("23505");
    expect(executar("servidor", `insert into public.mia_melhorias_do_produto (titulo, situacao) values ('Outra melhoria', 'pronta')`)).toBe("23514");
  });
});

describe("a retenção e a idempotência", () => {
  it("a retenção das trilhas só o servidor executa, e apaga o parado há mais de um ano", () => {
    expect(executar(ADMIN_A, `perform public.fn_mia_expurgar_trilhas_vencidas(365, 10)`)).toBe("42501");
    executar("servidor", `update public.mia_assistente_trilhas set updated_at = now() - interval '400 days' where trilha = 'importar' and organization_id = '${ORG_A}'`);
    // O gatilho põe a hora de agora em updated_at: a linha velha é forjada direto, como dono.
    sql(`alter table public.mia_assistente_trilhas disable trigger trg_mia_trilha_da_pessoa;
         update public.mia_assistente_trilhas set updated_at = now() - interval '400 days' where trilha = 'importar' and organization_id = '${ORG_A}';
         alter table public.mia_assistente_trilhas enable trigger trg_mia_trilha_da_pessoa;`);
    expect(valor(`select (public.fn_mia_expurgar_trilhas_vencidas(365, 100)->>'trilhas');`)).toBe("1");
    expect(valor(`select count(*) from public.mia_assistente_trilhas where trilha = 'importar' and organization_id = '${ORG_A}';`)).toBe("0");
  });

  it("aplicar as duas migrations duas vezes por cima do baseline não dá erro nem duplica", () => {
    const pasta = path.resolve(__dirname, "../../supabase/migrations-mia");
    for (const nome of ["20261027120000_9090_trilhas_do_assistente.sql", "20261027120100_9091_melhorias_do_produto.sql"]) {
      const migration = readFileSync(path.join(pasta, nome), "utf8");
      sql(migration);
      sql(migration);
    }
    expect(valor(`select count(*) from pg_policies where tablename = 'mia_assistente_trilhas' and policyname like 'mia_%';`)).toBe("3");
    expect(valor(`select count(*) from pg_policies where tablename = 'mia_assistente_trilhas_config' and policyname like 'mia_%';`)).toBe("1");
    expect(valor(`select count(*) from pg_constraint where contype = 'c' and conname like 'mia\\_assistente\\_trilhas\\_%';`)).toBe("7");
    expect(valor(`select count(*) from pg_constraint where contype = 'c' and conname like 'mia\\_melhorias\\_do\\_produto\\_%';`)).toBe("4");
  });
});
