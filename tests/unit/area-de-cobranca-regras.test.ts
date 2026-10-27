/**
 * FORK MIA (.96, segunda frente) · as regras puras da área de cobrança e do
 * lado da Time (protótipo "Pagamento no início", telas 3 e 4, decisões 5, 9 e 10).
 */
import { describe, expect, it } from "vitest";

import type { CobrancaLida, NotaLida } from "@/lib/asaas-mia/cobrancas";
import { formaDasMensalidades, paraCobrancaDaArea } from "@/lib/area-de-cobranca/leitura";
import {
  bandeiraPeloNumero,
  mesPorExtenso,
  notaDaCobranca,
  notaErradaSchema,
  situacaoNaArea,
  textoDoChamadoDaNota,
} from "@/lib/area-de-cobranca/regras";
import { situacaoDoPagamentoNaLista, type AssinaturaParaALista } from "@/lib/pagamento-inicial/situacao-na-lista";

const cobranca = (o: Partial<CobrancaLida> = {}): CobrancaLida => ({
  ref: "pay_out",
  status: "RECEIVED",
  situacao: "paga",
  valorCents: 59700,
  vencimento: "2026-10-27",
  pagaEm: "2026-10-27",
  forma: "pix",
  assinaturaRef: "sub_1",
  descricao: null,
  faturaUrl: "https://www.asaas.com/i/pay_out",
  boletoUrl: null,
  reciboUrl: "https://www.asaas.com/comprovantes/pay_out",
  cartaoFinal: null,
  cartaoBandeira: null,
  criadaEm: "2026-10-20",
  ...o,
});

const nota = (o: Partial<NotaLida> = {}): NotaLida => ({
  ref: "inv_1",
  status: "AUTHORIZED",
  situacao: "emitida",
  numero: "418",
  pdfUrl: "https://www.asaas.com/nota/inv_1.pdf",
  xmlUrl: "https://www.asaas.com/nota/inv_1.xml",
  pagamentoRef: "pay_out",
  valorCents: 59700,
  emitidaEm: "2026-10-27",
  ...o,
});

describe("cada cobrança na área", () => {
  it("⭐ paga: a nota (PDF e XML) e o recibo; nada de pagar", () => {
    const a = paraCobrancaDaArea(cobranca(), [nota()], new Map());
    expect(a).toMatchObject({
      situacao: "paga",
      paga_em: "2026-10-27",
      recibo_url: "https://www.asaas.com/comprovantes/pay_out",
      pagar_url: null,
      segunda_via_url: null,
      nota: { numero: "418", situacao: "emitida", pdf_url: "https://www.asaas.com/nota/inv_1.pdf", xml_url: "https://www.asaas.com/nota/inv_1.xml" },
    });
  });

  it("em aberto: Pagar agora pela fatura e a segunda via pelo boleto; sem nota nem recibo", () => {
    const a = paraCobrancaDaArea(
      cobranca({ situacao: "aberta", status: "PENDING", pagaEm: null, forma: "boleto", boletoUrl: "https://www.asaas.com/b/pdf/pay_nov", reciboUrl: null }),
      [nota()],
      new Map(),
    );
    expect(a).toMatchObject({ situacao: "aberta", pagar_url: "https://www.asaas.com/i/pay_out", segunda_via_url: "https://www.asaas.com/b/pdf/pay_nov", nota: null, recibo_url: null });
  });

  it("cancelada (o Pix que venceu e foi apagado): sem nota e sem pagar", () => {
    const a = paraCobrancaDaArea(cobranca({ situacao: "cancelada", status: "PENDING", pagaEm: null }), [nota()], new Map());
    expect(a).toMatchObject({ situacao: "cancelada", nota: null, pagar_url: null, recibo_url: null });
  });

  it("a correção pedida aparece na cobrança dela", () => {
    const a = paraCobrancaDaArea(cobranca(), [nota()], new Map([["pay_out", { chamado: 1040, situacao: "novo" as const, motivo: "razao_social" as const }]]));
    expect(a.correcao).toEqual({ chamado: 1040, situacao: "novo", motivo: "razao_social" });
  });

  it("situações do Asaas que a área não conhece viram 'em andamento'", () => {
    expect(situacaoNaArea({ situacao: "outra" })).toBe("em_andamento");
    expect(situacaoNaArea({ situacao: "vencida" })).toBe("vencida");
  });

  it("a nota que vale é a emitida, mesmo com a cancelada (a errada) ao lado", () => {
    const n = notaDaCobranca([nota({ ref: "inv_velha", situacao: "cancelada", numero: "417" }), nota({ ref: "inv_nova", numero: "419" })], "pay_out");
    expect(n?.numero).toBe("419");
    expect(notaDaCobranca([nota()], "pay_outra")).toBeNull();
  });
});

