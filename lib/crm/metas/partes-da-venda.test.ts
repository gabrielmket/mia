import { describe, expect, it } from "vitest";

import { partesDaVenda } from "./partes-da-venda";
import { resumoDoMes, type LeadFechadoComPrazo } from "./progresso";

/**
 * FORK MIA — as metas leem as duas formas da recorrência: a de antes da v1.99
 * (a mensalidade em `value_cents` do negócio `recorrente`) e a do upstream
 * (`recurring_value_cents`, com o valor único ao lado).
 */
describe("as partes da venda", () => {
  it("o negócio de antes da v1.99 continua com o número que tinha", () => {
    expect(partesDaVenda({ value_cents: 99_000, revenue_kind: "recorrente" })).toEqual({
      recorrente: 99_000,
      avulso: 0,
      naoClassificada: 0,
      mensalidade: 99_000,
    });
    expect(partesDaVenda({ value_cents: 200_000, revenue_kind: "avulso" }).avulso).toBe(200_000);
    expect(partesDaVenda({ value_cents: 30_000, revenue_kind: null }).naoClassificada).toBe(30_000);
  });

  it("com a mensalidade do upstream, o setup é avulso e a mensalidade é recorrente", () => {
    expect(
      partesDaVenda({ value_cents: 150_000, revenue_kind: "recorrente", recurring_value_cents: 49_000 }),
    ).toEqual({ recorrente: 49_000, avulso: 150_000, naoClassificada: 0, mensalidade: 49_000 });
  });

  it("mensalidade gravada é recorrência mesmo sem o tipo de receita marcado", () => {
    expect(partesDaVenda({ value_cents: 10_000, revenue_kind: null, recurring_value_cents: 5_000 })).toEqual({
      recorrente: 5_000,
      avulso: 0,
      naoClassificada: 10_000,
      mensalidade: 5_000,
    });
  });

  it("o contrato do mês multiplica a mensalidade, e não o setup, pelo prazo", () => {
    const venda = (extra: Partial<LeadFechadoComPrazo>): LeadFechadoComPrazo => ({
      status: "won",
      pipeline_id: "p1",
      value_cents: 150_000,
      revenue_kind: "recorrente",
      owner_user_id: null,
      originated_by_user_id: null,
      closed_at: "2026-11-10T15:00:00Z",
      recurring_months: 12,
      ...extra,
    });
    const resumo = resumoDoMes([venda({ recurring_value_cents: 49_000 })], "2026-11-01");
    expect(resumo.recorrente).toBe(49_000);
    expect(resumo.avulso).toBe(150_000);
    expect(resumo.contratoRecorrenteCents).toBe(49_000 * 12);
    expect(resumo.total).toBe(199_000);
  });
});
