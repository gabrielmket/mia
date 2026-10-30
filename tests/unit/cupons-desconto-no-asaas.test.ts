/**
 * FORK MIA (.98) · O desconto do cupom no Asaas (lib/cupons/desconto-no-asaas.ts;
 * docs/fork/cupons-e-parceiros.md, seção 3). O Asaas real nunca é chamado aqui.
 *
 * O que se prova:
 *   - cada cobrança em aberto recebe o valor da ordem dela; a assinatura, o da próxima;
 *   - a N-ésima mensalidade paga, com tudo no preço cheio: o desconto ENCERRA e a
 *     conferência para;
 *   - a cobrança paga nunca muda; a nota agendada acompanha a cobrança;
 *   - o plano que o cupom não cobre fica no preço cheio;
 *   - falha do Asaas não lança;
 *   - a conferência de preço do upstream não acusa o preço do cupom.
 */
import { describe, expect, it, vi } from "vitest";

import type { PagamentoDoCliente } from "@/lib/asaas-mia/pagamentos";
import { garantirDescontoNoAsaas, planoDoDesconto, precoDoProvedorEhODoCupom } from "@/lib/cupons/desconto-no-asaas";

import { asaasFalso, CHAVE_DE_TESTE } from "../helpers/asaas-falso";
import { bancoEmMemoria } from "../helpers/banco-em-memoria";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const ORG = "11111111-1111-4111-8111-111111111111";
const PLANO = "22222222-2222-4222-8222-222222222222";
const OUTRO = "33333333-3333-4333-8333-333333333333";
const CUPOM = "44444444-4444-4444-8444-444444444444";

const pagamento = (m: Partial<PagamentoDoCliente> & { ref: string }): PagamentoDoCliente => ({
  status: "PENDING",
  valorCents: 59_700,
  liquidoCents: null,
  vencimento: "2026-11-10",
  pagoEm: null,
  assinaturaRef: "sub_1",
  referenciaExterna: null,
  forma: "UNDEFINED",
  faturaUrl: null,
  pago: false,
  estornado: false,
  aberto: true,
  ...m,
});
const paga = (ref: string, vencimento: string) =>
  pagamento({ ref, status: "RECEIVED", vencimento, pagoEm: vencimento, valorCents: 53_730, pago: true, aberto: false });

const uso = (m: Record<string, unknown> = {}) => ({
  organization_id: ORG,
  cupom_id: CUPOM,
  parceiro_id: null,
  codigo: "JOAO10",
  beneficio: "pct",
  valor: 10,
  meses: 3,
  setup_tipo: "nenhum",
  setup_valor: 0,
  planos: [PLANO],
  aplicado_em: "2026-10-01T12:00:00Z",
  parceiro_desde: "2026-10-01T12:00:00Z",
  desconto_encerrado_em: null,
  ...m,
});

function banco(usoLinha: Record<string, unknown> | null, planoId = PLANO) {
  return bancoEmMemoria({
    mia_cupom_da_empresa: usoLinha ? [usoLinha] : [],
    cobranca_assinaturas: [{ organization_id: ORG, plano_id: planoId, provedor: "asaas", provedor_cliente_id: "cus_1", provedor_assinatura_id: "sub_1" }],
    cobranca_planos: [
      { id: PLANO, preco_cents: 59_700 },
      { id: OUTRO, preco_cents: 99_000 },
    ],
  });
}

const deps = (f: ReturnType<typeof asaasFalso>) => ({ fetch: f.fetch, lerChave: async () => CHAVE_DE_TESTE, baseDeTeste: null, esperar: async () => undefined });

