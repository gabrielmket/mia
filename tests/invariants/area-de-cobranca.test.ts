import { describe, expect, it, beforeAll } from "vitest";

import { criarOrg, criarPlano, criarUsuarios, valor } from "./cobranca-helpers";
import { lastLine, sql } from "./gov-helpers";

/**
 * FORK MIA (9125 e 9126) · A ÁREA DE COBRANÇA E O LADO DA TIME NO BANCO (.96,
 * segunda frente; docs/fork/area-de-cobranca.md).
 *
 * Contra o Postgres de verdade:
 *   - 9125, o cartão das mensalidades: só o servidor lê e escreve (o admin da
 *     empresa e anon recebem permission denied), o banco recusa mais que o final
 *     de 4 números, e a empresa redigida perde a linha (LGPD);
 *   - 9126, o funil: conta quem escolheu um plano, quem nasceu pelo cadastro,
 *     quem pagou, quem espera e quem está sem pagamento há mais de 30 dias; só o
 *     servidor executa;
 *   - 9126, o preparo do "Apagar o cadastro": só a empresa que espera o primeiro
 *     pagamento há 30 dias ou mais e nunca pagou; a suspensão de cobrança vira
 *     administrativa, de novo é "ja_preparada", e a EXCLUSÃO DO UPSTREAM
 *     (`fn_excluir_organizacao`, 0614) aceita apagar a empresa preparada; as
 *     recusas; só o servidor executa.
 */

const ADMIN = "91259125-1111-4000-8000-0000000000a1";
const QUEM_ESCOLHEU = "91259125-1111-4000-8000-0000000000a2";
const ORG_CARTAO = "91259125-0000-4000-8000-00000000000a";
const ORG_VELHA = "91269126-0000-4000-8000-00000000000a";
const ORG_NOVA = "91269126-0000-4000-8000-00000000000b";
const ORG_PAGOU = "91269126-0000-4000-8000-00000000000c";
const PLANO = "91269126-2222-4000-8000-000000000001";

/** Um comando como `usuario` (`anon` ou o uuid de alguém): a última linha, ou o SQLSTATE. */
function como(usuario: string, comando: string): string {
  const papel = usuario === "anon" ? "anon" : "authenticated";
  const claims = papel === "authenticated" ? `select set_config('request.jwt.claims', '{"sub":"${usuario}","role":"authenticated"}', false);` : "";
  return lastLine(
    sql(`
      set role ${papel};
      ${claims}
      do $$
      declare r text;
      begin
        begin
          execute $q$ ${comando} $q$ into r;
          perform set_config('inv.r9125', coalesce(r, '<null>'), false);
        exception when others then
          perform set_config('inv.r9125', 'erro:' || sqlstate, false);
        end;
      end $$;
      select current_setting('inv.r9125');
    `),
  );
}

/** Como o servidor (service_role): a última linha, ou o SQLSTATE. */
function comoServidor(comando: string): string {
  return lastLine(
    sql(`
      set role service_role;
      do $$
      declare r text;
      begin
        begin
          execute $q$ ${comando} $q$ into r;
          perform set_config('inv.s9126', coalesce(r, '<null>'), false);
        exception when others then
          perform set_config('inv.s9126', 'erro:' || sqlstate, false);
        end;
      end $$;
      select current_setting('inv.s9126');
    `),
  );
}

const preparar = (org: string, dias = 30) =>
  comoServidor(`select public.fn_mia_cadastro_sem_pagamento_para_apagar('${org}', null, ${dias})->>'motivo'`);

