import { beforeAll, describe, expect, it } from "vitest";

import { assinar, criarOrg, criarPlano, criarUsuarios, tornarPlatformAdmin } from "./cobranca-helpers";
import { lastLine, sql } from "./gov-helpers";

/**
 * FORK MIA (9070 a 9072) — A JORNADA DE ASSINATURA NO BANCO.
 *
 * Contra o Postgres de verdade (o molde do baseline + baseline-mia), com o papel
 * `authenticated` e o JWT de cada pessoa, como o PostgREST faz:
 *
 *   - TUDO DESLIGADO: com a cobrança desligada, nenhum módulo vem pelo plano,
 *     nem para a empresa que tem assinatura; a isenta nunca ganha módulo de plano;
 *   - ligada, o plano liga os módulos da linha `mia_plano_modulos`, e Vendas B2B
 *     só com o módulo da instalação ligado; a sessão só pergunta da própria empresa;
 *   - tirar módulo (ou mudar o preço por mensagem ou, desde a 9110, o por e-mail) de plano assinado é recusado
 *     no banco; acrescentar pode; plano sem assinante muda à vontade;
 *   - seguir o plano grava a diferença uma vez só (rodar de novo não repete), e
 *     desligar a cobrança registra o "desligou";
 *   - a origem nasce no insert da empresa: cadastro próprio ou implantação;
 *   - a compra de crédito paga entra na carteira UMA vez;
 *   - as cinco tabelas novas são só do servidor: authenticated e anon recebem
 *     permission denied, e as funções de escrita não são da sessão.
 */

const ORG_A = "90709070-0000-4000-8000-00000000000a";
const ORG_B = "90709070-0000-4000-8000-00000000000b";
const ORG_C = "90709070-0000-4000-8000-00000000000c";
const ADMIN_A = "90709070-1111-4000-8000-0000000000a1";
const USR_B = "90709070-1111-4000-8000-0000000000b1";
const PLATAFORMA = "90709070-1111-4000-8000-0000000000f1";
const PRO = "90709070-2222-4000-8000-000000000001";
const ESS = "90709070-2222-4000-8000-000000000002";
const NOVO = "90709070-2222-4000-8000-000000000003";
const COMPRA = "90709070-3333-4000-8000-000000000001";

const TABELAS = [
  "mia_plano_modulos",
  "mia_modulos_do_plano_registro",
  "mia_origem_da_empresa",
  "mia_pacotes_de_creditos",
  "mia_compras_de_creditos",
] as const;

/** Um comando como `usuario` (`anon`, `postgres` ou o uuid de alguém): a última linha, ou o SQLSTATE. */
function como(usuario: string, comando: string): string {
  const papel = usuario === "anon" ? "anon" : usuario === "postgres" ? null : "authenticated";
  const claims =
    papel === "authenticated" ? `select set_config('request.jwt.claims', '{"sub":"${usuario}"}', false);` : "";
  return lastLine(
    sql(`
      ${papel ? `set role ${papel};` : ""}
      ${claims}
      do $$
      declare r text;
      begin
        begin
          execute $q$ ${comando} $q$ into r;
          perform set_config('inv.r9070', coalesce(r, '<null>'), false);
        exception when others then
          perform set_config('inv.r9070', 'erro:' || sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9070');
    `),
  );
}

const modulos = (usuario: string, org: string) => como(usuario, `select public.fn_mia_modulos_do_plano('${org}')::text`);
const ligarCobranca = () =>
  sql(`insert into public.platform_config (chave, valor) values ('MODULO_COBRANCA', 'ligado')
         on conflict (chave) do update set valor = 'ligado';`);
const desligarCobranca = () => sql(`delete from public.platform_config where chave = 'MODULO_COBRANCA';`);

