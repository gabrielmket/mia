import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { criarOrg, criarPlano, criarUsuarios, tornarPlatformAdmin, valor } from "./cobranca-helpers";
import { lastLine, sql } from "./gov-helpers";

/**
 * FORK MIA (9120 a 9122) · O PAGAMENTO NO INÍCIO NO BANCO (.96).
 *
 * Contra o Postgres de verdade, com o papel `authenticated` e o JWT de cada
 * pessoa, como o PostgREST faz:
 *
 *   - os dados fiscais e o retrato do pagamento: o ADMINISTRADOR da empresa lê os
 *     da própria (controle positivo) e zero do vizinho; gestor e atendente da
 *     mesma empresa leem zero; a plataforma lê; anon recebe permission denied; a
 *     sessão não escreve (só o servidor);
 *   - a passagem do cadastro e a nota da assinatura são só do servidor;
 *   - a empresa nasce com os dados do cadastro de quem a criou (o gatilho), a
 *     passagem some e a razão social vira o `legal_name`;
 *   - a empresa redigida perde os dados fiscais e o retrato do pagamento (LGPD);
 *   - o banco recusa documento com o tamanho errado e cartão com mais que o final.
 */

const ORG_A = "91209120-0000-4000-8000-00000000000a";
const ORG_B = "91209120-0000-4000-8000-00000000000b";
const ORG_NOVA = "91209120-0000-4000-8000-00000000000c";
const ADMIN_A = "91209120-1111-4000-8000-0000000000a1";
const GESTOR_A = "91209120-1111-4000-8000-0000000000a2";
const ADMIN_B = "91209120-1111-4000-8000-0000000000b1";
const PLATAFORMA = "91209120-1111-4000-8000-0000000000f1";
const QUEM_SE_CADASTROU = "91209120-1111-4000-8000-0000000000c1";
const PLANO = "91209120-2222-4000-8000-000000000001";

/** Um comando como `usuario` (`anon`, `postgres` ou o uuid de alguém): a última linha, ou o SQLSTATE. */
function como(usuario: string, comando: string): string {
  const papel = usuario === "anon" ? "anon" : usuario === "postgres" ? null : "authenticated";
  const claims =
    papel === "authenticated" ? `select set_config('request.jwt.claims', '{"sub":"${usuario}","role":"authenticated"}', false);` : "";
  return lastLine(
    sql(`
      ${papel ? `set role ${papel};` : ""}
      ${claims}
      do $$
      declare r text;
      begin
        begin
          execute $q$ ${comando} $q$ into r;
          perform set_config('inv.r9120', coalesce(r, '<null>'), false);
        exception when others then
          perform set_config('inv.r9120', 'erro:' || sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9120');
    `),
  );
}

const fiscais = (org: string, doc: string) =>
  `insert into public.mia_dados_fiscais (organization_id, tipo, documento, razao_social, cep, logradouro, numero, bairro, cidade, uf)
     values ('${org}', 'pj', '${doc}', 'Empresa de Teste ${org.slice(-1)} Ltda', '30130010', 'Rua A', '10', 'Centro', 'Belo Horizonte', 'MG')
     on conflict (organization_id) do nothing;`;
const pagamento = (org: string) =>
  `insert into public.mia_pagamento_inicial (organization_id, plano_id, situacao, forma, pagamento_ref, valor_cents)
     values ('${org}', '${PLANO}', 'aguardando', 'pix', 'pay_inv_${org.slice(-1)}', 59700)
     on conflict (organization_id) do nothing;`;

beforeAll(() => {
  // Sem PII real: documentos de exemplo e e-mails sintéticos (LGPD).
  criarUsuarios([
    [ADMIN_A, "pagamento-admin-a@invariant.test"],
    [GESTOR_A, "pagamento-gestor-a@invariant.test"],
    [ADMIN_B, "pagamento-admin-b@invariant.test"],
    [PLATAFORMA, "pagamento-plataforma@invariant.test"],
    [QUEM_SE_CADASTROU, "pagamento-cadastro@invariant.test"],
  ]);
  tornarPlatformAdmin(PLATAFORMA, "full", PLATAFORMA);
  criarOrg(ORG_A, "pagamento-a", ADMIN_A);
  criarOrg(ORG_B, "pagamento-b", ADMIN_B);
  sql(`insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
         ('${ADMIN_A}', '${ORG_A}', 'admin', now()),
         ('${GESTOR_A}', '${ORG_A}', 'manager', now()),
         ('${ADMIN_B}', '${ORG_B}', 'admin', now())
         on conflict do nothing;`);
  criarPlano({ id: PLANO, nome: "Entrada paga (inv 9121)", trialDias: 0 });
  sql(fiscais(ORG_A, "11222333000181"));
  sql(fiscais(ORG_B, "11444777000161"));
  sql(pagamento(ORG_A));
  sql(pagamento(ORG_B));
});

