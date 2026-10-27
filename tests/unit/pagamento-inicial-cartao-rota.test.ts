/**
 * FORK MIA (.96) · A ROTA DO CARTÃO (`POST /api/v1/pagamento-inicial/cartao`) e o
 * passo do pagamento por trás dela: o número do cartão e o código de segurança
 * NUNCA aparecem em log, Sentry, auditoria, escrita no banco nem na resposta
 * (decisão 2a do protótipo "Pagamento no início").
 *
 * A outra metade (a camada do Asaas sozinha) é `cartao-fora-dos-registros.test.ts`.
 * Aqui os caminhos de ponta a ponta: o corpo que não é JSON (a mensagem do parse
 * citaria o cartão), o cartão que não passa na conferência, a recusa do banco
 * com a descrição ecoando o cartão, o pagamento aprovado na entrada paga e o
 * cadastro sem cobrança do modo teste.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ chamadas: [] as unknown[] }));
const auditoria = vi.hoisted(() => ({ chamadas: [] as unknown[] }));
const ctx = vi.hoisted(() => ({ banco: null as unknown, fetch: null as unknown }));

vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => sentry.chamadas.push(a),
  captureMessage: (...a: unknown[]) => sentry.chamadas.push(a),
  addBreadcrumb: (...a: unknown[]) => sentry.chamadas.push(a),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async (e: unknown) => void auditoria.chamadas.push(e)) }));
vi.mock("@/lib/cobranca/provedores/base-de-teste", () => ({ baseDeTesteDaCobranca: () => null }));
vi.mock("@/lib/cobranca/configuracao", () => ({ chaveDoProvedor: async () => ["$aact", "hmlg", "000000000000000000000000000000"].join("_") }));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: async () => true }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/planos-mia/seguir-o-plano", () => ({ seguirOPlano: vi.fn(async () => []) }));
vi.mock("@/lib/cobranca/emails", () => ({ emailDoAdminDaEmpresa: async () => "admin@exemplo.com.br" }));
vi.mock("@/lib/cobranca/sincronizar", () => ({ sincronizar: vi.fn(async () => ({ tipo: "descartada" })) }));
vi.mock("@/lib/cobranca/checkout", () => ({
  gerarLinkDePagamento: vi.fn(async () => {
    const e = (ctx.banco as { estado: { assinatura: Record<string, unknown> } }).estado;
    e.assinatura = { ...e.assinatura, provedor: "asaas", provedor_cliente_id: "cus_1", provedor_assinatura_id: "sub_1", checkout_sessao_id: "pay_1" };
    return { ok: true, url: "https://sandbox.asaas.com/i/pay_1" };
  }),
}));
vi.mock("@/lib/pagamento-inicial/rota", async () => {
  const resposta = await import("@/lib/pagamento-inicial/resposta");
  return {
    ...resposta,
    acessoDeEscrita: async () => ({
      requestId: "00000000-0000-4000-8000-0000000000aa",
      user: { id: "00000000-0000-4000-8000-00000000a096" },
      org: { orgId: "00000000-0000-4000-8000-00000000c096", role: "admin" },
      admin: (ctx.banco as { cliente: unknown }).cliente,
    }),
  };
});

import { POST } from "@/app/api/v1/pagamento-inicial/cartao/route";
import { asaasFalso } from "@/tests/helpers/asaas-falso";
import { bancoDoPagamento, type EstadoDoPagamento } from "@/tests/helpers/banco-do-pagamento";

const ORG = "00000000-0000-4000-8000-00000000c096";
const NUMERO = "4111111111111111";
const NUMERO_COM_ESPACOS = "4111 1111 1111 1111";
const CVV = "7391";

let registros: string[];
const espioes: Array<ReturnType<typeof vi.spyOn>> = [];
const fetchOriginal = globalThis.fetch;

function comoTexto(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return (
      JSON.stringify(v, (_k, x: unknown) =>
        x instanceof Error ? { nome: x.name, mensagem: x.message, pilha: x.stack, ...(x as unknown as Record<string, unknown>) } : x,
      ) ?? String(v)
    );
  } catch {
    return String(v);
  }
}

function estado(modo: "entrada_paga" | "teste"): EstadoDoPagamento {
  return {
    assinatura: {
      organization_id: ORG,
      plano_id: "plano-1",
      estado: "trial",
      trial_ate: modo === "teste" ? "2099-11-12T15:00:00Z" : "2026-10-29T14:00:00Z",
      pagamento_inicial_pendente: modo === "entrada_paga",
      provedor: null,
      provedor_cliente_id: null,
      provedor_assinatura_id: null,
      checkout_sessao_id: null,
      proximo_vencimento: null,
    },
    linha: null,
    fiscais: {
      organization_id: ORG,
      tipo: "pj",
      documento: "11222333000181",
      razao_social: "Clínica Exemplo Ltda",
      cep: "30130010",
      logradouro: "Rua A",
      numero: "10",
      complemento: null,
      bairro: "Centro",
      cidade: "Belo Horizonte",
      uf: "MG",
      inscricao_municipal: null,
      inscricao_estadual: null,
      telefone: "5531988880000",
      updated_at: "2026-10-29T14:59:00Z",
    },
    planos: [{ id: "plano-1", nome: "Profissional", preco_cents: 59700, intervalo: "mes", trial_dias: modo === "teste" ? 14 : 0, max_assentos: 8, max_canais: 2 }],
    org: { id: ORG, onboarded_at: null, status: modo === "teste" ? "active" : "suspended" },
    nota: null,
    config: [],
  };
}

async function postar(corpo: string): Promise<{ status: number; texto: string }> {
  const req = new Request("http://localhost/api/v1/pagamento-inicial/cartao", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "200.1.2.3" },
    body: corpo,
  });
  const r = await POST(req);
  return { status: r.status, texto: await r.text() };
}

/** A prova: nada do cartão em lugar nenhum que fica. */
function nadaDoCartao(banco: ReturnType<typeof bancoDoPagamento>, resposta: string) {
  const tudo = [
    ...registros,
    ...sentry.chamadas.map(comoTexto),
    ...auditoria.chamadas.map(comoTexto),
    ...banco.escritas.map(comoTexto),
    ...banco.rpcs.map(comoTexto),
    comoTexto(banco.estado()),
    resposta,
  ].join("\n");
  expect(tudo, "o número do cartão apareceu num registro").not.toContain(NUMERO);
  expect(tudo, "o número do cartão apareceu num registro").not.toContain(NUMERO_COM_ESPACOS);
  expect(tudo, "o código de segurança apareceu num registro").not.toMatch(new RegExp(`(?<!\\d)${CVV}(?!\\d)`));
  expect(tudo, "um campo de código de segurança apareceu num registro").not.toMatch(/"(ccv|cvv)"\s*:/i);
}

