import { describe, expect, it } from "vitest";

import { calcularCusto } from "./custo-da-conversa";

/**
 * ZERO SE LÊ COMO "DE GRAÇA".
 *
 * Esta conta alimenta a conversa de preço com o cliente e a decisão de margem.
 * O erro que ela existe para não cometer é o mais silencioso possível: uma
 * categoria que a Meta cobrou e para a qual ninguém cadastrou preço somar
 * ZERO — o relatório fecharia bonito, com um número menor que a fatura, e
 * ninguém teria motivo para desconfiar.
 *
 * Por isso "sem preço" é `null` em toda a cadeia, aparece numa lista própria, e
 * a tela diz que o total está incompleto.
 *
 *     npx vitest run lib/channels/meta/custo-da-conversa.test.ts
 */

const precos = [
  { categoria: "marketing", centavos_brl: 12 },
  { categoria: "utility", centavos_brl: 4 },
];

describe("o custo do cliente", () => {
  it("multiplica contagem por preço, por categoria", () => {
    const r = calcularCusto(
      [
        { categoria: "marketing", cobradas: 100 },
        { categoria: "utility", cobradas: 50 },
      ],
      precos,
    );
    expect(r.totalCentavos).toBe(100 * 12 + 50 * 4);
  });

  it("NÃO soma zero para categoria sem preço — e diz qual falta", () => {
    const r = calcularCusto(
      [
        { categoria: "marketing", cobradas: 10 },
        { categoria: "authentication", cobradas: 999 },
      ],
      precos,
    );

    expect(r.totalCentavos, "as 999 sem preço entraram como zero e o total ficou menor que a fatura").toBe(
      10 * 12,
    );
    expect(r.semPreco).toEqual(["authentication"]);
    const linha = r.linhas.find((l) => l.categoria === "authentication");
    expect(linha?.centavosUnitarios).toBeNull();
    expect(linha?.totalCentavos).toBeNull();
  });

  it("ordena pelo maior gasto, e joga o sem preço para o fim", () => {
    const r = calcularCusto(
      [
        { categoria: "utility", cobradas: 10 },
        { categoria: "authentication", cobradas: 1 },
        { categoria: "marketing", cobradas: 100 },
      ],
      precos,
    );
    expect(r.linhas.map((l) => l.categoria)).toEqual(["marketing", "utility", "authentication"]);
  });

  it("aguenta mês sem mensagem cobrada", () => {
    const r = calcularCusto([], precos);
    expect(r.totalCentavos).toBe(0);
    expect(r.semPreco).toEqual([]);
  });

  it("preço ZERO cadastrado é diferente de preço ausente", () => {
    const r = calcularCusto([{ categoria: "service", cobradas: 30 }], [
      ...precos,
      { categoria: "service", centavos_brl: 0 },
    ]);
    expect(
      r.semPreco,
      "um preço zero DELIBERADO (a categoria é gratuita neste país) não pode virar pendência: quem cadastrou já respondeu",
    ).toEqual([]);
    expect(r.linhas[r.linhas.length - 1]!.totalCentavos).toBe(0);
  });
});
