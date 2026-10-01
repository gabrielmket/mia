/**
 * FORK MIA — a barra de etapas do cartão aberto: os dias em cada etapa, somados
 * pelas trocas que a linha do tempo já grava (`stage_changed`).
 */
import { describe, expect, it } from "vitest";

import { diasPorEtapa, trocasDasAtividades } from "./etapas";

describe("dias por etapa", () => {
  const etapas = [
    { id: "novo", nome: "Novo lead", posicao: 0 },
    { id: "qual", nome: "Qualificação", posicao: 1 },
    { id: "visita", nome: "Visita agendada", posicao: 2 },
    { id: "prop", nome: "Proposta", posicao: 3 },
  ];

  it("soma o tempo de cada etapa pelas trocas gravadas", () => {
    const barra = diasPorEtapa({
      etapas,
      etapaAtualId: "visita",
      criadoEm: "2026-09-20T12:00:00Z",
      encerradoEm: null,
      trocas: [
        { em: "2026-09-21T12:00:00Z", de: "novo", para: "qual" },
        { em: "2026-09-24T12:00:00Z", de: "qual", para: "visita" },
      ],
      agora: new Date("2026-09-30T12:00:00Z"),
    });
    expect(barra.map((e) => [e.id, e.dias, e.atual, e.feita])).toEqual([
      ["novo", 1, false, true],
      ["qual", 3, false, true],
      ["visita", 6, true, false],
      ["prop", null, false, false],
    ]);
  });

  it("voltar a uma etapa soma os dois períodos; sem troca, tudo na etapa atual", () => {
    const barra = diasPorEtapa({
      etapas,
      etapaAtualId: "qual",
      criadoEm: "2026-09-20T12:00:00Z",
      encerradoEm: null,
      trocas: [
        { em: "2026-09-22T12:00:00Z", de: "qual", para: "visita" },
        { em: "2026-09-25T12:00:00Z", de: "visita", para: "qual" },
      ],
      agora: new Date("2026-09-30T12:00:00Z"),
    });
    expect(barra.find((e) => e.id === "qual")?.dias).toBe(7);
    expect(barra.find((e) => e.id === "visita")?.dias).toBe(3);
    const semTroca = diasPorEtapa({ etapas, etapaAtualId: "novo", criadoEm: "2026-09-28T12:00:00Z", encerradoEm: null, trocas: [], agora: new Date("2026-09-30T12:00:00Z") });
    expect(semTroca[0]?.dias).toBe(2);
  });

  it("lê as trocas das atividades 'stage_changed' e ignora o resto", () => {
    expect(
      trocasDasAtividades([
        { type: "stage_changed", performed_at: "x", payload: { from_stage_id: "a", to_stage_id: "b" } },
        { type: "note", performed_at: "y", payload: {} },
      ]),
    ).toEqual([{ em: "x", de: "a", para: "b" }]);
  });
});