describe("o plano do desconto (puro)", () => {
  const c = { beneficio: "pct" as const, valor: 10, meses: 3 };
  it("nada pago: as abertas nas ordens 1 e 2, a assinatura na 3 (ainda com desconto)", () => {
    const p = planoDoDesconto({
      cupom: c,
      precoCents: 59_700,
      coberto: true,
      assinaturaRef: "sub_1",
      pagamentos: [pagamento({ ref: "pay_1", vencimento: "2026-11-10" }), pagamento({ ref: "pay_2", vencimento: "2026-12-10" })],
    });
    expect(p.cobrancas.map((x) => x.para)).toEqual([53_730, 53_730]);
    expect(p.assinatura).toBe(53_730);
    expect(p.pagas).toBe(0);
  });
  it("2 pagas e 2 abertas: a 3ª com desconto, a 4ª cheia, a assinatura já cheia", () => {
    const p = planoDoDesconto({
      cupom: c,
      precoCents: 59_700,
      coberto: true,
      assinaturaRef: "sub_1",
      pagamentos: [paga("pay_1", "2026-10-10"), paga("pay_2", "2026-11-10"), pagamento({ ref: "pay_3", vencimento: "2026-12-10" }), pagamento({ ref: "pay_4", vencimento: "2027-01-10" })],
    });
    expect(p.cobrancas).toEqual([
      { ref: "pay_3", de: 59_700, para: 53_730 },
      { ref: "pay_4", de: 59_700, para: 59_700 },
    ]);
    expect(p.assinatura).toBe(59_700);
    expect(p.tudoCheio).toBe(false);
  });
  it("o plano fora do cupom: tudo cheio", () => {
    const p = planoDoDesconto({ cupom: c, precoCents: 99_000, coberto: false, assinaturaRef: "sub_1", pagamentos: [pagamento({ ref: "pay_1", valorCents: 53_730 })] });
    expect(p.cobrancas).toEqual([{ ref: "pay_1", de: 53_730, para: 99_000 }]);
    expect(p.assinatura).toBe(99_000);
  });
  it("só conta as mensalidades pagas depois que o cupom entrou", () => {
    const p = planoDoDesconto({ cupom: c, precoCents: 59_700, coberto: true, assinaturaRef: "sub_1", desde: "2026-10-05", pagamentos: [paga("pay_0", "2026-09-10"), pagamento({ ref: "pay_1" })] });
    expect(p.pagas).toBe(0);
    expect(p.cobrancas[0]?.para).toBe(53_730);
  });
  it("cobrança avulsa (crédito, setup) não conta como mensalidade", () => {
    const p = planoDoDesconto({ cupom: c, precoCents: 59_700, coberto: true, assinaturaRef: "sub_1", pagamentos: [pagamento({ ref: "pay_cred", assinaturaRef: null, pago: true, aberto: false, status: "RECEIVED" })] });
    expect(p.pagas).toBe(0);
    expect(p.cobrancas).toEqual([]);
  });
});

