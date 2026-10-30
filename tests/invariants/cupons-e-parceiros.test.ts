import { beforeAll, describe, expect, it } from "vitest";

import { chaveDeCobranca, criarUsuarios } from "./cobranca-helpers";
import { lastLine, sql } from "./gov-helpers";

/**
 * FORK MIA (.98) · CUPONS, PARCEIROS E COMISSÃO NO BANCO (migrations 9130 a 9132;
 * docs/fork/cupons-e-parceiros.md).
 *
 * O que só o Postgres responde:
 *   - os dados do parceiro e tudo o que é de dinheiro são só do servidor: anon
 *     recebe permission denied, e a sessão de um administrador de empresa também
 *     (com o controle positivo: a linha existe, o `postgres` vê);
 *   - a régua única `fn_mia_aplicar_cupom`: inexistente, pausado, vencido, esgotado,
 *     fora do plano, plano escondido, um cupom por cliente, já pagou (só a Time troca);
 *   - dias grátis: o teste do plano, vale o MAIOR, sem somar; a entrada paga vira
 *     teste e a empresa é liberada; tirar o cupom devolve a empresa ao plano;
 *   - a passagem do cadastro: o gatilho ADIADO aplica o cupom DEPOIS de o gatilho da
 *     entrada paga do upstream criar a assinatura, e cupom que não vale mais só some;
 *   - cupom usado não se apaga; sem anexo, o repasse não vira pago; LGPD do parceiro.
 */

const PLANO_ENTRADA = "91300000-0000-4000-8000-000000000001";
const PLANO_TESTE = "91300000-0000-4000-8000-000000000002";
const PLANO_ESCONDIDO = "91300000-0000-4000-8000-000000000003";
const PARCEIRO = "91300000-0000-4000-8000-0000000000a1";
const USUARIO = "91300000-1111-4000-8000-000000000001";
const VIZINHO = "91300000-1111-4000-8000-000000000002";

let seq = 0;
const novaOrg = () => {
  seq += 1;
  return `91300000-2222-4000-8000-${String(seq).padStart(12, "0")}`;
};

function aplicar(org: string, codigo: string, origem = "pagamento"): Record<string, unknown> {
  return JSON.parse(lastLine(sql(`select public.fn_mia_aplicar_cupom('${org}', '${codigo}', '${origem}', null)::text;`))) as Record<string, unknown>;
}

/** Uma empresa com assinatura, sem passar pelo gatilho do upstream (created_by nulo). */
function empresa(plano: string, o: { pendente?: boolean; trial?: string; pagou?: boolean } = {}): string {
  const org = novaOrg();
  sql(`
    insert into public.organizations (id, slug, display_name, legal_name, status)
      values ('${org}', 'cupom-${org.slice(-6)}', 'x', 'x', 'active');
    insert into public.cobranca_assinaturas (organization_id, plano_id, estado, trial_ate, pagamento_inicial_pendente, proximo_vencimento, created_at)
      values ('${org}', '${plano}', 'trial', ${o.trial ?? "now()"}, ${o.pendente === true}, ${o.pagou ? "now() + interval '20 days'" : "null"}, now());
  `);
  if (o.pendente) sql(`select public.fn_suspender_organizacao('${org}', 'cobranca', 'Aguardando o primeiro pagamento', null);`);
  return org;
}