beforeAll(() => {
  // Sem PII real: e-mails sintéticos (LGPD). A cobrança desligada na semente: o
  // gatilho da 0679 (trial na criação) não cria assinatura aqui.
  sql(`delete from public.platform_config where chave in ('MODULO_COBRANCA', 'MODULO_CRM_B2B');`);
  criarUsuarios([
    [ADMIN_A, "jornada-admin-a@invariant.test"],
    [USR_B, "jornada-usr-b@invariant.test"],
    [PLATAFORMA, "jornada-plataforma@invariant.test"],
  ]);
  tornarPlatformAdmin(PLATAFORMA, "full", PLATAFORMA);
  criarOrg(ORG_A, "jornada-a", ADMIN_A);
  criarOrg(ORG_B, "jornada-b", PLATAFORMA);
  criarOrg(ORG_C, "jornada-c", null);
  sql(`insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
         ('${ADMIN_A}', '${ORG_A}', 'admin', now()),
         ('${USR_B}', '${ORG_B}', 'admin', now())
         on conflict do nothing;`);
  criarPlano({ id: PRO, nome: "Profissional (inv 9070)" });
  criarPlano({ id: ESS, nome: "Essencial (inv 9070)" });
  criarPlano({ id: NOVO, nome: "Novo (inv 9070)" });
  sql(`insert into public.mia_plano_modulos (plano_id, modulos, preco_por_mensagem_cents) values
         ('${PRO}', array['disparador', 'email_marketing', 'crm_b2b'], 12),
         ('${ESS}', '{}', null),
         ('${NOVO}', array['disparador'], 10)
         on conflict (plano_id) do nothing;`);
  // A e C assinam; B é isenta (sem linha de assinatura).
  assinar(ORG_A, PRO);
  assinar(ORG_C, ESS);
});

describe("tudo desligado: a cobrança desligada não muda nada", () => {
  it("⭐ nem a empresa com assinatura ganha módulo pelo plano", () => {
    desligarCobranca();
    expect(modulos("postgres", ORG_A)).toBe("{}");
    expect(modulos("postgres", ORG_B)).toBe("{}");
  });
});

describe("ligada, o plano liga os módulos", () => {
  it("o plano da empresa liga os dele; Vendas B2B só com o módulo da instalação", () => {
    ligarCobranca();
    sql(`delete from public.platform_config where chave = 'MODULO_CRM_B2B';`);
    expect(modulos("postgres", ORG_A)).toBe("{disparador,email_marketing}");
    sql(`insert into public.platform_config (chave, valor) values ('MODULO_CRM_B2B', 'ligado') on conflict (chave) do update set valor = 'ligado';`);
    expect(modulos("postgres", ORG_A)).toBe("{crm_b2b,disparador,email_marketing}");
  });

  it("⭐ a isenta (sem assinatura) não ganha módulo de plano; plano sem módulo não liga nada", () => {
    ligarCobranca();
    expect(modulos("postgres", ORG_B)).toBe("{}");
    expect(modulos("postgres", ORG_C)).toBe("{}");
  });

  it("a sessão pergunta só da própria empresa; anon não pergunta", () => {
    ligarCobranca();
    expect(modulos(ADMIN_A, ORG_A)).toContain("disparador");
    expect(modulos(ADMIN_A, ORG_C)).toBe("{}");
    expect(modulos("anon", ORG_A)).toBe("erro:42501");
  });
});

describe("plano assinado não perde módulo nem muda o preço por mensagem", () => {
  it("⭐ tirar módulo de plano assinado é recusado; acrescentar pode", () => {
    expect(como("postgres", `update public.mia_plano_modulos set modulos = array['disparador'] where plano_id = '${PRO}' returning 'ok'`)).toBe(
      "erro:23514",
    );
    expect(como("postgres", `update public.mia_plano_modulos set preco_por_mensagem_cents = 9 where plano_id = '${PRO}' returning 'ok'`)).toBe(
      "erro:23514",
    );
    // FORK MIA (.95, 9110): o preço por e-mail trava como o por mensagem.
    expect(como("postgres", `update public.mia_plano_modulos set preco_por_email_cents = 4 where plano_id = '${PRO}' returning 'ok'`)).toBe(
      "erro:23514",
    );
    expect(como("postgres", `delete from public.mia_plano_modulos where plano_id = '${PRO}' returning 'ok'`)).toBe("erro:23514");
    expect(
      como("postgres", `update public.mia_plano_modulos set modulos = array['disparador'] where plano_id = '${ESS}' returning 'ok'`),
    ).toBe("ok");
  });

  it("plano sem assinante muda à vontade; módulo fora do catálogo é recusado pelo CHECK", () => {
    expect(como("postgres", `update public.mia_plano_modulos set modulos = '{}', preco_por_mensagem_cents = null where plano_id = '${NOVO}' returning 'ok'`)).toBe(
      "ok",
    );
    expect(como("postgres", `update public.mia_plano_modulos set modulos = array['prospeccao'] where plano_id = '${NOVO}' returning 'ok'`)).toBe(
      "erro:23514",
    );
    // FORK MIA (.95, 9110): o preço por e-mail muda à vontade sem assinante; fora da faixa, o CHECK recusa.
    expect(como("postgres", `update public.mia_plano_modulos set preco_por_email_cents = 3 where plano_id = '${NOVO}' returning 'ok'`)).toBe("ok");
    expect(como("postgres", `update public.mia_plano_modulos set preco_por_email_cents = -1 where plano_id = '${NOVO}' returning 'ok'`)).toBe(
      "erro:23514",
    );
  });
});

