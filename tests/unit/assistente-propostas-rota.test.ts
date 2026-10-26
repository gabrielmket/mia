/**
 * FORK MIA (.91) — POST /api/v1/assistente/propostas/[id]: quem decide.
 *
 *   - a guarda do suporte vem PRIMEIRO: o acompanhamento somente leitura não
 *     decide nada, e nada é lido nem escrito;
 *   - "aplicar" pede o papel de ADMINISTRADOR; "rejeitar", de gestor;
 *   - a empresa é a da sessão, nunca do corpo;
 *   - corpo fora do formato é recusado antes de qualquer papel.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  bloqueio: null as Response | null,
  papelPedido: [] as string[],
  decisoes: [] as Array<{ orgId: string; id: string; decisao: string }>,
}));

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => h.bloqueio }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async (papel: string) => {
    h.papelPedido.push(papel);
    return { ok: true, user: { id: "u1", idioma: "pt-BR" }, org: { orgId: "org-da-sessao", role: papel } };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/assistente/propostas/decidir", () => ({
  decidirProposta: async (quem: { orgId: string }, id: string, decisao: string) => {
    h.decisoes.push({ orgId: quem.orgId, id, decisao });
    return { ok: true, desfecho: decisao === "aplicar" ? "aplicada" : "rejeitada", proposta: { id }, avisos: [] };
  },
}));

const { POST } = await import("@/app/api/v1/assistente/propostas/[id]/route");

const ID = "0f000000-0000-4000-8000-000000000091";

function pedido(corpo: unknown) {
  return new Request(`http://localhost/api/v1/assistente/propostas/${ID}`, {
    method: "POST",
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  h.bloqueio = null;
  h.papelPedido = [];
  h.decisoes = [];
});

describe("quem decide a proposta", () => {
  it("aplicar pede administrador; a empresa é a da sessão", async () => {
    const r = await POST(pedido({ decisao: "aplicar" }) as never, { params: Promise.resolve({ id: ID }) });
    expect(r.status).toBe(200);
    expect(h.papelPedido).toEqual(["admin"]);
    expect(h.decisoes).toEqual([{ orgId: "org-da-sessao", id: ID, decisao: "aplicar" }]);
  });

  it("recusar pede gestor", async () => {
    await POST(pedido({ decisao: "rejeitar" }) as never, { params: Promise.resolve({ id: ID }) });
    expect(h.papelPedido).toEqual(["manager"]);
  });

  it("o acompanhamento somente leitura é barrado antes de tudo", async () => {
    h.bloqueio = new Response("somente leitura", { status: 403 });
    const r = await POST(pedido({ decisao: "aplicar" }) as never, { params: Promise.resolve({ id: ID }) });
    expect(r.status).toBe(403);
    expect(h.papelPedido).toEqual([]);
    expect(h.decisoes).toEqual([]);
  });

  it("corpo fora do formato (e organização no corpo) é recusado sem decidir", async () => {
    const r = await POST(pedido({ decisao: "aplicar", organization_id: "outra" }) as never, { params: Promise.resolve({ id: ID }) });
    expect(r.status).toBe(422);
    expect(h.decisoes).toEqual([]);
  });
});
