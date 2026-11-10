/**
 * FORK MIA (.107) · a faixa "IA pausada" do cabeçalho da conversa.
 *
 * Decisão de 10/11: "calada em todos, mas avisando". Com a conversa em
 * "Automático" e o contato com uma pessoa noutra conversa, o cabeçalho diz quem
 * está com ele, em que número, e leva até aquela conversa. Dados fictícios.
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { FaixaDaPausaPorOutraConversa } from "@/components/inbox/FaixaDaPausaPorOutraConversa";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { traduzir } from "@/lib/i18n/dicionario";
import type { PausaPorOutraConversa } from "@/hooks/ai/useHorarioDaIa";

const estado = vi.hoisted(() => ({ pausa: null as PausaPorOutraConversa | null }));
vi.mock("@/hooks/ai/useHorarioDaIa", () => ({
  useHorarioDaIaDaConversa: () => ({ data: { agente: null, horario: null, pausa_por_outra_conversa: estado.pausa } }),
}));

const CONV = "0f0f0f0f-2222-4222-8222-000000000002";
const OUTRA = "0f0f0f0f-1212-4212-8212-000000000012";

function montar(automatico: boolean, locale = "pt-BR") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IdiomaProvider locale={locale}>
        <FaixaDaPausaPorOutraConversa conversationId={CONV} automatico={automatico} />
      </IdiomaProvider>
    </QueryClientProvider>,
  );
}

describe("a faixa da IA calada por outra conversa do contato", () => {
  it("em Automático, com a pessoa noutra conversa: diz quem, em que número, e abre aquela conversa", () => {
    estado.pausa = { conversation_id: OUTRA, pessoa: "Pessoa Fictícia", numero: "Comercial Fictício", desde: null };
    montar(true);
    const faixa = screen.getByTestId("faixa-pausa-por-outra-conversa");
    expect(faixa.textContent).toContain(
      "IA pausada: Pessoa Fictícia está atendendo este contato no número Comercial Fictício.",
    );
    const botao = screen.getByRole("link", { name: "Abrir aquela conversa" });
    expect(botao.getAttribute("href")).toBe(`/app/inbox?id=${OUTRA}`);
  });

  it("sem dono na outra conversa (pausada), diz que a IA está pausada naquele número", () => {
    estado.pausa = { conversation_id: OUTRA, pessoa: null, numero: "Comercial Fictício", desde: null };
    montar(true);
    expect(screen.getByTestId("faixa-pausa-por-outra-conversa").textContent).toContain(
      "IA pausada: este contato está com a IA pausada no número Comercial Fictício.",
    );
  });

  it("fora de Automático não aparece (o cabeçalho já diz por que a IA não responde)", () => {
    estado.pausa = { conversation_id: OUTRA, pessoa: "Pessoa Fictícia", numero: "Comercial Fictício", desde: null };
    montar(false);
    expect(screen.queryByTestId("faixa-pausa-por-outra-conversa")).toBeNull();
  });

  it("sem outra conversa calando esta, não aparece", () => {
    estado.pausa = null;
    montar(true);
    expect(screen.queryByTestId("faixa-pausa-por-outra-conversa")).toBeNull();
  });

  it("em espanhol", () => {
    estado.pausa = { conversation_id: OUTRA, pessoa: "Pessoa Fictícia", numero: "Comercial Fictício", desde: null };
    montar(true, "es");
    expect(screen.getByTestId("faixa-pausa-por-outra-conversa").textContent).toContain(
      "IA en pausa: Pessoa Fictícia está atendiendo a este contacto en el número Comercial Fictício.",
    );
    expect(screen.getByRole("link", { name: "Abrir esa conversación" })).toBeTruthy();
    for (const frase of [
      "IA pausada: {pessoa} está atendendo este contato no número {numero}.",
      "IA pausada: este contato está com a IA pausada no número {numero}.",
      "Abrir aquela conversa",
      "outro número",
    ]) {
      expect(traduzir(frase, "es"), frase).not.toBe(frase);
    }
  });

  it("o cabeçalho da conversa monta a faixa só com o comando em Automático", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const fonte = readFileSync(join(__dirname, "..", "..", "components/inbox/ConversationHeader.tsx"), "utf8");
    expect(fonte).toContain(
      '<FaixaDaPausaPorOutraConversa conversationId={conversation.id} automatico={comando.quem === "automatico"} />',
    );
  });
});
