/**
 * FORK MIA — A ORDEM E O FILTRO DA TABELA DE CAMPANHAS, sem tela.
 *
 * As três promessas de `lib/plataformas-de-anuncio/meta/ordem-da-tabela.ts`:
 * número compara como número (não como o texto "R$ 1.000,00"), texto compara
 * em ordem alfabética da língua, e "—" fica no fim nas DUAS direções. Mais o
 * filtro "só com impressão" e a preferência lembrada, que nunca pode derrubar
 * a tela.
 */
import { describe, expect, it } from "vitest";

import {
  PREFERENCIA_PADRAO,
  chaveDaPreferencia,
  direcaoInicial,
  gravarPreferencia,
  lerPreferencia,
  ordenarCampanhas,
  proximaOrdem,
  soQuemTeveImpressao,
} from "@/lib/plataformas-de-anuncio/meta/ordem-da-tabela";
import type { LinhaDeCampanha } from "@/lib/plataformas-de-anuncio/types";

function linha(id: string, ajustes: Partial<LinhaDeCampanha> = {}): LinhaDeCampanha {
  return {
    campanhaId: id,
    nome: `Campanha ${id}`,
    status: "ACTIVE",
    veiculacao: "ACTIVE",
    objetivo: null,
    resultado: { valor: null, custoPorResultado: null, indicador: null },
    gasto: null,
    impressoes: null,
    alcance: null,
    cpm: null,
    ctr: null,
    connectRate: null,
    frequencia: null,
    cpc: null,
    hookRate: null,
    thruPlays: null,
    ...ajustes,
  };
}

const ids = (linhas: LinhaDeCampanha[]) => linhas.map((l) => l.campanhaId);

describe("ordem numérica de verdade", () => {
  // 9,50 · 1000 · 999 — como TEXTO a ordem seria "1000" < "999" < "9.5".
  const linhas = [
    linha("a", { gasto: 999 }),
    linha("b", { gasto: 9.5 }),
    linha("c", { gasto: null }),
    linha("d", { gasto: 1000 }),
  ];

  it("dinheiro do maior para o menor, com o ausente no fim", () => {
    expect(ids(ordenarCampanhas(linhas, { coluna: "gasto", direcao: "desc" }))).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
  });

  it("dinheiro do menor para o maior, com o ausente AINDA no fim", () => {
    expect(ids(ordenarCampanhas(linhas, { coluna: "gasto", direcao: "asc" }))).toEqual([
      "b",
      "a",
      "d",
      "c",
    ]);
  });

  it("porcentagem: 10% passa de 9,99%, e o zero medido NÃO vai para o fim", () => {
    const pct = [
      linha("a", { ctr: 9.99 }),
      linha("b", { ctr: null }),
      linha("c", { ctr: 10 }),
      linha("d", { ctr: 0 }),
    ];
    expect(ids(ordenarCampanhas(pct, { coluna: "ctr", direcao: "desc" }))).toEqual([
      "c",
      "a",
      "d",
      "b",
    ]);
    expect(ids(ordenarCampanhas(pct, { coluna: "ctr", direcao: "asc" }))).toEqual([
      "d",
      "a",
      "c",
      "b",
    ]);
  });

  it("resultado e custo por resultado leem dentro de `resultado`", () => {
    const r = [
      linha("a", { resultado: { valor: 3, custoPorResultado: 50, indicador: null } }),
      linha("b", { resultado: { valor: 12, custoPorResultado: 20, indicador: null } }),
    ];
    expect(ids(ordenarCampanhas(r, { coluna: "resultado", direcao: "desc" }))).toEqual(["b", "a"]);
    expect(ids(ordenarCampanhas(r, { coluna: "custoPorResultado", direcao: "desc" }))).toEqual([
      "a",
      "b",
    ]);
  });

  it("empate mantém a ordem da plataforma (ordenação estável)", () => {
    const empate = [linha("x", { cpm: 5 }), linha("y", { cpm: 5 }), linha("z", { cpm: 5 })];
    expect(ids(ordenarCampanhas(empate, { coluna: "cpm", direcao: "desc" }))).toEqual([
      "x",
      "y",
      "z",
    ]);
    expect(ids(ordenarCampanhas(empate, { coluna: "cpm", direcao: "asc" }))).toEqual([
      "x",
      "y",
      "z",
    ]);
  });

  it("não muda o array recebido (é o `data` compartilhado do React Query)", () => {
    const original = [linha("a", { gasto: 1 }), linha("b", { gasto: 2 })];
    ordenarCampanhas(original, { coluna: "gasto", direcao: "desc" });
    expect(ids(original)).toEqual(["a", "b"]);
  });

  it("sem ordem escolhida devolve a ordem da plataforma", () => {
    expect(ids(ordenarCampanhas(linhas, null))).toEqual(["a", "b", "c", "d"]);
  });
});

