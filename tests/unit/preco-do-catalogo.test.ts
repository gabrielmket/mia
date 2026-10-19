/**
 * O preço do catálogo — a peça que tirou o custo do zero.
 *
 * O que estes casos prendem, medido na instalação da Time Company (15/09/2026):
 * o agente rodava em `gpt-5.6-terra`, `pricing.ts` só conhece três Claude, e
 * TODA linha de `llm_calls` nascia com `cost_cents` nulo — tela zerada e teto
 * mensal desarmado, porque `fn_gasto_de_ia_do_mes` soma `coalesce(cost_cents, 0)`.
 */
import { describe, expect, it } from "vitest";

import {
  custoPelaTarifa,
  tarifaDoPrecoDaInstalacao,
} from "@/lib/agent-engine/edge/llm/preco-do-catalogo";

// A LEITURA da linha de preço é do upstream desde a .83 (v1.85, #3013:
// `pricing-do-catalogo.ts`, com teste próprio). O que fica do fork é a conta.
describe("a linha de preço do upstream na unidade da conta", () => {
  it("converte centavos por milhão em dólar por milhão", () => {
    // gpt-5.6-terra no catálogo: 200 e 1200 centavos por milhão = US$ 2 e US$ 12.
    expect(
      tarifaDoPrecoDaInstalacao({
        entradaCentsPorMilhao: 200,
        saidaCentsPorMilhao: 1200,
        origem: "catalogo",
      }),
    ).toEqual({ input: 2, output: 12 });
  });

  it("sem cache, a conta do fork dá o mesmo número que a do upstream", () => {
    // 2 MTok de entrada a 15¢/M + 1 MTok de saída a 60¢/M = 90 centavos (#3013).
    const tarifa = tarifaDoPrecoDaInstalacao({
      entradaCentsPorMilhao: 15,
      saidaCentsPorMilhao: 60,
      origem: "catalogo",
    });
    expect(
      custoPelaTarifa(tarifa, {
        inputTokens: 2_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBeCloseTo(90, 9);
  });
});

describe("custo pela tarifa", () => {
  const terra = { input: 2, output: 12 };

  it("cobra entrada, saída e desconta o que veio do cache", () => {
    // 1M de entrada (300k lidos do cache) + 100k de saída:
    // 700k × US$2 + 300k × US$0,20 + 100k × US$12 = 1,40 + 0,06 + 1,20 = US$ 2,66
    const cents = custoPelaTarifa(terra, {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 300_000,
      cacheWriteTokens: 0,
    });
    expect(cents).toBeCloseTo(266, 6);
  });

  it("o turno real da Rafa custa centavos, não zero", () => {
    // Um agent_turn medido em produção: 46 mil de entrada, 400 de saída.
    const cents = custoPelaTarifa(terra, {
      inputTokens: 46_000,
      outputTokens: 400,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(cents).toBeGreaterThan(0);
    expect(cents).toBeCloseTo(9.68, 2);
  });

  it("chamada sem token nenhum custa zero, e não NaN", () => {
    expect(
      custoPelaTarifa(terra, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(0);
  });
});
