/**
 * FORK MIA (.96) · o fim do teste grátis (lib/pagamento-inicial/fim-do-teste.ts),
 * a decisão 12 revista pelo Gabriel em 27/10/2026. O que se prova:
 *   - 3 dias antes do fim, sem assinatura e sem aviso dado: gera o Pix da
 *     primeira mensalidade (só Pix, sem boleto), com o aviso do upstream
 *     (`trial_acabando`) marcado, para a régua dele não mandar o dela;
 *   - acabou sem a primeira mensalidade paga: bloqueia NA HORA, como a entrada
 *     paga (a função do banco 9122), com o aviso "falta só o pagamento" e nunca o
 *     de "conta suspensa"; com o cartão cadastrado, espera o fim do dia do débito;
 *   - quem já pagou uma mensalidade, quem tem prazo da Time e a empresa parada
 *     seguem a régua de hoje;
 *   - com a cobrança desligada, nada (nem leitura).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Saida from "@/lib/branding/saida";

const auditoria = vi.hoisted(() => ({ chamadas: [] as Array<{ action: string }> }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async (e: { action: string }) => void auditoria.chamadas.push(e)) }));
vi.mock("@/lib/cobranca/provedores/base-de-teste", () => ({ baseDeTesteDaCobranca: () => null }));
vi.mock("@/lib/branding/saida", async (importOriginal) => ({
  ...(await importOriginal<typeof Saida>()),
  marcaDaSaida: async () => ({ nome: "Marca de Teste", logoUrl: null, accent: "#0a7a57", accentFg: "#ffffff" }),
}));
vi.mock("@/lib/cobranca/emails", () => ({
  emailDoAdminDaEmpresa: async () => "admin@exemplo.com.br",
  emailsDosAdmins: async () => ["admin@exemplo.com.br"],
}));

import { antesDaRegua, decidirFimDoTeste, textosDoFimDoTeste } from "@/lib/pagamento-inicial/fim-do-teste";
import { asaasFalso, CHAVE_DE_TESTE } from "@/tests/helpers/asaas-falso";
import { bancoDoPagamento, type EstadoDoPagamento } from "@/tests/helpers/banco-do-pagamento";

const ORG = "00000000-0000-4000-8000-00000000f096";
const FIM = "2026-11-12T15:00:00Z";

const base = {
  estado: "trial",
  trial_ate: FIM,
  pagamento_inicial_pendente: false,
  provedor_assinatura_id: null as string | null,
  proximo_vencimento: null as string | null,
  periodo_pago_desde: null as string | null,
  prazo_extra_ate: null as string | null,
  ultimo_aviso: null as string | null,
};
const ativa = { status: "active" };

describe("a decisão, pura", () => {
  it("antes dos 3 dias, nada; nos 3 dias, o Pix; no fim, o bloqueio", () => {
    expect(decidirFimDoTeste(base, ativa, new Date("2026-11-08T15:00:00Z"), false)).toBe("nada");
    expect(decidirFimDoTeste(base, ativa, new Date("2026-11-09T16:00:00Z"), false)).toBe("gerar_pix");
    expect(decidirFimDoTeste(base, ativa, new Date("2026-11-12T15:00:01Z"), false)).toBe("bloquear");
  });

  it("o Pix sai uma vez: com o aviso dado ou com a assinatura já criada, não gera de novo", () => {
    const agora = new Date("2026-11-10T12:00:00Z");
    expect(decidirFimDoTeste({ ...base, ultimo_aviso: "trial_acabando" }, ativa, agora, false)).toBe("nada");
    expect(decidirFimDoTeste({ ...base, provedor_assinatura_id: "sub_1" }, ativa, agora, false)).toBe("nada");
  });

  it("⭐ com o cartão cadastrado, o bloqueio espera o fim do DIA do débito (em São Paulo)", () => {
    const comCartao = { ...base, provedor_assinatura_id: "sub_1" };
    expect(decidirFimDoTeste(comCartao, ativa, new Date("2026-11-12T20:00:00Z"), true)).toBe("nada");
    expect(decidirFimDoTeste(comCartao, ativa, new Date("2026-11-13T03:00:00Z"), true)).toBe("bloquear");
  });

  it("⭐ quem já pagou alguma mensalidade, com prazo da Time, parada ou já esperando o pagamento: régua de hoje", () => {
    const depois = new Date("2026-11-13T12:00:00Z");
    expect(decidirFimDoTeste({ ...base, proximo_vencimento: "2026-12-12T02:59:59Z" }, ativa, depois, false)).toBe("nada");
    expect(decidirFimDoTeste({ ...base, periodo_pago_desde: "2026-10-12T03:00:00Z" }, ativa, depois, false)).toBe("nada");
    expect(decidirFimDoTeste({ ...base, prazo_extra_ate: "2026-11-20T00:00:00Z" }, ativa, depois, false)).toBe("nada");
    expect(decidirFimDoTeste(base, { status: "suspended" }, depois, false)).toBe("nada");
    expect(decidirFimDoTeste({ ...base, pagamento_inicial_pendente: true }, ativa, depois, false)).toBe("nada");
    expect(decidirFimDoTeste({ ...base, estado: "ativa" }, ativa, depois, false)).toBe("nada");
  });

  it("os textos: o do bloqueio é o \"falta só o pagamento\", nunca \"suspensa\"", () => {
    const t = textosDoFimDoTeste("pt-BR", "Marca", { data: "12/11", pix: "000201" });
    expect(t.bloqueio.titulo).toBe("Falta só o pagamento para continuar usando o Marca");
    expect(`${t.bloqueio.titulo} ${t.bloqueio.corpo}`).not.toMatch(/suspens/i);
    expect(t.pix.corpo).toContain("000201");
  });
});

function estado(extra: Record<string, unknown> = {}): EstadoDoPagamento {
  return {
    assinatura: { organization_id: ORG, plano_id: "plano-teste", provedor_cliente_id: null, checkout_sessao_id: null, ...base, ...extra },
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
      updated_at: "2026-11-01T00:00:00Z",
    },
    planos: [],
    org: { id: ORG, status: "active", locale: "pt-BR", timezone: "America/Sao_Paulo", onboarded_at: "2026-10-29T15:00:00Z" },
    nota: null,
    config: [],
  };
}

describe("o gancho antes da régua", () => {
  let enviados: Array<{ subject: string; text: string }>;
  const enviar = vi.fn(async (m: { subject: string; text: string }) => {
    enviados.push(m);
    return { ok: true as const };
  });
  beforeEach(() => {
    enviados = [];
    auditoria.chamadas = [];
  });

  it("com a cobrança desligada, nada (nem a assinatura é lida)", async () => {
    const banco = bancoDoPagamento(estado());
    expect(await antesDaRegua(banco.cliente as never, ORG, new Date("2026-11-13T12:00:00Z"), { cobrancaLigada: async () => false })).toBe("nada");
    expect(banco.cadeias).toEqual([]);
  });

  it("⭐ o fim do teste sem pagamento: a função do banco bloqueia como a entrada paga, e o aviso é o \"falta só o pagamento\"", async () => {
    const e = estado();
    const banco = bancoDoPagamento(e);
    const r = await antesDaRegua(banco.cliente as never, ORG, new Date("2026-11-12T15:30:00Z"), { cobrancaLigada: async () => true, enviar: enviar as never });
    expect(r).toBe("bloquear");
    expect(banco.rpcs.map((x) => x.nome)).toEqual(["fn_mia_bloquear_fim_do_teste", "fn_cobranca_registrar_aviso"]);
    expect(banco.rpcs[1]!.args).toMatchObject({ p_aviso: "suspensa", p_severidade: "critical", p_titulo: "Falta só o pagamento para continuar usando o Marca de Teste" });
    expect(enviados).toHaveLength(1);
    expect(`${enviados[0]!.subject} ${enviados[0]!.text}`).not.toMatch(/conta suspensa/i);
    expect(e.linha).toMatchObject({ modo: "teste", situacao: "sem_cobranca" });
    expect(auditoria.chamadas.map((a) => a.action)).toContain("pagamento_inicial.fim_do_teste_bloqueou");
  });

  it("⭐ 3 dias antes: a assinatura, a cobrança SÓ no Pix, o QR e o aviso do upstream marcado", async () => {
    const e = estado();
    const banco = bancoDoPagamento(e);
    const a = asaasFalso({
      "GET /customers": { corpo: { data: [] } },
      "POST /customers": { corpo: { id: "cus_1" } },
      "PUT /payments/pay_9": { corpo: { id: "pay_9", status: "PENDING", value: 20, dueDate: "2026-11-12", billingType: "PIX", invoiceUrl: "https://sandbox.asaas.com/i/pay_9" } },
      "GET /payments/pay_9/pixQrCode": { corpo: { payload: "00020101PIXDOFIM" } },
    });
    const gerarLink = vi.fn(async () => {
      e.assinatura = { ...e.assinatura, provedor: "asaas", provedor_cliente_id: "cus_1", provedor_assinatura_id: "sub_9", checkout_sessao_id: "pay_9" };
      return { ok: true as const, url: "https://sandbox.asaas.com/i/pay_9" };
    });
    const r = await antesDaRegua(banco.cliente as never, ORG, new Date("2026-11-10T12:00:00Z"), {
      cobrancaLigada: async () => true,
      asaas: { fetch: a.fetch, lerChave: async () => CHAVE_DE_TESTE, esperar: async () => undefined, baseDeTeste: null },
      gerarLink: gerarLink as never,
      enviar: enviar as never,
    });
    expect(r).toBe("gerar_pix");
    const forma = a.chamadas.find((c) => c.metodo === "PUT" && c.caminho === "/payments/pay_9")!;
    expect(JSON.parse(forma.corpo)).toEqual({ billingType: "PIX" });
    expect(banco.rpcs.find((x) => x.nome === "fn_cobranca_registrar_aviso")?.args).toMatchObject({ p_aviso: "trial_acabando" });
    expect(e.linha).toMatchObject({ modo: "teste", situacao: "aguardando", forma: "pix", pix_copia_e_cola: "00020101PIXDOFIM", primeira_cobranca_em: "2026-11-12" });
    expect(enviados[0]!.text).toContain("00020101PIXDOFIM");
  });

  it("sem os dados fiscais (empresa anterior à .96): não gera o Pix, e a régua do upstream avisa", async () => {
    const e = estado();
    e.fiscais = null;
    const banco = bancoDoPagamento(e);
    const gerarLink = vi.fn();
    const r = await antesDaRegua(banco.cliente as never, ORG, new Date("2026-11-10T12:00:00Z"), { cobrancaLigada: async () => true, gerarLink: gerarLink as never });
    expect(r).toBe("nada");
    expect(gerarLink).not.toHaveBeenCalled();
    expect(banco.rpcs).toEqual([]);
  });
});
