/**
 * FORK MIA (MIA-218) · o aviso da chave em IA › Provedores, sobre `ia.chave`
 * do GET (`iaDaEmpresa`, MIA-217).
 *
 * Na MIA a chave é da plataforma: a empresa sem chave própria NÃO deve ler
 * "Você ainda não cadastrou a chave" (a frase do upstream que fez o próprio dono
 * da instalação achar que precisava cadastrar). A chave própria é opção
 * avançada, só para o admin da plataforma. E o padrão num provedor sem chave
 * nenhuma (o buraco da MIA-215) é dito, com o efeito.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarcaDaInstalacaoProvider } from "@/lib/branding/contexto";

import { AvisoDaChave } from "./AvisoDaChave";

/** Marca fictícia: o aviso diz o nome DELA, e não um texto qualquer. */
const MARCA = { name: "Marca Exemplo", logoUrl: null, initial: "M" };

const SEGUE_COM_A_DA_INSTALACAO = { origem: "plataforma", chave: "instalacao" } as const;
const SEM_CHAVE = { origem: "propria", chave: null } as const;

function montar(p: Partial<Parameters<typeof AvisoDaChave>[0]> = {}) {
  return render(
    <AvisoDaChave
      ia={SEGUE_COM_A_DA_INSTALACAO}
      provedorNome="Anthropic (Claude)"
      podeEditar={false}
      podeCadastrarChave={false}
      {...p}
    />,
    { wrapper: ({ children }) => <MarcaDaInstalacaoProvider marca={MARCA}>{children}</MarcaDaInstalacaoProvider> },
  );
}

describe("AvisoDaChave", () => {
  it("com a chave da instalação: diz que usa a chave da plataforma e que nada precisa ser cadastrado", () => {
    montar();
    const aviso = screen.getByTestId("aviso-chave-da-plataforma");
    expect(aviso).toHaveTextContent(/^Usando a chave da Marca Exemplo\. Nenhuma chave precisa ser cadastrada\.$/);
    expect(screen.queryByTestId("chave-propria-avancado")).toBeNull();
    expect(screen.queryByTestId("aviso-sem-chave")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("o admin da plataforma vê a chave própria como opção avançada", () => {
    montar({ podeEditar: true, podeCadastrarChave: true });
    expect(screen.getByTestId("chave-propria-avancado")).toHaveTextContent("Opção avançada:");
    expect(screen.getByRole("link", { name: "cadastrar uma chave própria desta empresa" })).toHaveAttribute(
      "href",
      "/app/ai/credentials",
    );
  });

  it("⭐ padrão sem chave, para quem escolhe a IA (a plataforma em modo suporte): diz o provedor, o efeito e o que fazer, sem link de chave", () => {
    montar({ ia: SEM_CHAVE, podeEditar: true, podeCadastrarChave: false });
    const aviso = screen.getByTestId("aviso-sem-chave");
    expect(aviso).toHaveTextContent("A IA principal desta empresa (Anthropic (Claude)) está sem chave e não responde aos clientes.");
    expect(aviso).toHaveTextContent("Escolha no padrão abaixo um provedor com chave.");
    expect(aviso).not.toHaveTextContent("{provedor}");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("padrão sem chave, para o admin da plataforma fora de suporte: também a chave própria, como opção avançada", () => {
    montar({ ia: SEM_CHAVE, podeEditar: true, podeCadastrarChave: true });
    expect(screen.getByTestId("aviso-sem-chave")).toHaveTextContent("Escolha no padrão abaixo um provedor com chave.");
    expect(screen.getByRole("link", { name: "cadastrar uma chave própria desta empresa" })).toBeTruthy();
  });

  it("padrão sem chave, para a empresa: é com o suporte, sem link e sem o nome do provedor", () => {
    montar({ ia: SEM_CHAVE });
    const aviso = screen.getByTestId("aviso-sem-chave");
    expect(aviso).toHaveTextContent("A IA desta conta está sem chave para funcionar. Fale com o suporte.");
    expect(aviso).not.toHaveTextContent("Anthropic");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("com chave própria, nada aparece", () => {
    const { container } = montar({ ia: { origem: "propria", chave: "propria" }, podeCadastrarChave: true });
    expect(container).toBeEmptyDOMElement();
  });

  it("a leitura falhou (ia null): nada aparece, nem um \"sem chave\" chutado", () => {
    const { container } = montar({ ia: null, podeEditar: true, podeCadastrarChave: true });
    expect(container).toBeEmptyDOMElement();
  });
});