beforeAll(() => {
  criarUsuarios([
    [USUARIO, "cupom-a@invariant.test"],
    [VIZINHO, "cupom-b@invariant.test"],
  ]);
  chaveDeCobranca("ligado");
  sql(`
    insert into public.cobranca_planos (id, nome, preco_cents, intervalo, trial_dias, oferecido_ao_cliente) values
      ('${PLANO_ENTRADA}', 'Entrada 9130', 59700, 'mes', 0, true),
      ('${PLANO_TESTE}', 'Teste 9130', 59700, 'mes', 14, true),
      ('${PLANO_ESCONDIDO}', 'Escondido 9130', 59700, 'mes', 0, false)
    on conflict (id) do nothing;
    insert into public.mia_parceiros (id, nome, tipo_documento, documento, email, chave_pix, comissao_pct, comissao_meses, comissao_setup_pct)
      values ('${PARCEIRO}', 'Parceira 9130', 'cpf', '52998224725', 'parceira@invariant.test', 'parceira@invariant.test', 20, 12, 30)
    on conflict (id) do nothing;
    insert into public.mia_cupons (codigo, beneficio, valor, meses, planos, parceiro_id, setup_tipo, setup_valor) values
      ('DEZ9130', 'pct', 10, 3, array['${PLANO_ENTRADA}','${PLANO_TESTE}']::uuid[], '${PARCEIRO}', 'pct', 20),
      ('DIAS30', 'dias', 30, null, array['${PLANO_ENTRADA}','${PLANO_TESTE}']::uuid[], null, 'nenhum', 0),
      ('DIAS7', 'dias', 7, null, array['${PLANO_TESTE}']::uuid[], null, 'nenhum', 0),
      ('SOTESTE', 'pct', 10, null, array['${PLANO_TESTE}']::uuid[], null, 'nenhum', 0),
      ('UMUSO', 'pct', 10, null, array['${PLANO_ENTRADA}','${PLANO_TESTE}','${PLANO_ESCONDIDO}']::uuid[], null, 'nenhum', 0)
    on conflict do nothing;
    update public.mia_cupons set limite_de_usos = 1 where codigo = 'UMUSO';
    insert into public.mia_cupons (codigo, beneficio, valor, meses, planos, ativo) values
      ('PAUSADO1', 'pct', 10, null, array['${PLANO_ENTRADA}']::uuid[], false)
    on conflict do nothing;
    insert into public.mia_cupons (codigo, beneficio, valor, meses, planos, vale_ate) values
      ('VENCIDO1', 'pct', 10, null, array['${PLANO_ENTRADA}']::uuid[], current_date - 10)
    on conflict do nothing;
  `);
});

describe("o isolamento: só o servidor", () => {
  const TABELAS = [
    "mia_parceiros",
    "mia_cupons",
    "mia_cupom_da_empresa",
    "mia_cupom_do_cadastro",
    "mia_plano_setup",
    "mia_setup_da_empresa",
    "mia_comissoes",
    "mia_repasses",
  ];

  it.each(TABELAS)("%s: RLS ligada, sem política, e nem anon nem a sessão leem", (tabela) => {
    expect(sql(`select relrowsecurity::text from pg_class where oid = 'public.${tabela}'::regclass;`)).toBe("true");
    expect(sql(`select count(*) from pg_policies where schemaname = 'public' and tablename = '${tabela}';`)).toBe("0");
    expect(sql(`select has_table_privilege('anon', 'public.${tabela}', 'select')::text || '|' || has_table_privilege('authenticated', 'public.${tabela}', 'select')::text;`)).toBe("false|false");
    for (const papel of ["anon", "authenticated"]) {
      expect(() => sql(`set role ${papel}; select count(*) from public.${tabela};`)).toThrow(/permission denied/);
    }
  });

  it("a empresa do cliente não alcança o próprio cupom pela sessão (controle positivo: a linha existe)", () => {
    const org = empresa(PLANO_ENTRADA, { pendente: true });
    expect(aplicar(org, "DEZ9130").ok).toBe(true);
    expect(sql(`select count(*) from public.mia_cupom_da_empresa where organization_id = '${org}';`)).toBe("1");
    sql(`insert into public.user_organizations (user_id, organization_id, role, accepted_at) values ('${USUARIO}', '${org}', 'admin', now());`);
    expect(() =>
      sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${USUARIO}"}', false); select count(*) from public.mia_cupom_da_empresa;`),
    ).toThrow(/permission denied/);
    for (const papel of ["anon", "authenticated"]) {
      expect(sql(`select has_function_privilege('${papel}', 'public.fn_mia_aplicar_cupom(uuid, text, text, uuid)', 'execute')::text;`)).toBe("false");
      expect(sql(`select has_function_privilege('${papel}', 'public.fn_mia_anonimizar_parceiro(uuid, uuid)', 'execute')::text;`)).toBe("false");
      expect(sql(`select has_function_privilege('${papel}', 'public.fn_mia_tirar_cupom(uuid, uuid)', 'execute')::text;`)).toBe("false");
    }
  });
});

