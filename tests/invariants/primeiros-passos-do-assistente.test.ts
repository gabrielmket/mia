import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { countAs, lastLine, sql } from "./gov-helpers";

/**
 * FORK MIA (9080 a 9082) — AS PROPOSTAS E O RETRATO DO "O QUE FALTA" NO BANCO.
 *
 * Contra o Postgres de verdade (o molde do baseline + baseline-mia), com o papel
 * `authenticated` e o JWT de cada pessoa, como o PostgREST faz:
 *
 *   - a proposta: gestor e administrador leem e propõem; atendente não vê nem
 *     propõe; outra empresa vê zero; anon nada;
 *   - a proposta pela sessão nasce PENDENTE e da própria pessoa, sem aprovação
 *     nem resultado, por mais que o pedido mande outra coisa;
 *   - pela sessão ninguém aprova, aplica, rejeita nem apaga;
 *   - SABOTAGEM do desenho do upstream: nem o servidor aplica uma proposta
 *     pendente sem aprovar antes, nem muda a peça, nem reabre a decidida;
 *   - risco crítico e peça fora das três não cabem na tabela;
 *   - uma pendente por peça e empresa;
 *   - o retrato: o administrador grava, o gestor lê e não grava, a hora e quem
 *     calculou vêm do banco, ninguém altera nem apaga pela sessão;
 *   - a retenção vence a pendente atrasada e guarda o primeiro retrato;
 *   - as três migrations aplicam duas vezes sem erro.
 */

const ORG_A = "90809080-0000-4000-8000-00000000000a";
const ORG_B = "90809080-0000-4000-8000-00000000000b";
const ADMIN_A = "90809080-1111-4000-8000-0000000000a1";
const GESTOR_A = "90809080-1111-4000-8000-0000000000a2";
const AT_A = "90809080-1111-4000-8000-0000000000a3";
const ADMIN_B = "90809080-1111-4000-8000-0000000000b1";
const PROPOSTA_A = "90809080-2222-4000-8000-000000000001";

/**
 * Uma escrita como `usuario` (`anon`, `servidor` = o `service_role`, ou o
 * uuid de alguém): `n:<linhas>` ou o SQLSTATE.
 */
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
          perform set_config('inv.r9080', 'n:' || n, false);
        exception when others then
          perform set_config('inv.r9080', sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9080');
    `),
  );
}

function valor(consulta: string): string {
  return lastLine(sql(consulta));
}

const PROPOR = (org: string, tipo = "funil") =>
  `insert into public.mia_assistente_propostas (organization_id, tipo, titulo, mudancas, pedido)
   values ('${org}', '${tipo}', 'Funil "Agendamentos", do quadro pronto', '[{"rotulo":"Funil","valor":"Agendamentos"}]', '{"pacote":"clinica"}')`;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ADMIN_A}', 'propostas-admin-a@invariant.test'),
      ('${GESTOR_A}', 'propostas-gestor-a@invariant.test'),
      ('${AT_A}', 'propostas-at-a@invariant.test'),
      ('${ADMIN_B}', 'propostas-admin-b@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'propostas-9080-a', 'Propostas A', 'Propostas A'),
      ('${ORG_B}', 'propostas-9080-b', 'Propostas B', 'Propostas B')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ADMIN_A}', '${ORG_A}', 'admin', now()),
      ('${GESTOR_A}', '${ORG_A}', 'manager', now()),
      ('${AT_A}', '${ORG_A}', 'agent', now()),
      ('${ADMIN_B}', '${ORG_B}', 'admin', now())
      on conflict do nothing;
    insert into public.mia_assistente_propostas (id, organization_id, tipo, titulo, pedido, criada_por)
      values ('${PROPOSTA_A}', '${ORG_A}', 'agente', 'Agente "Clara · Recepção", do modelo de clínica', '{"segmento":"clinica"}', '${GESTOR_A}');
  `);
});

