/**
 * FORK MIA (.98) · O cupom e o setup no passo "Pagamento" e no cadastro
 * (lib/cupons/no-passo.ts, lib/cupons/cadastro.ts, lib/setup-de-implantacao/servico.ts).
 * Banco em memória; o Asaas real nunca é chamado.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/instalacao/modulos", async (original) => ({
  ...(await original<typeof import("@/lib/instalacao/modulos")>()),
  moduloLigado: async () => true,
}));
vi.mock("@/lib/cobranca/sincronizar", () => ({ sincronizar: vi.fn(async () => ({ tipo: "isenta" })) }));
vi.mock("@/lib/cobranca/checkout", () => ({ gerarLinkDePagamento: vi.fn(async () => ({ ok: true, url: "https://x" })) }));

import { aplicarCupomNoPasso, escolherSetupNoPasso, tirarCupomNoPasso } from "@/lib/cupons/no-passo";
import { conferirCupomDoCadastro } from "@/lib/cupons/cadastro";
import { lerPassoDoPagamento } from "@/lib/pagamento-inicial/servico";
import { conferirSetup, desistirDoSetup, gravarPrecoDoSetup, pagarSetupComOMesmoCartao, pedirSetup, precoDoSetup } from "@/lib/setup-de-implantacao/servico";

import { asaasFalso, CHAVE_DE_TESTE } from "../helpers/asaas-falso";
import { bancoEmMemoria, type Linha } from "../helpers/banco-em-memoria";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "99999999-9999-4999-8999-999999999999";
const PLANO = "22222222-2222-4222-8222-222222222222";
const PLANO_TESTE = "33333333-3333-4333-8333-333333333333";
const AGORA = new Date("2026-10-27T15:00:00Z");

const CUPOM_PCT = {
  id: "c0000000-0000-4000-8000-000000000001",
  codigo: "JOAO10",
  beneficio: "pct",
  valor: 10,
  meses: 3,
  setup_tipo: "pct",
  setup_valor: 20,
  planos: [PLANO],
  vale_ate: null,
  limite_de_usos: null,
  parceiro_id: null,
  comissao_pct: null,
  ativo: true,
};
const FISCAIS = {
  organization_id: ORG,
  tipo: "pj",
  documento: "11222333000181",
  razao_social: "Clínica Exemplo Ltda",
  cep: "30130010",
  logradouro: "Av. Afonso Pena",
  numero: "1500",
  complemento: null,
  bairro: "Centro",
  cidade: "Belo Horizonte",
  uf: "MG",
  inscricao_municipal: null,
  inscricao_estadual: null,
  telefone: "5531988880000",
  updated_at: "2026-10-27T10:00:00Z",
};

function banco(o: { assinatura?: Partial<Linha>; cupons?: Linha[]; usos?: Linha[]; setup?: Linha[]; linha?: Linha[]; precos?: Linha[]; fiscais?: Linha[] } = {}) {
  const rpcs = {
    fn_mia_aplicar_cupom: (args: Record<string, unknown>, db: Record<string, Linha[]>) => {
      const c = (db.mia_cupons ?? []).find((x) => x.codigo === args.p_codigo);
      if (!c) return { data: { ok: false, motivo: "inexistente", codigo: args.p_codigo }, error: null };
      (db.mia_cupom_da_empresa ??= []).push({
        organization_id: args.p_org,
        cupom_id: c.id,
        parceiro_id: c.parceiro_id,
        parceiro_desde: AGORA.toISOString(),
        codigo: c.codigo,
        beneficio: c.beneficio,
        valor: c.valor,
        meses: c.meses,
        setup_tipo: c.setup_tipo,
        setup_valor: c.setup_valor,
        planos: c.planos,
        origem: args.p_origem,
        aplicado_em: AGORA.toISOString(),
      });
      if (c.beneficio === "dias") {
        const a = db.cobranca_assinaturas?.[0];
        if (a) Object.assign(a, { estado: "trial", trial_ate: "2026-11-26T15:00:00Z", pagamento_inicial_pendente: false });
      }
      return { data: { ok: true, ja_estava: false, codigo: c.codigo, beneficio: c.beneficio, parceiro_id: c.parceiro_id, trocou: false, dias_aplicados: c.beneficio === "dias" ? c.valor : null }, error: null };
    },
    fn_mia_tirar_cupom: (args: Record<string, unknown>, db: Record<string, Linha[]>) => {
      db.mia_cupom_da_empresa = (db.mia_cupom_da_empresa ?? []).filter((u) => u.organization_id !== args.p_org);
      return { data: { ok: true, mudou: true, tinha_dias: false }, error: null };
    },
  };
  return bancoEmMemoria(
    {
      cobranca_assinaturas: [
        {
          organization_id: ORG,
          plano_id: PLANO,
          estado: "trial",
          pagamento_inicial_pendente: true,
          provedor: null,
          provedor_cliente_id: null,
          provedor_assinatura_id: null,
          checkout_sessao_id: null,
          proximo_vencimento: null,
          trial_ate: AGORA.toISOString(),
          ...o.assinatura,
        },
      ],
      cobranca_planos: [
        { id: PLANO, nome: "Profissional", preco_cents: 59_700, intervalo: "mes", trial_dias: 0, max_assentos: 3, max_canais: 1, oferecido_ao_cliente: true, arquivado_em: null, padrao_no_cadastro: true },
        { id: PLANO_TESTE, nome: "Essencial", preco_cents: 29_700, intervalo: "mes", trial_dias: 14, max_assentos: 1, max_canais: 1, oferecido_ao_cliente: true, arquivado_em: null, padrao_no_cadastro: false },
      ],
      mia_cupons: o.cupons ?? [CUPOM_PCT],
      mia_cupom_da_empresa: o.usos ?? [],
      mia_setup_da_empresa: o.setup ?? [],
      mia_pagamento_inicial: o.linha ?? [],
      mia_plano_setup: o.precos ?? [{ plano_id: PLANO, preco_cents: 150_000 }],
      mia_dados_fiscais: o.fiscais ?? [FISCAIS],
      mia_parceiros: [],
      organizations: [{ id: ORG, onboarded_at: null, display_name: "Clínica", status: "suspended" }],
      user_organizations: [],
      platform_admins: [],
      platform_config: [],
    },
    rpcs,
  );
}

const deps = (f: ReturnType<typeof asaasFalso>) => ({
  asaas: { fetch: f.fetch, lerChave: async () => CHAVE_DE_TESTE, baseDeTeste: null, esperar: async () => undefined },
  agora: () => AGORA,
  cobrancaLigada: async () => true,
  emailDoAdmin: async () => "dono@exemplo.com.br",
});
const P = { orgId: ORG, userId: USER, requestId: "r1" };

describe("Tenho um cupom no passo", () => {
  it("cupom bom: o selo, o valor com desconto e nada vai ao Asaas sem cobrança gerada", async () => {
    const b = banco();
    const f = asaasFalso({});
    const r = await aplicarCupomNoPasso(b.cliente as never, { ...P, codigo: "joao10" }, deps(f));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.passo.cupom).toMatchObject({ codigo: "JOAO10", vale_no_plano: true, preco_cheio_cents: 59_700, primeira_mensalidade_cents: 53_730 });
    expect(r.passo.valor_cents).toBe(53_730);
    expect(f.chamadas).toEqual([]);
  });

  it.each([
    ["inexistente", {}, "XPTO", /Não encontramos o cupom XPTO/],
    ["pausado", { cupons: [{ ...CUPOM_PCT, ativo: false }] }, "JOAO10", /está pausado/],
    ["vencido", { cupons: [{ ...CUPOM_PCT, vale_ate: "2026-10-25" }] }, "JOAO10", /venceu em 25\/10\/2026/],
    ["fora do plano", { cupons: [{ ...CUPOM_PCT, planos: [PLANO_TESTE] }] }, "JOAO10", /não vale para o plano Profissional\. Vale para: Essencial/],
    ["esgotado", { cupons: [{ ...CUPOM_PCT, limite_de_usos: 1 }], usos: [{ organization_id: "outra", cupom_id: CUPOM_PCT.id, codigo: "JOAO10" }] }, "JOAO10", /número máximo de vezes/],
  ])("%s: a mensagem do protótipo, e nada muda", async (_nome, o, codigo, frase) => {
    const b = banco(o as never);
    const r = await aplicarCupomNoPasso(b.cliente as never, { ...P, codigo }, deps(asaasFalso({})));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(frase);
    expect(r.status).toBe(422);
    expect((b.db.mia_cupom_da_empresa ?? []).filter((u) => u.organization_id === ORG)).toEqual([]);
  });

  it("um cupom por cliente; depois de pago, só a Time troca", async () => {
    const com = banco({ usos: [{ organization_id: ORG, cupom_id: CUPOM_PCT.id, codigo: "OUTRO", beneficio: "pct", valor: 5, meses: null, setup_tipo: "nenhum", setup_valor: 0, planos: [PLANO] }] });
    const r = await aplicarCupomNoPasso(com.cliente as never, { ...P, codigo: "JOAO10" }, deps(asaasFalso({})));
    expect(r).toMatchObject({ ok: false, code: "cupom_ja_tem_cupom" });
    const pagou = banco({ assinatura: { pagamento_inicial_pendente: false, estado: "ativa", proximo_vencimento: "2026-11-27T00:00:00Z" }, linha: [{ organization_id: ORG, modo: "entrada_paga", situacao: "pago", pagamento_ref: "pay_1", cobrancas_refeitas: 0, cartao_recusas: 0 }] });
    expect(await aplicarCupomNoPasso(pagou.cliente as never, { ...P, codigo: "JOAO10" }, deps(asaasFalso({})))).toMatchObject({ ok: false, code: "ja_pago" });
  });

  it("com cobrança já gerada: cancela no Asaas e o passo recomeça, para o Pix sair com o valor novo", async () => {
    const b = banco({
      assinatura: { provedor: "asaas", provedor_cliente_id: "cus_1", provedor_assinatura_id: "sub_1", checkout_sessao_id: "pay_1" },
      linha: [{ organization_id: ORG, modo: "entrada_paga", plano_id: PLANO, situacao: "aguardando", forma: "pix", pagamento_ref: "pay_1", assinatura_ref: "sub_1", pix_copia_e_cola: "000201", cobrancas_refeitas: 0, cartao_recusas: 0 }],
    });
    const f = asaasFalso({
      "GET /payments/pay_1": { corpo: { id: "pay_1", status: "PENDING", value: 597, dueDate: "2026-10-30", subscription: "sub_1" } },
      "DELETE /subscriptions/sub_1": { corpo: { deleted: true } },
    });
    const r = await aplicarCupomNoPasso(b.cliente as never, { ...P, codigo: "JOAO10" }, deps(f));
    expect(r.ok).toBe(true);
    expect(f.chamadas.some((c) => c.metodo === "DELETE" && c.caminho === "/subscriptions/sub_1")).toBe(true);
    expect(b.db.mia_pagamento_inicial?.[0]).toMatchObject({ pagamento_ref: null, pix_copia_e_cola: null, cobrancas_refeitas: 1, situacao: "sem_cobranca" });
    expect(b.db.cobranca_assinaturas?.[0]).toMatchObject({ provedor_assinatura_id: null });
  });

  it("a cobrança já paga no Asaas: não troca", async () => {
    const b = banco({
      assinatura: { provedor: "asaas", provedor_cliente_id: "cus_1", provedor_assinatura_id: "sub_1" },
      linha: [{ organization_id: ORG, modo: "entrada_paga", plano_id: PLANO, situacao: "aguardando", pagamento_ref: "pay_1", assinatura_ref: "sub_1", cobrancas_refeitas: 0, cartao_recusas: 0 }],
    });
    const f = asaasFalso({ "GET /payments/pay_1": { corpo: { id: "pay_1", status: "RECEIVED", value: 597, dueDate: "2026-10-30" } } });
    expect(await aplicarCupomNoPasso(b.cliente as never, { ...P, codigo: "JOAO10" }, deps(f))).toMatchObject({ ok: false, code: "ja_pago" });
    expect(f.chamadas.some((c) => c.metodo === "DELETE")).toBe(false);
  });

  it("cupom de dias numa entrada paga: o passo vira o do teste", async () => {
    const b = banco({ cupons: [{ ...CUPOM_PCT, id: "c0000000-0000-4000-8000-000000000002", codigo: "DIAS30", beneficio: "dias", valor: 30, meses: null, setup_tipo: "nenhum", setup_valor: 0 }] });
    const r = await aplicarCupomNoPasso(b.cliente as never, { ...P, codigo: "DIAS30" }, deps(asaasFalso({})));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.passo.modo).toBe("teste");
    expect(r.passo.formas).toEqual(["cartao", "pix"]);
    expect(b.db.mia_pagamento_inicial?.[0]).toMatchObject({ modo: "teste" });
  });

  it("tirar o cupom: volta ao preço do plano", async () => {
    const b = banco();
    await aplicarCupomNoPasso(b.cliente as never, { ...P, codigo: "JOAO10" }, deps(asaasFalso({})));
    const r = await tirarCupomNoPasso(b.cliente as never, P, deps(asaasFalso({})));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.passo.cupom).toBeNull();
    expect(r.passo.valor_cents).toBe(59_700);
  });
});

describe("o cupom no cadastro público", () => {
  it("bom: guarda o código; dias grátis dispensa os dados fiscais da entrada paga", async () => {
    const b = banco({ cupons: [CUPOM_PCT, { ...CUPOM_PCT, id: "c0000000-0000-4000-8000-000000000002", codigo: "DIAS30", beneficio: "dias", valor: 30, meses: null, setup_tipo: "nenhum", setup_valor: 0 }] });
    expect(await conferirCupomDoCadastro(b.cliente as never, PLANO, "joao10", AGORA)).toEqual({ ok: true, codigo: "JOAO10", diasGratis: false });
    expect(await conferirCupomDoCadastro(b.cliente as never, PLANO, "DIAS30", AGORA)).toEqual({ ok: true, codigo: "DIAS30", diasGratis: true });
    expect(await conferirCupomDoCadastro(b.cliente as never, PLANO, "", AGORA)).toEqual({ ok: true, codigo: null, diasGratis: false });
  });
  it("ruim: a frase certa, com os nomes dos planos", async () => {
    const b = banco({ cupons: [{ ...CUPOM_PCT, planos: [PLANO_TESTE] }] });
    expect(await conferirCupomDoCadastro(b.cliente as never, PLANO, "JOAO10", AGORA)).toEqual({ ok: false, mensagem: "O cupom JOAO10 não vale para o plano Profissional. Vale para: Essencial." });
    expect(await conferirCupomDoCadastro(b.cliente as never, PLANO, "NADA1", AGORA)).toMatchObject({ ok: false, mensagem: expect.stringContaining("Não encontramos") });
  });
});

const CARTAO = { numero: "4111111111111111", nome: "A B", validade: "12/30", cvv: "123", mes: "12", ano: "2030" } as never;
const TITULAR = { nome: "Clínica", email: "a@b.c", documento: "11222333000181", cep: "30130010", numeroDoEndereco: "1", complemento: null, telefone: "31988880000" };

describe("o setup de implantação", () => {
  const asaasDoSetup = (extra: Record<string, unknown> = {}) =>
    asaasFalso({
      "GET /customers": { corpo: { data: [] } },
      "POST /customers": { corpo: { id: "cus_novo" } },
      "GET /payments": { corpo: { data: [] } },
      "POST /payments": (c: { corpo: string }) => ({ corpo: { id: "pay_setup", status: "PENDING", value: JSON.parse(c.corpo).value, dueDate: "2026-10-30", invoiceUrl: "https://asaas/i/1" } }),
      "GET /payments/pay_setup/pixQrCode": { corpo: { payload: "00020126-setup", encodedImage: null } },
      ...(extra as object),
    } as never);

  it("o preço é por plano: sem preço, não oferece", async () => {
    const b = banco({ precos: [] });
    expect(await precoDoSetup(b.cliente as never, PLANO)).toBeNull();
    const r = await pedirSetup(b.cliente as never, P, deps(asaasFalso({})));
    expect(r).toMatchObject({ ok: false, code: "setup_indisponivel" });
    expect(await gravarPrecoDoSetup(b.cliente as never, PLANO, 150_000, USER)).toEqual({ ok: true, mudou: true });
    expect(await precoDoSetup(b.cliente as never, PLANO)).toBe(150_000);
    expect(await gravarPrecoDoSetup(b.cliente as never, PLANO, 150_000, USER)).toEqual({ ok: true, mudou: false });
    expect(await gravarPrecoDoSetup(b.cliente as never, PLANO, null, USER)).toEqual({ ok: true, mudou: true });
    expect(await precoDoSetup(b.cliente as never, PLANO)).toBeNull();
  });

  it("marcar: cobrança AVULSA com o desconto do cupom, separada da mensalidade, e o Pix na tela", async () => {
    const b = banco({ usos: [{ organization_id: ORG, cupom_id: CUPOM_PCT.id, codigo: "JOAO10", beneficio: "pct", valor: 10, meses: 3, setup_tipo: "pct", setup_valor: 20, planos: [PLANO] }] });
    const f = asaasDoSetup();
    const r = await pedirSetup(b.cliente as never, { ...P, agora: AGORA }, deps(f));
    expect(r).toMatchObject({ ok: true, criado: true, setup: { situacao: "aguardando", preco_cents: 150_000, desconto_cents: 30_000, valor_cents: 120_000, pagamento_ref: "pay_setup", cliente_ref: "cus_novo" } });
    const post = f.chamadas.find((c) => c.metodo === "POST" && c.caminho === "/payments");
    expect(JSON.parse(post?.corpo ?? "{}")).toMatchObject({ customer: "cus_novo", billingType: "UNDEFINED", value: 1200, externalReference: `setup:${ORG}`, dueDate: "2026-10-30" });
    expect(f.chamadas.some((c) => c.caminho.startsWith("/subscriptions"))).toBe(false);
    const passo = await lerPassoDoPagamento(b.cliente as never, ORG, { podePagar: true }, deps(f));
    expect(passo.setup).toMatchObject({ oferecido: true, situacao: "aguardando", valor_cents: 120_000, desconto_cents: 30_000 });
    expect(passo.setup?.pix?.copia_e_cola).toBe("00020126-setup");
  });

  it("sem os dados fiscais, não cobra", async () => {
    const r = await pedirSetup(banco({ fiscais: [] }).cliente as never, P, deps(asaasFalso({})));
    expect(r).toMatchObject({ ok: false, code: "dados_fiscais_faltando" });
  });

  it("o desconto que zera o valor é cortesia: nada vai ao Asaas", async () => {
    const b = banco({ usos: [{ organization_id: ORG, cupom_id: CUPOM_PCT.id, codigo: "JOAO10", beneficio: "pct", valor: 10, meses: 3, setup_tipo: "pct", setup_valor: 100, planos: [PLANO] }] });
    const f = asaasFalso({});
    const r = await pedirSetup(b.cliente as never, P, deps(f));
    expect(r).toMatchObject({ ok: true, setup: { situacao: "cortesia", valor_cents: 0 } });
    expect(f.chamadas).toEqual([]);
  });

  it("desmarcar antes de pagar cancela no Asaas; depois de pago, recusa", async () => {
    const aberto = { organization_id: ORG, situacao: "aguardando", preco_cents: 150_000, desconto_cents: 0, valor_cents: 150_000, pagamento_ref: "pay_setup", cliente_ref: "cus_1", nota_tentativas: 0 };
    const b = banco({ setup: [aberto] });
    const f = asaasFalso({
      "GET /payments/pay_setup": { corpo: { id: "pay_setup", status: "PENDING", value: 1500, dueDate: "2026-10-30" } },
      "DELETE /payments/pay_setup": { corpo: { deleted: true } },
    });
    expect(await desistirDoSetup(b.cliente as never, P, deps(f))).toEqual({ ok: true });
    expect(b.db.mia_setup_da_empresa?.[0]).toMatchObject({ situacao: "cancelado" });
    expect(f.chamadas.some((c) => c.metodo === "DELETE")).toBe(true);
    const pago = banco({ setup: [{ ...aberto, situacao: "pago" }] });
    expect(await desistirDoSetup(pago.cliente as never, P, deps(asaasFalso({})))).toMatchObject({ ok: false, code: "setup_pago" });
  });

  it("escolher pelo passo devolve o passo novo", async () => {
    const b = banco();
    const r = await escolherSetupNoPasso(b.cliente as never, { ...P, quero: true }, deps(asaasDoSetup()));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.passo.setup?.situacao).toBe("aguardando");
  });

  it("pagou: registra e pede a nota com o serviço PRÓPRIO do setup; sem o serviço, avisa e não pede", async () => {
    const aberto = { organization_id: ORG, situacao: "aguardando", preco_cents: 150_000, desconto_cents: 30_000, valor_cents: 120_000, pagamento_ref: "pay_setup", cliente_ref: "cus_1", nota_tentativas: 0, nota_ref: null, nota_erro: null };
    const pagamento = { ref: "pay_setup", status: "RECEIVED", valorCents: 120_000, liquidoCents: 115_752, vencimento: "2026-10-30", pagoEm: "2026-10-28", assinaturaRef: null, referenciaExterna: `setup:${ORG}`, forma: "PIX", faturaUrl: null, pago: true, estornado: false, aberto: false };
    const semServico = banco({ setup: [{ ...aberto }] });
    expect(await conferirSetup(semServico.cliente as never, ORG, { pagamentos: [pagamento], deps: deps(asaasFalso({})).asaas, agora: AGORA })).toBe("pago");
    expect(semServico.db.mia_setup_da_empresa?.[0]).toMatchObject({ situacao: "pago", forma_paga: "PIX", nota_erro: "sem_configuracao", nota_ref: null });

    const comServico = banco({ setup: [{ ...aberto }] });
    (comServico.db.platform_config as Linha[]).push({
      chave: "MIA_NOTA_FISCAL_DO_ASAAS",
      valor: JSON.stringify({
        servicoMunicipalCodigo: "1.05",
        impostos: { reterIss: false, iss: 3, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 },
        setup: { servicoMunicipalCodigo: "17.06", servicoMunicipalNome: "Setup de implementação", impostos: { reterIss: false, iss: 2, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 } },
      }),
    });
    const f = asaasFalso({ "GET /invoices": { corpo: { data: [] } }, "POST /invoices": { corpo: { id: "inv_setup" } } });
    await conferirSetup(comServico.cliente as never, ORG, { pagamentos: [pagamento], deps: deps(f).asaas, agora: AGORA });
    const nota = JSON.parse(f.chamadas.find((c) => c.metodo === "POST" && c.caminho === "/invoices")?.corpo ?? "{}");
    expect(nota).toMatchObject({ payment: "pay_setup", value: 1200, municipalServiceCode: "17.06", taxes: { iss: 2 } });
    expect(comServico.db.mia_setup_da_empresa?.[0]).toMatchObject({ nota_ref: "inv_setup", nota_erro: null });
  });

  it("o mesmo cartão: paga o setup na mesma requisição; recusado não lança e nada do cartão é gravado", async () => {
    const aberto = { organization_id: ORG, situacao: "aguardando", preco_cents: 150_000, desconto_cents: 0, valor_cents: 150_000, pagamento_ref: "pay_setup", cliente_ref: "cus_1", nota_tentativas: 0 };
    const b = banco({ setup: [{ ...aberto }] });
    const recusado = asaasFalso({ "POST /payments/pay_setup/payWithCreditCard": { status: 400, corpo: { errors: [{ code: "invalid_creditCard" }] } } });
    expect(await pagarSetupComOMesmoCartao(b.cliente as never, { orgId: ORG, cartao: CARTAO, titular: TITULAR }, deps(recusado).asaas)).toBe("recusado");
    expect(JSON.stringify(b.db.mia_setup_da_empresa)).not.toContain("4111111111111111");
    expect(b.db.mia_setup_da_empresa?.[0]?.situacao).toBe("aguardando");
    const semSetup = banco();
    expect(await pagarSetupComOMesmoCartao(semSetup.cliente as never, { orgId: ORG, cartao: CARTAO, titular: TITULAR }, deps(recusado).asaas)).toBe("nao_havia");
  });
});