describe("a régua do cupom (fn_mia_aplicar_cupom)", () => {
  it("inexistente, pausado, vencido e fora do plano recusam com o motivo", () => {
    const org = empresa(PLANO_ENTRADA, { pendente: true });
    expect(aplicar(org, "NAOEXISTE")).toMatchObject({ ok: false, motivo: "inexistente" });
    expect(aplicar(org, "PAUSADO1")).toMatchObject({ ok: false, motivo: "pausado" });
    expect(aplicar(org, "VENCIDO1")).toMatchObject({ ok: false, motivo: "vencido" });
    expect(aplicar(org, "SOTESTE")).toMatchObject({ ok: false, motivo: "fora_do_plano" });
    expect(sql(`select count(*) from public.mia_cupom_da_empresa where organization_id = '${org}';`)).toBe("0");
  });

  it("plano escondido não aceita cupom, mesmo com o plano na lista", () => {
    const org = empresa(PLANO_ESCONDIDO, { pendente: true });
    expect(aplicar(org, "UMUSO")).toMatchObject({ ok: false, motivo: "plano_escondido" });
  });

  it("o limite de usos é respeitado: o segundo recebe esgotado", () => {
    const a = empresa(PLANO_ENTRADA, { pendente: true });
    const b = empresa(PLANO_ENTRADA, { pendente: true });
    expect(aplicar(a, "UMUSO").ok).toBe(true);
    expect(aplicar(b, "UMUSO")).toMatchObject({ ok: false, motivo: "esgotado" });
  });

  it("um cupom por cliente; repetir o mesmo não faz nada", () => {
    const org = empresa(PLANO_ENTRADA, { pendente: true });
    expect(aplicar(org, "DEZ9130")).toMatchObject({ ok: true, ja_estava: false });
    expect(aplicar(org, "DEZ9130")).toMatchObject({ ok: true, ja_estava: true });
    expect(aplicar(org, "DIAS30")).toMatchObject({ ok: false, motivo: "ja_tem_cupom" });
  });

  it("guarda o retrato do combinado e o parceiro do cupom; a comissão fica para o primeiro pagamento", () => {
    const org = empresa(PLANO_ENTRADA, { pendente: true });
    aplicar(org, "DEZ9130");
    expect(
      sql(`select codigo || '|' || beneficio || '|' || valor || '|' || meses || '|' || setup_tipo || '|' || parceiro_id || '|' || (termos_fixados_em is null)::text
             from public.mia_cupom_da_empresa where organization_id = '${org}';`),
    ).toBe(`DEZ9130|pct|10.00|3|pct|${PARCEIRO}|true`);
    // Mudar o cupom depois não mexe no combinado de quem já entrou.
    sql(`update public.mia_cupons set valor = 50 where codigo = 'DEZ9130';`);
    expect(sql(`select valor::text from public.mia_cupom_da_empresa where organization_id = '${org}';`)).toBe("10.00");
    sql(`update public.mia_cupons set valor = 10 where codigo = 'DEZ9130';`);
  });

  it("depois de pago, o cliente não troca; a Time troca", () => {
    const org = empresa(PLANO_ENTRADA, { pagou: true });
    expect(aplicar(org, "DEZ9130")).toMatchObject({ ok: false, motivo: "ja_pagou" });
    expect(aplicar(org, "DEZ9130", "time")).toMatchObject({ ok: true, trocou: false });
    expect(aplicar(org, "SOTESTE", "time")).toMatchObject({ ok: false, motivo: "fora_do_plano" });
    expect(aplicar(org, "DIAS30", "pagamento")).toMatchObject({ ok: false, motivo: "ja_tem_cupom" });
    expect(aplicar(org, "DIAS30", "time")).toMatchObject({ ok: true, trocou: true, dias_aplicados: null });
    // Dias grátis não valem para quem já pagou: o estado não muda.
    expect(sql(`select pagamento_inicial_pendente::text from public.cobranca_assinaturas where organization_id = '${org}';`)).toBe("false");
  });
});