function montar(modo: "entrada_paga" | "teste", rotas: Parameters<typeof asaasFalso>[0]) {
  const e = estado(modo);
  const banco = bancoDoPagamento(e);
  const comEstado = { ...banco, estado: () => e };
  ctx.banco = { cliente: banco.cliente, estado: e };
  // O `estado` do mock do checkout precisa ser o mesmo objeto do banco.
  Object.defineProperty(ctx.banco, "estado", { get: () => e });
  const a = asaasFalso(rotas);
  globalThis.fetch = a.fetch;
  return { banco: comEstado, asaas: a, e };
}

beforeEach(() => {
  registros = [];
  sentry.chamadas = [];
  auditoria.chamadas = [];
  for (const nivel of ["log", "info", "warn", "error", "debug", "trace"] as const) {
    espioes.push(vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => void registros.push(...a.map(comoTexto))));
  }
});
afterEach(() => {
  for (const s of espioes.splice(0)) s.mockRestore();
  globalThis.fetch = fetchOriginal;
});

const CARTAO = JSON.stringify({ numero: NUMERO_COM_ESPACOS, nome: "Fulana de Tal", validade: "12/31", cvv: CVV });

describe("o cartão passa pela rota só para chegar ao Asaas", () => {
  it("corpo que não é JSON (com o cartão no meio): 422 sem eco, e nada registrado", async () => {
    const { banco } = montar("entrada_paga", {});
    const r = await postar(`{numero: ${NUMERO}, cvv: ${CVV}`);
    expect(r.status).toBe(422);
    nadaDoCartao(banco, r.texto);
  });

  it("cartão que não passa na conferência: a recusa diz o campo, nunca o valor", async () => {
    const { banco, asaas } = montar("entrada_paga", {});
    const r = await postar(JSON.stringify({ numero: "4111 1111 1111 1112", nome: "Fulana", validade: "12/31", cvv: CVV }));
    expect(r.status).toBe(422);
    expect(JSON.parse(r.texto).error.details).toEqual({ campo: "numero_invalido" });
    expect(asaas.chamadas).toEqual([]);
    nadaDoCartao(banco, r.texto);
  });

  it("⭐ recusa do banco com a descrição do Asaas ecoando o cartão: 402, e nada do cartão em log, auditoria, banco ou resposta", async () => {
    const { banco, asaas } = montar("entrada_paga", {
      "GET /customers": { corpo: { data: [{ id: "cus_1" }] } },
      "PUT /customers/cus_1": { corpo: { id: "cus_1" } },
      "GET /payments/pay_1": { corpo: { id: "pay_1", status: "PENDING", value: 597, dueDate: "2026-10-29", subscription: "sub_1" } },
      "POST /payments/pay_1/payWithCreditCard": {
        status: 400,
        corpo: { errors: [{ code: "invalid_creditCard", description: `Cartão ${NUMERO} recusado, cvv ${CVV}` }] },
      },
    });
    const r = await postar(CARTAO);
    expect(r.status).toBe(402);
    // Controle: o cartão SAIU para o Asaas (só para lá).
    expect(asaas.chamadas.find((c) => c.caminho.includes("payWithCreditCard"))?.corpo).toContain(NUMERO);
    nadaDoCartao(banco, r.texto);
  });

  it("⭐ aprovado na entrada paga: só o final e a bandeira ficam, nada mais do cartão", async () => {
    const { banco, e } = montar("entrada_paga", {
      "GET /customers": { corpo: { data: [{ id: "cus_1" }] } },
      "PUT /customers/cus_1": { corpo: { id: "cus_1" } },
      "GET /payments/pay_1": { corpo: { id: "pay_1", status: "PENDING", value: 597, dueDate: "2026-10-29", subscription: "sub_1" } },
      "POST /payments/pay_1/payWithCreditCard": { corpo: { id: "pay_1", status: "CONFIRMED", creditCard: { creditCardNumber: "1111", creditCardBrand: "VISA" } } },
      "POST /subscriptions/sub_1/updateCreditCard": { corpo: { id: "sub_1" } },
      "PUT /subscriptions/sub_1": { corpo: { id: "sub_1" } },
    });
    const r = await postar(CARTAO);
    expect(r.status).toBe(200);
    expect(e.linha).toMatchObject({ cartao_final: "1111", cartao_bandeira: "VISA" });
    nadaDoCartao(banco, r.texto);
  });

  it("⭐ cadastro no modo teste (nada cobrado): o cartão vai à assinatura e a nenhum registro", async () => {
    const { banco, asaas } = montar("teste", {
      "GET /customers": { corpo: { data: [] } },
      "POST /customers": { corpo: { id: "cus_1" } },
      "POST /subscriptions/sub_1/updateCreditCard": { corpo: { id: "sub_1" } },
      "PUT /subscriptions/sub_1": { corpo: { id: "sub_1" } },
      "GET /payments/pay_1": { corpo: { id: "pay_1", status: "PENDING", value: 597, dueDate: "2099-11-12", subscription: "sub_1" } },
    });
    const r = await postar(CARTAO);
    expect(r.status).toBe(200);
    expect(asaas.chamadas.some((c) => c.caminho.includes("payWithCreditCard"))).toBe(false);
    expect(asaas.chamadas.find((c) => c.caminho.endsWith("/updateCreditCard"))?.corpo).toContain(NUMERO);
    nadaDoCartao(banco, r.texto);
  });
});