describe("A nota saiu errada", () => {
  it("a entrada: cobrança do Asaas, motivo da lista e texto", () => {
    expect(notaErradaSchema.safeParse({ cobranca_ref: "pay_abc123", motivo: "endereco", texto: "Saiu sem a sala" }).success).toBe(true);
    expect(notaErradaSchema.safeParse({ cobranca_ref: "../payments", motivo: "endereco", texto: "x y z" }).success).toBe(false);
    expect(notaErradaSchema.safeParse({ cobranca_ref: "pay_abc123", motivo: "imposto", texto: "x y z" }).success).toBe(false);
    expect(notaErradaSchema.safeParse({ cobranca_ref: "pay_abc123", motivo: "outro", texto: "" }).success).toBe(false);
  });

  it("⭐ o texto do chamado leva a cobrança, a nota, o motivo e o que a pessoa escreveu", () => {
    const texto = textoDoChamadoDaNota({ vencimento: "2026-10-27", valorCents: 59700, numeroDaNota: "418", motivo: "razao_social", texto: "Saiu sem o Odontologia." });
    expect(texto).toContain("nota nº 418");
    expect(texto).toContain("Outubro de 2026");
    expect(texto).toContain("O que está errado: Razão social ou nome");
    expect(texto).toContain("Saiu sem o Odontologia.");
    expect(texto).not.toMatch(/—/);
    expect(mesPorExtenso("2026-03-05")).toBe("Março de 2026");
  });
});

describe("o cartão das próximas mensalidades", () => {
  it("a bandeira pelos primeiros números, e nada do número", () => {
    expect(bandeiraPeloNumero("4111 1111 1111 1111")).toBe("VISA");
    expect(bandeiraPeloNumero("5555555555554444")).toBe("MASTERCARD");
    expect(bandeiraPeloNumero("378282246310005")).toBe("AMEX");
    expect(bandeiraPeloNumero("6062825624254001")).toBe("HIPERCARD");
    expect(bandeiraPeloNumero("12")).toBeNull();
  });

  const doAsaas = { ref: "sub_1", forma: "CREDIT_CARD", proximaEm: "2026-11-27", ativa: true, cartaoFinal: null, cartaoBandeira: null };

  it("⭐ trocado aqui DEPOIS da última mensalidade paga: vale o trocado", () => {
    const f = formaDasMensalidades({
      assinaturaRef: "sub_1",
      noAsaas: doAsaas,
      trocado: { cartao_final: "7730", cartao_bandeira: "MASTERCARD", assinatura_ref: "sub_1", trocado_em: "2026-10-28T10:00:00Z" },
      cobrancas: [cobranca({ forma: "cartao", cartaoFinal: "4821", cartaoBandeira: "VISA" })],
      doPasso: null,
    });
    expect(f).toEqual({ no_cartao: true, cartao_final: "7730", cartao_bandeira: "MASTERCARD", proxima_em: "2026-11-27", pode_trocar: true });
  });

  it("a mensalidade paga DEPOIS da troca mostra o cartão que o Asaas cobrou; troca de outra assinatura não vale", () => {
    const f = formaDasMensalidades({
      assinaturaRef: "sub_2",
      noAsaas: { ...doAsaas, ref: "sub_2" },
      trocado: { cartao_final: "7730", cartao_bandeira: null, assinatura_ref: "sub_1", trocado_em: "2026-12-01T10:00:00Z" },
      cobrancas: [cobranca({ forma: "cartao", cartaoFinal: "4821", cartaoBandeira: "VISA", assinaturaRef: "sub_2" })],
      doPasso: null,
    });
    expect(f.cartao_final).toBe("4821");
  });

  it("a assinatura no Pix ou boleto: não está no cartão, e o botão vira 'Cadastrar um cartão'", () => {
    const f = formaDasMensalidades({ assinaturaRef: "sub_1", noAsaas: { ...doAsaas, forma: "UNDEFINED" }, trocado: null, cobrancas: [], doPasso: null });
    expect(f).toMatchObject({ no_cartao: false, cartao_final: null, pode_trocar: true });
  });

  it("sem a leitura do Asaas, o cartão do passo do pagamento (o primeiro) ainda aparece", () => {
    const f = formaDasMensalidades({
      assinaturaRef: "sub_1",
      noAsaas: null,
      trocado: null,
      cobrancas: [],
      doPasso: { cartao_final: "1111", cartao_bandeira: "VISA", cartao_recorrente: "ok", assinatura_ref: "sub_1" },
    });
    expect(f).toMatchObject({ no_cartao: true, cartao_final: "1111", cartao_bandeira: "VISA" });
  });
});