describe("dias grátis: o mesmo teste do plano, vale o maior", () => {
  it("entrada paga com cupom de dias: vira teste e a empresa é liberada", () => {
    const org = empresa(PLANO_ENTRADA, { pendente: true });
    expect(sql(`select status from public.organizations where id = '${org}';`)).toBe("suspended");
    expect(aplicar(org, "DIAS30")).toMatchObject({ ok: true, dias_aplicados: 30 });
    expect(
      sql(`select estado || '|' || pagamento_inicial_pendente::text || '|' || (trial_ate between now() + interval '29 days' and now() + interval '31 days')::text
             from public.cobranca_assinaturas where organization_id = '${org}';`),
    ).toBe("trial|false|true");
    expect(sql(`select status from public.organizations where id = '${org}';`)).toBe("active");
  });

  it("plano com teste maior que o cupom: fica o do plano, sem somar", () => {
    const org = empresa(PLANO_TESTE, { trial: "now() + interval '14 days'" });
    const antes = sql(`select trial_ate::text from public.cobranca_assinaturas where organization_id = '${org}';`);
    expect(aplicar(org, "DIAS7")).toMatchObject({ ok: true, dias_aplicados: null });
    expect(sql(`select trial_ate::text from public.cobranca_assinaturas where organization_id = '${org}';`)).toBe(antes);
  });

  it("plano com teste menor que o cupom: fica o do cupom, sem somar", () => {
    const org = empresa(PLANO_TESTE, { trial: "now() + interval '14 days'" });
    expect(aplicar(org, "DIAS30")).toMatchObject({ ok: true, dias_aplicados: 30 });
    expect(sql(`select (trial_ate < now() + interval '31 days' and trial_ate > now() + interval '29 days')::text from public.cobranca_assinaturas where organization_id = '${org}';`)).toBe("true");
  });

  it("tirar o cupom antes de pagar devolve a empresa ao plano", () => {
    const entrada = empresa(PLANO_ENTRADA, { pendente: true });
    aplicar(entrada, "DIAS30");
    expect(JSON.parse(lastLine(sql(`select public.fn_mia_tirar_cupom('${entrada}', null)::text;`)))).toMatchObject({ ok: true, mudou: true, tinha_dias: true });
    expect(sql(`select pagamento_inicial_pendente::text from public.cobranca_assinaturas where organization_id = '${entrada}';`)).toBe("true");
    expect(sql(`select status || '|' || suspended_kind from public.organizations where id = '${entrada}';`)).toBe("suspended|cobranca");
    const comTeste = empresa(PLANO_TESTE, { trial: "now() + interval '14 days'" });
    aplicar(comTeste, "DIAS30");
    sql(`select public.fn_mia_tirar_cupom('${comTeste}', null);`);
    expect(sql(`select (trial_ate < now() + interval '15 days')::text from public.cobranca_assinaturas where organization_id = '${comTeste}';`)).toBe("true");
    const pagou = empresa(PLANO_ENTRADA, { pagou: true });
    aplicar(pagou, "DEZ9130", "time");
    expect(JSON.parse(lastLine(sql(`select public.fn_mia_tirar_cupom('${pagou}', null)::text;`)))).toMatchObject({ ok: false, motivo: "ja_pagou" });
  });
});