describe("seguir o plano grava a diferença uma vez só", () => {
  it("⭐ liga, não repete, e desligar a cobrança registra o desligou", () => {
    ligarCobranca();
    const primeira = como("postgres", `select public.fn_mia_seguir_o_plano('${ORG_A}', 'rodada')::text`);
    expect(primeira).toContain('"acao": "ligou"');
    expect(como("postgres", `select public.fn_mia_seguir_o_plano('${ORG_A}', 'rodada')::text`)).toBe("[]");
    desligarCobranca();
    const depois = como("postgres", `select public.fn_mia_seguir_o_plano('${ORG_A}', 'rodada')::text`);
    expect(depois).toContain('"acao": "desligou"');
    expect(
      lastLine(sql(`select count(*) from public.mia_modulos_do_plano_registro where organization_id = '${ORG_A}' and acao = 'desligou';`)),
    ).toBe(lastLine(sql(`select count(*) from public.mia_modulos_do_plano_registro where organization_id = '${ORG_A}' and acao = 'ligou';`)));
  });

  it("a sessão não segue o plano por conta própria", () => {
    expect(como(ADMIN_A, `select public.fn_mia_seguir_o_plano('${ORG_A}', 'rodada')::text`)).toBe("erro:42501");
  });
});

describe("a origem nasce com a empresa", () => {
  it("⭐ cadastro próprio, implantação pela plataforma e sem autor", () => {
    expect(lastLine(sql(`select origem from public.mia_origem_da_empresa where organization_id = '${ORG_A}';`))).toBe("cadastro");
    expect(lastLine(sql(`select origem from public.mia_origem_da_empresa where organization_id = '${ORG_B}';`))).toBe("implantacao");
    expect(lastLine(sql(`select origem from public.mia_origem_da_empresa where organization_id = '${ORG_C}';`))).toBe("implantacao");
  });
});

describe("a compra de crédito paga entra na carteira uma vez", () => {
  it("⭐ confirmar duas vezes lança um crédito só", () => {
    sql(`insert into public.mia_compras_de_creditos (id, organization_id, valor_cents, status, pagamento_ref, modo)
           values ('${COMPRA}', '${ORG_A}', 10000, 'aguardando', 'pay_inv_9072', 'teste') on conflict (id) do nothing;`);
    expect(como("postgres", `select public.fn_mia_confirmar_compra_de_creditos('${COMPRA}', now())->>'mudou'`)).toBe("true");
    expect(como("postgres", `select public.fn_mia_confirmar_compra_de_creditos('${COMPRA}', now())->>'mudou'`)).toBe("false");
    expect(
      lastLine(
        sql(`select count(*)::text || ':' || sum(amount_cents)::text from public.tenant_wallet_ledger
              where organization_id = '${ORG_A}' and ref_kind = 'compra_pix' and ref_id = '${COMPRA}';`),
      ),
    ).toBe("1:10000");
    expect(lastLine(sql(`select status from public.mia_compras_de_creditos where id = '${COMPRA}';`))).toBe("paga");
  });

  it("a sessão não confirma compra", () => {
    expect(como(ADMIN_A, `select public.fn_mia_confirmar_compra_de_creditos('${COMPRA}', now())::text`)).toBe("erro:42501");
  });
});

describe("as tabelas novas são só do servidor", () => {
  it("RLS ligada em todas, sem política", () => {
    for (const t of TABELAS) {
      expect(lastLine(sql(`select relrowsecurity::text from pg_class where oid = 'public.${t}'::regclass;`)), t).toBe("true");
      expect(lastLine(sql(`select count(*) from pg_policies where schemaname = 'public' and tablename = '${t}';`)), t).toBe("0");
    }
  });

  it("⭐ authenticated (até o admin da empresa) e anon recebem permission denied", () => {
    for (const t of TABELAS) {
      expect(como(ADMIN_A, `select count(*)::text from public.${t}`), t).toBe("erro:42501");
      expect(como("anon", `select count(*)::text from public.${t}`), t).toBe("erro:42501");
    }
  });
});