describe("ordem alfabética", () => {
  it("acento não separa, e o número dentro do nome é número", () => {
    const nomes = [
      linha("1", { nome: "Campanha 10" }),
      linha("2", { nome: "Árvore" }),
      linha("3", { nome: "Campanha 2" }),
      linha("4", { nome: "abacate" }),
    ];
    expect(ordenarCampanhas(nomes, { coluna: "nome", direcao: "asc" }).map((l) => l.nome)).toEqual([
      "abacate",
      "Árvore",
      "Campanha 2",
      "Campanha 10",
    ]);
    expect(ordenarCampanhas(nomes, { coluna: "nome", direcao: "desc" }).map((l) => l.nome)).toEqual(
      ["Campanha 10", "Campanha 2", "Árvore", "abacate"],
    );
  });

  it("status ordena pelo TEXTO da tela, não pelo código da plataforma", () => {
    const texto: Record<string, string> = {
      ACTIVE: "Ativa",
      PAUSED: "Pausada",
      ARCHIVED: "Arquivada",
    };
    const est = [
      linha("p", { status: "PAUSED" }),
      linha("n", { status: null }),
      linha("a", { status: "ACTIVE" }),
      linha("r", { status: "ARCHIVED" }),
    ];
    // Pelo código seria ACTIVE < ARCHIVED < PAUSED; pelo texto, Arquivada < Ativa < Pausada.
    expect(
      ids(
        ordenarCampanhas(
          est,
          { coluna: "status", direcao: "asc" },
          { textoDoEstado: (c) => texto[c] ?? c },
        ),
      ),
    ).toEqual(["r", "a", "p", "n"]);
  });
});

describe("o clique no cabeçalho", () => {
  it("número começa do maior; texto começa do A", () => {
    expect(direcaoInicial("gasto")).toBe("desc");
    expect(direcaoInicial("ctr")).toBe("desc");
    expect(direcaoInicial("nome")).toBe("asc");
    expect(direcaoInicial("veiculacao")).toBe("asc");
  });

  it("a mesma coluna alterna; coluna nova recomeça na direção dela", () => {
    const primeira = proximaOrdem(null, "gasto");
    expect(primeira).toEqual({ coluna: "gasto", direcao: "desc" });
    const segunda = proximaOrdem(primeira, "gasto");
    expect(segunda).toEqual({ coluna: "gasto", direcao: "asc" });
    expect(proximaOrdem(segunda, "gasto")).toEqual({ coluna: "gasto", direcao: "desc" });
    expect(proximaOrdem(segunda, "nome")).toEqual({ coluna: "nome", direcao: "asc" });
  });
});

describe("só o que teve impressão", () => {
  it("fica só impressões > 0 — zero e ausente saem", () => {
    const l = [
      linha("a", { impressoes: 100 }),
      linha("b", { impressoes: 0 }),
      linha("c", { impressoes: null }),
      linha("d", { impressoes: 1 }),
    ];
    expect(ids(soQuemTeveImpressao(l))).toEqual(["a", "d"]);
  });
});

describe("a preferência lembrada nunca derruba a tela", () => {
  function armazenamentoEmMemoria() {
    const mapa = new Map<string, string>();
    return {
      getItem: (k: string) => mapa.get(k) ?? null,
      setItem: (k: string, v: string) => void mapa.set(k, v),
    };
  }

  it("a chave é por pessoa", () => {
    expect(chaveDaPreferencia("u1")).not.toBe(chaveDaPreferencia("u2"));
    expect(chaveDaPreferencia(undefined)).toContain("anonimo");
  });

  it("grava e lê de volta", () => {
    const a = armazenamentoEmMemoria();
    const pref = {
      ordem: { coluna: "cpc" as const, direcao: "asc" as const },
      soComImpressao: true,
    };
    gravarPreferencia(a, "k", pref);
    expect(lerPreferencia(a, "k")).toEqual(pref);
  });

  it("JSON corrompido, coluna que não existe e direção inválida voltam ao padrão", () => {
    const a = armazenamentoEmMemoria();
    a.setItem("k1", "{não é json");
    expect(lerPreferencia(a, "k1")).toEqual(PREFERENCIA_PADRAO);
    a.setItem(
      "k2",
      JSON.stringify({ ordem: { coluna: "roas", direcao: "desc" }, soComImpressao: true }),
    );
    expect(lerPreferencia(a, "k2")).toEqual({ ordem: null, soComImpressao: true });
    a.setItem(
      "k3",
      JSON.stringify({ ordem: { coluna: "gasto", direcao: "lado" }, soComImpressao: "sim" }),
    );
    expect(lerPreferencia(a, "k3")).toEqual(PREFERENCIA_PADRAO);
  });

  it("armazenamento que LANÇA (aba privada, dados bloqueados) não lança para fora", () => {
    const quebrado = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(lerPreferencia(quebrado, "k")).toEqual(PREFERENCIA_PADRAO);
    expect(() => gravarPreferencia(quebrado, "k", PREFERENCIA_PADRAO)).not.toThrow();
    expect(lerPreferencia(null, "k")).toEqual(PREFERENCIA_PADRAO);
  });
});