describe("a passagem do cadastro", () => {
  function nascer(usuario: string, plano: string): string {
    const org = novaOrg();
    sql(`insert into public.organizations (id, slug, display_name, legal_name, status, created_by, settings)
           values ('${org}', 'nasce-${org.slice(-6)}', 'x', 'x', 'active', '${usuario}', '{"cobranca_signup_plan_id": "${plano}"}'::jsonb);`);
    return org;
  }

  it("o cupom de dias num plano de entrada paga: a empresa nasce no teste, liberada", () => {
    sql(`insert into public.mia_cupom_do_cadastro (user_id, codigo) values ('${USUARIO}', 'DIAS30') on conflict (user_id) do update set codigo = excluded.codigo;`);
    const org = nascer(USUARIO, PLANO_ENTRADA);
    expect(sql(`select codigo from public.mia_cupom_da_empresa where organization_id = '${org}';`)).toBe("DIAS30");
    expect(sql(`select pagamento_inicial_pendente::text || '|' || (trial_ate > now() + interval '29 days')::text from public.cobranca_assinaturas where organization_id = '${org}';`)).toBe("false|true");
    expect(sql(`select status from public.organizations where id = '${org}';`)).toBe("active");
    expect(sql(`select count(*) from public.mia_cupom_do_cadastro where user_id = '${USUARIO}';`)).toBe("0");
  });

  it("o cupom de desconto: a entrada paga segue esperando o pagamento, com o cupom ligado", () => {
    sql(`insert into public.mia_cupom_do_cadastro (user_id, codigo) values ('${VIZINHO}', 'DEZ9130') on conflict (user_id) do update set codigo = excluded.codigo;`);
    const org = nascer(VIZINHO, PLANO_ENTRADA);
    expect(sql(`select codigo || '|' || parceiro_id || '|' || origem from public.mia_cupom_da_empresa where organization_id = '${org}';`)).toBe(`DEZ9130|${PARCEIRO}|cadastro`);
    expect(sql(`select status from public.organizations where id = '${org}';`)).toBe("suspended");
  });

  it("cupom que não vale mais só some: a empresa nasce sem ele", () => {
    sql(`insert into public.mia_cupom_do_cadastro (user_id, codigo) values ('${USUARIO}', 'VENCIDO1') on conflict (user_id) do update set codigo = excluded.codigo;`);
    const org = nascer(USUARIO, PLANO_ENTRADA);
    expect(sql(`select count(*) from public.mia_cupom_da_empresa where organization_id = '${org}';`)).toBe("0");
    expect(sql(`select count(*) from public.mia_cupom_do_cadastro where user_id = '${USUARIO}';`)).toBe("0");
    expect(sql(`select count(*) from public.cobranca_assinaturas where organization_id = '${org}';`)).toBe("1");
  });
});

