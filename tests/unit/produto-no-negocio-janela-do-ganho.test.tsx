/**
 * FORK MIA (.109) · a janela "Marcar como ganho" (tela 3 do protótipo,
 * components/produto-no-negocio/JanelaDoGanho.tsx).
 *
 * Com "Pedir o produto ao marcar como ganho" ligado, ela só confirma com pelo
 * menos um item; desligada, mostra os itens e deixa fechar sem. Confirmar sem
 * mexer não grava nada e devolve o motivo; mexer grava os itens ANTES de devolver
 * (com o carimbo novo do negócio, que o move do arrasto confere).
 *
 * Dado fictício (Clínica Sorriso Exemplo).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  funil: {} as Record<string, unknown>,
  itens: [] as Array<Record<string, unknown>>,
  put: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: vi.fn(async (caminho: string) => {
      if (caminho.endsWith("/produto-no-negocio")) return { data: h.funil };
      if (caminho.endsWith("/itens")) {
        const soma = h.itens.length ? 22_000 : null;
        return {
          data: {
            lead_id: "l-1",
            pipeline_id: "p-1",
            updated_at: "2026-11-10T12:00:00.000Z",
            moeda: "BRL",
            itens: h.itens,
            valor: { modo: "soma", antigo: false, somaCents: soma, valorCents: soma },
            funil: h.funil,
          },
        };
      }
      if (caminho.startsWith("/api/v1/products")) {
        return { data: [{ id: "p-lim", codigo: "LIM-01", nome: "Limpeza", preco_cents: 22_000, moeda: "BRL", ativo: true }] };
      }
      throw new Error(`leitura inesperada: ${caminho}`);
    }),
    put: h.put,
    post: vi.fn(),
    patch: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

const { JanelaDoGanho } = await import("@/components/produto-no-negocio/JanelaDoGanho");

const funil = (ajuste: Record<string, unknown> = {}) => ({
  pipeline_id: "p-1",
  palavra: "Tratamento",
  pedir_no_ganho: false,
  mostrar_valor_recorrente: false,
  ganho: "Fechado",
  motivos_de_ganho: ["Avaliação convenceu", "Indicação"],
  motivo_de_ganho_obrigatorio: false,
  ...ajuste,
});

const LIMPEZA = {
  id: "i-1",
  origem: "negocio",
  productId: "p-lim",
  nome: "Limpeza",
  codigo: "LIM-01",
  precoUnitarioCents: 22_000,
  quantidade: 1,
  descontoCents: 0,
  moeda: "BRL",
  proposta: null,
};

function abrir(onConfirmar = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <JanelaDoGanho open onOpenChange={() => {}} lead={{ id: "l-1", title: "Paciente Ana Exemplo" }} pipelineId="p-1" onConfirmar={onConfirmar} />
    </QueryClientProvider>,
  );
  return onConfirmar;
}

beforeEach(() => {
  h.funil = funil();
  h.itens = [];
  h.put.mockReset();
});

describe("Marcar como ganho", () => {
  it("a janela diz para onde o negócio vai, com a palavra do funil", async () => {
    abrir();
    expect(await screen.findByText(/Paciente Ana Exemplo/)).toBeTruthy();
    expect(await screen.findByText("Fechado")).toBeTruthy();
    expect(await screen.findByText("Tratamentos")).toBeTruthy();
  });

  it("⭐ pedir LIGADO e sem item: Confirmar fica desligado e a janela diz o que falta", async () => {
    h.funil = funil({ pedir_no_ganho: true });
    const onConfirmar = abrir();
    expect(await screen.findByText("Este negócio ainda não tem tratamento.")).toBeTruthy();
    expect(screen.getByText("Escolha pelo menos um tratamento para confirmar.")).toBeTruthy();
    const botao = screen.getByTestId("confirmar-ganho") as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    await userEvent.click(botao);
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  it("pedir LIGADO com item: confirma, sem gravar o que não mudou, e devolve o motivo escolhido", async () => {
    h.funil = funil({ pedir_no_ganho: true });
    h.itens = [LIMPEZA];
    const onConfirmar = abrir();
    expect(await screen.findByText("Veio do negócio. O que mudar aqui vale para o negócio também.")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Motivo do ganho (opcional)"), "Indicação");
    const botao = screen.getByTestId("confirmar-ganho") as HTMLButtonElement;
    await waitFor(() => expect(botao.disabled).toBe(false));
    await userEvent.click(botao);
    await waitFor(() => expect(onConfirmar).toHaveBeenCalledWith({ wonReason: "Indicação", updatedAt: null }));
    expect(h.put).not.toHaveBeenCalled();
  });

  it("pedir DESLIGADO e sem item: avisa que entra como Sem tratamento e deixa fechar", async () => {
    const onConfirmar = abrir();
    expect(await screen.findByText(/Neste funil escolher é opcional/)).toBeTruthy();
    const botao = screen.getByTestId("confirmar-ganho") as HTMLButtonElement;
    await waitFor(() => expect(botao.disabled).toBe(false));
    await userEvent.click(botao);
    await waitFor(() => expect(onConfirmar).toHaveBeenCalledWith({ updatedAt: null }));
  });

  it("mexer na janela grava os itens ANTES de devolver, com o carimbo novo do negócio", async () => {
    h.funil = funil({ pedir_no_ganho: true });
    h.put.mockResolvedValue({
      data: {
        lead_id: "l-1",
        pipeline_id: "p-1",
        updated_at: "2026-11-10T12:05:00.000Z",
        moeda: "BRL",
        itens: [LIMPEZA],
        valor: { modo: "soma", antigo: false, somaCents: 22_000, valorCents: 22_000 },
        mudou: true,
      },
    });
    const onConfirmar = abrir();
    const busca = await screen.findByPlaceholderText("Buscar tratamento no catálogo pelo nome ou código");
    await userEvent.click(busca);
    await userEvent.click(await screen.findByText("Limpeza"));
    const botao = screen.getByTestId("confirmar-ganho") as HTMLButtonElement;
    await waitFor(() => expect(botao.disabled).toBe(false));
    await userEvent.click(botao);
    await waitFor(() => expect(onConfirmar).toHaveBeenCalledWith({ updatedAt: "2026-11-10T12:05:00.000Z" }));
    expect(h.put).toHaveBeenCalledWith("/api/v1/leads/l-1/itens", {
      itens: [{ product_id: "p-lim", quantidade: 1, desconto_cents: 0 }],
      valor: { modo: "soma" },
    });
  });

  it("motivo obrigatório no funil: tira o (opcional) e só confirma com o motivo", async () => {
    h.funil = funil({ motivo_de_ganho_obrigatorio: true });
    const onConfirmar = abrir();
    const campo = await screen.findByLabelText("Motivo do ganho");
    const botao = screen.getByTestId("confirmar-ganho") as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    await userEvent.selectOptions(campo, "Avaliação convenceu");
    await waitFor(() => expect(botao.disabled).toBe(false));
    await userEvent.click(botao);
    await waitFor(() => expect(onConfirmar).toHaveBeenCalledWith({ wonReason: "Avaliação convenceu", updatedAt: null }));
  });
});
