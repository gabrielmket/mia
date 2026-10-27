/**
 * FORK MIA (.96) — a camada do Asaas das cobranças (lib/asaas-mia/). Asaas
 * dublado: nenhuma chamada sai daqui. O que se prova:
 *   - o cliente do Asaas recebe os dados fiscais com os avisos do Asaas
 *     DESLIGADOS (`notificationDisabled`), achado pela `externalReference` antes
 *     de criar (o Asaas não tem idempotência);
 *   - Pix, linha digitável, cobrança e notas lidos pelos caminhos da API;
 *   - apagar o que já foi apagado (404) não é falha;
 *   - a nota fiscal da assinatura sai NA CONFIRMAÇÃO do pagamento, e a
 *     configuração que já existe é atualizada;
 *   - a chave só no cabeçalho; link que não é https não vira link.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cobranca/provedores/base-de-teste", () => ({ baseDeTesteDaCobranca: () => null }));

import { asaasDaMia, corpoDoClienteFiscal, telefoneNacional } from "@/lib/asaas-mia/cobrancas";
import type { DadosFiscais } from "@/lib/dados-fiscais/regras";

const ORG = "00000000-0000-4000-8000-0000000000c1";
const CHAVE = ["$aact", "hmlg", "000000000000000000000000000000"].join("_");

const DADOS: DadosFiscais = {
  tipo: "pj",
  documento: "11222333000181",
  razao_social: "Clínica Exemplo Odontologia Ltda",
  cep: "30130010",
  logradouro: "Avenida Afonso Pena",
  numero: "1500",
  complemento: null,
  bairro: "Centro",
  cidade: "Belo Horizonte",
  uf: "MG",
  inscricao_municipal: "123456",
  inscricao_estadual: null,
  telefone: "5531988880000",
};

let chamadas: Array<{ url: string; init: RequestInit }>;
let respostas: Array<(url: string, init: RequestInit) => { status?: number; corpo?: unknown }>;

const fetchFalso = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  chamadas.push({ url: u, init: init ?? {} });
  const proxima = respostas.shift();
  const r = proxima ? proxima(u, init ?? {}) : {};
  return new Response(r.corpo === undefined ? "" : JSON.stringify(r.corpo), {
    status: r.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}) as unknown as typeof fetch;

const asaas = () => asaasDaMia({ fetch: fetchFalso, lerChave: async () => CHAVE, esperar: async () => undefined, baseDeTeste: null });
const corpoDe = (i: number) => JSON.parse(String(chamadas[i]!.init.body)) as Record<string, unknown>;

beforeEach(() => {
  chamadas = [];
  respostas = [];
});

describe("o cliente do Asaas com os dados fiscais", () => {
  it("⭐ não existe: procura pela externalReference e cria com os dados da nota e os avisos do Asaas desligados", async () => {
    respostas = [() => ({ corpo: { data: [] } }), () => ({ corpo: { id: "cus_1" } })];
    const ref = await asaas().garantirClienteFiscal({ orgId: ORG, clienteRef: null, dados: DADOS, email: "admin@exemplo.com.br" });
    expect(ref).toBe("cus_1");
    expect(chamadas[0]!.url).toBe(`https://api-sandbox.asaas.com/v3/customers?externalReference=${ORG}&limit=10`);
    expect(chamadas[1]!.init.method).toBe("POST");
    expect(corpoDe(1)).toEqual({
      name: "Clínica Exemplo Odontologia Ltda",
      cpfCnpj: "11222333000181",
      email: "admin@exemplo.com.br",
      mobilePhone: "31988880000",
      postalCode: "30130010",
      address: "Avenida Afonso Pena",
      addressNumber: "1500",
      complement: "",
      province: "Centro",
      municipalInscription: "123456",
      notificationDisabled: true,
      externalReference: ORG,
    });
  });

  it("já existe (achado ou conhecido): atualiza o mesmo cliente, sem criar outro", async () => {
    respostas = [() => ({ corpo: { data: [{ id: "cus_9" }] } }), () => ({ corpo: { id: "cus_9" } })];
    expect(await asaas().garantirClienteFiscal({ orgId: ORG, clienteRef: null, dados: DADOS, email: null })).toBe("cus_9");
    expect(chamadas[1]!.init.method).toBe("PUT");
    expect(chamadas[1]!.url).toMatch(/\/customers\/cus_9$/);
    expect(corpoDe(1)).toMatchObject({ notificationDisabled: true, name: DADOS.razao_social });
    expect(corpoDe(1)).not.toHaveProperty("email");

    chamadas = [];
    respostas = [() => ({ corpo: { id: "cus_7" } })];
    expect(await asaas().garantirClienteFiscal({ orgId: ORG, clienteRef: "cus_7", dados: DADOS, email: "a@b.co" })).toBe("cus_7");
    expect(chamadas).toHaveLength(1);
  });

  it("sem cliente e sem e-mail de admin: recusa sem criar", async () => {
    respostas = [() => ({ corpo: { data: [] } })];
    await expect(asaas().garantirClienteFiscal({ orgId: ORG, clienteRef: null, dados: DADOS, email: null })).rejects.toMatchObject({ codigo: "empresa_sem_email" });
    expect(chamadas).toHaveLength(1);
  });

  it("o telefone vai sem o 55; a pessoa física não leva inscrição", () => {
    expect(telefoneNacional("5531988880000")).toBe("31988880000");
    expect(corpoDoClienteFiscal({ ...DADOS, tipo: "pf", inscricao_municipal: null }, null)).not.toHaveProperty("municipalInscription");
  });
});

describe("a cobrança, o Pix e o boleto", () => {
  it("lê a cobrança: situação, forma, valor, recibo; link que não é https fica de fora", async () => {
    respostas = [
      () => ({
        corpo: {
          id: "pay_1",
          status: "RECEIVED",
          value: 597,
          dueDate: "2026-10-29",
          clientPaymentDate: "2026-10-29",
          billingType: "PIX",
          subscription: "sub_1",
          invoiceUrl: "https://sandbox.asaas.com/i/pay_1",
          bankSlipUrl: "javascript:alert(1)",
          transactionReceiptUrl: "https://sandbox.asaas.com/comprovantes/1",
        },
      }),
    ];
    const c = await asaas().lerCobranca("pay_1");
    expect(c).toMatchObject({
      ref: "pay_1",
      situacao: "paga",
      forma: "pix",
      valorCents: 59700,
      pagaEm: "2026-10-29",
      assinaturaRef: "sub_1",
      faturaUrl: "https://sandbox.asaas.com/i/pay_1",
      boletoUrl: null,
      reciboUrl: "https://sandbox.asaas.com/comprovantes/1",
    });
  });

  it("o Pix e a linha digitável pelos caminhos da API", async () => {
    respostas = [
      () => ({ corpo: { payload: "00020101PIX", encodedImage: "iVBOR", expirationDate: "2027-10-29 23:59:59" } }),
      () => ({ corpo: { identificationField: "34191790010104351004791020150008291070026000", barCode: "3419..." } }),
    ];
    expect(await asaas().lerPix("pay_1")).toEqual({ copiaECola: "00020101PIX", imagemBase64: "iVBOR", expiraEm: "2027-10-29 23:59:59" });
    expect(await asaas().lerLinhaDigitavel("pay_1")).toMatchObject({ linha: "34191790010104351004791020150008291070026000" });
    expect(chamadas[0]!.url).toMatch(/\/payments\/pay_1\/pixQrCode$/);
    expect(chamadas[1]!.url).toMatch(/\/payments\/pay_1\/identificationField$/);
  });

  it("apagar cobrança ou assinatura que já não existe (404) é o efeito desejado", async () => {
    respostas = [() => ({ status: 404, corpo: {} }), () => ({ status: 404, corpo: {} })];
    await expect(asaas().cancelarCobranca("pay_x")).resolves.toBeUndefined();
    await expect(asaas().cancelarAssinatura("sub_x")).resolves.toBeUndefined();
    expect(chamadas.map((c) => c.init.method)).toEqual(["DELETE", "DELETE"]);
  });

  it("a chave só no cabeçalho, nunca na URL", async () => {
    respostas = [() => ({ corpo: { data: [] } })];
    await asaas().listarCobrancasDoCliente("cus_1");
    expect(chamadas[0]!.url).not.toContain(CHAVE);
    expect((chamadas[0]!.init.headers as Record<string, string>).access_token).toBe(CHAVE);
  });
});

describe("a nota fiscal", () => {
  it("as notas de uma cobrança: número, PDF e XML", async () => {
    respostas = [
      () => ({
        corpo: {
          data: [
            { id: "inv_1", status: "AUTHORIZED", number: 418, pdfUrl: "https://s.asaas.com/n.pdf", xmlUrl: "https://s.asaas.com/n.xml", payment: "pay_1", value: 597, effectiveDate: "2026-10-29" },
          ],
        },
      }),
    ];
    expect(await asaas().listarNotas({ pagamentoRef: "pay_1" })).toEqual([
      { ref: "inv_1", status: "AUTHORIZED", situacao: "emitida", numero: "418", pdfUrl: "https://s.asaas.com/n.pdf", xmlUrl: "https://s.asaas.com/n.xml", pagamentoRef: "pay_1", valorCents: 59700, emitidaEm: "2026-10-29" },
    ]);
    expect(chamadas[0]!.url).toContain("/invoices?limit=100&payment=pay_1");
    expect(await asaas().listarNotas({})).toEqual([]);
  });

  it("⭐ a configuração da assinatura pede a nota NA CONFIRMAÇÃO do pagamento; a que já existe é atualizada", async () => {
    const config = {
      servicoMunicipalId: null,
      servicoMunicipalCodigo: "01.07",
      servicoMunicipalNome: "Suporte técnico em informática",
      observacoes: null,
      impostos: { reterIss: false, iss: 2, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 },
    };
    respostas = [() => ({ status: 400, corpo: { errors: [{ code: "invalid_action" }] } }), () => ({ corpo: {} })];
    await asaas().configurarNotaDaAssinatura("sub_1", config);
    expect(chamadas.map((c) => c.init.method)).toEqual(["POST", "PUT"]);
    expect(chamadas[0]!.url).toMatch(/\/subscriptions\/sub_1\/invoiceSettings$/);
    expect(corpoDe(0)).toMatchObject({
      effectiveDatePeriod: "ON_PAYMENT_CONFIRMATION",
      municipalServiceCode: "01.07",
      taxes: { retainIss: false, iss: 2, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 },
    });
    expect(corpoDe(1)).toEqual(corpoDe(0));
  });
});