describe("o que não pode", () => {
  it("cupom usado não se apaga", () => {
    const org = empresa(PLANO_ENTRADA, { pendente: true });
    sql(`insert into public.mia_cupons (codigo, beneficio, valor, planos) values ('USADO1', 'pct', 5, array['${PLANO_ENTRADA}']::uuid[]) on conflict do nothing;`);
    aplicar(org, "USADO1");
    expect(() => sql(`delete from public.mia_cupons where codigo = 'USADO1';`)).toThrow(/foreign key|violates/);
  });

  it("sem o anexo, o repasse não vira pago", () => {
    const id = lastLine(sql(`insert into public.mia_repasses (parceiro_id, competencia, total_cents) values ('${PARCEIRO}', '2026-09-01', 1000) returning id;`).split("\n")[0] ?? "");
    expect(() => sql(`update public.mia_repasses set pago_em = now() where id = '${id}';`)).toThrow(/mia_repasses_pago_com_anexo/);
    sql(`update public.mia_repasses set anexo_path = 'a/b.pdf', anexo_em = now() where id = '${id}';`);
    sql(`update public.mia_repasses set pago_em = now() where id = '${id}';`);
    expect(sql(`select (pago_em is not null)::text from public.mia_repasses where id = '${id}';`)).toBe("true");
  });

  it("uma comissão por cobrança e tipo; o estorno é negativo e aponta o original", () => {
    const org = empresa(PLANO_ENTRADA, { pagou: true });
    const linha = (tipo: string, extra = "null", sinal = 1) => `
      insert into public.mia_comissoes (parceiro_id, organization_id, tipo, pagamento_ref, estorno_de, pago_em, competencia, valor_pago_cents, aliquota_pct, imposto_cents, taxa_cents, liquido_cents, comissao_pct, comissao_cents)
      values ('${PARCEIRO}', '${org}', '${tipo}', 'pay_9130', ${extra}, '2026-09-10', '2026-09-01', ${sinal * 10000}, 10, ${sinal * 1000}, ${sinal * 100}, ${sinal * 8900}, 20, ${sinal * 1780}) returning id;`;
    const id = lastLine(sql(linha("mensalidade")).split("\n")[0] ?? "");
    expect(() => sql(linha("mensalidade"))).toThrow(/mia_comissoes_uma_por_cobranca/);
    expect(() => sql(linha("estorno"))).toThrow(/mia_comissoes_estorno/);
    sql(linha("estorno", `'${id}'`, -1));
    expect(sql(`select sum(comissao_cents)::text from public.mia_comissoes where pagamento_ref = 'pay_9130';`)).toBe("0");
    // A empresa apagada não leva o lançamento: é registro financeiro.
    expect(sql(`select confdeltype from pg_constraint where conname = 'mia_comissoes_organization_id_fkey';`)).toBe("n");
  });

  it("o bucket dos anexos é privado e sem política", () => {
    expect(sql(`select public::text from storage.buckets where id = 'mia-repasses';`)).toBe("false");
    expect(
      sql(`select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
            and (coalesce(qual, '') || coalesce(with_check, '')) like '%mia-repasses%';`),
    ).toBe("0");
  });
});

describe("LGPD do parceiro", () => {
  it("anonimizar apaga a pessoa e o anexo, e os valores ficam", () => {
    const parceiro = lastLine(
      sql(`insert into public.mia_parceiros (nome, tipo_documento, documento, email, chave_pix, comissao_pct, comissao_setup_pct)
             values ('Pessoa Para Apagar', 'cpf', '39053344705', 'apagar@invariant.test', '31988881111', 10, 10) returning id;`).split("\n")[0] ?? "",
    );
    const repasse = lastLine(
      sql(`insert into public.mia_repasses (parceiro_id, competencia, total_cents, anexo_path, anexo_nome, anexo_em)
             values ('${parceiro}', '2026-08-01', 5000, 'x/y.pdf', 'recibo.pdf', now()) returning id;`).split("\n")[0] ?? "",
    );
    expect(JSON.parse(lastLine(sql(`select public.fn_mia_anonimizar_parceiro('${parceiro}', null)::text;`)))).toMatchObject({ ok: true, anexos_removidos: 1 });
    expect(
      sql(`select nome || '|' || (documento is null)::text || '|' || (email is null)::text || '|' || (chave_pix is null)::text || '|' || ativo::text || '|' || (anonimizado_em is not null)::text
             from public.mia_parceiros where id = '${parceiro}';`),
    ).toBe("Parceiro anonimizado|true|true|true|false|true");
    expect(sql(`select (anexo_path is null)::text || '|' || (anexo_nome is null)::text || '|' || (anexo_removido_em is not null)::text || '|' || total_cents from public.mia_repasses where id = '${repasse}';`)).toBe(
      "true|true|true|5000",
    );
  });

  it("o parceiro anonimizado libera o documento para um cadastro novo (a chave única é só de quem tem documento)", () => {
    sql(`insert into public.mia_parceiros (nome, tipo_documento, documento, email, chave_pix, comissao_pct, comissao_setup_pct)
           values ('Outra Pessoa', 'cpf', '39053344705', 'outra@invariant.test', 'outra', 10, 10);`);
    expect(sql(`select count(*) from public.mia_parceiros where documento = '39053344705';`)).toBe("1");
  });
});
