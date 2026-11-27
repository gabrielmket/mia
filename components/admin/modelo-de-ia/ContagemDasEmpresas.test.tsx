/**
 * FORK MIA (MIA-218) · as três contagens no cartão do Modelo de IA.
 *
 * Vêm de `empresas` no GET do admin (`contarEmpresas`, MIA-217), só das
 * empresas que operam. `null` = a leitura falhou: nada aparece.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

import { ContagemDasEmpresas } from "./ContagemDasEmpresas";

describe("ContagemDasEmpresas", () => {
  it("mostra as três contagens, e nenhum alarme quando ninguém está sem chave", () => {
    render(<ContagemDasEmpresas empresas={{ seguem: 7, propria: 2, sem_chave: 0 }} />);
    expect(screen.getByTestId("contagem-das-empresas")).toHaveTextContent(
      "7 seguem a plataforma · 2 com escolha própria · 0 sem chave",
    );
    expect(screen.queryByTestId("empresas-sem-chave")).toBeNull();
  });

  it("⭐ com empresa sem chave: diz o efeito e onde ver quais", () => {
    render(<ContagemDasEmpresas empresas={{ seguem: 5, propria: 1, sem_chave: 3 }} />);
    expect(screen.getByTestId("contagem-das-empresas")).toHaveTextContent("3 sem chave");
    expect(screen.getByTestId("empresas-sem-chave")).toHaveTextContent("plataforma_ver_ia_das_empresas");
  });

  it("a leitura falhou (null) ou o servidor ainda não manda o campo: nada aparece", () => {
    const { container, rerender } = render(<ContagemDasEmpresas empresas={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ContagemDasEmpresas empresas={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
