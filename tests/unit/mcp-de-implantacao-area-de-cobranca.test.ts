/**
 * FORK MIA (.96, segunda frente) · as cobranças da empresa no MCP de plataforma
 * (docs/fork/mcp-de-implantacao.md, "A área de cobrança (.96, segunda frente)").
 * O que se prova:
 *   - nenhuma ferramenta nova nesta peça (a contagem da lista mora no teste da cobrança);
 *   - `plataforma_ver_cliente` traz, em `cobrancas`, cada cobrança com a
 *     situação, o número da nota fiscal e o link do PDF, e o chamado "A nota saiu
 *     errada" dela; a descrição da ferramenta diz isso;
 *   - a empresa sem cobrança pelo Asaas devolve `null`, e o Asaas fora não
 *     derruba o retrato ("nao_lido").
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/cobranca/provedores/base-de-teste", () => ({ baseDeTesteDaCobranca: () => null }));
vi.mock("@/lib/cobranca/configuracao", () => ({
  toleranciaDias: async () => 7,
  provedorDaInstalacao: async () => "asaas",
  chaveDoProvedor: async () => ["$aact", "hmlg", "000000000000000000000000000000"].join("_"),
}));
vi.mock("@/lib/carteira/ler-saldo", () => ({ lerSaldoDaCarteira: async () => ({ saldo_cents: 0, truncado: false, erro: null }) }));
vi.mock("@/lib/implantacao/agente", () => ({ lerCamadaClinica: async () => null }));
vi.mock("@/lib/planos-mia/empresas-do-cadastro", () => ({ lerDetalheDaEmpresa: async () => null }));

import { FERRAMENTAS, FERRAMENTA_POR_NOME } from "@/lib/mcp-plataforma/ferramentas";
import { asaasFalso } from "@/tests/helpers/asaas-falso";
import { bancoLivre, filtroLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

const COM_ASAAS = "00000000-0000-4000-8000-0000000000d1";
const SEM_ASAAS = "00000000-0000-4000-8000-0000000000d2";
const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

function responder(c: CadeiaLivre) {
  if (c.tabela === "platform_config") return { data: [{ chave: "MODULO_COBRANCA", valor: "ligado" }] };
  if (c.tabela === "modulos_instalados") return { data: [] };
  if (c.tabela === "cobranca_assinaturas") {
    return {
      data:
        filtroLivre(c, "eq", "organization_id") === COM_ASAAS
          ? { plano_id: "p1", estado: "ativa", pagamento_inicial_pendente: false, provedor: "asaas", provedor_cliente_id: "cus_1", provedor_assinatura_id: "sub_1", proximo_vencimento: "2026-11-27T00:00:00Z" }
          : null,
    };
  }
  if (c.tabela === "mia_chamados") return { data: [{ numero: 1040, situacao: "em_analise", cobranca_ref: "pay_out", motivo: "razao_social" }] };
  if (c.tabela === "organizations") {
    const id = filtroLivre(c, "eq", "id");
    return { data: { id, display_name: "Empresa", status: "active", onboarded_at: "2026-10-01T00:00:00Z", settings: {} } };
  }
  return { data: null };
}

const ctx = (banco: ReturnType<typeof bancoLivre>) => ({ admin: banco.cliente as never, autorUserId: "a", tokenId: "t", requestId: "r", escopos: [] });

describe("as cobranças no MCP de plataforma", () => {
  it("nenhuma ferramenta nova nesta peça (99 + a de etiquetar da .97 + as 6 de cupons da .98), e a descrição de ver_cliente cita as cobranças e a nota", () => {
    expect(FERRAMENTAS).toHaveLength(106);
    const d = FERRAMENTA_POR_NOME.get("plataforma_ver_cliente")!.description;
    expect(d).toContain("`cobrancas`");
    expect(d).toContain("número da nota fiscal");
  });

  it("⭐ ver_cliente: as cobranças com o número da nota e o link do PDF, e o chamado da nota errada", async () => {
    globalThis.fetch = asaasFalso({
      "GET /payments": {
        corpo: { data: [{ id: "pay_out", status: "RECEIVED", value: 597, dueDate: "2026-10-27", paymentDate: "2026-10-27", billingType: "PIX", subscription: "sub_1" }] },
      },
      "GET /invoices": { corpo: { data: [{ id: "inv_1", status: "AUTHORIZED", number: 418, pdfUrl: "https://www.asaas.com/nota/inv_1.pdf", payment: "pay_out", value: 597 }] } },
    }).fetch;
    const r = (await FERRAMENTA_POR_NOME.get("plataforma_ver_cliente")!.handler(ctx(bancoLivre(responder)) as never, { organization_id: COM_ASAAS })) as {
      cobrancas: Array<Record<string, unknown>>;
    };
    expect(r.cobrancas).toEqual([
      expect.objectContaining({
        cobranca: "pay_out",
        situacao: "paga",
        valor_cents: 59700,
        nota_numero: "418",
        nota_pdf_url: "https://www.asaas.com/nota/inv_1.pdf",
        correcao_pedida: { chamado: 1040, situacao: "em_analise" },
      }),
    ]);
  });

  it("a empresa sem cobrança pelo Asaas: null; o Asaas fora: 'nao_lido', e o retrato sai do mesmo jeito", async () => {
    const sem = (await FERRAMENTA_POR_NOME.get("plataforma_ver_cliente")!.handler(ctx(bancoLivre(responder)) as never, { organization_id: SEM_ASAAS })) as {
      cobrancas: unknown;
    };
    expect(sem.cobrancas).toBeNull();
    globalThis.fetch = asaasFalso({ "GET /payments": { status: 401, corpo: { errors: [{ code: "invalid_access_token" }] } } }).fetch;
    const fora = (await FERRAMENTA_POR_NOME.get("plataforma_ver_cliente")!.handler(ctx(bancoLivre(responder)) as never, { organization_id: COM_ASAAS })) as {
      cobrancas: unknown;
      cliente: unknown;
    };
    expect(fora.cobrancas).toBe("nao_lido");
    expect(fora.cliente).toBeTruthy();
  });
});