describe("garantirDescontoNoAsaas", () => {
  it("assinatura recém-criada: a primeira cobrança e a assinatura recebem o desconto; a nota agendada acompanha", async () => {
    const b = banco(uso());
    const f = asaasFalso({
      "GET /payments": { corpo: { data: [{ id: "pay_1", status: "PENDING", value: 597, dueDate: "2026-11-10", subscription: "sub_1" }] } },
      "PUT /payments/pay_1": { corpo: { id: "pay_1", status: "PENDING", value: 537.3, dueDate: "2026-11-10" } },
      "GET /invoices": { corpo: { data: [{ id: "inv_1", status: "SCHEDULED", value: 597 }] } },
      "PUT /invoices/inv_1": { corpo: { id: "inv_1" } },
      "GET /subscriptions/sub_1": { corpo: { id: "sub_1", value: 597 } },
      "PUT /subscriptions/sub_1": { corpo: { id: "sub_1" } },
    });
    const r = await garantirDescontoNoAsaas(b.cliente as never, ORG, { assinaturaRef: "sub_1", clienteRef: "cus_1", deps: deps(f) });
    expect(r).toMatchObject({ acao: "acertado", cobrancasAcertadas: 1, assinaturaAcertada: true });
    const put = (c: string) => f.chamadas.find((x) => x.metodo === "PUT" && x.caminho === c)?.corpo;
    expect(JSON.parse(put("/payments/pay_1") ?? "{}")).toEqual({ value: 537.3 });
    expect(JSON.parse(put("/invoices/inv_1") ?? "{}")).toEqual({ value: 537.3 });
    expect(JSON.parse(put("/subscriptions/sub_1") ?? "{}")).toEqual({ value: 537.3, updatePendingPayments: false });
  });

  it("depois de N pagas e com tudo cheio: encerra, e a próxima conferência nem vai ao Asaas", async () => {
    const b = banco(uso());
    const f = asaasFalso({
      "GET /subscriptions/sub_1": { corpo: { id: "sub_1", value: 597 } },
    });
    const pagamentos = [paga("pay_1", "2026-10-10"), paga("pay_2", "2026-11-10"), paga("pay_3", "2026-12-10"), pagamento({ ref: "pay_4", vencimento: "2027-01-10" })];
    const r = await garantirDescontoNoAsaas(b.cliente as never, ORG, { pagamentos, deps: deps(f) });
    expect(r.acao).toBe("encerrado");
    expect(f.chamadas.filter((c) => c.metodo === "PUT")).toEqual([]);
    const depois = asaasFalso({});
    expect((await garantirDescontoNoAsaas(b.cliente as never, ORG, { pagamentos, deps: deps(depois) })).acao).toBe("nada");
    expect(depois.chamadas).toEqual([]);
  });

  it("a cobrança paga nunca é mudada", async () => {
    const b = banco(uso({ meses: null }));
    const f = asaasFalso({ "GET /subscriptions/sub_1": { corpo: { id: "sub_1", value: 537.3 } } });
    const r = await garantirDescontoNoAsaas(b.cliente as never, ORG, { pagamentos: [pagamento({ ref: "pay_1", status: "RECEIVED", pago: true, aberto: false, valorCents: 59_700 })], deps: deps(f) });
    expect(r.acao).toBe("conferido");
    expect(f.chamadas.some((c) => c.caminho.startsWith("/payments/"))).toBe(false);
  });

  it("o cliente foi para um plano fora do cupom: o preço cheio dele", async () => {
    const b = banco(uso(), OUTRO);
    const f = asaasFalso({
      "PUT /payments/pay_1": { corpo: { id: "pay_1", status: "PENDING", dueDate: "2026-11-10" } },
      "GET /invoices": { corpo: { data: [] } },
      "GET /subscriptions/sub_1": { corpo: { id: "sub_1", value: 537.3 } },
      "PUT /subscriptions/sub_1": { corpo: { id: "sub_1" } },
    });
    const r = await garantirDescontoNoAsaas(b.cliente as never, ORG, { pagamentos: [pagamento({ ref: "pay_1", valorCents: 53_730 })], deps: deps(f) });
    expect(r.acao).toBe("acertado");
    expect(JSON.parse(f.chamadas.find((c) => c.metodo === "PUT" && c.caminho === "/payments/pay_1")?.corpo ?? "{}")).toEqual({ value: 990 });
  });

  it("sem cupom, com dias grátis e com o desconto encerrado: não vai ao Asaas", async () => {
    const f = asaasFalso({});
    expect((await garantirDescontoNoAsaas(banco(null).cliente as never, ORG, { deps: deps(f) })).acao).toBe("sem_cupom");
    expect((await garantirDescontoNoAsaas(banco(uso({ beneficio: "dias", valor: 30, meses: null })).cliente as never, ORG, { deps: deps(f) })).acao).toBe("sem_cupom");
    expect((await garantirDescontoNoAsaas(banco(uso({ desconto_encerrado_em: "2026-10-01T00:00:00Z" })).cliente as never, ORG, { deps: deps(f) })).acao).toBe("nada");
    expect(f.chamadas).toEqual([]);
  });

  it("o Asaas fora do ar não lança", async () => {
    const f = asaasFalso({ "GET /payments": { status: 500, corpo: {} } });
    const r = await garantirDescontoNoAsaas(banco(uso()).cliente as never, ORG, { deps: deps(f) });
    expect(r.acao).toBe("falhou");
  });
});

describe("a conferência de preço do upstream (#2609)", () => {
  it("o preço do cupom não é divergência; outro preço é; encerrado volta a valer a do plano", async () => {
    const b = banco(uso());
    expect(await precoDoProvedorEhODoCupom(b.cliente as never, ORG, PLANO, 53_730)).toBe(true);
    expect(await precoDoProvedorEhODoCupom(b.cliente as never, ORG, PLANO, 50_000)).toBe(false);
    expect(await precoDoProvedorEhODoCupom(banco(uso({ desconto_encerrado_em: "2026-10-01T00:00:00Z" })).cliente as never, ORG, PLANO, 53_730)).toBe(false);
    expect(await precoDoProvedorEhODoCupom(banco(null).cliente as never, ORG, PLANO, 53_730)).toBe(false);
  });
});
