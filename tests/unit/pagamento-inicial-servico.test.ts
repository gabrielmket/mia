/**
 * FORK MIA (.96) · o passo "Pagamento" do início (lib/pagamento-inicial/servico.ts),
 * com o banco e o Asaas dublados. O que se prova:
 *   - entrada paga: sem dados fiscais não há cobrança; o cliente do Asaas recebe
 *     os dados fiscais com os avisos do Asaas desligados ANTES da cobrança; o Pix
 *     sai com o copia e cola e o QR; o boleto que venceria hoje ganha prazo e a
 *     linha digitável; sair do boleto para o Pix cancela o boleto (a assinatura)
 *     no Asaas e refaz a cobrança;
 *   - a conferência lê a cobrança no Asaas, roda a releitura do upstream e marca
 *     paga; e não lê de novo antes do intervalo;
 *   - trocar de plano antes de pagar cancela a cobrança e, para um plano com
 *     teste, libera a empresa no teste;
 *   - o modo teste: "nada é cobrado hoje"; Pix escolhido não toca o Asaas; o
 *     cartão é CADASTRADO (nunca cobrado) e, recusado, a assinatura recém-criada sai.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const auditoria = vi.hoisted(() => ({ chamadas: [] as unknown[] }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async (e: unknown) => void auditoria.chamadas.push(e)) }));
vi.mock("@/lib/cobranca/provedores/base-de-teste", () => ({ baseDeTesteDaCobranca: () => null }));
vi.mock("@/lib/planos-mia/seguir-o-plano", () => ({ seguirOPlano: vi.fn(async () => []) }));

import {
  cadastrarCartaoNoTeste,
  conferirPagamento,
  escolherPixNoTeste,
  gerarCobranca,
  lerPassoDoPagamento,
  pagarComCartaoNoPasso,
  trocarPlanoAntesDePagar,
  type DependenciasDoPasso,
} from "@/lib/pagamento-inicial/servico";
import { asaasFalso, CHAVE_DE_TESTE } from "@/tests/helpers/asaas-falso";
import { bancoDoPagamento, type EstadoDoPagamento } from "@/tests/helpers/banco-do-pagamento";

const ORG = "00000000-0000-4000-8000-00000000c096";
const USER = "00000000-0000-4000-8000-00000000a096";
const PLANO = "00000000-0000-4000-8000-0000000000p1".replace("p1", "a1");
const PLANO_TESTE = "00000000-0000-4000-8000-0000000000b1";
const AGORA = new Date("2026-10-29T15:00:00Z");

let e: EstadoDoPagamento;
let assinaturas: number;

function estadoInicial(modo: "entrada_paga" | "teste"): EstadoDoPagamento {
  return {
    assinatura: {
      organization_id: ORG,
      plano_id: modo === "teste" ? PLANO_TESTE : PLANO,
      estado: "trial",
      trial_ate: modo === "teste" ? "2026-11-12T15:00:00Z" : "2026-10-29T14:00:00Z",
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
      razao_social: "Clínica Exemplo Odontologia Ltda",
      cep: "30130010",
      logradouro: "Avenida Afonso Pena",
      numero: "1500",
      complemento: null,
      bairro: "Centro",
      cidade: "Belo Horizonte",
      uf: "MG",
      inscricao_municipal: null,
      inscricao_estadual: null,
      telefone: "5531988880000",
      asaas_sincronizado_em: null,
      updated_at: "2026-10-29T14:59:00Z",
    },
    planos: [
      { id: PLANO, nome: "Profissional", preco_cents: 59700, intervalo: "mes", trial_dias: 0, max_assentos: 8, max_canais: 2, arquivado_em: null, oferecido_ao_cliente: true },
      { id: PLANO_TESTE, nome: "Teste", preco_cents: 2000, intervalo: "mes", trial_dias: 14, max_assentos: 1, max_canais: 1, arquivado_em: null, oferecido_ao_cliente: true },
    ],
    org: { id: ORG, onboarded_at: null, status: modo === "teste" ? "active" : "suspended", suspended_kind: modo === "teste" ? null : "cobranca" },
    nota: null,
    config: [],
  };
}

function deps(fetch: typeof globalThis.fetch, extra: Partial<DependenciasDoPasso> = {}): DependenciasDoPasso {
  return {
    asaas: { fetch, lerChave: async () => CHAVE_DE_TESTE, esperar: async () => undefined, baseDeTeste: null },
    agora: () => AGORA,
    cobrancaLigada: async () => true,
    emailDoAdmin: async () => "admin@exemplo.com.br",
    // A assinatura do upstream: cria a sub e a primeira cobrança (o "checkout").
    gerarLink: vi.fn(async () => {
      assinaturas += 1;
      e.assinatura = {
        ...e.assinatura,
        provedor: "asaas",
        provedor_cliente_id: "cus_1",
        provedor_assinatura_id: `sub_${assinaturas}`,
        checkout_sessao_id: `pay_${assinaturas}`,
      };
      return { ok: true as const, url: `https://sandbox.asaas.com/i/pay_${assinaturas}` };
    }),
    sincronizar: vi.fn(async () => {
      e.assinatura = { ...e.assinatura, pagamento_inicial_pendente: false, estado: "ativa", proximo_vencimento: "2026-11-30T02:59:59Z" };
      e.org = { ...e.org, status: "active", suspended_kind: null };
      return { tipo: "aplicada" as const, estado: "ativa" as const, mudou: true, acao: "reativar" as const };
    }),
    ...extra,
  };
}

const cobranca = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: "PENDING",
  value: 597,
  dueDate: "2026-10-29",
  billingType: "UNDEFINED",
  subscription: "sub_1",
  invoiceUrl: `https://sandbox.asaas.com/i/${id}`,
  bankSlipUrl: `https://sandbox.asaas.com/b/pdf/${id}`,
  ...extra,
});

beforeEach(() => {
  assinaturas = 0;
  auditoria.chamadas = [];
});

describe("entrada paga: gerar a cobrança", () => {
  it("sem os dados fiscais, não há cobrança (a nota sairia errada) e nada vai ao Asaas", async () => {
    e = estadoInicial("entrada_paga");
    e.fiscais = null;
    const a = asaasFalso({});
    const r = await gerarCobranca(bancoDoPagamento(e).cliente as never, { orgId: ORG, userId: USER, forma: "pix", requestId: "r1" }, deps(a.fetch));
    expect(r).toMatchObject({ ok: false, code: "dados_fiscais_faltando" });
    expect(a.chamadas).toEqual([]);
  });

  it("⭐ Pix: o cliente do Asaas com os dados fiscais e os avisos dele desligados, a assinatura, o copia e cola e o QR", async () => {
    e = estadoInicial("entrada_paga");
    const a = asaasFalso({
      "GET /customers": { corpo: { data: [] } },
      "POST /customers": { corpo: { id: "cus_1" } },
      "GET /payments/pay_1": { corpo: cobranca("pay_1") },
      "GET /payments/pay_1/pixQrCode": { corpo: { payload: "00020101PIXDOTESTE", encodedImage: null } },
    });
    const d = deps(a.fetch);
    const r = await gerarCobranca(bancoDoPagamento(e).cliente as never, { orgId: ORG, userId: USER, forma: "pix", requestId: "r1" }, d);
    expect(r.ok).toBe(true);
    const criacao = a.chamadas.find((c) => c.metodo === "POST" && c.caminho.startsWith("/customers"))!;
    expect(JSON.parse(criacao.corpo)).toMatchObject({ cpfCnpj: "11222333000181", postalCode: "30130010", notificationDisabled: true, externalReference: ORG });
    // O cliente nasce ANTES da assinatura do upstream.
    expect(d.gerarLink).toHaveBeenCalledTimes(1);
    expect(e.linha).toMatchObject({ situacao: "aguardando", forma: "pix", pagamento_ref: "pay_1", assinatura_ref: "sub_1", pix_copia_e_cola: "00020101PIXDOTESTE", valor_cents: 59700 });
    if (r.ok) {
      expect(r.passo.pix?.copia_e_cola).toBe("00020101PIXDOTESTE");
      expect(r.passo.pix?.qr).toMatch(/^data:image\/png;base64,/);
      expect(r.passo.formas).toEqual(["pix", "cartao", "boleto"]);
    }
    expect(auditoria.chamadas).toContainEqual(expect.objectContaining({ action: "pagamento_inicial.cobranca_gerada" }));
  });

  it("⭐ boleto que venceria hoje ganha 3 dias; sair dele para o Pix CANCELA o boleto no Asaas e refaz a cobrança", async () => {
    e = estadoInicial("entrada_paga");
    const a = asaasFalso({
      "GET /customers": { corpo: { data: [{ id: "cus_1" }] } },
      "PUT /customers/cus_1": { corpo: { id: "cus_1" } },
      "GET /payments/pay_1": { corpo: cobranca("pay_1") },
      "PUT /payments/pay_1": { corpo: cobranca("pay_1", { dueDate: "2026-11-01" }) },
      "GET /payments/pay_1/identificationField": { corpo: { identificationField: "34191790010104351004791020150008291070026000" } },
      "DELETE /subscriptions/sub_1": { corpo: { deleted: true } },
      "GET /payments/pay_2": { corpo: cobranca("pay_2", { subscription: "sub_2" }) },
      "GET /payments/pay_2/pixQrCode": { corpo: { payload: "00020101PIXNOVO" } },
    });
    const banco = bancoDoPagamento(e);
    const d = deps(a.fetch);
    const boleto = await gerarCobranca(banco.cliente as never, { orgId: ORG, userId: USER, forma: "boleto", requestId: "r1" }, d);
    expect(boleto.ok).toBe(true);
    const prazo = a.chamadas.find((c) => c.metodo === "PUT" && c.caminho === "/payments/pay_1")!;
    expect(JSON.parse(prazo.corpo)).toEqual({ dueDate: "2026-11-01" });
    expect(e.linha).toMatchObject({ forma: "boleto", boleto_linha: "34191790010104351004791020150008291070026000", vence_em: "2026-11-01" });

    const pix = await gerarCobranca(banco.cliente as never, { orgId: ORG, userId: USER, forma: "pix", requestId: "r2" }, d);
    expect(pix.ok).toBe(true);
    expect(a.chamadas.some((c) => c.metodo === "DELETE" && c.caminho === "/subscriptions/sub_1")).toBe(true);
    expect(e.linha).toMatchObject({ forma: "pix", pagamento_ref: "pay_2", boleto_linha: null, pix_copia_e_cola: "00020101PIXNOVO", cobrancas_refeitas: 1 });
    expect(auditoria.chamadas).toContainEqual(
      expect.objectContaining({ action: "pagamento_inicial.cobranca_refeita", metadata: expect.objectContaining({ motivo: "saiu_do_boleto" }) }),
    );
  });

  it("dois cliques ao mesmo tempo: a reserva segura o segundo", async () => {
    e = estadoInicial("entrada_paga");
    e.linha = { organization_id: ORG, ...{ situacao: "sem_cobranca", reserva_ate: "2026-10-29T15:01:00Z", cartao_recusas: 0, cobrancas_refeitas: 0 } };
    const a = asaasFalso({});
    const r = await gerarCobranca(bancoDoPagamento(e).cliente as never, { orgId: ORG, userId: USER, forma: "pix", requestId: "r1" }, deps(a.fetch));
    expect(r).toMatchObject({ ok: false, code: "em_andamento" });
    expect(a.chamadas).toEqual([]);
  });
});

describe("a conferência e o pagamento confirmado", () => {
  function comPixGerado() {
    e = estadoInicial("entrada_paga");
    e.assinatura = { ...e.assinatura, provedor: "asaas", provedor_cliente_id: "cus_1", provedor_assinatura_id: "sub_1", checkout_sessao_id: "pay_1" };
    e.linha = {
      organization_id: ORG,
      modo: "entrada_paga",
      situacao: "aguardando",
      forma: "pix",
      pagamento_ref: "pay_1",
      assinatura_ref: "sub_1",
      plano_id: PLANO,
      pix_copia_e_cola: "00020101PIX",
      cartao_recusas: 0,
      cobrancas_refeitas: 0,
      conferido_em: null,
      reserva_ate: null,
    };
  }

  it("⭐ pago no Asaas: roda a releitura do upstream (que libera) e a linha vira pago, com a forma e a data", async () => {
    comPixGerado();
    const a = asaasFalso({ "GET /payments/pay_1": { corpo: cobranca("pay_1", { status: "RECEIVED", billingType: "PIX", clientPaymentDate: "2026-10-29" }) } });
    const d = deps(a.fetch);
    const passo = await conferirPagamento(bancoDoPagamento(e).cliente as never, ORG, { podePagar: true }, d);
    expect(d.sincronizar).toHaveBeenCalledTimes(1);
    expect(passo).toMatchObject({ pago: true, cumprido: true, situacao: "pago", forma_paga: "pix" });
    expect(e.linha).toMatchObject({ situacao: "pago", forma_paga: "pix" });
  });

  it("não lê o Asaas de novo antes do intervalo (várias abas abertas não multiplicam as leituras)", async () => {
    comPixGerado();
    e.linha = { ...e.linha!, conferido_em: "2026-10-29T14:59:58Z" };
    const a = asaasFalso({ "GET /payments/pay_1": { corpo: cobranca("pay_1") } });
    await conferirPagamento(bancoDoPagamento(e).cliente as never, ORG, { podePagar: true }, deps(a.fetch));
    expect(a.chamadas).toEqual([]);
  });

  it("cartão aprovado na entrada paga: paga a cobrança, deixa o cartão para as próximas e confirma", async () => {
    comPixGerado();
    const a = asaasFalso({
      "GET /payments/pay_1": [{ corpo: cobranca("pay_1") }, { corpo: cobranca("pay_1", { status: "CONFIRMED", billingType: "CREDIT_CARD" }) }],
      "POST /payments/pay_1/payWithCreditCard": { corpo: { id: "pay_1", status: "CONFIRMED", creditCard: { creditCardNumber: "1111", creditCardBrand: "VISA", creditCardToken: "tok_1" } } },
      "POST /subscriptions/sub_1/updateCreditCard": { corpo: { id: "sub_1" } },
      "PUT /subscriptions/sub_1": { corpo: { id: "sub_1" } },
    });
    const r = await pagarComCartaoNoPasso(
      bancoDoPagamento(e).cliente as never,
      { orgId: ORG, userId: USER, cartao: { numero: "4111111111111111", nome: "FULANA", mes: "12", ano: "2031", cvv: "123" }, ipRemoto: "200.1.2.3", requestId: "r1" },
      deps(a.fetch),
    );
    expect(r).toMatchObject({ ok: true, passo: { pago: true } });
    expect(e.linha).toMatchObject({ cartao_final: "1111", cartao_bandeira: "VISA", cartao_recorrente: "ok", situacao: "pago" });
    const recorrente = a.chamadas.find((c) => c.caminho === "/subscriptions/sub_1/updateCreditCard")!;
    expect(JSON.parse(recorrente.corpo)).toEqual({ creditCardToken: "tok_1", remoteIp: "200.1.2.3" });
  });

  it("cartão recusado: conta a recusa e devolve o passo com o caminho do Pix", async () => {
    comPixGerado();
    const a = asaasFalso({
      "GET /payments/pay_1": { corpo: cobranca("pay_1") },
      "POST /payments/pay_1/payWithCreditCard": { status: 400, corpo: { errors: [{ code: "invalid_creditCard", description: "Não autorizada" }] } },
    });
    const r = await pagarComCartaoNoPasso(
      bancoDoPagamento(e).cliente as never,
      { orgId: ORG, userId: USER, cartao: { numero: "4111111111111111", nome: "FULANA", mes: "12", ano: "2031", cvv: "123" }, ipRemoto: null, requestId: "r1" },
      deps(a.fetch),
    );
    expect(r).toMatchObject({ ok: false, status: 402, code: "cartao_recusado" });
    expect(e.linha).toMatchObject({ situacao: "recusado", cartao_recusas: 1 });
  });
});

describe("trocar de plano antes de pagar (decisão 7)", () => {
  it("⭐ cancela a cobrança no Asaas; para um plano com teste, a empresa entra no teste e é liberada", async () => {
    e = estadoInicial("entrada_paga");
    e.assinatura = { ...e.assinatura, provedor: "asaas", provedor_cliente_id: "cus_1", provedor_assinatura_id: "sub_1", checkout_sessao_id: "pay_1" };
    e.linha = { organization_id: ORG, modo: "entrada_paga", situacao: "aguardando", forma: "pix", pagamento_ref: "pay_1", assinatura_ref: "sub_1", plano_id: PLANO, cartao_recusas: 0, cobrancas_refeitas: 0, reserva_ate: null };
    const a = asaasFalso({ "GET /payments/pay_1": { corpo: cobranca("pay_1") }, "DELETE /subscriptions/sub_1": { corpo: { deleted: true } } });
    const banco = bancoDoPagamento(e);
    const r = await trocarPlanoAntesDePagar(banco.cliente as never, { orgId: ORG, userId: USER, planoId: PLANO_TESTE, requestId: "r1" }, deps(a.fetch));
    expect(r.ok).toBe(true);
    expect(a.chamadas.some((c) => c.metodo === "DELETE" && c.caminho === "/subscriptions/sub_1")).toBe(true);
    expect(e.assinatura).toMatchObject({ plano_id: PLANO_TESTE, pagamento_inicial_pendente: false, estado: "trial", provedor_assinatura_id: null });
    expect(banco.rpcs.map((x) => x.nome)).toContain("fn_reativar_organizacao");
    expect(e.linha).toMatchObject({ modo: "teste", situacao: "sem_cobranca", pagamento_ref: null, cobrancas_refeitas: 1 });
  });

  it("plano que não é oferecido às empresas é recusado", async () => {
    e = estadoInicial("entrada_paga");
    e.planos[1] = { ...e.planos[1]!, oferecido_ao_cliente: false };
    const r = await trocarPlanoAntesDePagar(bancoDoPagamento(e).cliente as never, { orgId: ORG, userId: USER, planoId: PLANO_TESTE, requestId: "r1" }, deps(asaasFalso({}).fetch));
    expect(r).toMatchObject({ ok: false, code: "plano_indisponivel" });
  });
});

describe("plano com teste: nada é cobrado hoje (decisão 12 revista)", () => {
  it("o passo aparece no modo teste, só com cartão e Pix, e o fim do teste", async () => {
    e = estadoInicial("teste");
    const passo = await lerPassoDoPagamento(bancoDoPagamento(e).cliente as never, ORG, { podePagar: true }, deps(asaasFalso({}).fetch));
    expect(passo).toMatchObject({ modo: "teste", espera: false, cumprido: false, formas: ["cartao", "pix"], teste_ate: "2026-11-12T15:00:00Z", primeira_cobranca_em: "2026-11-12" });
  });

  it("⭐ Pix escolhido: nada vai ao Asaas agora, e a primeira cobrança fica para o fim do teste", async () => {
    e = estadoInicial("teste");
    const a = asaasFalso({});
    const r = await escolherPixNoTeste(bancoDoPagamento(e).cliente as never, { orgId: ORG, userId: USER, requestId: "r1" }, deps(a.fetch));
    expect(r).toMatchObject({ ok: true, passo: { cumprido: true, situacao: "escolhida", forma: "pix" } });
    expect(a.chamadas).toEqual([]);
    expect(e.linha).toMatchObject({ modo: "teste", primeira_cobranca_em: "2026-11-12" });
  });

  it("⭐ cartão CADASTRADO na assinatura, sem cobrança nenhuma (nunca payWithCreditCard)", async () => {
    e = estadoInicial("teste");
    const a = asaasFalso({
      "GET /customers": { corpo: { data: [] } },
      "POST /customers": { corpo: { id: "cus_1" } },
      "POST /subscriptions/sub_1/updateCreditCard": { corpo: { id: "sub_1" } },
      "PUT /subscriptions/sub_1": { corpo: { id: "sub_1" } },
      "GET /payments/pay_1": { corpo: cobranca("pay_1", { dueDate: "2026-11-12", billingType: "CREDIT_CARD", creditCard: { creditCardNumber: "1111", creditCardBrand: "VISA" } }) },
    });
    const r = await cadastrarCartaoNoTeste(
      bancoDoPagamento(e).cliente as never,
      { orgId: ORG, userId: USER, cartao: { numero: "4111111111111111", nome: "FULANA", mes: "12", ano: "2031", cvv: "123" }, ipRemoto: "200.1.2.3", requestId: "r1" },
      deps(a.fetch),
    );
    expect(r).toMatchObject({ ok: true, passo: { cumprido: true, situacao: "escolhida", forma: "cartao", primeira_cobranca_em: "2026-11-12" } });
    expect(a.chamadas.some((c) => c.caminho.includes("payWithCreditCard"))).toBe(false);
    expect(e.linha).toMatchObject({ cartao_final: "1111", cartao_recorrente: "ok", assinatura_ref: "sub_1" });
  });

  it("cartão recusado no cadastro: a assinatura recém-criada sai do Asaas e a pessoa escolhe de novo", async () => {
    e = estadoInicial("teste");
    const a = asaasFalso({
      "GET /customers": { corpo: { data: [{ id: "cus_1" }] } },
      "PUT /customers/cus_1": { corpo: { id: "cus_1" } },
      "POST /subscriptions/sub_1/updateCreditCard": { status: 400, corpo: { errors: [{ code: "invalid_creditCard" }] } },
      "DELETE /subscriptions/sub_1": { corpo: { deleted: true } },
    });
    const r = await cadastrarCartaoNoTeste(
      bancoDoPagamento(e).cliente as never,
      { orgId: ORG, userId: USER, cartao: { numero: "4111111111111111", nome: "FULANA", mes: "12", ano: "2031", cvv: "123" }, ipRemoto: null, requestId: "r1" },
      deps(a.fetch),
    );
    expect(r).toMatchObject({ ok: false, code: "cartao_recusado" });
    expect(a.chamadas.some((c) => c.metodo === "DELETE" && c.caminho === "/subscriptions/sub_1")).toBe(true);
    expect(e.linha).toMatchObject({ situacao: "recusado", cartao_recusas: 1, assinatura_ref: null });
    expect(e.assinatura).toMatchObject({ provedor_assinatura_id: null });
  });
});