describe("a situação do pagamento na lista da Time", () => {
  const agora = new Date("2026-10-28T12:00:00Z");
  const espera: AssinaturaParaALista = { pagamento_inicial_pendente: true, proximo_vencimento: null, periodo_pago_desde: null };
  const passo = (o: Record<string, unknown> = {}) => ({
    modo: "entrada_paga",
    situacao: "aguardando",
    forma: "pix",
    vence_em: "2026-10-30",
    gerada_em: "2026-10-28T10:00:00Z",
    cartao_recusas: 0,
    pago_em: null,
    forma_paga: null,
    ...o,
  });

  it("Pix gerado, boleto em compensação, cartão recusado, nunca gerou", () => {
    const s = (p: ReturnType<typeof passo> | null) => situacaoDoPagamentoNaLista({ assinatura: espera, passo: p, criadaEm: "2026-10-27T12:00:00Z", agora })?.chave;
    expect(s(passo())).toBe("pix_gerado");
    expect(s(passo({ forma: "boleto" }))).toBe("boleto_em_compensacao");
    expect(s(passo({ situacao: "recusado", forma: "cartao", cartao_recusas: 2 }))).toBe("cartao_recusado");
    expect(s(null)).toBe("sem_cobranca");
  });

  it("⭐ 'Apagar o cadastro' só depois de 30 dias sem NENHUM pagamento", () => {
    const com = (criadaEm: string, a = espera) => situacaoDoPagamentoNaLista({ assinatura: a, passo: passo({ situacao: "sem_cobranca", forma: null }), criadaEm, agora });
    expect(com("2026-09-29T12:00:00Z")).toMatchObject({ pode_apagar: false, dias: 29 });
    expect(com("2026-09-27T12:00:00Z")).toMatchObject({ chave: "sem_pagamento_ha_dias", pode_apagar: true, dias: 31 });
    // Pagou alguma vez (a releitura gravou o período): nunca.
    expect(com("2026-08-01T12:00:00Z", { ...espera, periodo_pago_desde: "2026-08-02T00:00:00Z" })?.pode_apagar).toBe(false);
  });

  it("pago e o modo teste; a empresa sem o passo (implantada pela Time) não ganha coluna", () => {
    const livre = { pagamento_inicial_pendente: false, proximo_vencimento: "2026-11-27T00:00:00Z", periodo_pago_desde: null };
    expect(situacaoDoPagamentoNaLista({ assinatura: livre, passo: passo({ situacao: "pago", forma_paga: "pix", pago_em: "2026-10-27T14:02:00Z" }), criadaEm: "2026-10-27T12:00:00Z", agora })).toMatchObject({
      chave: "pago",
      forma: "pix",
      pode_apagar: false,
    });
    expect(situacaoDoPagamentoNaLista({ assinatura: { ...livre, proximo_vencimento: null }, passo: passo({ modo: "teste", situacao: "escolhida", forma: "cartao" }), criadaEm: "2026-10-27T12:00:00Z", agora })?.chave).toBe("teste_cartao");
    expect(situacaoDoPagamentoNaLista({ assinatura: livre, passo: null, criadaEm: "2026-01-01T12:00:00Z", agora })).toBeNull();
    expect(situacaoDoPagamentoNaLista({ assinatura: null, passo: null, criadaEm: "2026-01-01T12:00:00Z", agora })).toBeNull();
  });
});
