/**
 * O dia do lançamento do saldo do provedor é o dia de quem digitou.
 *
 * Achado em produção (17/11/2026): o campo "Quando" virava meia-noite em UTC,
 * que em Brasília é 21h do dia anterior. A leitura lançada para hoje aparecia
 * com a data de ontem; a lançada para amanhã aparecia hoje, mas no futuro, e o
 * "consumido desde então" ficava zerado até a hora chegar.
 *
 * Os casos rodam no fuso de Brasília de propósito: em UTC, que é o fuso do CI,
 * o defeito não aparece.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  diaLocal,
  instanteNaoEstaNoFuturo,
  momentoDoLancamento,
} from "@/lib/ai/custo/dia-do-lancamento";

const FUSO_ORIGINAL = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "America/Sao_Paulo";
});

afterAll(() => {
  if (FUSO_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = FUSO_ORIGINAL;
});

// 17/11/2026 às 18h30 em Brasília = 21h30 em UTC.
const AGORA = new Date("2026-11-17T21:30:00.000Z");

describe("dia escolhido vira instante no fuso de quem digitou", () => {
  it("controle: o jeito antigo jogava o dia de hoje para ontem", () => {
    // É o defeito que esta regra existe para evitar; se um dia passar a dar
    // 17, o fuso do teste deixou de ser o de Brasília e os casos abaixo não provam nada.
    expect(diaLocal(new Date(new Date("2026-11-17").toISOString()))).toBe("2026-11-16");
  });

  it("hoje vira agora, e o dia exibido continua sendo hoje", () => {
    const r = momentoDoLancamento("2026-11-17", AGORA);
    expect(r).toEqual({ ok: true, occurred_at: AGORA.toISOString() });
    if (r.ok) expect(diaLocal(new Date(r.occurred_at))).toBe("2026-11-17");
  });

  it("dia passado vira meio-dia local daquele dia", () => {
    const r = momentoDoLancamento("2026-11-10", AGORA);
    expect(r).toEqual({ ok: true, occurred_at: "2026-11-10T15:00:00.000Z" });
    if (r.ok) expect(diaLocal(new Date(r.occurred_at))).toBe("2026-11-10");
  });

  it("dia futuro é recusado, não gravado como o dia anterior", () => {
    expect(momentoDoLancamento("2026-11-18", AGORA)).toEqual({ ok: false, motivo: "futuro" });
  });

  it("depois das 21h de Brasília, hoje ainda é hoje (já é amanhã em UTC)", () => {
    const tarde = new Date("2026-11-18T01:30:00.000Z"); // 17/11 às 22h30 em Brasília
    expect(momentoDoLancamento("2026-11-17", tarde)).toEqual({ ok: true, occurred_at: tarde.toISOString() });
    expect(momentoDoLancamento("2026-11-18", tarde)).toEqual({ ok: false, motivo: "futuro" });
  });

  it("data que não existe é inválida, não o dia seguinte", () => {
    expect(momentoDoLancamento("2026-02-31", AGORA)).toEqual({ ok: false, motivo: "invalido" });
    expect(momentoDoLancamento("17/11/2026", AGORA)).toEqual({ ok: false, motivo: "invalido" });
  });
});

describe("o servidor recusa lançamento no futuro", () => {
  it("aceita o passado e o agora, com folga de relógio de 5 minutos", () => {
    expect(instanteNaoEstaNoFuturo("2026-11-10T15:00:00.000Z", AGORA)).toBe(true);
    expect(instanteNaoEstaNoFuturo("2026-11-17T21:34:00.000Z", AGORA)).toBe(true);
  });

  it("recusa o que cairia horas à frente, como a meia-noite UTC de amanhã", () => {
    expect(instanteNaoEstaNoFuturo("2026-11-18T00:00:00.000Z", AGORA)).toBe(false);
    expect(instanteNaoEstaNoFuturo("não é data", AGORA)).toBe(false);
  });
});
