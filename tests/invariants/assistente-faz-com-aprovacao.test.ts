import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { countAs, lastLine, sql } from "./gov-helpers";

/**
 * FORK MIA (9100, 9101) — O ASSISTENTE FAZ COM APROVAÇÃO, NO BANCO.
 *
 * Contra o Postgres de verdade, com o papel `authenticated` e o JWT de cada
 * pessoa, como o PostgREST faz (Empresa Modelo fictícia):
 *
 *   - as doze peças cabem; o que não é peça e o risco crítico, não (o "nunca");
 *   - o risco vem do TIPO, não de quem propõe;
 *   - o atendente propõe e lê só as dele; o gestor lê todas; o somente leitura
 *     não propõe; outra empresa vê zero;
 *   - uma pendente por PEÇA (a chave): três etapas são três cartões;
 *   - o pedido, o ajuste e o desfazer não nascem pela sessão;
 *   - SABOTAGEM: nem o servidor desfaz o que não foi aplicado, nem desfaz sem
 *     data, nem mexe na desfeita, nem muda a peça fora do ajuste da pendente;
 *   - a referência que some (a conversa expurgada) não trava mais o expurgo;
 *   - a configuração da empresa: os tipos ligados e o "pode pedir";
 *   - a retenção leva a desfeita depois de um ano;
 *   - 9080 a 9082 e 9100 a 9101, duas vezes, na ordem, sem erro.
 */

const ORG_A = "91009100-0000-4000-8000-00000000000a";
const ORG_B = "91009100-0000-4000-8000-00000000000b";
const ADMIN_A = "91009100-1111-4000-8000-0000000000a1";
const GESTOR_A = "91009100-1111-4000-8000-0000000000a2";
const AT_A = "91009100-1111-4000-8000-0000000000a3";
const LEITOR_A = "91009100-1111-4000-8000-0000000000a4";
const ADMIN_B = "91009100-1111-4000-8000-0000000000b1";

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
          perform set_config('inv.r9100', 'n:' || n, false);
        exception when others then
          perform set_config('inv.r9100', sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9100');
    `),
  );
}

function valor(consulta: string): string {
  return lastLine(sql(consulta));
}

const PROPOR = (org: string, tipo: string, chave = "") =>
  `insert into public.mia_assistente_propostas (organization_id, tipo, titulo, mudancas, pedido, chave)
   values ('${org}', '${tipo}', 'Cartão de teste', '[{"rotulo":"Etapa","valor":"Pediu orçamento"}]', '{"nome":"Pediu orçamento"}', '${chave}')`;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ADMIN_A}', 'faz-admin-a@invariant.test'),
      ('${GESTOR_A}', 'faz-gestor-a@invariant.test'),
      ('${AT_A}', 'faz-at-a@invariant.test'),
      ('${LEITOR_A}', 'faz-leitor-a@invariant.test'),
      ('${ADMIN_B}', 'faz-admin-b@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'faz-9100-a', 'Empresa Modelo A', 'Empresa Modelo A'),
      ('${ORG_B}', 'faz-9100-b', 'Empresa Modelo B', 'Empresa Modelo B')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ADMIN_A}', '${ORG_A}', 'admin', now()),
      ('${GESTOR_A}', '${ORG_A}', 'manager', now()),
      ('${AT_A}', '${ORG_A}', 'agent', now()),
      ('${LEITOR_A}', '${ORG_A}', 'viewer', now()),
      ('${ADMIN_B}', '${ORG_B}', 'admin', now())
      on conflict do nothing;
  `);
});