describe("9080 · quem vê e quem propõe", () => {
  it("gestor e administrador da empresa leem a proposta (controle positivo)", () => {
    expect(countAs(ADMIN_A, `select count(*) from public.mia_assistente_propostas where id = '${PROPOSTA_A}';`)).toBe(1);
    expect(countAs(GESTOR_A, `select count(*) from public.mia_assistente_propostas where id = '${PROPOSTA_A}';`)).toBe(1);
  });

  it("o atendente não vê; outra empresa vê zero; anon nada", () => {
    expect(countAs(AT_A, `select count(*) from public.mia_assistente_propostas;`)).toBe(0);
    expect(countAs(ADMIN_B, `select count(*) from public.mia_assistente_propostas where organization_id = '${ORG_A}';`)).toBe(0);
    expect(executar("anon", `perform 1 from public.mia_assistente_propostas limit 1`)).toBe("42501");
    expect(executar("anon", `perform 1 from public.mia_assistente_retratos limit 1`)).toBe("42501");
  });

  it("o gestor propõe pela sessão; o atendente e a outra empresa, não", () => {
    expect(executar(GESTOR_A, PROPOR(ORG_A))).toBe("n:1");
    expect(executar(AT_A, PROPOR(ORG_A, "followup"))).toBe("42501");
    expect(executar(ADMIN_B, PROPOR(ORG_A, "followup"))).toBe("42501");
  });

  it("a proposta pela sessão nasce pendente e da própria pessoa, por mais que o pedido mande outra coisa", () => {
    expect(
      executar(
        ADMIN_A,
        `insert into public.mia_assistente_propostas
           (organization_id, tipo, titulo, pedido, situacao, aprovada_em, aplicada_em, resultado, criada_por)
         values ('${ORG_A}', 'followup', 'forjada', '{}', 'aplicada', now(), now(), '{"x":1}', '${GESTOR_A}')`,
      ),
    ).toBe("n:1");
    expect(
      valor(
        `select situacao || '|' || (criada_por = '${ADMIN_A}')::text || '|' || (aprovada_em is null)::text || '|' || (resultado is null)::text
           from public.mia_assistente_propostas where organization_id = '${ORG_A}' and tipo = 'followup';`,
      ),
    ).toBe("pendente|true|true|true");
  });

  it("uma pendente por peça e empresa: a segunda igual é recusada", () => {
    expect(executar(ADMIN_A, PROPOR(ORG_A))).toBe("23505");
  });

  it("risco crítico e peça fora das três não cabem na tabela", () => {
    expect(
      executar(
        ADMIN_A,
        `insert into public.mia_assistente_propostas (organization_id, tipo, titulo, risco) values ('${ORG_A}', 'agente', 'x', 'critico')`,
      ),
    ).toBe("23514");
    expect(
      executar(ADMIN_A, `insert into public.mia_assistente_propostas (organization_id, tipo, titulo) values ('${ORG_A}', 'canal', 'conectar o número')`),
    ).toBe("23514");
  });
});

describe("9080 · aprovar, aplicar e rejeitar são do servidor, e na ordem", () => {
  it("pela sessão ninguém aprova, aplica, rejeita nem apaga, nem o administrador", () => {
    for (const dml of [
      `update public.mia_assistente_propostas set situacao = 'aprovada', aprovada_em = now() where id = '${PROPOSTA_A}'`,
      `update public.mia_assistente_propostas set situacao = 'rejeitada' where id = '${PROPOSTA_A}'`,
      `delete from public.mia_assistente_propostas where id = '${PROPOSTA_A}'`,
    ]) {
      expect(executar(ADMIN_A, dml), dml).toBe("42501");
    }
  });

  it("SABOTAGEM: nem o servidor aplica uma proposta pendente sem aprová-la antes", () => {
    expect(
      executar(
        "servidor",
        `update public.mia_assistente_propostas set situacao = 'aplicada', aprovada_em = now(), aplicada_em = now() where id = '${PROPOSTA_A}'`,
      ),
    ).toBe("23514");
    expect(valor(`select situacao from public.mia_assistente_propostas where id = '${PROPOSTA_A}';`)).toBe("pendente");
  });

  it("aprovada e depois aplicada passa (controle positivo); a peça não muda depois de criada", () => {
    sql(`update public.mia_assistente_propostas set situacao = 'aprovada', aprovada_em = now() where id = '${PROPOSTA_A}';`);
    expect(
      executar("servidor", `update public.mia_assistente_propostas set pedido = '{"segmento":"academia"}' where id = '${PROPOSTA_A}'`),
    ).toBe("23514");
    sql(
      `update public.mia_assistente_propostas set situacao = 'aplicada', aplicada_em = now(), resultado = '{"agente_id":"x"}' where id = '${PROPOSTA_A}';`,
    );
    expect(valor(`select situacao from public.mia_assistente_propostas where id = '${PROPOSTA_A}';`)).toBe("aplicada");
  });

  it("aplicada não volta atrás nem troca o resultado; a saída junto com o agente ainda é anotada", () => {
    expect(executar("servidor", `update public.mia_assistente_propostas set situacao = 'rejeitada' where id = '${PROPOSTA_A}'`)).toBe(
      "23514",
    );
    expect(executar("servidor", `update public.mia_assistente_propostas set resultado = '{}' where id = '${PROPOSTA_A}'`)).toBe("23514");
    expect(
      executar("servidor", `update public.mia_assistente_propostas set saiu_com_o_agente_em = now() where id = '${PROPOSTA_A}'`),
    ).toBe("n:1");
  });

  it("rejeitada não muda mais", () => {
    sql(`update public.mia_assistente_propostas set situacao = 'rejeitada', rejeitada_em = now() where organization_id = '${ORG_A}' and tipo = 'funil' and situacao = 'pendente';`);
    expect(
      executar(
        "servidor",
        `update public.mia_assistente_propostas set situacao = 'aprovada', aprovada_em = now() where organization_id = '${ORG_A}' and tipo = 'funil'`,
      ),
    ).toBe("23514");
  });
});

