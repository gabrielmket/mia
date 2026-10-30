/**
 * FORK MIA (.98) · A régua dos cupons e a conta da comissão, puras
 * (lib/cupons/regras.ts, lib/parceiros/regras.ts; docs/fork/cupons-e-parceiros.md).
 */
import { describe, expect, it } from "vitest";

import {
  codigoValido,
  fraseDoMotivo,
  mensalidadeComCupom,
  motivoDoCupom,
  normalizarCodigo,
  reais,
  setupComCupom,
  textoDoBeneficio,
  textoDoPeriodo,
  textoDoSetup,
  valorDaMensalidade,
  type CupomParaRegra,
} from "@/lib/cupons/regras";
import {
  competenciaDe,
  contaDaComissao,
  documentoDoParceiro,
  mensalidadeNoPrazo,
  mesAnterior,
  nomeDoMes,
  pixMascarado,
  somarMeses,
} from "@/lib/parceiros/regras";

const PLANO = "11111111-1111-4111-8111-111111111111";
const AGORA = new Date("2026-10-27T15:00:00Z");

const cupom = (m: Partial<CupomParaRegra> = {}): CupomParaRegra => ({
  codigo: "JOAO10",
  beneficio: "pct",
  valor: 10,
  meses: 3,
  setup_tipo: "nenhum",
  setup_valor: 0,
  planos: [PLANO],
  vale_ate: null,
  limite_de_usos: null,
  ativo: true,
  ...m,
});

describe("o código", () => {
  it("normaliza maiúsculas e espaços; só letras e números, de 3 a 20", () => {
    expect(normalizarCodigo(" joao 10 ")).toBe("JOAO10");
    expect(codigoValido("JOAO10")).toBe(true);
    expect(codigoValido("JO")).toBe(false);
    expect(codigoValido("JOAO-10")).toBe(false);
    expect(codigoValido("A".repeat(21))).toBe(false);
  });
});

describe("o motivo, na ordem da função do banco", () => {
  const base = { planoId: PLANO, usos: 0, agora: AGORA };
  it("vale", () => {
    expect(motivoDoCupom(cupom(), base)).toBeNull();
  });
  it("inexistente, pausado, vencido, fora do plano, escondido, esgotado", () => {
    expect(motivoDoCupom(null, base)).toBe("inexistente");
    expect(motivoDoCupom(cupom({ ativo: false }), base)).toBe("pausado");
    expect(motivoDoCupom(cupom({ vale_ate: "2026-10-26" }), base)).toBe("vencido");
    expect(motivoDoCupom(cupom({ vale_ate: "2026-10-27" }), base)).toBeNull();
    expect(motivoDoCupom(cupom({ planos: ["outro"] }), base)).toBe("fora_do_plano");
    expect(motivoDoCupom(cupom(), { ...base, planoOferecido: false })).toBe("plano_escondido");
    expect(motivoDoCupom(cupom({ limite_de_usos: 2 }), { ...base, usos: 2 })).toBe("esgotado");
    expect(motivoDoCupom(cupom({ limite_de_usos: 2 }), { ...base, usos: 1 })).toBeNull();
  });
  it("sem plano escolhido, não acusa o plano (a página de preços mostra em cada cartão)", () => {
    expect(motivoDoCupom(cupom({ planos: ["outro"] }), { ...base, planoId: null })).toBeNull();
  });
  it("as frases do protótipo", () => {
    expect(fraseDoMotivo("inexistente", { codigo: "XPTO" })).toBe("Não encontramos o cupom XPTO. Confira as letras e os números.");
    expect(fraseDoMotivo("pausado", { codigo: "LIA15" })).toBe("O cupom LIA15 está pausado. Fale com quem te passou o cupom.");
    expect(fraseDoMotivo("vencido", { codigo: "NATAL25", data: "2026-10-25" })).toBe("O cupom NATAL25 venceu em 25/10/2026.");
    expect(fraseDoMotivo("esgotado", { codigo: "BLACKMIA" })).toBe("O cupom BLACKMIA já foi usado o número máximo de vezes.");
    expect(fraseDoMotivo("fora_do_plano", { codigo: "LIA15", plano: "Completo", planos: ["Essencial"] })).toBe("O cupom LIA15 não vale para o plano Completo. Vale para: Essencial.");
  });
});

