/**
 * FORK MIA (.89) — a resposta do assistente da MIA sem asteriscos à vista.
 *
 * O caso que o Gabriel viu em 26/10/2026 no painel: "**Compromissos:** nenhum."
 * aparecia com os asteriscos, as listas como traços soltos, e "836 horas" no lugar
 * de dias. O painel passa a desenhar negrito e listas (com sub-item); o tempo de
 * espera, acima de 48 h, sai em dias.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { blocosDoTexto, TextoDoAssistente } from "@/components/assistente/TextoDoAssistente";
import { tempoDeEspera } from "@/lib/assistente/prioridades";

afterEach(() => cleanup());

const DO_PRINT = [
  "Sua rotina hoje, segunda-feira (26/10):",
  "",
  "- **Compromissos:** nenhum.",
  "- **Tarefas de hoje:** nenhuma.",
  "- **Tarefas atrasadas:** 2, sem responsável:",
  "  - **frf**, vencida em 28/09 às 9h.",
  "  - **testt**, vencida em 30/09 às 9h.",
  "- **Conversas:**",
  "  - 1 esperando resposta há mais de 1 hora.",
  "  - 22 sem dono.",
  "- **Conexão:** 1 número desconectado desde 17/09.",
].join("\n");

describe("o texto do assistente", () => {
  it("separa o parágrafo da lista e pendura os sub-itens no item de cima", () => {
    const blocos = blocosDoTexto(DO_PRINT);
    expect(blocos.map((b) => b.tipo)).toEqual(["paragrafo", "lista"]);
    const lista = blocos[1];
    if (!lista || lista.tipo !== "lista") throw new Error("esperava lista");
    const itens = lista.itens;
    expect(itens).toHaveLength(5);
    expect(itens[2]?.texto).toBe("**Tarefas atrasadas:** 2, sem responsável:");
    expect(itens[2]?.filhos.map((f) => f.texto)).toEqual([
      "**frf**, vencida em 28/09 às 9h.",
      "**testt**, vencida em 30/09 às 9h.",
    ]);
    expect(itens[3]?.filhos).toHaveLength(2);
    expect(itens[4]?.filhos).toHaveLength(0);
  });

  it("na tela: negrito vira <strong>, nenhum asterisco à vista, listas aninhadas", () => {
    render(<TextoDoAssistente texto={DO_PRINT} />);
    const caixa = screen.getByTestId("texto-do-assistente");
    expect(caixa.textContent).not.toContain("*");
    const fortes = Array.from(caixa.querySelectorAll("strong")).map((s) => s.textContent);
    expect(fortes).toContain("Compromissos:");
    expect(fortes).toContain("frf");
    expect(caixa.querySelectorAll("ul")).toHaveLength(3);
    expect(caixa.querySelectorAll("ul ul li")).toHaveLength(4);
  });

  it("o que o modelo escrever vira texto, nunca marcação", () => {
    render(<TextoDoAssistente texto={'- <img src=x onerror="alert(1)"> e **<b>oi</b>**'} />);
    const caixa = screen.getByTestId("texto-do-assistente");
    expect(caixa.querySelector("img")).toBeNull();
    expect(caixa.querySelector("b")).toBeNull();
    expect(caixa.textContent).toContain("<img");
  });

  it("título com # e linhas soltas viram parágrafo; asterisco sozinho fica como está", () => {
    const blocos = blocosDoTexto("## Resumo\nlinha 1\nlinha 2\n\n*nota*");
    expect(blocos).toEqual([
      { tipo: "paragrafo", linhas: ["Resumo", "linha 1", "linha 2"] },
      { tipo: "paragrafo", linhas: ["*nota*"] },
    ]);
  });
});

describe("o tempo de espera", () => {
  it("até 48 h em horas; acima, em dias", () => {
    expect(tempoDeEspera(5)).toBe("5 h");
    expect(tempoDeEspera(47)).toBe("47 h");
    expect(tempoDeEspera(48)).toBe("2 dias");
    expect(tempoDeEspera(836)).toBe("34 dias");
  });
});
