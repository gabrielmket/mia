/**
 * FORK MIA (MIA-250 D) — CRIAR AGENTE ACIMA DO TETO DO PLANO PELA API.
 *
 * O banco recusa (gatilho da 9174: PT402 com `limite_do_plano:agentes:<teto>`);
 * a rota `POST /api/v1/ai/agents` (voz e agente novo) devolve 409
 * `plan_limit_reached` com a frase no idioma de quem pediu, e não grava a versão
 * (a recusa vem no insert do agente, antes dela: nada órfão).
 *
 * Nenhum dado daqui é de cliente real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/api/auth-dual", () => ({ resolveAuthDual: vi.fn(), tetoDeEscritaDoToken: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/trava-da-ia-na-rota", () => ({
  quemPedeNaRota: vi.fn(async () => ({ is_platform_admin: true, platform_admin_scope: "full", support: null })),
}));
// O duplicar: a cópia é a de `lib/ai/agents/duplicate.ts`, que devolve a mensagem do banco.
vi.mock("@/lib/ai/agents/duplicate", async (original) => ({
  ...(await original<typeof import("@/lib/ai/agents/duplicate")>()),
  duplicateAgentWithVersion: vi.fn(async () => ({ ok: false, error: "agent_insert_failed", message: "limite_do_plano:agentes:3" })),
}));
vi.mock("@/lib/ai/trava-da-ia", async (original) => ({
  ...(await original<typeof import("@/lib/ai/trava-da-ia")>()),
  iaDaCopia: vi.fn(async () => undefined),
}));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

let gravados: Record<string, Record<string, unknown>[]>;

/** O insert em `ai_agents` recusa como o gatilho; o resto grava. */
function adminComTetoCheio(teto: number) {
  gravados = {};
  return {
    from(tabela: string) {
      const fila = (gravados[tabela] ??= []);
      let recusar = false;
      const cadeia: Record<string, unknown> = {};
      cadeia.insert = (payload: Record<string, unknown>) => {
        if (tabela === "ai_agents") recusar = true;
        else fila.push(payload);
        return cadeia;
      };
      cadeia.update = () => cadeia;
      cadeia.select = () => cadeia;
      cadeia.eq = () => cadeia;
      cadeia.single = async () =>
        recusar
          ? { data: null, error: { code: "PT402", message: `limite_do_plano:agentes:${teto}` } }
          : { data: { id: `${tabela}-id`, organization_id: ORG, ...(fila[fila.length - 1] ?? {}) }, error: null };
      return cadeia;
    },
  };
}

const post = (corpo: unknown) =>
  new NextRequest("http://localhost/api/v1/ai/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });

function autenticar(idioma: string) {
  vi.mocked(resolveAuthDual).mockResolvedValue({
    ok: true,
    organizationId: ORG,
    idioma,
    actor: { type: "user", id: USER },
    apiTokenId: null,
  } as unknown as Awaited<ReturnType<typeof resolveAuthDual>>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(tetoDeEscritaDoToken).mockResolvedValue(null);
  autenticar("pt-BR");
});

describe("POST /api/v1/ai/agents com o teto do plano cheio", () => {
  it("⭐ agente novo: 409 plan_limit_reached com a frase e o teto, e nenhuma versão gravada", async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminComTetoCheio(2) as never);
    const { POST } = await import("@/app/api/v1/ai/agents/route");
    const res = await POST(post({ name: "Recepção", system_prompt: "Você é a recepção da Academia Alfa.", model: "anthropic/claude-sonnet-4-6" }));
    const corpo = (await res.json()) as { error: { code: string; message: string; details?: unknown } };
    expect(res.status, JSON.stringify(corpo)).toBe(409);
    expect(corpo.error.code).toBe("plan_limit_reached");
    expect(corpo.error.message).toBe(
      "Seu plano permite 2 agentes de IA e todos já foram criados. Arquive um agente em Agentes de IA ou troque de plano em Configurações › Plano e cobrança.",
    );
    expect(corpo.error.details).toEqual({ recurso: "agentes", limite: 2 });
    expect(gravados.ai_agent_versions ?? []).toHaveLength(0);
  });

  it("agente de voz: o mesmo 409, no idioma de quem pediu", async () => {
    autenticar("es");
    vi.mocked(createAdminClient).mockReturnValue(adminComTetoCheio(1) as never);
    const { POST } = await import("@/app/api/v1/ai/agents/route");
    const res = await POST(post({ channel: "voice", name: "Recepção por voz", system_prompt: "Atende o telefone da Academia Alfa." }));
    const corpo = (await res.json()) as { error: { code: string; message: string } };
    expect(res.status).toBe(409);
    expect(corpo.error.code).toBe("plan_limit_reached");
    expect(corpo.error.message).toMatch(/^Tu plan permite 1 agente de IA/);
  });
});

describe("POST /api/v1/ai/agents/[id]/duplicate com o teto do plano cheio", () => {
  it("⭐ duplicar é criar: 409 plan_limit_reached com a frase, e não o 500 genérico", async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminComTetoCheio(3) as never);
    const { POST } = await import("@/app/api/v1/ai/agents/[id]/duplicate/route");
    const id = "33333333-3333-4333-8333-333333333333";
    const res = await POST(new NextRequest(`http://localhost/api/v1/ai/agents/${id}/duplicate`, { method: "POST" }), {
      params: Promise.resolve({ id }),
    } as never);
    const corpo = (await res.json()) as { error: { code: string; message: string; details?: unknown } };
    expect(res.status, JSON.stringify(corpo)).toBe(409);
    expect(corpo.error).toMatchObject({ code: "plan_limit_reached", details: { recurso: "agentes", limite: 3 } });
    expect(corpo.error.message).toMatch(/^Seu plano permite 3 agentes de IA/);
  });
});