describe("o desconto", () => {
  it("em %, em R$ e nunca abaixo do mínimo de cobrança do Asaas", () => {
    expect(mensalidadeComCupom(59_700, cupom())).toBe(53_730);
    expect(mensalidadeComCupom(59_700, cupom({ beneficio: "reais", valor: 100 }))).toBe(49_700);
    expect(mensalidadeComCupom(59_700, cupom({ beneficio: "reais", valor: 1000 }))).toBe(500);
    expect(mensalidadeComCupom(59_700, cupom({ beneficio: "dias", valor: 30 }))).toBe(59_700);
    expect(mensalidadeComCupom(59_700, null)).toBe(59_700);
  });
  it("por N mensalidades: depois, o preço cheio; todas = sempre", () => {
    const c = cupom({ meses: 3 });
    expect([1, 2, 3, 4].map((n) => valorDaMensalidade(59_700, c, n))).toEqual([53_730, 53_730, 53_730, 59_700]);
    expect(valorDaMensalidade(59_700, cupom({ meses: null }), 500)).toBe(53_730);
    expect(valorDaMensalidade(59_700, cupom({ beneficio: "dias", valor: 30, meses: null }), 1)).toBe(59_700);
  });
  it("o setup: separado do da mensalidade, em % ou R$; o que zera é cortesia", () => {
    expect(setupComCupom(150_000, cupom({ setup_tipo: "pct", setup_valor: 20 }))).toBe(120_000);
    expect(setupComCupom(150_000, cupom({ setup_tipo: "reais", setup_valor: 500 }))).toBe(100_000);
    expect(setupComCupom(150_000, cupom())).toBe(150_000);
    expect(setupComCupom(150_000, cupom({ setup_tipo: "pct", setup_valor: 100 }))).toBe(0);
    expect(setupComCupom(150_000, null)).toBe(150_000);
    expect(setupComCupom(600, cupom({ setup_tipo: "reais", setup_valor: 5.5 }))).toBe(500);
  });
  it("os textos", () => {
    expect(textoDoBeneficio(cupom())).toBe("10% de desconto nas 3 primeiras mensalidades");
    expect(textoDoBeneficio(cupom({ beneficio: "reais", valor: 100, meses: 1 }))).toBe("R$ 100,00 de desconto na primeira mensalidade");
    expect(textoDoBeneficio(cupom({ meses: null }))).toBe("10% de desconto em todas as mensalidades");
    expect(textoDoBeneficio(cupom({ beneficio: "dias", valor: 30 }))).toBe("30 dias grátis");
    expect(textoDoSetup(cupom({ setup_tipo: "reais", setup_valor: 500 }))).toBe("R$ 500,00 de desconto no setup");
    expect(textoDoSetup(cupom())).toBe("sem desconto no setup");
    expect(textoDoPeriodo(cupom({ meses: 1 }))).toBe("no 1º mês");
    expect(textoDoPeriodo(cupom({ meses: 3 }))).toBe("nos 3 primeiros meses");
    expect(textoDoPeriodo(cupom({ meses: null }))).toBe("sempre");
    expect(reais(123_456)).toBe("R$ 1.234,56");
    expect(reais(-7_962)).toBe("-R$ 79,62");
  });
});

describe("a comissão sobre o líquido (decisão 1)", () => {
  it("valor pago, menos o imposto, menos a taxa real do Asaas; a conta do protótipo", () => {
    // João: 6 mensalidades, R$ 3.402,90 pagos, taxa R$ 58,30, alíquota 10%, comissão 20%.
    const c = contaDaComissao({ valorPagoCents: 340_290, liquidoDoAsaasCents: 340_290 - 5_830, aliquotaPct: 10, comissaoPct: 20 });
    expect(c.imposto_cents).toBe(34_029);
    expect(c.taxa_cents).toBe(5_830);
    expect(c.liquido_cents).toBe(300_431);
    expect(c.comissao_cents).toBe(60_086);
  });
  it("o setup, com a comissão dele", () => {
    const c = contaDaComissao({ valorPagoCents: 120_000, liquidoDoAsaasCents: 120_000 - 4_248, aliquotaPct: 10, comissaoPct: 30 });
    expect(c.liquido_cents).toBe(103_752);
    expect(c.comissao_cents).toBe(31_126);
  });
  it("sem taxa negativa, sem líquido negativo", () => {
    const c = contaDaComissao({ valorPagoCents: 1_000, liquidoDoAsaasCents: 1_200, aliquotaPct: 100, comissaoPct: 50 });
    expect(c.taxa_cents).toBe(0);
    expect(c.liquido_cents).toBe(0);
    expect(c.comissao_cents).toBe(0);
  });
});

describe("o prazo e o mês", () => {
  it("a mensalidade no prazo: N meses da primeira paga; enquanto pagar não acaba", () => {
    expect(mensalidadeNoPrazo("2027-01-10", "2026-10-10", 6)).toBe(true);
    expect(mensalidadeNoPrazo("2027-04-09", "2026-10-10", 6)).toBe(true);
    expect(mensalidadeNoPrazo("2027-04-10", "2026-10-10", 6)).toBe(false);
    expect(mensalidadeNoPrazo("2040-01-01", "2026-10-10", null)).toBe(true);
    expect(mensalidadeNoPrazo("2026-10-10", null, 6)).toBe(true);
  });
  it("as contas de data", () => {
    expect(somarMeses("2026-08-31", 6)).toBe("2027-02-28");
    expect(competenciaDe("2026-10-27")).toBe("2026-10-01");
    expect(mesAnterior("2026-01-01")).toBe("2025-12-01");
    expect(nomeDoMes("2026-10-01")).toBe("Outubro de 2026");
  });
});

describe("o parceiro", () => {
  it("o documento pelo tamanho, com o dígito conferido", () => {
    expect(documentoDoParceiro("529.982.247-25")).toEqual({ tipo: "cpf", documento: "52998224725" });
    expect(documentoDoParceiro("11.222.333/0001-81")).toEqual({ tipo: "cnpj", documento: "11222333000181" });
    expect(documentoDoParceiro("111.111.111-11")).toBeNull();
    expect(documentoDoParceiro("123")).toBeNull();
  });
  it("a chave Pix mascarada", () => {
    expect(pixMascarado("parceira@exemplo.com.br")).toBe("par***.br");
    expect(pixMascarado("abc")).toBe("***");
    expect(pixMascarado(null)).toBeNull();
  });
});