/** A empresa que espera o primeiro pagamento, parada pela cobrança como o gatilho da entrada paga deixa. */
function esperandoOPagamento(org: string, slug: string, diasAtras: number, pago = false): void {
  // `created_by` nulo: o gatilho da entrada paga do upstream não cria a assinatura sozinho.
  criarOrg(org, slug, null);
  sql(`update public.organizations set created_at = now() - interval '${diasAtras} days' where id = '${org}';`);
  sql(`insert into public.mia_origem_da_empresa (organization_id, origem) values ('${org}', 'cadastro')
         on conflict (organization_id) do update set origem = 'cadastro';`);
  sql(`insert into public.cobranca_assinaturas (organization_id, plano_id, estado, trial_ate, pagamento_inicial_pendente, periodo_pago_desde)
         values ('${org}', '${PLANO}', 'trial', now(), true, ${pago ? "now() - interval '5 days'" : "null"})
         on conflict (organization_id) do nothing;`);
  sql(`select public.fn_suspender_organizacao('${org}', 'cobranca', 'Aguardando o primeiro pagamento', null);`);
}

beforeAll(() => {
  // Sem PII real: e-mails sintéticos (LGPD).
  criarUsuarios([
    [ADMIN, "area-cobranca-admin@invariant.test"],
    [QUEM_ESCOLHEU, "area-cobranca-escolheu@invariant.test"],
  ]);
  sql(`update auth.users set raw_user_meta_data = jsonb_build_object('cobranca_plan_id', '${PLANO}'), created_at = now()
         where id = '${QUEM_ESCOLHEU}';`);
  criarOrg(ORG_CARTAO, "area-cobranca-cartao", null);
  sql(`insert into public.user_organizations (user_id, organization_id, role, accepted_at)
         values ('${ADMIN}', '${ORG_CARTAO}', 'admin', now()) on conflict do nothing;`);
  sql(`insert into public.mia_cartao_das_mensalidades (organization_id, cartao_final, cartao_bandeira, assinatura_ref, trocado_por)
         values ('${ORG_CARTAO}', '4821', 'VISA', 'sub_inv_1', '${ADMIN}') on conflict (organization_id) do nothing;`);
  criarPlano({ id: PLANO, nome: "Entrada paga (inv 9126)", trialDias: 0 });
  esperandoOPagamento(ORG_VELHA, "area-cobranca-velha", 40);
  esperandoOPagamento(ORG_NOVA, "area-cobranca-nova", 10);
  esperandoOPagamento(ORG_PAGOU, "area-cobranca-pagou", 40, true);
});

describe("9125: o cartão das mensalidades", () => {
  it("⭐ só o servidor: o admin da própria empresa e anon recebem permission denied", () => {
    expect(como(ADMIN, `select count(*)::text from public.mia_cartao_das_mensalidades`)).toBe("erro:42501");
    expect(como("anon", `select count(*)::text from public.mia_cartao_das_mensalidades`)).toBe("erro:42501");
    expect(comoServidor(`select cartao_final from public.mia_cartao_das_mensalidades where organization_id = '${ORG_CARTAO}'`)).toBe("4821");
  });

  it("⭐ do cartão, o banco só aceita o final de 4 números", () => {
    expect(
      comoServidor(`update public.mia_cartao_das_mensalidades set cartao_final = '4111111111111111' where organization_id = '${ORG_CARTAO}' returning 'ok'`),
    ).toBe("erro:23514");
    expect(comoServidor(`update public.mia_cartao_das_mensalidades set cartao_bandeira = 'visa' where organization_id = '${ORG_CARTAO}' returning 'ok'`)).toBe(
      "erro:23514",
    );
  });

  it("LGPD: a empresa redigida perde o cartão das mensalidades", () => {
    sql(`update public.organizations set status = 'redacted' where id = '${ORG_CARTAO}';`);
    expect(valor(`select count(*) from public.mia_cartao_das_mensalidades where organization_id = '${ORG_CARTAO}';`)).toBe("0");
  });
});

