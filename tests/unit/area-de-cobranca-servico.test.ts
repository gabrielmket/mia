/**
 * FORK MIA (.96, segunda frente) · as escritas da área de cobrança, com o banco
 * e o Asaas dublados (decisões 10 e 11 do protótipo "Pagamento no início"):
 *
 *   - dados fiscais: o CPF ou CNPJ e o tipo NUNCA mudam por aqui (vale o
 *     gravado, e a gravação vai com `permitirTrocarDocumento: false`); o cliente
 *     do Asaas recebe na hora; o WhatsApp entra;
 *   - "A nota saiu errada": a cobrança é procurada entre as do cliente do Asaas
 *     DA EMPRESA e precisa estar paga; vira um chamado da SESSÃO (tipo pedido),
 *     com a marca `contexto.cobranca` e o número da nota; o pedido repetido com
 *     o chamado aberto é recusado; a Time recebe o recado.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/cobranca/provedores/base-de-teste", () => ({ baseDeTesteDaCobranca: () => null }));

import { pedirCorrecaoDaNota, salvarDadosFiscaisDaArea } from "@/lib/area-de-cobranca/servico";
import { asaasFalso, CHAVE_DE_TESTE } from "@/tests/helpers/asaas-falso";
import { bancoLivre, operacaoLivre, type CadeiaLivre } from "@/tests/helpers/banco-livre";

const ORG = "00000000-0000-4000-8000-00000000c962";
const USER = "00000000-0000-4000-8000-00000000a962";

const GRAVADOS = {
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
};

const depsDoAsaas = (a: ReturnType<typeof asaasFalso>) => ({
  asaas: { fetch: a.fetch, lerChave: async () => CHAVE_DE_TESTE, esperar: async () => undefined, baseDeTeste: null },
  emailDoAdmin: async () => "admin@exemplo.com.br",
});

function bancoComFiscais(chamados: unknown[] = []) {
  return bancoLivre((c: CadeiaLivre) => {
    if (c.tabela === "mia_dados_fiscais") {
      const upsert = c.passos.find((p) => p.metodo === "upsert");
      if (upsert) return { data: { ...GRAVADOS, ...(upsert.args[0] as object), updated_at: "2026-10-28T12:00:00Z" } };
      if (operacaoLivre(c) === "update") return { data: { organization_id: ORG } };
      return { data: GRAVADOS };
    }
    if (c.tabela === "cobranca_assinaturas") return { data: { provedor: "asaas", provedor_cliente_id: "cus_1", provedor_assinatura_id: "sub_1" } };
    if (c.tabela === "mia_chamados") return { data: chamados };
    return { data: null };
  });
}

describe("os dados fiscais pela área de cobrança", () => {
  it("⭐ o CNPJ e o tipo que a tela mandar não valem: grava com o documento gravado e leva ao Asaas", async () => {
    const banco = bancoComFiscais();
    const a = asaasFalso({ "PUT /customers/cus_1": { corpo: { id: "cus_1" } } });
    const r = await salvarDadosFiscaisDaArea(
      banco.cliente as never,
      {
        orgId: ORG,
        userId: USER,
        requestId: "r",
        entrada: {
          tipo: "pf",
          documento: "529.982.247-25",
          razao_social: "Clínica Exemplo Odontologia Ltda",
          cep: "30130-010",
          logradouro: "Avenida Afonso Pena",
          numero: "1500",
          complemento: "Sala 803",
          bairro: "Centro",
          cidade: "Belo Horizonte",
          uf: "mg",
          inscricao_municipal: "12345",
          telefone: "(31) 98888-0000",
        },
      },
      depsDoAsaas(a),
    );
    expect(r).toEqual({ ok: true, no_asaas: true });
    const gravacao = banco.cadeias.find((c) => c.tabela === "mia_dados_fiscais" && operacaoLivre(c) === "upsert");
    expect(gravacao?.passos.find((p) => p.metodo === "upsert")?.args[0]).toMatchObject({
      tipo: "pj",
      documento: "11222333000181",
      razao_social: "Clínica Exemplo Odontologia Ltda",
      inscricao_municipal: "12345",
      asaas_sincronizado_em: null,
    });
    const noAsaas = a.chamadas.find((c) => c.metodo === "PUT" && c.caminho === "/customers/cus_1");
    expect(JSON.parse(noAsaas!.corpo)).toMatchObject({ name: "Clínica Exemplo Odontologia Ltda", cpfCnpj: "11222333000181", notificationDisabled: true });
  });

  it("campo ruim volta com o campo, e nada é gravado", async () => {
    const banco = bancoComFiscais();
    const r = await salvarDadosFiscaisDaArea(
      banco.cliente as never,
      { orgId: ORG, userId: USER, requestId: "r", entrada: { razao_social: "X Ltda", cep: "301", logradouro: "", numero: "1", bairro: "B", cidade: "C", uf: "MG" } },
      depsDoAsaas(asaasFalso({})),
    );
    expect(r).toMatchObject({ ok: false, status: 422, code: "validation_failed", details: { campos: { cep: "invalido", logradouro: "obrigatorio" } } });
    expect(banco.cadeias.some((c) => c.tabela === "mia_dados_fiscais" && operacaoLivre(c) === "upsert")).toBe(false);
  });

  it("o Asaas fora: grava mesmo assim, e a rodada leva depois (no_asaas: false)", async () => {
    const banco = bancoComFiscais();
    const r = await salvarDadosFiscaisDaArea(
      banco.cliente as never,
      { orgId: ORG, userId: USER, requestId: "r", entrada: { razao_social: "Clínica Exemplo Ltda", cep: "30130010", logradouro: "Rua A", numero: "10", bairro: "Centro", cidade: "Belo Horizonte", uf: "MG" } },
      depsDoAsaas(asaasFalso({ "PUT /customers/cus_1": { status: 400, corpo: { errors: [{ code: "x" }] } } })),
    );
    expect(r).toEqual({ ok: true, no_asaas: false });
  });
});

describe("A nota saiu errada", () => {
  const ROTAS = {
    "GET /payments": {
      corpo: {
        data: [
          { id: "pay_out", status: "RECEIVED", value: 597, dueDate: "2026-10-27", paymentDate: "2026-10-27", billingType: "PIX", subscription: "sub_1" },
          { id: "pay_nov", status: "PENDING", value: 597, dueDate: "2026-11-27", billingType: "PIX", subscription: "sub_1" },
        ],
      },
    },
    "GET /invoices": { corpo: { data: [{ id: "inv_1", status: "AUTHORIZED", number: "418", payment: "pay_out", value: 597 }] } },
  };
  const contexto = { versao: "1.21.0-mia.96", navegador: "Chrome no Windows", hora_local: "28/10 12:00", empresa: "Clínica Exemplo" };

  function sessao(resposta: { data: unknown; error: unknown } = { data: { id: "ch-1", numero: 1040, demonstracao: false }, error: null }) {
    const inseridos: unknown[] = [];
    const cliente = {
      from: (tabela: string) => ({
        insert: (linha: unknown) => {
          inseridos.push({ tabela, linha });
          return { select: () => ({ single: async () => resposta }) };
        },
      }),
    };
    return { cliente, inseridos };
  }

  it("⭐ vira um chamado da sessão, tipo pedido, com a marca da cobrança e o número da nota; a Time recebe o recado", async () => {
    const s = sessao();
    const reportar = vi.fn(async () => true);
    const r = await pedirCorrecaoDaNota(
      s.cliente as never,
      bancoComFiscais().cliente as never,
      { orgId: ORG, userId: USER, papel: "admin", requestId: "r", contexto, entrada: { cobranca_ref: "pay_out", motivo: "razao_social", texto: "Saiu sem o Odontologia." } },
      { ...depsDoAsaas(asaasFalso(ROTAS)), reportar },
    );
    expect(r).toEqual({ ok: true, chamado: 1040, demonstracao: false });
    const { tabela, linha } = s.inseridos[0] as { tabela: string; linha: { tipo: string; texto: string; organization_id: string; contexto: Record<string, unknown> } };
    expect(tabela).toBe("mia_chamados");
    expect(linha.organization_id).toBe(ORG);
    expect(linha.tipo).toBe("pedido");
    expect(linha.texto).toContain("nota nº 418");
    expect(linha.texto).toContain("Saiu sem o Odontologia.");
    expect(linha.contexto.cobranca).toEqual({ ref: "pay_out", nota: "418", motivo: "razao_social", vencimento: "2026-10-27", valor_cents: 59700 });
    expect(linha.contexto.tela).toEqual({ caminho: "/app/settings/billing", rotulo: "Plano e cobrança" });
    expect(reportar).toHaveBeenCalledTimes(1);
  });

  it("a cobrança de OUTRA empresa (fora do cliente do Asaas dela) é recusada, e nada é aberto", async () => {
    const s = sessao();
    const r = await pedirCorrecaoDaNota(
      s.cliente as never,
      bancoComFiscais().cliente as never,
      { orgId: ORG, userId: USER, papel: "admin", requestId: "r", contexto, entrada: { cobranca_ref: "pay_deoutro", motivo: "outro", texto: "Nota errada" } },
      depsDoAsaas(asaasFalso(ROTAS)),
    );
    expect(r).toMatchObject({ ok: false, status: 404, code: "cobranca_nao_encontrada" });
    expect(s.inseridos).toEqual([]);
  });

  it("cobrança em aberto não tem nota para corrigir", async () => {
    const s = sessao();
    const r = await pedirCorrecaoDaNota(
      s.cliente as never,
      bancoComFiscais().cliente as never,
      { orgId: ORG, userId: USER, papel: "admin", requestId: "r", contexto, entrada: { cobranca_ref: "pay_nov", motivo: "outro", texto: "Nota errada" } },
      depsDoAsaas(asaasFalso(ROTAS)),
    );
    expect(r).toMatchObject({ ok: false, status: 409, code: "cobranca_nao_paga" });
    expect(s.inseridos).toEqual([]);
  });

  it("com a correção já pedida e aberta, não abre outro chamado", async () => {
    const s = sessao();
    const r = await pedirCorrecaoDaNota(
      s.cliente as never,
      bancoComFiscais([{ numero: 1039, situacao: "em_analise", cobranca_ref: "pay_out", motivo: "endereco" }]).cliente as never,
      { orgId: ORG, userId: USER, papel: "admin", requestId: "r", contexto, entrada: { cobranca_ref: "pay_out", motivo: "razao_social", texto: "De novo" } },
      depsDoAsaas(asaasFalso(ROTAS)),
    );
    expect(r).toMatchObject({ ok: false, status: 409, code: "correcao_ja_pedida", details: { chamado: 1039 } });
    expect(s.inseridos).toEqual([]);
  });

  it("na empresa de demonstração o chamado fica registrado e não vai recado à Time", async () => {
    const s = sessao({ data: { id: "ch-2", numero: 1041, demonstracao: true }, error: null });
    const reportar = vi.fn(async () => true);
    const r = await pedirCorrecaoDaNota(
      s.cliente as never,
      bancoComFiscais().cliente as never,
      { orgId: ORG, userId: USER, papel: "admin", requestId: "r", contexto, entrada: { cobranca_ref: "pay_out", motivo: "endereco", texto: "Saiu sem a sala." } },
      { ...depsDoAsaas(asaasFalso(ROTAS)), reportar },
    );
    expect(r).toEqual({ ok: true, chamado: 1041, demonstracao: true });
    expect(reportar).not.toHaveBeenCalled();
  });
});
