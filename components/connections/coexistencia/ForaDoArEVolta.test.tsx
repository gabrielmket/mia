/**
 * FORK MIA · coexistência (S4): o cartão do canal com o número fora do ar e o
 * de volta, como a tela 4 do protótipo v3. O motivo vem em palavras (o mesmo do
 * aviso da Central), e "Conectar de novo" abre a mesma janela da S3.
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ForaDoArEVolta } from "./ForaDoArEVolta";

const fora = {
  estado: "fora_do_ar" as const,
  foraDoArMotivo: "PRIMARY_INACTIVITY",
  foraDoArEm: "2026-11-18T09:40:00.000Z",
  voltouEm: null,
};

describe("ForaDoArEVolta", () => {
  it("fora do ar: o motivo em palavras, o que para, e o Conectar de novo abre a janela", async () => {
    const aoConectar = vi.fn();
    render(<ForaDoArEVolta numero={fora} podeConectar aoConectar={aoConectar} />);
    expect(screen.getByTestId("coexistencia-fora-do-ar").textContent).toContain("cerca de 14 dias");
    expect(screen.getByText(/nada sai pela MIA por este número/)).toBeTruthy();
    await userEvent.click(screen.getByTestId("coexistencia-conectar-de-novo"));
    expect(aoConectar).toHaveBeenCalledTimes(1);
  });

  it("fora do ar sem poder conectar (chave desligada ou app da Meta sem configurar): o botão fica desligado", () => {
    render(<ForaDoArEVolta numero={{ ...fora, foraDoArMotivo: null }} podeConectar={false} aoConectar={() => undefined} />);
    expect((screen.getByTestId("coexistencia-conectar-de-novo") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("coexistencia-fora-do-ar").textContent).toContain("não informou o motivo");
  });

  it("de volta: diz que nada foi duplicado", () => {
    render(
      <ForaDoArEVolta
        numero={{ ...fora, estado: "no_ar", voltouEm: "2026-11-19T10:12:00.000Z" }}
        podeConectar
        aoConectar={() => undefined}
      />,
    );
    expect(screen.getByTestId("coexistencia-de-volta").textContent).toContain("nada foi duplicado");
  });

  it("no ar e nunca saiu: nada a mostrar", () => {
    const { container } = render(
      <ForaDoArEVolta numero={{ ...fora, estado: "no_ar", foraDoArMotivo: null, foraDoArEm: null }} podeConectar aoConectar={() => undefined} />,
    );
    expect(container.textContent).toBe("");
  });
});
