/**
 * FORK MIA — QUANDO A LEITURA É CORTADA, A TELA DIZ.
 *
 * As rotas de metas e do relatório de vendas devolvem `truncado` quando o
 * período passa do teto de páginas (`lib/leitura/todas-as-paginas.ts`). O campo
 * sozinho não protege ninguém: quem decide comissão olha a tela, não o JSON.
 * Aqui se prova que o aviso aparece quando o campo vem ligado, e que NÃO
 * aparece quando a leitura coube (aviso que está sempre lá deixa de ser lido).
 *
 * A frase segue a do upstream no relatório por etiqueta (`aviso-de-corte`, em
 * `app/app/activities/_components/TagReportClient.tsx`), e tem de ter espanhol.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { traduzir } from "@/lib/i18n/dicionario";

const cenario = vi.hoisted(() => ({ truncado: false }));

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));
vi.mock("@/hooks/auth/AuthProvider", () => ({ usePermission: () => false }));
vi.mock("@/components/metas/DefinirMeta", () => ({ DefinirMeta: () => null }));

vi.mock("@/hooks/useRelatorioDeVendas", () => ({
  useRelatorioDeVendas: () => ({
    isLoading: false,
    isError: false,
    data: {
      periodo: "2026-09",
      fuso: "UTC",
      taxa_de_ganho: { ganhos: 800, perdidos: 200, taxa: 0.8 },
      ciclo_de_venda: { mediaDias: 12, medianaDias: 9, vendas: 800 },
      motivos_de_perda: [],
      historico: [],
      truncado: cenario.truncado,
    },
  }),
}));

vi.mock("@/hooks/useMetas", () => ({
  useMetas: () => ({
    isLoading: false,
    isError: false,
    data: {
      periodo: "2026-09",
      metas: [],
      resumo: {
        recorrente: 0,
        avulso: 0,
        naoClassificada: 0,
        total: 0,
        vendasSemClassificacao: 0,
        contratoRecorrenteCents: 0,
      },
      reunioes_no_mes: 0,
      reunioes: { marcadas: 0, realizadas: 0, faltas: 0, sem_desfecho: 0, taxa_de_comparecimento: null },
      truncado: cenario.truncado,
    },
  }),
}));

import { PainelDeMetas } from "@/components/metas/PainelDeMetas";
import { RelatorioDeVendas } from "@/components/metas/RelatorioDeVendas";

const FRASE_DO_RELATORIO =
  "O período passou do limite de leitura: os números contam só os negócios fechados mais recentes.";
const FRASE_DAS_METAS =
  "O mês passou do limite de leitura: os números contam só as vendas e as reuniões mais recentes.";

afterEach(() => {
  cleanup();
  cenario.truncado = false;
});

describe("o aviso de leitura cortada", () => {
  it("relatório de vendas: aparece quando a rota diz truncado", () => {
    cenario.truncado = true;
    render(<RelatorioDeVendas />);
    expect(screen.getByTestId("aviso-de-corte").textContent).toBe(FRASE_DO_RELATORIO);
  });

  it("relatório de vendas: não aparece quando a leitura coube", () => {
    render(<RelatorioDeVendas />);
    expect(screen.queryByTestId("aviso-de-corte")).toBeNull();
  });

  it("metas: aparece quando a rota diz truncado", () => {
    cenario.truncado = true;
    render(<PainelDeMetas />);
    expect(screen.getByTestId("aviso-de-corte").textContent).toBe(FRASE_DAS_METAS);
  });

  it("metas: não aparece quando a leitura coube", () => {
    render(<PainelDeMetas />);
    expect(screen.queryByTestId("aviso-de-corte")).toBeNull();
  });

  it("as duas frases têm espanhol, e o português é a própria chave", () => {
    for (const frase of [FRASE_DO_RELATORIO, FRASE_DAS_METAS]) {
      expect(traduzir(frase, "pt-BR")).toBe(frase);
      const emEspanhol = traduzir(frase, "es");
      expect(emEspanhol).not.toBe(frase);
      expect(emEspanhol).toContain("límite de lectura");
    }
  });
});