describe("9100 · as doze peças, e o nunca não cabe", () => {
  it("as nove do dia a dia cabem (controle positivo)", () => {
    for (const tipo of ["etapa_criar", "etapa_renomear", "resposta", "etiqueta", "tarefa", "rascunho_de_followup", "conhecimento", "relatorio", "meta"]) {
      expect(executar(GESTOR_A, PROPOR(ORG_A, tipo, `peca-${tipo}`)), tipo).toBe("n:1");
    }
  });

  it("o que não é peça (número, convite, publicar, mensagem) e o risco crítico não cabem", () => {
    for (const tipo of ["canal", "convite", "publicar_agente", "mensagem", "plano", "chave"]) {
      expect(executar(GESTOR_A, PROPOR(ORG_A, tipo, `x-${tipo}`)), tipo).toBe("23514");
    }
    expect(executar("servidor", `update public.mia_assistente_propostas set risco = 'critico' where organization_id = '${ORG_A}' and tipo = 'meta'`)).toBe("23514");
  });

  it("o risco vem do tipo: a etapa nova é segura e a meta pede atenção, por mais que a sessão mande outra coisa", () => {
    expect(executar(ADMIN_A, `${PROPOR(ORG_A, "etiqueta", "indicacao")}`.replace("(organization_id,", "(risco, organization_id,").replace("values (", "values ('atencao', "))).toBe("n:1");
    expect(valor(`select risco from public.mia_assistente_propostas where organization_id = '${ORG_A}' and chave = 'indicacao';`)).toBe("seguro");
    expect(valor(`select risco from public.mia_assistente_propostas where organization_id = '${ORG_A}' and chave = 'peca-meta';`)).toBe("atencao");
  });
});

describe("9100 · quem propõe e quem lê", () => {
  it("o atendente propõe e lê só a dele; o gestor lê todas; outra empresa vê zero; anon nada", () => {
    expect(executar(AT_A, PROPOR(ORG_A, "resposta", `eu:${AT_A}:endereco`))).toBe("n:1");
    expect(countAs(AT_A, `select count(*) from public.mia_assistente_propostas;`)).toBe(1);
    expect(countAs(GESTOR_A, `select count(*) from public.mia_assistente_propostas where organization_id = '${ORG_A}';`)).toBeGreaterThan(9);
    expect(countAs(ADMIN_B, `select count(*) from public.mia_assistente_propostas where organization_id = '${ORG_A}';`)).toBe(0);
    expect(executar("anon", `perform 1 from public.mia_assistente_propostas limit 1`)).toBe("42501");
  });

  it("o somente leitura não propõe; a outra empresa não propõe aqui", () => {
    expect(executar(LEITOR_A, PROPOR(ORG_A, "tarefa", "leitor"))).toBe("42501");
    expect(executar(ADMIN_B, PROPOR(ORG_A, "tarefa", "outra"))).toBe("42501");
  });

  it("pela sessão o pedido, o ajuste e o desfazer não nascem: a proposta nasce pendente, sem pedido", () => {
    expect(
      executar(
        AT_A,
        `insert into public.mia_assistente_propostas (organization_id, tipo, titulo, pedido, chave, pedida_a, pedida_em, desfeita_em, ajustada_em)
         values ('${ORG_A}', 'tarefa', 'forjada', '{}', 'forjada', '${ADMIN_A}', now(), now(), now())`,
      ),
    ).toBe("n:1");
    expect(
      valor(
        `select situacao || '|' || (pedida_a is null)::text || '|' || (desfeita_em is null)::text || '|' || (ajustada_em is null)::text
           from public.mia_assistente_propostas where organization_id = '${ORG_A}' and chave = 'forjada';`,
      ),
    ).toBe("pendente|true|true|true");
  });

  it("pela sessão ninguém pede, ajusta, desfaz nem apaga, nem o administrador", () => {
    for (const dml of [
      `update public.mia_assistente_propostas set pedida_a = '${ADMIN_A}', pedida_em = now() where chave = 'forjada'`,
      `update public.mia_assistente_propostas set pedido = '{"x":1}' where chave = 'forjada'`,
      `delete from public.mia_assistente_propostas where chave = 'forjada'`,
    ]) {
      expect(executar(ADMIN_A, dml), dml).toBe("42501");
    }
  });
});

