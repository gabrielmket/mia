/**
 * FORK MIA — A ORDEM E O FILTRO NO DOM: o que quem usa vê e aciona.
 *
 * `meta-ads-ordem-da-tabela.test.ts` prova a regra; este arquivo prova que ela
 * está LIGADA na tela: o cabeçalho é um botão alcançável por teclado, o
 * `aria-sort` diz a ordem atual, o "—" fica no fim, a chave de impressão
 * esconde quem não veiculou e diz quantas estão à vista, e a escolha volta
 * depois de recarregar — por pessoa.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TabelaDeCampanhas } from "@/app/app/ads/meta/_components/TabelaDeCampanhas";
import { chaveDaPreferencia } from "@/lib/plataformas-de-anuncio/meta/ordem-da-tabela";
import type { LinhaDeCampanha } from "@/lib/plataformas-de-anuncio/types";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

function linha(id: string, nome: string, ajustes: Partial<LinhaDeCampanha> = {}): LinhaDeCampanha {
  return {
    campanhaId: id,
    nome,
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

// Ordem da plataforma: Beta, Alfa, Sem veiculação, Gama.
const LINHAS = [
  linha("2", "Beta", { gasto: 999, impressoes: 500 }),
  linha("1", "Alfa", { gasto: 1000, impressoes: 800 }),
  linha("3", "Sem veiculação", {
    gasto: null,
    impressoes: 0,
    status: "PAUSED",
    veiculacao: "PAUSED",
  }),
  linha("4", "Gama", { gasto: 9.5, impressoes: 20 }),
];

function nomesNaTabela(): string[] {
  const corpo = screen.getAllByRole("rowgroup")[1]!;
  return within(corpo)
    .getAllByRole("row")
    .map((tr) => (within(tr).getAllByRole("cell")[0]!.textContent ?? "").trim());
}

function cabecalho(rotulo: string): HTMLElement {
  const th = screen
    .getAllByRole("columnheader")
    .find((el) => (el.textContent ?? "").trim() === rotulo);
  if (!th) throw new Error(`coluna ${rotulo} não achada`);
  return th;
}

describe("ordenar pelo cabeçalho", () => {
  it("abre na ordem da plataforma, sem coluna marcada", () => {
    render(<TabelaDeCampanhas linhas={LINHAS} moeda="BRL" />);
    expect(nomesNaTabela()).toEqual(["Beta", "Alfa", "Sem veiculação", "Gama"]);
    for (const th of screen.getAllByRole("columnheader")) {
      expect(th.getAttribute("aria-sort")).toBe("none");
    }
  });

  it('dinheiro: 1º clique do maior para o menor, 2º inverte — e o "—" fica no fim nas duas', async () => {
    const usuario = userEvent.setup();
    render(<TabelaDeCampanhas linhas={LINHAS} moeda="BRL" />);

    await usuario.click(within(cabecalho("Valor Gasto")).getByRole("button"));
    expect(nomesNaTabela()).toEqual(["Alfa", "Beta", "Gama", "Sem veiculação"]);
    expect(cabecalho("Valor Gasto").getAttribute("aria-sort")).toBe("descending");

    await usuario.click(within(cabecalho("Valor Gasto")).getByRole("button"));
    expect(nomesNaTabela()).toEqual(["Gama", "Beta", "Alfa", "Sem veiculação"]);
    expect(cabecalho("Valor Gasto").getAttribute("aria-sort")).toBe("ascending");
  });

  it("texto: começa do A", async () => {
    const usuario = userEvent.setup();
    render(<TabelaDeCampanhas linhas={LINHAS} moeda="BRL" />);
    await usuario.click(within(cabecalho("Campanha")).getByRole("button"));
    expect(nomesNaTabela()).toEqual(["Alfa", "Beta", "Gama", "Sem veiculação"]);
    expect(cabecalho("Campanha").getAttribute("aria-sort")).toBe("ascending");
  });

  it("pelo teclado: Tab até o cabeçalho e Enter ordena, Espaço inverte", async () => {
    const usuario = userEvent.setup();
    render(<TabelaDeCampanhas linhas={LINHAS} moeda="BRL" />);
    const botao = within(cabecalho("Impressões")).getByRole("button");

    // Tab percorre a chave, e depois os cabeçalhos na ordem das colunas.
    while (document.activeElement !== botao) await usuario.tab();
    await usuario.keyboard("{Enter}");
    expect(nomesNaTabela()).toEqual(["Alfa", "Beta", "Gama", "Sem veiculação"]);
    await usuario.keyboard(" ");
    expect(nomesNaTabela()).toEqual(["Sem veiculação", "Gama", "Beta", "Alfa"]);
    expect(cabecalho("Impressões").getAttribute("aria-sort")).toBe("ascending");
  });

  it("o botão de voltar à ordem da plataforma só aparece com ordem escolhida", async () => {
    const usuario = userEvent.setup();
    render(<TabelaDeCampanhas linhas={LINHAS} moeda="BRL" />);
    expect(screen.queryByRole("button", { name: "Voltar à ordem da plataforma" })).toBeNull();

    await usuario.click(within(cabecalho("Valor Gasto")).getByRole("button"));
    await usuario.click(screen.getByRole("button", { name: "Voltar à ordem da plataforma" }));
    expect(nomesNaTabela()).toEqual(["Beta", "Alfa", "Sem veiculação", "Gama"]);
  });

  it("os rótulos das 15 colunas não mudam com o botão dentro do cabeçalho", () => {
    render(<TabelaDeCampanhas linhas={LINHAS} moeda="BRL" />);
    const rotulos = screen.getAllByRole("columnheader").map((th) => (th.textContent ?? "").trim());
    expect(rotulos).toHaveLength(15);
    expect(rotulos[0]).toBe("Campanha");
    expect(rotulos[10]).toBe("Connect rate");
    expect(rotulos[13]).toBe("Hook Rate(reproduções)");
  });
});

describe('a chave "só campanhas com impressão"', () => {
  it("desligada por padrão; ligada esconde quem não veiculou e diz quantas estão à vista", async () => {
    const usuario = userEvent.setup();
    render(<TabelaDeCampanhas linhas={LINHAS} moeda="BRL" />);

    const chave = screen.getByRole("switch", { name: "Só campanhas com impressão" });
    expect(chave.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Mostrando 4 de 4")).toBeTruthy();

    await usuario.click(chave);
    expect(nomesNaTabela()).toEqual(["Beta", "Alfa", "Gama"]);
    expect(screen.getByText("Mostrando 3 de 4")).toBeTruthy();
  });

  it("quando o filtro esconde tudo, a frase diz qual chave desligar", async () => {
    const usuario = userEvent.setup();
    render(<TabelaDeCampanhas linhas={[linha("9", "Parada", { impressoes: null })]} moeda="BRL" />);
    await usuario.click(screen.getByRole("switch", { name: "Só campanhas com impressão" }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/Nenhuma campanha teve impressão neste período/)).toBeTruthy();
  });
});

describe("a escolha é lembrada por pessoa", () => {
  it("volta depois de recarregar para a mesma pessoa, e não vaza para outra", async () => {
    const usuario = userEvent.setup();
    const primeira = render(<TabelaDeCampanhas linhas={LINHAS} moeda="BRL" usuarioId="ana" />);
    await usuario.click(within(cabecalho("Valor Gasto")).getByRole("button"));
    await usuario.click(screen.getByRole("switch", { name: "Só campanhas com impressão" }));
    expect(window.localStorage.getItem(chaveDaPreferencia("ana"))).toContain('"gasto"');
    primeira.unmount();

    // "Recarregar": monta de novo, a leitura acontece depois da montagem.
    render(<TabelaDeCampanhas linhas={LINHAS} moeda="BRL" usuarioId="ana" />);
    expect(await screen.findByText("Mostrando 3 de 4")).toBeTruthy();
    expect(nomesNaTabela()).toEqual(["Alfa", "Beta", "Gama"]);
    cleanup();

    render(<TabelaDeCampanhas linhas={LINHAS} moeda="BRL" usuarioId="bruno" />);
    expect(screen.getByText("Mostrando 4 de 4")).toBeTruthy();
    expect(nomesNaTabela()).toEqual(["Beta", "Alfa", "Sem veiculação", "Gama"]);
  });
});
