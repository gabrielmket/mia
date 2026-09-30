/**
 * FORK MIA — o cartão do Jev mostra o número da passagem prometida: quantas
 * vezes o atendente prometeu passar ao time e nada andou no mesmo turno. É o
 * número que se lê antes de deixar o Jev decidir.
 *
 *     npx vitest run app/app/ai/providers/_components/CartaoDoJev.passagem-prometida.test.tsx
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TAREFA_DA_PASSAGEM_PROMETIDA } from "@/lib/ai/decisao/tarefa-da-passagem-prometida";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

import { CartaoDoJev, type DadosDoJev } from "./CartaoDoJev";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/app/ai/credentials/_actions", () => ({ refreshCredentialsView: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

const PASSAGEM = {
  id: TAREFA_DA_PASSAGEM_PROMETIDA.id,
  ponto: TAREFA_DA_PASSAGEM_PROMETIDA.ponto,
  rotulo: TAREFA_DA_PASSAGEM_PROMETIDA.rotulo,
  oQueFaz: TAREFA_DA_PASSAGEM_PROMETIDA.oQueFaz,
  novo: false,
} as const;

function dados(por_tarefa: DadosDoJev["por_tarefa"]): DadosDoJev {
  return {
    provedor: { rotulo: "Jev (TypeSafe AI)", quandoUsar: "Decide rápido.", ondePegarAChave: "https://console.typesafe.ai/keys", prefixoDaChave: "apikey_…" },
    chave: { existe: true, validada: true, credencial_id: "cred-1", rotulo: "Jev", erro_de_validacao: null },
    config: { ligado: true, modo: "observacao", aceite: null },
    tarefas: [],
    por_tarefa,
    tem_ia_de_sempre: true,
    numeros: {
      dias: 7,
      decisoes: 0,
      custo_cents: 0,
      custo_incompleto: false,
      latencia_media_ms: null,
      reservas: 0,
      irritados: 0,
      observacao: { dias: 30, comparadas: 0, concordaram: 0 },
    },
    ultima_falha: null,
    pode_editar: true,
  } as DadosDoJev;
}

function montar(d: DadosDoJev) {
  return render(
    <IdiomaProvider locale="pt-BR">
      <QueryClientProvider client={new QueryClient()}>
        <CartaoDoJev dados={d} erro={null} recarregar={vi.fn(async () => {})} />
      </QueryClientProvider>
    </IdiomaProvider>,
  );
}

describe("o cartão do Jev e a passagem prometida", () => {
  it("⭐ observando: mostra quantas vezes prometeu passar e nada andou", () => {
    montar(
      dados([
        {
          ...PASSAGEM,
          estado: "observando",
          observacao: { dias: 30, comparadas: 50, concordaram: 44, prometida_sem_aviso: 5 },
        },
      ]),
    );
    const linha = screen.getByTestId("jev-concordancia-passagem_prometida");
    expect(linha).toHaveTextContent(/concordaram em 44 de 50/);
    expect(within(linha).getByTestId("jev-passagem-prometida-sem-aviso")).toHaveTextContent("5");
    expect(linha).toHaveTextContent(/prometeu passar ao time e nada andou no mesmo turno/);
  });

  it("pausada (o estado de fábrica): o botão é Religar — ligada, ela volta observando", () => {
    montar(dados([{ ...PASSAGEM, estado: "desligada" }]));
    const tarefa = screen.getByTestId("jev-tarefa-passagem_prometida");
    expect(within(tarefa).getByText("Pausada")).toBeInTheDocument();
    expect(within(tarefa).getByRole("button", { name: "Religar" })).toBeInTheDocument();
  });
});
