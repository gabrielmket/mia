import { describe, expect, it } from "vitest";

import { aconteceuAntes } from "./instante";

describe("aconteceuAntes: a precisão que o banco guarda", () => {
  it("milissegundos diferentes decidem sozinhos", () => {
    expect(aconteceuAntes("2026-10-01T12:00:00.100000+00:00", "2026-10-01T12:00:00.101000+00:00")).toBe(true);
    expect(aconteceuAntes("2026-10-01T12:00:00.101000+00:00", "2026-10-01T12:00:00.100000+00:00")).toBe(false);
  });

  it("no MESMO milissegundo, os microssegundos desempatam (o caso que o CI mediu)", () => {
    expect(aconteceuAntes("2026-10-01T12:00:00.123456+00:00", "2026-10-01T12:00:00.123789+00:00")).toBe(true);
    expect(aconteceuAntes("2026-10-01T12:00:00.123789+00:00", "2026-10-01T12:00:00.123456+00:00")).toBe(false);
  });

  it("instantes iguais não são anteriores, com ou sem microssegundos escritos", () => {
    expect(aconteceuAntes("2026-10-01T12:00:00.123456+00:00", "2026-10-01T12:00:00.123456+00:00")).toBe(false);
    expect(aconteceuAntes("2026-10-01T12:00:00.123Z", "2026-10-01T12:00:00.123+00:00")).toBe(false);
    expect(aconteceuAntes("2026-10-01T12:00:00Z", "2026-10-01T12:00:00.000000+00:00")).toBe(false);
  });

  it("fusos diferentes continuam comparando o mesmo instante", () => {
    expect(aconteceuAntes("2026-10-01T09:00:00.000100-03:00", "2026-10-01T12:00:00.000200+00:00")).toBe(true);
  });

  it("texto que não é data nunca é anterior", () => {
    expect(aconteceuAntes("ontem", "2026-10-01T12:00:00Z")).toBe(false);
    expect(aconteceuAntes("2026-10-01T12:00:00Z", "")).toBe(false);
  });
});
