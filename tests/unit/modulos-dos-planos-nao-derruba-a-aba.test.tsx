/**
 * FORK MIA (.90) — O BLOCO DOS MÓDULOS NUNCA DERRUBA A ABA PLANOS DO UPSTREAM.
 *
 * O defeito que o e2e do upstream pegou (cobranca-revendedor e
 * cobranca-suspensao-e-limites): a aba abre sem plano, o upstream salva o
 * primeiro, a página se atualiza e o bloco recebe um plano que o rascunho (o
 * estado inicial do React) não conhecia. Ler o rascunho dele quebrava o desenho
 * e levava a aba inteira, com a lista do upstream, para a tela de erro.
 *
 * O que se prova: o plano que chega depois aparece e pode ser mexido; e qualquer
 * erro de desenho dentro do contorno some com o bloco e deixa o vizinho de pé.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ContornoDoBloco } from "@/components/planos-mia/ContornoDoBloco";
import { ModulosDosPlanos, type PlanoComLado } from "@/components/planos-mia/ModulosDosPlanos";

afterEach(cleanup);

const ESSENCIAL: PlanoComLado = {
  id: "00000000-0000-4000-8000-0000000000b1",
  nome: "Essencial E2E",
  arquivado: false,
  assinantes: 0,
  conversas: 300,
  modulos: [],
  preco_por_mensagem_cents: null,
  frase: null,
  destaque: false,
};

describe("o plano que chega depois do primeiro desenho", () => {
  it("⭐ aba sem plano, o upstream salva um, a página se atualiza: o bloco desenha o plano novo", () => {
    const { rerender } = render(<ModulosDosPlanos planos={[]} crmB2bNaInstalacao />);
    expect(screen.queryByText("Essencial E2E")).toBeNull();
    rerender(<ModulosDosPlanos planos={[ESSENCIAL]} crmB2bNaInstalacao />);
    expect(screen.getByText("Essencial E2E")).toBeTruthy();
    // E dá para mexer nele: o rascunho nasce do que veio do servidor.
    const broadcast = screen.getByRole("button", { name: "Broadcast" });
    expect(broadcast.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(broadcast);
    expect(screen.getByRole("button", { name: "Broadcast" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("o segundo plano também entra, sem perder o que foi mexido no primeiro", () => {
    const { rerender } = render(<ModulosDosPlanos planos={[ESSENCIAL]} crmB2bNaInstalacao />);
    fireEvent.click(screen.getByRole("button", { name: "Broadcast" }));
    const profissional = { ...ESSENCIAL, id: "00000000-0000-4000-8000-0000000000b2", nome: "Profissional E2E" };
    rerender(<ModulosDosPlanos planos={[ESSENCIAL, profissional]} crmB2bNaInstalacao />);
    expect(screen.getByText("Profissional E2E")).toBeTruthy();
    const botoes = screen.getAllByRole("button", { name: "Broadcast" });
    expect(botoes.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
  });
});

describe("o contorno do bloco", () => {
  it("⭐ erro de desenho dentro dele some com o bloco e deixa o vizinho (a lista do upstream) de pé", () => {
    const Quebra = (): never => {
      throw new Error("dado inesperado");
    };
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <div>
        <p>Lista de planos do upstream</p>
        <ContornoDoBloco>
          <Quebra />
        </ContornoDoBloco>
      </div>,
    );
    expect(screen.getByText("Lista de planos do upstream")).toBeTruthy();
    aviso.mockRestore();
    erro.mockRestore();
  });
});