describe("9100 · uma pendente por PEÇA", () => {
  it("três etapas são três cartões; a mesma etapa de novo é recusada", () => {
    expect(executar(GESTOR_A, PROPOR(ORG_A, "etapa_criar", "funil-1:visita"))).toBe("n:1");
    expect(executar(GESTOR_A, PROPOR(ORG_A, "etapa_criar", "funil-1:retorno"))).toBe("n:1");
    expect(executar(ADMIN_A, PROPOR(ORG_A, "etapa_criar", "funil-1:visita"))).toBe("23505");
  });
});

describe("9100 · a ordem, com o pedido, o ajuste e o desfazer (só o servidor)", () => {
  const ID = (chave: string) => `(select id from public.mia_assistente_propostas where organization_id = '${ORG_A}' and chave = '${chave}')`;

  it("o servidor marca o pedido e ajusta a peça enquanto ela está pendente", () => {
    expect(
      executar("servidor", `update public.mia_assistente_propostas set pedida_a = '${GESTOR_A}', pedida_em = now() where id = ${ID("funil-1:visita")}`),
    ).toBe("n:1");
    expect(
      executar(
        "servidor",
        `update public.mia_assistente_propostas set pedido = '{"nome":"Visita marcada"}', chave = 'funil-1:visita-marcada', ajustada_em = now() where id = ${ID("funil-1:visita")}`,
      ),
    ).toBe("n:1");
  });

  it("SABOTAGEM: desfazer o que não foi aplicado é recusado, mesmo pelo servidor", () => {
    expect(
      executar("servidor", `update public.mia_assistente_propostas set situacao = 'desfeita', desfeita_em = now() where id = ${ID("funil-1:retorno")}`),
    ).toBe("23514");
  });

  it("aprovada não muda de peça; aplicada vira desfeita só com a data; desfeita não muda mais", () => {
    sql(`update public.mia_assistente_propostas set situacao = 'aprovada', aprovada_em = now() where id = ${ID("funil-1:retorno")};`);
    expect(executar("servidor", `update public.mia_assistente_propostas set pedido = '{"nome":"x"}' where id = ${ID("funil-1:retorno")}`)).toBe("23514");
    sql(
      `update public.mia_assistente_propostas set situacao = 'aplicada', aplicada_em = now(), resultado = '{"etapa_id":"e1"}' where id = ${ID("funil-1:retorno")};`,
    );
    expect(executar("servidor", `update public.mia_assistente_propostas set situacao = 'desfeita' where id = ${ID("funil-1:retorno")}`)).toBe("23514");
    expect(
      executar(
        "servidor",
        `update public.mia_assistente_propostas set situacao = 'desfeita', desfeita_em = now(), desfeita_por = '${GESTOR_A}' where id = ${ID("funil-1:retorno")}`,
      ),
    ).toBe("n:1");
    expect(executar("servidor", `update public.mia_assistente_propostas set situacao = 'aplicada' where id = ${ID("funil-1:retorno")}`)).toBe("23514");
    expect(executar("servidor", `update public.mia_assistente_propostas set resultado = '{}' where id = ${ID("funil-1:retorno")}`)).toBe("23514");
  });

  it("a referência que some vira nulo em qualquer situação: o expurgo da conversa não trava mais", () => {
    sql(`
      insert into public.mia_assistente_conversas (id, organization_id, user_id, titulo)
        values ('91009100-3333-4000-8000-000000000001', '${ORG_A}', '${GESTOR_A}', 'conversa que vai sair');
      insert into public.mia_assistente_propostas (organization_id, conversa_id, tipo, titulo, chave, situacao, rejeitada_em)
        values ('${ORG_A}', '91009100-3333-4000-8000-000000000001', 'etiqueta', 'recusada', 'recusada-com-conversa', 'rejeitada', now());
    `);
    expect(executar("servidor", `delete from public.mia_assistente_conversas where id = '91009100-3333-4000-8000-000000000001'`)).toBe("n:1");
    expect(valor(`select (conversa_id is null)::text || '|' || situacao from public.mia_assistente_propostas where chave = 'recusada-com-conversa';`)).toBe(
      "true|rejeitada",
    );
  });
});

