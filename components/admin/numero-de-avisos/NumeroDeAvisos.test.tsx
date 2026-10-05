/**
 * FORK MIA (.62) — A TELA DIZ QUANDO O NÚMERO DA EMPRESA CAIU.
 *
 * "Não troca calado" tem duas metades: o histórico de cada negócio (provado em
 * `lib/avisos/registro-do-aviso.test.ts`) e esta tela, que é o que quem opera
 * olha. Se o número que a empresa escolheu cair, a linha dela tem de dizer — em
 * destaque — que os avisos pararam, ou que estão saindo pela reserva.
 *
 *     npx vitest run components/admin/numero-de-avisos/NumeroDeAvisos.test.tsx
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EmpresaComGrupo, NumeroDeAvisos as Dados } from "@/hooks/useNumeroDeAvisos";

import { NumeroDeAvisos } from "./NumeroDeAvisos";

const get = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: { get: (...a: unknown[]) => get(...a), put: vi.fn(), post: vi.fn() },
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

function envolver(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const NUMERO = {
  id: "eeeeeeee-0000-4000-8000-00000000000e",
  organization_id: "org-ultra",
  organizacao: "Vita Odonto",
  phone_number: "5511911112222",
  display_name: "Comercial Vita",
  status: "FAILED",
};

function comEmpresa(empresa: Partial<EmpresaComGrupo>): Dados {
  return {
    sessao: null,
    candidatas: [],
    grupos: [],
    grupos_indisponiveis: false,
    grupos_motivo: null,
    report: { grupo: null, limite_saldo_usd: 20, resumo_diario: true },
    empresas: [
      {
        id: "org-ultra",
        display_name: "Vita Odonto",
        grupo: { id: "120363000000000001@g.us", nome: "Vita · Comercial" },
        origem: { modo: "empresa", channel_session_id: NUMERO.id, reserva_da_plataforma: false },
        numeros: [],
        numero_escolhido: NUMERO,
        situacao: { via: null, motivo: "numero_da_empresa_fora_do_ar", reserva: "desligada" },
        grupos_do_numero: { grupos: [], indisponiveis: true, motivo: "desconectado" },
        reserva_no_grupo: null,
        ...empresa,
      },
    ],
  };
}

beforeEach(() => vi.clearAllMocks());

describe("a linha da empresa com o próprio número", () => {
  it("⭐ número caído e sem reserva: a tela diz que os avisos NÃO estão saindo", async () => {
    get.mockResolvedValue({ data: comEmpresa({}) });
    envolver(<NumeroDeAvisos />);

    const alerta = await screen.findByTestId("aviso-parado");
    expect(alerta.textContent).toContain("O número escolhido está fora do ar.");
    expect(alerta.textContent).toContain("NÃO estão saindo");
  });

  it("⭐ número caído com reserva: a tela diz que estão saindo pelo número da plataforma", async () => {
    get.mockResolvedValue({
      data: comEmpresa({
        origem: { modo: "empresa", channel_session_id: NUMERO.id, reserva_da_plataforma: true },
        situacao: { via: "reserva", motivo: "numero_da_empresa_fora_do_ar", reserva: null },
        reserva_no_grupo: false,
      }),
    });
    envolver(<NumeroDeAvisos />);

    const alerta = await screen.findByTestId("aviso-pela-reserva");
    expect(alerta.textContent).toContain("saindo pelo número da plataforma (reserva)");
    expect(
      screen.getByText(/A reserva só funciona se o número da plataforma também estiver no grupo/),
      "a tela não avisou que a reserva não chega ao grupo escolhido",
    ).toBeInTheDocument();
  });

  it("número de pé: nada de alarme", async () => {
    get.mockResolvedValue({
      data: comEmpresa({
        numero_escolhido: { ...NUMERO, status: "WORKING" },
        situacao: { via: "empresa", motivo: null, reserva: null },
        grupos_do_numero: {
          grupos: [{ id: "120363000000000001@g.us", nome: "Vita · Comercial" }],
          indisponiveis: false,
          motivo: null,
        },
      }),
    });
    envolver(<NumeroDeAvisos />);

    expect(await screen.findByText("Os avisos saem pelo número desta empresa.")).toBeInTheDocument();
    expect(screen.queryByTestId("aviso-parado")).not.toBeInTheDocument();
    expect(screen.queryByTestId("aviso-pela-reserva")).not.toBeInTheDocument();
  });
});