describe("9081 · o retrato do \"o que falta\"", () => {
  const GRAVAR = (org: string, faltam: number) =>
    `insert into public.mia_assistente_retratos (organization_id, faltam, total, preenchido, posso_completar, preciso_confirmar, nao_se_aplica, itens, calculado_por, rodada_em)
     values ('${org}', ${faltam}, 8, ${8 - faltam}, 0, ${faltam}, 2, '[{"chave":"whatsapp","coluna":"preciso_confirmar"}]', '${GESTOR_A}', now() - interval '3 years')`;

  it("o administrador grava; a hora e quem calculou vêm do banco", () => {
    expect(executar(ADMIN_A, GRAVAR(ORG_A, 6))).toBe("n:1");
    expect(
      valor(
        `select (calculado_por = '${ADMIN_A}')::text || '|' || (rodada_em > now() - interval '1 minute')::text
           from public.mia_assistente_retratos where organization_id = '${ORG_A}' order by rodada_em desc limit 1;`,
      ),
    ).toBe("true|true");
  });

  it("o gestor lê a evolução e não grava; o atendente não lê; outra empresa vê zero", () => {
    expect(countAs(GESTOR_A, `select count(*) from public.mia_assistente_retratos where organization_id = '${ORG_A}';`)).toBe(1);
    expect(executar(GESTOR_A, GRAVAR(ORG_A, 5))).toBe("42501");
    expect(countAs(AT_A, `select count(*) from public.mia_assistente_retratos;`)).toBe(0);
    expect(countAs(ADMIN_B, `select count(*) from public.mia_assistente_retratos where organization_id = '${ORG_A}';`)).toBe(0);
  });

  it("ninguém altera nem apaga o retrato pela sessão; a conta que não fecha é recusada", () => {
    expect(executar(ADMIN_A, `update public.mia_assistente_retratos set faltam = 0 where organization_id = '${ORG_A}'`)).toBe("42501");
    expect(executar(ADMIN_A, `delete from public.mia_assistente_retratos where organization_id = '${ORG_A}'`)).toBe("42501");
    expect(
      executar(
        ADMIN_A,
        `insert into public.mia_assistente_retratos (organization_id, faltam, total, preenchido, posso_completar, preciso_confirmar) values ('${ORG_A}', 3, 8, 8, 0, 3)`,
      ),
    ).toBe("23514");
  });
});

