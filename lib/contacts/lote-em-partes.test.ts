/**
 * FORK MIA (.97) — o laço da ação em lote: quem usa não tem teto, o servidor tem.
 *
 *     npx vitest run --project produto lib/contacts/lote-em-partes.test.ts
 */
import { describe, expect, it, vi } from "vitest";

import { rodarLoteEmPartes, TAMANHO_DA_PARTE, type RespostaDaParte } from "./lote-em-partes";

const feita = (n: number): RespostaDaParte => ({ feitos: n, recusados: 0, recusas: [] });

describe("por ids", () => {
  it("340 marcados vão em 4 chamadas de até 100, sem repetir ninguém", async () => {
    const ids = Array.from({ length: 340 }, (_, i) => `c-${i}`);
    const partes: string[][] = [];
    const resumo = await rodarLoteEmPartes(
      { ids },
      {
        porIds: async (lote) => {
          partes.push(lote);
          return feita(lote.length);
        },
        porFiltro: vi.fn(),
      },
    );

    expect(partes.map((p) => p.length)).toEqual([100, 100, 100, 40]);
    expect(partes.flat()).toEqual(ids);
    expect(resumo).toMatchObject({ processados: 340, feitos: 340, recusados: 0, interrompido: false });
  });

  it("100 marcados são uma chamada só", async () => {
    const porIds = vi.fn(async (lote: string[]) => feita(lote.length));
    await rodarLoteEmPartes({ ids: Array.from({ length: TAMANHO_DA_PARTE }, (_, i) => `c-${i}`) }, {
      porIds,
      porFiltro: vi.fn(),
    });
    expect(porIds).toHaveBeenCalledTimes(1);
  });
});

describe("pelo filtro", () => {
  it("anda pelo cursor até o servidor dizer que acabou, e avisa o andamento", async () => {
    const respostas: RespostaDaParte[] = [
      { ...feita(100), processados: 100, cursor: "c1", has_more: true },
      { ...feita(100), processados: 100, cursor: "c2", has_more: true },
      { ...feita(65), processados: 65, cursor: null, has_more: false },
    ];
    const cursores: Array<string | undefined> = [];
    const andamento: number[] = [];

    const resumo = await rodarLoteEmPartes(
      { filtro: { tag: ["vip"] }, total: 265 },
      {
        porIds: vi.fn(),
        porFiltro: async (_filtro, cursor) => {
          cursores.push(cursor);
          return respostas.shift()!;
        },
      },
      (p) => {
        andamento.push(p.processados);
        expect(p.total).toBe(265);
      },
    );

    expect(cursores).toEqual([undefined, "c1", "c2"]);
    expect(andamento).toEqual([0, 100, 200, 265]);
    expect(resumo).toMatchObject({ processados: 265, feitos: 265, interrompido: false });
  });

  it("filtro vazio: uma chamada, nada processado", async () => {
    const resumo = await rodarLoteEmPartes(
      { filtro: {} },
      { porIds: vi.fn(), porFiltro: async () => ({ ...feita(0), processados: 0, cursor: null, has_more: false }) },
    );
    expect(resumo).toMatchObject({ processados: 0, feitos: 0 });
  });

  it("servidor que repete o cursor não prende o laço", async () => {
    const porFiltro = vi.fn(async () => ({ ...feita(1), processados: 1, cursor: "mesmo", has_more: true }));
    await rodarLoteEmPartes({ filtro: {} }, { porIds: vi.fn(), porFiltro });
    expect(porFiltro).toHaveBeenCalledTimes(2);
  });

  it("junta as recusas por motivo: 300 frases iguais não são informação", async () => {
    const recusa = { motivo: "Contato anonimizado — edição bloqueada (LGPD)." };
    const resumo = await rodarLoteEmPartes(
      { filtro: {} },
      {
        porIds: vi.fn(),
        porFiltro: async () => ({
          feitos: 1,
          recusados: 3,
          recusas: [recusa, recusa, { codigo: "not_found" }],
          processados: 4,
          cursor: null,
          has_more: false,
        }),
      },
    );
    expect(resumo.motivos).toEqual([
      { motivo: recusa.motivo, quantos: 2 },
      { motivo: "not_found", quantos: 1 },
    ]);
  });
});

describe("o erro no caminho", () => {
  it("na PRIMEIRA chamada sobe: nada aconteceu", async () => {
    await expect(
      rodarLoteEmPartes(
        { filtro: {} },
        {
          porIds: vi.fn(),
          porFiltro: async () => {
            throw new Error("403");
          },
        },
      ),
    ).rejects.toThrow("403");
  });

  it("no MEIO não sobe: o que já foi, foi, e o resumo diz até onde", async () => {
    let chamadas = 0;
    const resumo = await rodarLoteEmPartes(
      { filtro: {} },
      {
        porIds: vi.fn(),
        porFiltro: async () => {
          chamadas += 1;
          if (chamadas === 2) throw new Error("fetch failed");
          return { ...feita(100), processados: 100, cursor: "c1", has_more: true };
        },
      },
    );
    expect(resumo).toMatchObject({ feitos: 100, interrompido: true, erro: "fetch failed" });
  });

  it("por ids também: a parte que falhou não some com a que passou", async () => {
    let chamadas = 0;
    const resumo = await rodarLoteEmPartes(
      { ids: Array.from({ length: 150 }, (_, i) => `c-${i}`) },
      {
        porIds: async (lote) => {
          chamadas += 1;
          if (chamadas === 2) throw new Error("caiu");
          return feita(lote.length);
        },
        porFiltro: vi.fn(),
      },
    );
    expect(resumo).toMatchObject({ feitos: 100, processados: 100, interrompido: true });
  });
});
