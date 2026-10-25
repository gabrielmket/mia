/**
 * FORK MIA (.90) — créditos por Pix pelo mesmo Asaas da cobrança
 * (lib/carteira/compra-pelo-asaas.ts). O que se prova:
 *   - só compra quem já é cliente do Asaas, com a cobrança ligada, um pacote ativo;
 *   - a cobrança avulsa sai por Pix, com a `externalReference` da compra, e a
 *     resposta perdida é achada antes de criar outra (o Asaas não tem idempotência);
 *   - o valor só entra na carteira quando a RELEITURA diz pago, pela função do
 *     banco (uma vez só); pendente não lança; apagada vira cancelada;
 *   - a chave do Asaas só vai no cabeçalho.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/cobranca/provedores/base-de-teste", () => ({ baseDeTesteDaCobranca: () => null }));

import { conferirCompra, iniciarCompraDeCreditos, podeComprarCreditos } from "@/lib/carteira/compra-pelo-asaas";
import { argumentosLivres, bancoLivre, operacaoLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

const ORG = "00000000-0000-4000-8000-0000000000c1";
const CHAVE = "$aact_hmlg_0000000000000000000000000000";

interface Estado {
  pacotes: Array<{ id: string; valor_cents: number; ordem: number }>;
  assinatura: { provedor: string | null; provedor_cliente_id: string | null } | null;
  aberta: Record<string, unknown> | null;
  compra: Record<string, unknown> | null;
}
let e: Estado;
let chamadas: Array<{ url: string; init: RequestInit }>;
let respostasDoAsaas: Array<(url: string) => unknown>;

function responder(c: CadeiaLivre) {
  if (c.tabela === "mia_pacotes_de_creditos") return { data: e.pacotes };
  if (c.tabela === "cobranca_assinaturas") return { data: e.assinatura };
  if (c.tabela === "mia_compras_de_creditos") {
    const op = operacaoLivre(c);
    if (op === "insert") return { data: { id: "11111111-1111-4111-8111-111111111111" } };
    if (op === "update") {
      const campos = argumentosLivres(c, "update")?.[0] as Record<string, unknown>;
      return { data: { id: "11111111-1111-4111-8111-111111111111", valor_cents: 10000, criada_em: "2026-10-25T13:00:00Z", paga_em: null, ...campos } };
    }
    // select: a compra em aberto (iniciar) ou a compra a conferir.
    const ehConferencia = c.passos.some((p) => p.metodo === "select" && String(p.args[0]).includes("pagamento_ref"));
    return { data: ehConferencia ? e.compra : e.aberta };
  }
  return {};
}

const fetchFalso = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  chamadas.push({ url: u, init: init ?? {} });
  const proxima = respostasDoAsaas.shift();
  const corpo = proxima ? proxima(u) : {};
  return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
}) as unknown as typeof fetch;

const deps = (extra: Partial<Parameters<typeof iniciarCompraDeCreditos>[2]> = {}) => ({
  fetch: fetchFalso,
  lerChave: async () => CHAVE,
  cobrancaLigada: async () => true,
  agora: () => new Date("2026-10-25T13:30:00Z"),
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  chamadas = [];
  respostasDoAsaas = [];
  e = {
    pacotes: [
      { id: "pa", valor_cents: 10000, ordem: 0 },
      { id: "pb", valor_cents: 25000, ordem: 1 },
    ],
    assinatura: { provedor: "asaas", provedor_cliente_id: "cus_123" },
    aberta: null,
    compra: null,
  };
});

describe("quem pode comprar", () => {
  it("com a cobrança desligada, ninguém (nada muda para quem não usa)", async () => {
    const { cliente } = bancoLivre(responder);
    expect(await podeComprarCreditos(cliente as never, ORG, { cobrancaLigada: async () => false })).toEqual({ pode: false, motivo: "cobranca_desligada" });
  });
  it("a empresa isenta (sem assinatura) segue com a Time; a que não assinou no Asaas ainda não compra", async () => {
    e.assinatura = null;
    expect(await podeComprarCreditos(bancoLivre(responder).cliente as never, ORG, deps())).toEqual({ pode: false, motivo: "sem_assinatura" });
    e.assinatura = { provedor: null, provedor_cliente_id: null };
    expect(await podeComprarCreditos(bancoLivre(responder).cliente as never, ORG, deps())).toEqual({ pode: false, motivo: "sem_cliente_no_asaas" });
    e.assinatura = { provedor: "stripe", provedor_cliente_id: "cus_s" };
    expect(await podeComprarCreditos(bancoLivre(responder).cliente as never, ORG, deps())).toEqual({ pode: false, motivo: "provedor_nao_e_asaas" });
  });
});

describe("gerar o Pix", () => {
  it("valor fora dos pacotes é recusado antes de qualquer chamada ao Asaas", async () => {
    const r = await iniciarCompraDeCreditos(bancoLivre(responder).cliente as never, { orgId: ORG, valorCents: 12345, userId: null }, deps());
    expect(r).toMatchObject({ ok: false, code: "pacote_invalido" });
    expect(chamadas).toEqual([]);
  });

  it("⭐ cria a cobrança por PIX com a externalReference da compra, depois de procurar a perdida; a chave só no cabeçalho", async () => {
    respostasDoAsaas = [
      () => ({ data: [] }),
      () => ({ id: "pay_1", status: "PENDING", invoiceUrl: "https://sandbox.asaas.com/i/pay_1" }),
      () => ({ payload: "000201PIX" }),
    ];
    const banco = bancoLivre(responder);
    const r = await iniciarCompraDeCreditos(banco.cliente as never, { orgId: ORG, valorCents: 10000, userId: "u1" }, deps());
    expect(r).toMatchObject({ ok: true, reaproveitada: false, compra: { status: "aguardando", link: "https://sandbox.asaas.com/i/pay_1", pix_copia_e_cola: "000201PIX" } });
    expect(chamadas[0]!.url).toContain("externalReference=creditos%3A" + ORG);
    expect(chamadas[1]!.init.method).toBe("POST");
    const corpo = JSON.parse(String(chamadas[1]!.init.body));
    expect(corpo).toMatchObject({ customer: "cus_123", billingType: "PIX", value: 100, externalReference: `creditos:${ORG}:11111111-1111-4111-8111-111111111111` });
    for (const c of chamadas) {
      expect(c.url).not.toContain(CHAVE);
      expect((c.init.headers as Record<string, string>).access_token).toBe(CHAVE);
    }
    // Nada entrou na carteira aqui.
    expect(banco.rpcs).toEqual([]);
    expect(banco.cadeias.some((c) => c.tabela === "tenant_wallet_ledger")).toBe(false);
  });

  it("a compra em aberto do mesmo valor volta de novo, sem outra cobrança", async () => {
    e.aberta = { id: "c0", valor_cents: 10000, status: "aguardando", link: "https://x", pix_copia_e_cola: null, modo: "teste", criada_em: "2026-10-25T13:00:00Z", paga_em: null };
    const r = await iniciarCompraDeCreditos(bancoLivre(responder).cliente as never, { orgId: ORG, valorCents: 10000, userId: null }, deps());
    expect(r).toMatchObject({ ok: true, reaproveitada: true, compra: { id: "c0" } });
    expect(chamadas).toEqual([]);
  });

  it("a cobrança desligada recusa com a frase que manda falar com a equipe", async () => {
    const r = await iniciarCompraDeCreditos(bancoLivre(responder).cliente as never, { orgId: ORG, valorCents: 10000, userId: null }, deps({ cobrancaLigada: async () => false }));
    expect(r).toMatchObject({ ok: false, code: "cobranca_desligada" });
  });
});

describe("conferir: o valor só entra quando a releitura diz pago", () => {
  beforeEach(() => {
    e.compra = { id: "11111111-1111-4111-8111-111111111111", organization_id: ORG, status: "aguardando", pagamento_ref: "pay_1", criada_em: "2026-10-25T13:00:00Z", valor_cents: 10000 };
  });

  it("⭐ pago: a função do banco lança uma vez", async () => {
    respostasDoAsaas = [() => ({ id: "pay_1", status: "RECEIVED", paymentDate: "2026-10-25" })];
    const banco = bancoLivre(responder, (nome) => (nome === "fn_mia_confirmar_compra_de_creditos" ? { data: { mudou: true, lancou: true } } : {}));
    expect(await conferirCompra(banco.cliente as never, "11111111-1111-4111-8111-111111111111", deps())).toEqual({ status: "paga", lancou: true });
    expect(banco.rpcs.map((r) => r.nome)).toEqual(["fn_mia_confirmar_compra_de_creditos"]);
    // Nunca escreve a carteira direto: só pela função, que é idempotente.
    expect(banco.cadeias.some((c) => c.tabela === "tenant_wallet_ledger")).toBe(false);
  });

  it("pendente: nada é lançado", async () => {
    respostasDoAsaas = [() => ({ id: "pay_1", status: "PENDING" })];
    const banco = bancoLivre(responder);
    expect(await conferirCompra(banco.cliente as never, "11111111-1111-4111-8111-111111111111", deps())).toEqual({ status: "aguardando", lancou: false });
    expect(banco.rpcs).toEqual([]);
  });

  it("apagada no Asaas: vira cancelada, sem lançar", async () => {
    respostasDoAsaas = [() => ({ id: "pay_1", status: "DELETED" })];
    const banco = bancoLivre(responder);
    expect(await conferirCompra(banco.cliente as never, "11111111-1111-4111-8111-111111111111", deps())).toEqual({ status: "cancelada", lancou: false });
    expect(banco.rpcs).toEqual([]);
  });

  it("já paga: não relê nem lança de novo", async () => {
    e.compra = { ...e.compra!, status: "paga" };
    const banco = bancoLivre(responder);
    expect(await conferirCompra(banco.cliente as never, "11111111-1111-4111-8111-111111111111", deps())).toEqual({ status: "paga", lancou: false });
    expect(chamadas).toEqual([]);
  });
});