describe("9082 · a retenção das propostas e dos retratos", () => {
  it("a pendente que passou do prazo vence; o primeiro e o último retrato de cada empresa ficam", () => {
    sql(`
      insert into public.mia_assistente_propostas (organization_id, tipo, titulo, expira_em)
        values ('${ORG_B}', 'funil', 'vencida', now() - interval '1 day');
      insert into public.mia_assistente_retratos (organization_id, faltam, total, preenchido, posso_completar, preciso_confirmar, rodada_em) values
        ('${ORG_B}', 7, 7, 0, 2, 5, now() - interval '800 days'),
        ('${ORG_B}', 5, 7, 2, 1, 4, now() - interval '700 days'),
        ('${ORG_B}', 3, 7, 4, 0, 3, now() - interval '600 days');
    `);
    const r = JSON.parse(valor(`select public.fn_mia_expurgar_assistente_vencido(90, 5000)::text;`)) as Record<string, number>;
    expect(r.propostas_vencidas).toBeGreaterThanOrEqual(1);
    expect(r.retratos).toBeGreaterThanOrEqual(1);
    expect(valor(`select situacao from public.mia_assistente_propostas where organization_id = '${ORG_B}' and titulo = 'vencida';`)).toBe(
      "expirada",
    );
    // o primeiro (7) e o mais novo (3) ficam; o do meio sai
    expect(valor(`select string_agg(faltam::text, ',' order by rodada_em) from public.mia_assistente_retratos where organization_id = '${ORG_B}';`)).toBe(
      "7,3",
    );
  });

  it("só o servidor executa a retenção", () => {
    expect(executar(ADMIN_A, `perform public.fn_mia_expurgar_assistente_vencido(90, 10)`)).toBe("42501");
  });
});

describe("9080 a 9082 · as migrations são idempotentes", () => {
  it("aplicar as três duas vezes por cima do baseline não dá erro nem duplica", () => {
    const pasta = path.resolve(__dirname, "../../supabase/migrations-mia");
    for (const nome of [
      "20261025200000_9080_propostas_do_assistente.sql",
      "20261025200100_9081_retratos_do_que_falta.sql",
      "20261025200200_9082_retencao_das_propostas_e_dos_retratos.sql",
    ]) {
      const migration = readFileSync(path.join(pasta, nome), "utf8");
      sql(migration);
      sql(migration);
    }
    expect(valor(`select count(*) from pg_policies where tablename = 'mia_assistente_propostas' and policyname like 'mia_%';`)).toBe("2");
    expect(valor(`select count(*) from pg_policies where tablename = 'mia_assistente_retratos' and policyname like 'mia_%';`)).toBe("2");
    expect(valor(`select count(*) from pg_trigger where tgname in ('trg_mia_proposta_nasce', 'trg_mia_proposta_segue_a_ordem', 'trg_mia_retrato_nasce');`)).toBe(
      "3",
    );
  });

  it("com a .90 por baixo: 9070 a 9072 e 9080 a 9082 juntas, na ordem, duas vezes, sem erro", () => {
    // A .91 sobe por cima da .90: quem atualiza recebe as seis em sequência, e
    // uma segunda passada (o deploy que repete) não pode quebrar nem duplicar.
    const pasta = path.resolve(__dirname, "../../supabase/migrations-mia");
    const seis = [
      "20261025104713_9070_plano_libera_modulo.sql",
      "20261025104727_9071_origem_da_empresa.sql",
      "20261025104741_9072_creditos_por_pix.sql",
      "20261025200000_9080_propostas_do_assistente.sql",
      "20261025200100_9081_retratos_do_que_falta.sql",
      "20261025200200_9082_retencao_das_propostas_e_dos_retratos.sql",
    ];
    for (let passada = 0; passada < 2; passada += 1) {
      for (const nome of seis) sql(readFileSync(path.join(pasta, nome), "utf8"));
    }
    expect(
      valor(
        `select count(*) from pg_tables where schemaname = 'public' and tablename in ` +
          `('mia_plano_modulos', 'mia_modulos_do_plano_registro', 'mia_origem_da_empresa', 'mia_compras_de_creditos', ` +
          `'mia_assistente_propostas', 'mia_assistente_retratos') and rowsecurity;`,
      ),
    ).toBe("6");
    expect(valor(`select count(*) from pg_policies where tablename = 'mia_assistente_propostas' and policyname like 'mia_%';`)).toBe("2");
    // A retenção (9082, a nossa redefinição da 9051) continua uma função só.
    expect(valor(`select count(*) from pg_proc where proname = 'fn_mia_expurgar_assistente_vencido';`)).toBe("1");
  });
});
