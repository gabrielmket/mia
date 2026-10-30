/**
 * FORK MIA (.96, segunda frente) · "TROCAR O CARTÃO" NA ÁREA DE COBRANÇA
 * (`POST /api/v1/cobranca/area/cartao`): o cartão novo vai para a assinatura do
 * Asaas SEM cobrar nada, e o número e o código de segurança NUNCA aparecem em
 * log, Sentry, auditoria, escrita no banco nem na resposta.
 *
 * O molde é `tests/unit/cartao-fora-dos-registros.test.ts` e
 * `pagamento-inicial-cartao-rota.test.ts` (a primeira frente). Os caminhos que
 * costumam vazar: o corpo que não é JSON, o cartão que não passa na
 * conferência, a recusa do banco com a descrição do Asaas ecoando o cartão, a
 * rede que cai com o corpo na mensagem do erro e a troca aprovada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ chamadas: [] as unknown[] }));
const auditoria = vi.hoisted(() => ({ chamadas: [] as unknown[] }));
const ctx = vi.hoisted(() => ({ banco: null as unknown }));

vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => sentry.chamadas.push(a),
  captureMessage: (...a: unknown[]) => sentry.chamadas.push(a),
  addBreadcrumb: (...a: unknown[]) => sentry.chamadas.push(a),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async (e: unknown) => void auditoria.chamadas.push(e)) }));
vi.mock("@/lib/cobranca/provedores/base-de-teste", () => ({ baseDeTesteDaCobranca: () => null }));
vi.mock("@/lib/cobranca/configuracao", () => ({ chaveDoProvedor: async () => ["$aact", "hmlg", "000000000000000000000000000000"].join("_") }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/cobranca/emails", () => ({ emailDoAdminDaEmpresa: async () => "admin@exemplo.com.br" }));
vi.mock("@/lib/area-de-cobranca/rota", async () => {
  const real = await vi.importActual<typeof import("@/lib/area-de-cobranca/rota")>("@/lib/area-de-cobranca/rota");
  return {
    ...real,
    acessoDaArea: async () => ({
      requestId: "00000000-0000-4000-8000-0000000000aa",
      user: { id: "00000000-0000-4000-8000-00000000a961" },
      org: { orgId: "00000000-0000-4000-8000-00000000c961", role: "admin" },
      admin: (ctx.banco as { cliente: unknown }).cliente,
    }),
  };
});

import { POST } from "@/app/api/v1/cobranca/area/cartao/route";
import { asaasFalso } from "@/tests/helpers/asaas-falso";
import { bancoLivre, operacaoLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

const ORG = "00000000-0000-4000-8000-00000000c961";
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

function montar(rotas: Parameters<typeof asaasFalso>[0]) {
  const banco = bancoLivre((c: CadeiaLivre) => {
    if (c.tabela === "cobranca_assinaturas") return { data: { provedor: "asaas", provedor_cliente_id: "cus_1", provedor_assinatura_id: "sub_1" } };
    if (c.tabela === "mia_dados_fiscais") {
      return {
        data: {
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
          asaas_sincronizado_em: null,
          updated_at: "2026-10-27T11:00:00Z",
        },
      };
    }
    return { data: null };
  });
  ctx.banco = banco;
  const a = asaasFalso(rotas);
  globalThis.fetch = a.fetch;
  return { banco, asaas: a };
}

async function postar(corpo: string): Promise<{ status: number; texto: string }> {
  const req = new Request("http://localhost/api/v1/cobranca/area/cartao", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "200.1.2.3" },
    body: corpo,
  });
  const r = await POST(req);
  return { status: r.status, texto: await r.text() };
}

/** A prova: nada do cartão em lugar nenhum que fica. */
function nadaDoCartao(banco: ReturnType<typeof bancoLivre>, resposta: string) {
  const tudo = [
    ...registros,
    ...sentry.chamadas.map(comoTexto),
    ...auditoria.chamadas.map(comoTexto),
    ...banco.cadeias.map(comoTexto),
    ...banco.rpcs.map(comoTexto),
    resposta,
  ].join("\n");
  expect(tudo, "o número do cartão apareceu num registro").not.toContain(NUMERO);
  expect(tudo, "o número do cartão apareceu num registro").not.toContain(NUMERO_COM_ESPACOS);
  expect(tudo, "o código de segurança apareceu num registro").not.toMatch(new RegExp(`(?<!\\d)${CVV}(?!\\d)`));
  expect(tudo, "um campo de código de segurança apareceu num registro").not.toMatch(/"(ccv|cvv)"\s*:/i);
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

describe("trocar o cartão: vai à assinatura do Asaas e a nenhum registro", () => {
  it("corpo que não é JSON (com o cartão no meio): 422 sem eco, e nada registrado", async () => {
    const { banco, asaas } = montar({});
    const r = await postar(`{numero: ${NUMERO}, cvv: ${CVV}`);
    expect(r.status).toBe(422);
    expect(asaas.chamadas).toEqual([]);
    nadaDoCartao(banco, r.texto);
  });

  it("cartão que não passa na conferência: a recusa diz o campo, nunca o valor", async () => {
    const { banco, asaas } = montar({});
    const r = await postar(JSON.stringify({ numero: "4111 1111 1111 1112", nome: "Fulana", validade: "12/31", cvv: CVV }));
    expect(r.status).toBe(422);
    expect(JSON.parse(r.texto).error.details).toEqual({ campo: "numero_invalido" });
    expect(asaas.chamadas).toEqual([]);
    nadaDoCartao(banco, r.texto);
  });

  it("⭐ recusa do banco com a descrição do Asaas ecoando o cartão: 402, e nada do cartão em log, auditoria, banco ou resposta", async () => {
    const { banco, asaas } = montar({
      "POST /subscriptions/sub_1/updateCreditCard": {
        status: 400,
        corpo: { errors: [{ code: "invalid_creditCard", description: `Cartão ${NUMERO} recusado, cvv ${CVV}` }] },
      },
    });
    const r = await postar(CARTAO);
    expect(r.status).toBe(402);
    // Controle: o cartão SAIU para o Asaas (só para lá).
    expect(asaas.chamadas.find((c) => c.caminho.endsWith("/updateCreditCard"))?.corpo).toContain(NUMERO);
    expect(banco.cadeias.some((c) => c.tabela === "mia_cartao_das_mensalidades")).toBe(false);
    expect(auditoria.chamadas).toEqual([expect.objectContaining({ action: "area_de_cobranca.cartao_trocado", metadata: { resultado: "recusado" } })]);
    nadaDoCartao(banco, r.texto);
  });

  it("a rede cai com o corpo na mensagem do erro: 502, e o erro do fetch não é registrado", async () => {
    const { banco } = montar({});
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      throw new TypeError(`fetch failed: ${String(init?.body)}`);
    }) as typeof fetch;
    const r = await postar(CARTAO);
    expect(r.status).toBe(502);
    nadaDoCartao(banco, r.texto);
  });

  it("⭐ trocado: NADA é cobrado, a assinatura passa ao cartão, e do cartão ficam só o final e a bandeira", async () => {
    const { banco, asaas } = montar({
      "POST /subscriptions/sub_1/updateCreditCard": { corpo: { id: "sub_1" } },
      "PUT /subscriptions/sub_1": { corpo: { id: "sub_1" } },
    });
    const r = await postar(CARTAO);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.texto).data).toEqual({ cartao_final: "1111", cartao_bandeira: "VISA" });
    // Nada cobrado na hora: nenhum pagamento com cartão.
    expect(asaas.chamadas.some((c) => c.caminho.includes("payWithCreditCard") || (c.metodo === "POST" && c.caminho.startsWith("/payments")))).toBe(false);
    expect(asaas.chamadas.find((c) => c.metodo === "PUT" && c.caminho === "/subscriptions/sub_1")?.corpo).toContain("CREDIT_CARD");
    const gravacao = banco.cadeias.find((c) => c.tabela === "mia_cartao_das_mensalidades");
    expect(gravacao && operacaoLivre(gravacao)).toBe("upsert");
    expect(gravacao?.passos.find((p) => p.metodo === "upsert")?.args[0]).toMatchObject({
      organization_id: ORG,
      cartao_final: "1111",
      cartao_bandeira: "VISA",
      assinatura_ref: "sub_1",
    });
    expect(auditoria.chamadas).toEqual([expect.objectContaining({ metadata: { resultado: "trocado" } })]);
    nadaDoCartao(banco, r.texto);
  });
});