describe("os dados fiscais e o retrato do pagamento: só o administrador da empresa e a plataforma", () => {
  for (const tabela of ["mia_dados_fiscais", "mia_pagamento_inicial"] as const) {
    it(`⭐ ${tabela}: o admin lê a própria (controle positivo) e zero do vizinho`, () => {
      expect(como(ADMIN_A, `select count(*)::text from public.${tabela} where organization_id = '${ORG_A}'`)).toBe("1");
      expect(como(ADMIN_A, `select count(*)::text from public.${tabela} where organization_id = '${ORG_B}'`)).toBe("0");
      expect(como(ADMIN_A, `select count(*)::text from public.${tabela}`)).toBe("1");
      expect(como(ADMIN_B, `select count(*)::text from public.${tabela}`)).toBe("1");
    });

    it(`${tabela}: o gestor da mesma empresa lê zero; a plataforma lê as duas; anon é recusado`, () => {
      expect(como(GESTOR_A, `select count(*)::text from public.${tabela}`)).toBe("0");
      expect(
        Number(como(PLATAFORMA, `select count(*)::text from public.${tabela} where organization_id in ('${ORG_A}', '${ORG_B}')`)),
      ).toBe(2);
      expect(como("anon", `select count(*)::text from public.${tabela}`)).toBe("erro:42501");
    });

    it(`${tabela}: a sessão não escreve, nem o admin (quem grava é o servidor)`, () => {
      expect(como(ADMIN_A, `update public.${tabela} set updated_at = now() where organization_id = '${ORG_A}' returning 'ok'`)).toBe("erro:42501");
      expect(como(ADMIN_A, `delete from public.${tabela} where organization_id = '${ORG_A}' returning 'ok'`)).toBe("erro:42501");
    });
  }

  it("a passagem do cadastro e a nota da assinatura são só do servidor", () => {
    for (const tabela of ["mia_dados_fiscais_do_cadastro", "mia_nota_da_assinatura"]) {
      expect(como(ADMIN_A, `select count(*)::text from public.${tabela}`)).toBe("erro:42501");
      expect(como("anon", `select count(*)::text from public.${tabela}`)).toBe("erro:42501");
    }
  });
});

describe("a empresa nasce com os dados do cadastro", () => {
  it("⭐ o gatilho leva a passagem para a empresa criada por quem se cadastrou, e a razão social vira o legal_name", () => {
    sql(`insert into public.mia_dados_fiscais_do_cadastro
           (user_id, tipo, documento, razao_social, cep, logradouro, numero, bairro, cidade, uf, telefone)
         values ('${QUEM_SE_CADASTROU}', 'pf', '52998224725', 'Fulana de Teste', '30130010', 'Rua B', '20', 'Centro', 'Belo Horizonte', 'MG', '5531988880000')
         on conflict (user_id) do nothing;`);
    criarOrg(ORG_NOVA, "pagamento-nova", QUEM_SE_CADASTROU);
    expect(valor(`select documento || '|' || telefone from public.mia_dados_fiscais where organization_id = '${ORG_NOVA}';`)).toBe(
      "52998224725|5531988880000",
    );
    expect(valor(`select count(*) from public.mia_dados_fiscais_do_cadastro where user_id = '${QUEM_SE_CADASTROU}';`)).toBe("0");
    expect(valor(`select legal_name from public.organizations where id = '${ORG_NOVA}';`)).toBe("Fulana de Teste");
  });

  it("a empresa criada sem passagem (a Time, o MCP) nasce sem dados fiscais", () => {
    expect(valor(`select count(*) from public.mia_dados_fiscais where organization_id = '${ORG_B}' and documento = '11444777000161';`)).toBe("1");
    expect(valor(`select count(*) from public.mia_dados_fiscais where organization_id = '91209120-0000-4000-8000-0000000000ff';`)).toBe("0");
  });
});

describe("o banco recusa o que não é dado fiscal nem final de cartão", () => {
  it("documento com o tamanho do outro tipo, CEP curto, UF minúscula: 23514", () => {
    expect(como("postgres", `update public.mia_dados_fiscais set documento = '52998224725' where organization_id = '${ORG_A}' returning 'ok'`)).toBe("erro:23514");
    expect(como("postgres", `update public.mia_dados_fiscais set cep = '301' where organization_id = '${ORG_A}' returning 'ok'`)).toBe("erro:23514");
    expect(como("postgres", `update public.mia_dados_fiscais set uf = 'mg' where organization_id = '${ORG_A}' returning 'ok'`)).toBe("erro:23514");
  });

  it("⭐ do cartão, o banco só aceita o final de 4 números", () => {
    expect(
      como("postgres", `update public.mia_pagamento_inicial set cartao_final = '4111111111111111' where organization_id = '${ORG_A}' returning 'ok'`),
    ).toBe("erro:23514");
    expect(como("postgres", `update public.mia_pagamento_inicial set cartao_final = '1111' where organization_id = '${ORG_A}' returning 'ok'`)).toBe("ok");
  });
});