describe("9126: o funil do cadastro", () => {
  it("⭐ conta quem escolheu um plano, quem espera, quem pagou e quem está sem pagamento há mais de 30 dias", () => {
    const funil = JSON.parse(comoServidor(`select public.fn_mia_funil_do_cadastro(now() - interval '30 days')::text`)) as Record<string, number>;
    expect(Object.keys(funil).sort()).toEqual(
      ["criaram_conta", "escolheram_plano", "esperando_pagamento", "pagaram", "sem_pagamento_ha_mais_de_30_dias"].sort(),
    );
    expect(funil.escolheram_plano).toBeGreaterThanOrEqual(1);
    // A nova (10 dias) está na janela e espera; a velha (40 dias) está fora dela e sem pagamento.
    expect(funil.criaram_conta).toBeGreaterThanOrEqual(1);
    expect(funil.esperando_pagamento).toBeGreaterThanOrEqual(1);
    expect(funil.sem_pagamento_ha_mais_de_30_dias).toBeGreaterThanOrEqual(1);
    // A que pagou (40 dias) não conta como sem pagamento.
    const semAntes = funil.sem_pagamento_ha_mais_de_30_dias ?? 0;
    sql(`update public.cobranca_assinaturas set periodo_pago_desde = null where organization_id = '${ORG_PAGOU}';`);
    const depois = JSON.parse(comoServidor(`select public.fn_mia_funil_do_cadastro(now() - interval '30 days')::text`)) as Record<string, number>;
    expect(depois.sem_pagamento_ha_mais_de_30_dias).toBe(semAntes + 1);
    sql(`update public.cobranca_assinaturas set periodo_pago_desde = now() - interval '5 days' where organization_id = '${ORG_PAGOU}';`);
  });

  it("só o servidor executa", () => {
    expect(como(ADMIN, `select public.fn_mia_funil_do_cadastro(now())::text`)).toBe("erro:42501");
    expect(como("anon", `select public.fn_mia_funil_do_cadastro(now())::text`)).toBe("erro:42501");
  });
});

describe("9126: o preparo do Apagar o cadastro", () => {
  it("as recusas: antes de 30 dias, quem pagou, prazo menor que 30", () => {
    expect(preparar(ORG_NOVA)).toBe("antes_do_prazo");
    expect(preparar(ORG_PAGOU)).toBe("ja_pagou");
    expect(preparar(ORG_VELHA, 7)).toBe("erro:22023");
    expect(valor(`select suspended_kind from public.organizations where id = '${ORG_NOVA}';`)).toBe("cobranca");
  });

  it("só o servidor executa: a sessão e anon recebem permission denied", () => {
    expect(como(ADMIN, `select public.fn_mia_cadastro_sem_pagamento_para_apagar('${ORG_VELHA}', null, 30)::text`)).toBe("erro:42501");
    expect(como("anon", `select public.fn_mia_cadastro_sem_pagamento_para_apagar('${ORG_VELHA}', null, 30)::text`)).toBe("erro:42501");
  });

  it("⭐ a empresa sem pagamento há 40 dias: a suspensão vira administrativa, de novo é 'ja_preparada', e a exclusão do upstream aceita apagar", () => {
    expect(preparar(ORG_VELHA)).toBe("preparada");
    expect(valor(`select status || '|' || suspended_kind || '|' || suspended_reason from public.organizations where id = '${ORG_VELHA}';`)).toBe(
      "suspended|administrativa|Cadastro sem pagamento: apagado pela Time",
    );
    expect(preparar(ORG_VELHA)).toBe("ja_preparada");
    // A trava da 0614 (suspensão de cobrança desde o início da suspensão atual) não recusa mais.
    expect(
      comoServidor(
        `select public.fn_excluir_organizacao('${ORG_VELHA}', '${ADMIN}', 'area-cobranca-velha', 'Cadastro sem pagamento há 40 dias: prova da 9126', null)->>'slug'`,
      ),
    ).toBe("area-cobranca-velha");
    expect(valor(`select count(*) from public.organizations where id = '${ORG_VELHA}';`)).toBe("0");
  });

  it("controle: sem o preparo, a exclusão do upstream recusa a empresa parada pela cobrança", () => {
    expect(
      comoServidor(`select public.fn_excluir_organizacao('${ORG_NOVA}', '${ADMIN}', 'area-cobranca-nova', 'Controle da prova da 9126 sem preparo', null)->>'slug'`),
    ).toBe("erro:PT409");
  });
});
