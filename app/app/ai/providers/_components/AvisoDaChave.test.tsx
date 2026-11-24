/**
 * FORK MIA (MIA-218) · o aviso da chave em IA › Provedores.
 *
 * Na MIA a chave é da plataforma: a empresa sem chave própria NÃO deve ler
 * "Você ainda não cadastrou a chave" (a frase do upstream que fez o próprio dono
 * da instalação achar que precisava cadastrar). A chave própria é opção
 * avançada, só para o admin da plataforma.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AvisoDaChave } from "./AvisoDaChave";

describe("AvisoDaChave", () => {
  it("com a chave da instalação: diz que usa a chave da plataforma e que nada precisa ser cadastrado", () => {
    render(<AvisoDaChave semChavePropria instalacaoTemChave podeCadastrarChave={false} />);
    const aviso = screen.getByTestId("aviso-chave-da-plataforma");
    expect(aviso).toHaveTextContent(/^Usando a chave da .+\. Nenhuma chave precisa ser cadastrada\.$/);
    expect(aviso).not.toHaveTextContent("{marca}");
    expect(screen.queryByTestId("chave-propria-avancado")).toBeNull();
    expect(screen.queryByTestId("aviso-sem-chave")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("o admin da plataforma vê a chave própria como opção avançada", () => {
    render(<AvisoDaChave semChavePropria instalacaoTemChave podeCadastrarChave />);
    const avancado = screen.getByTestId("chave-propria-avancado");
    expect(avancado).toHaveTextContent("Opção avançada:");
    expect(screen.getByRole("link", { name: "cadastrar uma chave própria desta empresa" })).toHaveAttribute(
      "href",
      "/app/ai/credentials",
    );
  });

  it("sem chave nenhuma, a empresa é mandada ao suporte, sem link para cadastrar", () => {
    render(<AvisoDaChave semChavePropria instalacaoTemChave={false} podeCadastrarChave={false} />);
    expect(screen.getByTestId("aviso-sem-chave")).toHaveTextContent(
      "A IA desta conta está sem chave para funcionar. Fale com o suporte.",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("sem chave nenhuma, o admin da plataforma vê o aviso de cadastrar", () => {
    render(<AvisoDaChave semChavePropria instalacaoTemChave={false} podeCadastrarChave />);
    expect(screen.getByTestId("aviso-sem-chave")).toHaveTextContent("Você ainda não cadastrou a chave");
    expect(screen.getByRole("link", { name: "Cadastrar uma chave" })).toBeTruthy();
  });

  it("com chave própria cadastrada, nada aparece", () => {
    const { container } = render(
      <AvisoDaChave semChavePropria={false} instalacaoTemChave podeCadastrarChave />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