describe("LGPD: a empresa redigida perde os dados fiscais e o retrato do pagamento", () => {
  it("⭐ status 'redacted' apaga as duas linhas da empresa, e só dela", () => {
    sql(`update public.organizations set status = 'redacted' where id = '${ORG_B}';`);
    expect(valor(`select count(*) from public.mia_dados_fiscais where organization_id = '${ORG_B}';`)).toBe("0");
    expect(valor(`select count(*) from public.mia_pagamento_inicial where organization_id = '${ORG_B}';`)).toBe("0");
    expect(valor(`select count(*) from public.mia_dados_fiscais where organization_id = '${ORG_A}';`)).toBe("1");
  });
});

describe("9122: o fim do teste sem pagamento bloqueia como a entrada paga", () => {
  const TESTE_VENCIDO = "91229122-0000-4000-8000-00000000000a";
  const JA_PAGOU = "91229122-0000-4000-8000-00000000000b";
  const EM_TESTE = "91229122-0000-4000-8000-00000000000c";
  const PLANO_TESTE = "91229122-2222-4000-8000-000000000001";
  const bloquear = (org: string) => valor(`set role service_role; select public.fn_mia_bloquear_fim_do_teste('${org}')->>'motivo';`);

  beforeAll(() => {
    // `created_by` nulo: o gatilho da entrada paga do upstream não cria assinatura sozinho.
    criarOrg(TESTE_VENCIDO, "fim-do-teste-a", null);
    criarOrg(JA_PAGOU, "fim-do-teste-b", null);
    criarOrg(EM_TESTE, "fim-do-teste-c", null);
    criarPlano({ id: PLANO_TESTE, nome: "Com teste (inv 9122)", trialDias: 14 });
    sql(`insert into public.cobranca_assinaturas (organization_id, plano_id, estado, trial_ate, proximo_vencimento) values
           ('${TESTE_VENCIDO}', '${PLANO_TESTE}', 'trial', now() - interval '1 hour', null),
           ('${JA_PAGOU}', '${PLANO_TESTE}', 'em_atraso', now() - interval '40 days', now() - interval '5 days'),
           ('${EM_TESTE}', '${PLANO_TESTE}', 'trial', now() + interval '3 days', null)
         on conflict (organization_id) do nothing;`);
    sql(`insert into public.platform_config (chave, valor) values ('MODULO_COBRANCA', 'ligado')
           on conflict (chave) do update set valor = 'ligado';`);
  });
  afterAll(() => {
    sql(`delete from public.platform_config where chave = 'MODULO_COBRANCA';`);
  });

  it("⭐ teste vencido e nunca pago: liga a pendência e suspende com o motivo da entrada paga; de novo, não repete", () => {
    expect(bloquear(TESTE_VENCIDO)).toBe("fim_do_teste_sem_pagamento");
    expect(valor(`select pagamento_inicial_pendente::text from public.cobranca_assinaturas where organization_id = '${TESTE_VENCIDO}';`)).toBe("true");
    expect(valor(`select status || '|' || suspended_kind || '|' || suspended_reason from public.organizations where id = '${TESTE_VENCIDO}';`)).toBe(
      "suspended|cobranca|Aguardando o primeiro pagamento",
    );
    expect(bloquear(TESTE_VENCIDO)).toBe("ja_espera_o_pagamento");
  });

  it("quem já pagou uma mensalidade e quem ainda está no teste seguem a régua de hoje", () => {
    expect(bloquear(JA_PAGOU)).toBe("ja_pagou");
    expect(bloquear(EM_TESTE)).toBe("teste_em_curso");
    expect(valor(`select status from public.organizations where id = '${JA_PAGOU}';`)).toBe("active");
  });

  it("só o servidor executa: a sessão e anon recebem permission denied", () => {
    expect(como(ADMIN_A, `select public.fn_mia_bloquear_fim_do_teste('${EM_TESTE}')::text`)).toBe("erro:42501");
    expect(como("anon", `select public.fn_mia_bloquear_fim_do_teste('${EM_TESTE}')::text`)).toBe("erro:42501");
  });
});
