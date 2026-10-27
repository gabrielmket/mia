/**
 * FORK MIA (.96, segunda frente) · a leitura da área de cobrança e as cobranças
 * no MCP de plataforma (`plataforma_ver_cliente`), com o banco e o Asaas
 * dublados (nenhuma chamada sai daqui).
 *
 *   - a área lista as cobranças do cliente do Asaas DA EMPRESA, com a nota e o
 *     recibo, e o chamado "A nota saiu errada" de cada uma;
 *   - o Asaas que não responde não derruba a tela: a lista diz "falhou" e os
 *     dados fiscais aparecem;
 *   - empresa sem cliente no Asaas: "sem_asaas"; cobrança desligada ou outro
 *     provedor: a área não aparece;
 *   - o MCP devolve a cobrança com o número da nota e o link do PDF, e segue com
 *     99 ferramentas (nenhuma nova).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cobranca/provedores/base-de-teste", () => ({ baseDeTesteDaCobranca: () => null }));

import { lerAreaDeCobranca } from "@/lib/area-de-cobranca/leitura";
import { cobrancasParaATime } from "@/lib/area-de-cobranca/para-a-time";
import { asaasFalso, CHAVE_DE_TESTE } from "@/tests/helpers/asaas-falso";
import { bancoLivre, filtroLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

const ORG = "00000000-0000-4000-8000-00000000c961";

const FISCAIS = {
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
  inscricao_municipal: "12345",
  inscricao_estadual: null,
  telefone: "5531988880000",
  asaas_sincronizado_em: "2026-10-27T12:00:00Z",
  updated_at: "2026-10-27T11:00:00Z",
};

function banco(assinatura: Record<string, unknown> | null, extra: (c: CadeiaLivre) => { data?: unknown } | null = () => null) {
  return bancoLivre((c) => {
    const proprio = extra(c);
    if (proprio) return proprio;
    if (c.tabela === "cobranca_assinaturas") return { data: assinatura };
    if (c.tabela === "mia_dados_fiscais") return { data: filtroLivre(c, "eq", "organization_id") === ORG ? FISCAIS : null };
    if (c.tabela === "mia_chamados") {
      return { data: [{ numero: 1040, situacao: "novo", created_at: "2026-10-28T10:00:00Z", cobranca_ref: "pay_out", motivo: "razao_social" }] };
    }
    if (c.tabela === "mia_cartao_das_mensalidades") return { data: null };
    if (c.tabela === "mia_pagamento_inicial") return { data: null };
    return { data: null };
  });
}

const ASSINATURA = { provedor: "asaas", provedor_cliente_id: "cus_1", provedor_assinatura_id: "sub_1" };

const ROTAS = {
  "GET /payments": {
    corpo: {
      data: [
        { id: "pay_out", status: "RECEIVED", value: 597, dueDate: "2026-10-27", paymentDate: "2026-10-27", billingType: "PIX", subscription: "sub_1", invoiceUrl: "https://www.asaas.com/i/pay_out", transactionReceiptUrl: "https://www.asaas.com/comprovantes/pay_out" },
        { id: "pay_nov", status: "PENDING", value: 597, dueDate: "2026-11-27", billingType: "CREDIT_CARD", subscription: "sub_1", invoiceUrl: "https://www.asaas.com/i/pay_nov" },
        { id: "pay_ago", status: "PENDING", value: 597, dueDate: "2026-08-27", billingType: "PIX", subscription: "sub_1", deleted: true },
      ],
    },
  },
  "GET /invoices": {
    corpo: { data: [{ id: "inv_1", status: "AUTHORIZED", number: 418, pdfUrl: "https://www.asaas.com/nota/inv_1.pdf", xmlUrl: "https://www.asaas.com/nota/inv_1.xml", payment: "pay_out", value: 597 }] },
  },
  "GET /subscriptions/sub_1": {
    corpo: { id: "sub_1", billingType: "CREDIT_CARD", nextDueDate: "2026-11-27", status: "ACTIVE", creditCard: { creditCardNumber: "4821", creditCardBrand: "VISA" } },
  },
};

const deps = (a: ReturnType<typeof asaasFalso>) => ({
  asaas: { fetch: a.fetch, lerChave: async () => CHAVE_DE_TESTE, esperar: async () => undefined, baseDeTeste: null },
  cobrancaLigada: async () => true,
});

describe("a área de cobrança lê o Asaas da empresa", () => {
  it("⭐ as cobranças com a nota, o recibo, a segunda via e a correção pedida; o cartão das próximas", async () => {
    const a = asaasFalso(ROTAS);
    const area = await lerAreaDeCobranca(banco(ASSINATURA).cliente as never, ORG, deps(a));
    expect(area?.leitura).toBe("ok");
    expect(area?.cobrancas.map((c) => [c.ref, c.situacao])).toEqual([
      ["pay_nov", "aberta"],
      ["pay_out", "paga"],
      ["pay_ago", "cancelada"],
    ]);
    expect(area?.cobrancas[1]).toMatchObject({
      nota: { numero: "418", pdf_url: "https://www.asaas.com/nota/inv_1.pdf", xml_url: "https://www.asaas.com/nota/inv_1.xml" },
      recibo_url: "https://www.asaas.com/comprovantes/pay_out",
      correcao: { chamado: 1040, situacao: "novo" },
    });
    expect(area?.cobrancas[0]).toMatchObject({ pagar_url: "https://www.asaas.com/i/pay_nov", segunda_via_url: "https://www.asaas.com/i/pay_nov" });
    expect(area?.forma).toEqual({ no_cartao: true, cartao_final: "4821", cartao_bandeira: "VISA", proxima_em: "2026-11-27", pode_trocar: true });
    expect(area?.fiscais).toMatchObject({ documento: "11.222.333/0001-81", inscricao_municipal: "12345", no_asaas: true });
    // As cobranças são as DO CLIENTE da empresa.
    expect(a.chamadas.find((c) => c.caminho.startsWith("/payments"))?.caminho).toContain("customer=cus_1");
    // Só leitura: nenhuma escrita no Asaas.
    expect(a.chamadas.every((c) => c.metodo === "GET")).toBe(true);
  });

  it("o Asaas não responde: a lista diz 'falhou' e os dados fiscais aparecem", async () => {
    const a = asaasFalso({ "GET /payments": { status: 503, corpo: {} } });
    const area = await lerAreaDeCobranca(banco(ASSINATURA).cliente as never, ORG, deps(a));
    expect(area?.leitura).toBe("falhou");
    expect(area?.cobrancas).toEqual([]);
    expect(area?.fiscais?.razao_social).toBe("Clínica Exemplo Ltda");
  });

  it("empresa sem cliente no Asaas: 'sem_asaas', sem chamar o Asaas", async () => {
    const a = asaasFalso({});
    const area = await lerAreaDeCobranca(banco({ provedor: null, provedor_cliente_id: null, provedor_assinatura_id: null }).cliente as never, ORG, deps(a));
    expect(area).toMatchObject({ leitura: "sem_asaas", cobrancas: [], forma: null });
    expect(a.chamadas).toEqual([]);
  });

  it("a área não aparece com a cobrança desligada nem com outro provedor", async () => {
    const a = asaasFalso({});
    expect(await lerAreaDeCobranca(banco(ASSINATURA).cliente as never, ORG, { ...deps(a), cobrancaLigada: async () => false })).toBeNull();
    expect(await lerAreaDeCobranca(banco({ ...ASSINATURA, provedor: "stripe" }).cliente as never, ORG, deps(a))).toBeNull();
  });
});

describe("as cobranças no MCP de plataforma", () => {
  it("⭐ a cobrança com o número da nota e o link do PDF, e a correção pedida", async () => {
    const a = asaasFalso(ROTAS);
    const r = await cobrancasParaATime(banco(ASSINATURA).cliente as never, ORG, deps(a));
    expect(Array.isArray(r)).toBe(true);
    const out = (r as unknown as Array<Record<string, unknown>>).find((c) => c.cobranca === "pay_out");
    expect(out).toMatchObject({
      situacao: "paga",
      nota_numero: "418",
      nota_pdf_url: "https://www.asaas.com/nota/inv_1.pdf",
      correcao_pedida: { chamado: 1040, situacao: "novo" },
    });
  });

  it("sem Asaas: null; Asaas fora: 'nao_lido' (o retrato do cliente não cai)", async () => {
    expect(await cobrancasParaATime(banco(null).cliente as never, ORG, deps(asaasFalso({})))).toBeNull();
    expect(await cobrancasParaATime(banco(ASSINATURA).cliente as never, ORG, deps(asaasFalso({ "GET /payments": { status: 400, corpo: {} } })))).toBe("nao_lido");
  });
});
