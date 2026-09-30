/**
 * FORK MIA · A GALERIA POR SEGMENTO.
 *
 * O que estes casos guardam, pela tela:
 *
 * 1. A galeria abre no GERAL. Quem não é clínica não pode dar de cara com
 *    "paciente" e "consulta" como se o produto fosse só para saúde.
 * 2. Cada segmento mostra os quatro modelos DELE e nenhum de outro, para a
 *    pessoa não instalar texto de imobiliária numa academia.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NICHOS_DE_MODELO, modelosDoNicho } from "@/lib/followup/modelos";
import { ModelosDialog } from "./ModelosDialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/followup/useEtapasDeGatilho", () => ({
  useEtapasDeGatilho: () => ({ etapas: [], carregando: false }),
}));
vi.mock("@/hooks/followup/useInstalarModelo", () => ({
  useInstalarModelo: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));

function montar() {
  return render(<ModelosDialog open onOpenChange={() => {}} nomesExistentes={[]} />);
}

/** Os ids dos cartões que a galeria mostra agora. */
function cartoesNaTela(): string[] {
  return screen
    .getAllByTestId(/^modelo-/)
    .map((el) => el.getAttribute("data-testid")!.replace(/^modelo-/, ""))
    .sort();
}

describe("ModelosDialog · galeria por segmento (FORK MIA)", () => {
  it("abre no segmento Geral, sem nenhum modelo de clínica", () => {
    montar();
    expect(screen.getByTestId("segmento-geral")).toHaveAttribute("aria-pressed", "true");
    expect(cartoesNaTela()).toEqual(modelosDoNicho("geral").map((m) => m.id).sort());
    expect(screen.queryByTestId("modelo-clinica-consulta-retomada")).toBeNull();
  });

  it("cada segmento mostra os quatro modelos dele e nenhum de outro", async () => {
    const user = userEvent.setup({ delay: null });
    montar();
    for (const nicho of NICHOS_DE_MODELO) {
      await user.click(screen.getByTestId(`segmento-${nicho}`));
      expect(screen.getByTestId(`segmento-${nicho}`)).toHaveAttribute("aria-pressed", "true");
      const esperado = modelosDoNicho(nicho).map((m) => m.id).sort();
      expect(esperado).toHaveLength(4);
      expect([nicho, cartoesNaTela()]).toEqual([nicho, esperado]);
    }
  });

  it("o modelo de etapa continua pedindo a etapa antes de instalar", async () => {
    const user = userEvent.setup({ delay: null });
    montar();
    await user.click(screen.getByTestId("segmento-imobiliario"));
    const cartao = screen.getByTestId("modelo-imobiliario-visita");
    expect(within(cartao).getByRole("button", { name: "Instalar" })).toBeDisabled();
    expect(within(cartao).getByText("Etapa do funil que dispara")).toBeInTheDocument();
  });
});
