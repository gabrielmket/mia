/**
 * FORK MIA — O ADMIN DO CLIENTE CRIA AGENTE SEM ESCOLHER MODELO NEM CHAVE.
 *
 * Na MIA, modelo e chave de IA são da PLATAFORMA (`podeConfigurarChaveDeIa`,
 * lib/ai/custo-e-da-plataforma.ts). O editor já escondia o cartão "A
 * inteligência que ele usa" de quem não é da plataforma, mas continuava
 * EXIGINDO modelo e chave, e o erro morava dentro do cartão escondido: na .55 o
 * botão "Criar agente" ficava cinza para sempre, sem motivo visível.
 *
 * A página passa a mandar o par da plataforma (`iaDoAgenteNovo`) e nenhuma
 * credencial; o agente nasce com `credential_id: null`, que o runtime resolve.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const acoes = vi.hoisted(() => ({ salvar: vi.fn(), publicar: vi.fn(), criar: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/app/ai/agents/new",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/app/app/ai/agents/[id]/_actions", () => ({
  saveAgentDraftAction: acoes.salvar,
  publishAgentAction: acoes.publicar,
  createMcpAgentAction: acoes.criar,
}));

import { AgentForm } from "@/app/app/ai/agents/[id]/_components/AgentForm";
import { agentMcpCreateSchema } from "@/lib/ai/agents/validation";

const PAR = { provider: "openai", model: "gpt-5.6-terra" };

function criar(opcoes: {
  podeEscolherIa: boolean;
  iaDaPlataforma?: { provider: string; model: string } | null;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(
    <QueryClientProvider client={qc}>
      <AgentForm
        mode="create"
        credentials={[] as never}
        provedoresDaInstalacao={[]}
        podeEscolherIa={opcoes.podeEscolherIa}
        iaDaPlataforma={opcoes.iaDaPlataforma}
        channelSessions={[] as never}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(r.container.querySelector("#name")!, { target: { value: "Rafa" } });
  const botaoCriar = () => screen.getByRole("button", { name: /criar agente/i });
  return { ...r, botaoCriar };
}

describe("admin do cliente cria agente com a IA da plataforma", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    acoes.criar.mockResolvedValue({ ok: true, data: { agent_id: "novo" } });
  });

  it("⭐ o botão habilita, e o agente nasce com o par da plataforma e a chave da instalação", async () => {
    const { botaoCriar, container } = criar({ podeEscolherIa: false, iaDaPlataforma: PAR });

    expect(
      botaoCriar(),
      "o botão continua cinza: é o defeito da .55, o formulário exigindo o que o cartão escondido pede",
    ).toBeEnabled();
    // Nada de escolher chave: o seletor nem existe para o cliente.
    expect(container.querySelector("#credential_id")).toBeNull();
    expect(container.querySelector("#model")).toBeNull();

    fireEvent.click(botaoCriar());
    await waitFor(() => expect(acoes.criar).toHaveBeenCalled());

    const enviado = acoes.criar.mock.calls[0]?.[0] as { version: Record<string, unknown> };
    expect(enviado.version).toMatchObject({ provider: "openai", model: "gpt-5.6-terra", credential_id: null });
    expect(agentMcpCreateSchema.safeParse(enviado).success, "o servidor recusaria este envio").toBe(true);
  });

  it("sem par da plataforma, diz de quem é a pendência (fora do cartão), em vez de travar calado", () => {
    const { botaoCriar } = criar({ podeEscolherIa: false, iaDaPlataforma: null });

    expect(botaoCriar()).toBeDisabled();
    const aviso = screen.getByText(/nossa equipe/i);
    expect(aviso).toBeVisible();
    expect(aviso).toHaveTextContent(/suporte/i);
    expect(aviso).not.toHaveTextContent(/chave|credencia/i);
  });

  it("o motivo do Publicar bloqueado por chave não manda o cliente cadastrar chave", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const versao = {
      id: "v1", organization_id: "org", agent_id: "ag", version_number: 1, status: "draft",
      system_prompt: "Você é a Rafa, atendente da casa. Atenda com cuidado.",
      provider: "openai", model: "gpt-5.6-terra", credential_id: null, tool_ids: [],
      channel_session_id: "22222222-2222-4222-8222-222222222222", max_steps: 10, token_budget: 50000, cost_budget_cents: 50,
      history_message_window: 20, history_token_window: 8000, handoff_keywords: [],
      handoff_tool_enabled: true, cases_enabled: false, split_messages: false, split_max_chars: 600,
      followup: { enabled: false, flow_pointer_ids: [] }, operator_enabled: false, operator_model: null,
      operator_tool_ids: [], pipeline_ids: [], knowledge_source_ids: [], trigger_config: null,
      published_at: null, superseded_at: null, created_at: "2026-09-29T00:00:00Z", created_by: null,
    };
    render(
      <QueryClientProvider client={qc}>
        <AgentForm
          mode="edit"
          agent={{ id: "ag", organization_id: "org", name: "Rafa", description: null, priority: 0,
            model: "gpt-5.6-terra", system_prompt: "x", is_active: false, is_default: false, config: {},
            guardrails: [], active_kb_version_id: null, kind: "mcp_agent", published_version_id: null,
            archived_at: null, created_at: "2026-09-29T00:00:00Z", updated_at: "2026-09-29T00:00:00Z" } as never}
          credentials={[] as never}
          // A instalação NÃO tem chave do provedor: o motivo de bloqueio é de chave.
          provedoresDaInstalacao={[]}
          podeEscolherIa={false}
          channelSessions={[{ id: "22222222-2222-4222-8222-222222222222", display_name: "WhatsApp", status: "WORKING" }] as never}
          draft={versao as never}
          published={null}
          base={versao as never}
          draftObsoleto={null}
        />
      </QueryClientProvider>,
    );
    const motivo = screen.getByTestId("motivo-do-publicar").textContent ?? "";
    expect(motivo).toMatch(/nossa equipe/i);
    expect(motivo).toMatch(/suporte/i);
    expect(motivo).not.toMatch(/cadastre|escolha outra empresa|credenciais/i);
    // Mesma régua da e2e do upstream (`tests/e2e/motivo-do-publicar-na-tela.spec.ts`),
    // que reconhece o motivo pelo texto e roda com o dono do wizard sem escolher IA.
    expect(motivo).toMatch(/esta instalação não tem chave de/i);
  });

  it("a plataforma continua escolhendo (o controle): sem modelo e chave, não cria", () => {
    const { botaoCriar, container } = criar({ podeEscolherIa: true, iaDaPlataforma: PAR });

    // O par da plataforma é só para quem NÃO escolhe; quem escolhe começa em branco.
    expect(botaoCriar()).toBeDisabled();
    expect(container.querySelector("#credential_id")).not.toBeNull();
  });
});