describe("9100 · a configuração da empresa", () => {
  it("os tipos ligados só aceitam peças; o pode pedir nasce ligado", () => {
    sql(`insert into public.mia_assistente_config (organization_id) values ('${ORG_A}') on conflict (organization_id) do nothing;`);
    expect(valor(`select pode_pedir::text || '|' || coalesce(array_length(tipos_de_proposta, 1), 0) from public.mia_assistente_config where organization_id = '${ORG_A}';`)).toBe(
      "true|0",
    );
    expect(
      executar("servidor", `update public.mia_assistente_config set tipos_de_proposta = array['etapa_criar','meta'] where organization_id = '${ORG_A}'`),
    ).toBe("n:1");
    expect(
      executar("servidor", `update public.mia_assistente_config set tipos_de_proposta = array['conectar_numero'] where organization_id = '${ORG_A}'`),
    ).toBe("23514");
  });
});

describe("9101 · a retenção leva a desfeita depois de um ano", () => {
  it("a desfeita velha sai; a nova fica", () => {
    sql(`
      insert into public.mia_assistente_propostas (organization_id, tipo, titulo, chave, situacao, aprovada_em, aplicada_em, desfeita_em)
        values ('${ORG_B}', 'tarefa', 'desfeita velha', 'velha', 'desfeita', now(), now(), now()),
               ('${ORG_B}', 'tarefa', 'desfeita nova', 'nova', 'desfeita', now(), now(), now());
      alter table public.mia_assistente_propostas disable trigger trg_mia_proposta_segue_a_ordem;
      update public.mia_assistente_propostas set updated_at = now() - interval '400 days' where organization_id = '${ORG_B}' and chave = 'velha';
      alter table public.mia_assistente_propostas enable trigger trg_mia_proposta_segue_a_ordem;
    `);
    const r = JSON.parse(valor(`select public.fn_mia_expurgar_assistente_vencido(90, 5000)::text;`)) as Record<string, number>;
    expect(r.propostas).toBeGreaterThanOrEqual(1);
    expect(valor(`select string_agg(chave, ',' order by chave) from public.mia_assistente_propostas where organization_id = '${ORG_B}';`)).toBe("nova");
  });
});

describe("9080 a 9082 e 9100 a 9101 · idempotentes e na ordem", () => {
  it("as cinco, duas vezes, na ordem, sem erro; o estado final é o da 9100", () => {
    const pasta = path.resolve(__dirname, "../../supabase/migrations-mia");
    const cinco = [
      "20261025200000_9080_propostas_do_assistente.sql",
      "20261025200100_9081_retratos_do_que_falta.sql",
      "20261025200200_9082_retencao_das_propostas_e_dos_retratos.sql",
      "20261027200000_9100_o_assistente_faz_com_aprovacao.sql",
      "20261027200100_9101_retencao_das_propostas_desfeitas.sql",
    ];
    for (let passada = 0; passada < 2; passada += 1) {
      for (const nome of cinco) sql(readFileSync(path.join(pasta, nome), "utf8"));
    }
    expect(valor(`select count(*) from pg_policies where tablename = 'mia_assistente_propostas' and policyname like 'mia_%';`)).toBe("2");
    // o índice da 9080 tem o nome de sempre e a definição da 9100 (por peça)
    expect(valor(`select indexdef like '%chave%' from pg_indexes where indexname = 'mia_assistente_propostas_uma_pendente_idx';`)).toBe("t");
    expect(valor(`select pg_get_constraintdef(oid) like '%desfeita%' from pg_constraint where conname = 'mia_assistente_propostas_situacao';`)).toBe("t");
    // e o atendente continua propondo (a política da 9100 venceu a da 9080)
    expect(executar(AT_A, PROPOR(ORG_A, "tarefa", "depois-das-migrations"))).toBe("n:1");
  });
});
