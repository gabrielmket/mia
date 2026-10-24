// @vitest-environment node
/**
 * FORK MIA (.85) — a rota que alimenta os selos do horário da IA
 * (`GET /api/v1/ai/horario-da-ia`).
 *
 * Prova: só agentes publicados, no ar e com horário ganham selo; a conversa é
 * de quem o motor escolheria (a conversa grudada num agente, senão o publicado
 * no número dela, no ar antes de pausado, maior prioridade); o recorte é da
 * organização de quem pede. Banco em memória; nada de cliente real.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria } from "@/tests/helpers/banco-em-memoria";

const estado = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => estado.cliente }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({ ok: true, user: { id: "u1", idioma: "pt-BR" }, org: { orgId: ORG, role: "agent" } })),
}));

const ORG = "0a000000-0000-4000-8000-0000000000aa";
const OUTRA = "0a000000-0000-4000-8000-0000000000bb";
const NUMERO = "0e000000-0000-4000-8000-0000000000aa";
const CONVERSA = "0c000000-0000-4000-8000-0000000000aa";
const HORARIO = { fuso: "America/Sao_Paulo", faixas: [{ dias: [1, 2, 3, 4, 5], inicio: "17:30", fim: "24:00" }] };
const gatilho = (h: unknown) => ({ events: ["message"], filters: { horario_da_ia: h } });

function agente(id: string, extra: Record<string, unknown> = {}) {
  return { id, organization_id: ORG, name: `Agente ${id}`, priority: 0, created_at: "2026-01-01T00:00:00Z", paused_at: null, archived_at: null, published_version_id: `v-${id}`, ...extra };
}
function versao(id: string, h: unknown, extra: Record<string, unknown> = {}) {
  return { id: `v-${id}`, organization_id: ORG, status: "published", channel_session_id: NUMERO, trigger_config: gatilho(h), ...extra };
}

const { GET } = await import("@/app/api/v1/ai/horario-da-ia/route");
const pedir = async (consulta = "") => {
  const r = await GET(new NextRequest(`http://localhost/api/v1/ai/horario-da-ia${consulta}`));
  return { status: r.status, corpo: (await r.json()) as { data: Record<string, unknown> } };
};

beforeEach(() => {
  estado.cliente = bancoEmMemoria({
    ai_agents: [
      agente("comhorario"),
      agente("semhorario"),
      agente("pausado", { paused_at: "2026-10-01T00:00:00Z" }),
      agente("rascunho", { published_version_id: null }),
      agente("arquivado", { archived_at: "2026-10-01T00:00:00Z" }),
      { ...agente("deoutra"), organization_id: OUTRA },
    ],
    ai_agent_versions: [
      versao("comhorario", HORARIO),
      versao("semhorario", null),
      versao("pausado", HORARIO),
      versao("arquivado", HORARIO),
      { ...versao("deoutra", HORARIO), organization_id: OUTRA },
    ],
    conversations: [{ id: CONVERSA, organization_id: ORG, channel_session_id: NUMERO, active_ai_agent_id: null }],
  }).cliente;
});

describe("GET /api/v1/ai/horario-da-ia", () => {
  it("a lista: só quem está no ar e tem horário, da organização de quem pede", async () => {
    const { status, corpo } = await pedir();
    expect(status).toBe(200);
    expect(corpo.data.agentes).toEqual([{ id: "comhorario", horario: HORARIO }]);
  });

  it("a conversa: o publicado no número dela, no ar antes de pausado", async () => {
    const { corpo } = await pedir(`?conversa=${CONVERSA}`);
    expect(corpo.data).toEqual({ agente: { id: "comhorario", nome: "Agente comhorario" }, horario: HORARIO });
  });

  it("a conversa grudada num agente é dele, mesmo com outro de prioridade maior no número", async () => {
    estado.cliente = bancoEmMemoria({
      ai_agents: [agente("comhorario"), agente("prioritario", { priority: 10 })],
      ai_agent_versions: [versao("comhorario", HORARIO), versao("prioritario", null)],
      conversations: [{ id: CONVERSA, organization_id: ORG, channel_session_id: NUMERO, active_ai_agent_id: "comhorario" }],
    }).cliente;
    expect((await pedir(`?conversa=${CONVERSA}`)).corpo.data.agente).toEqual({ id: "comhorario", nome: "Agente comhorario" });

    estado.cliente = bancoEmMemoria({
      ai_agents: [agente("comhorario"), agente("prioritario", { priority: 10 })],
      ai_agent_versions: [versao("comhorario", HORARIO), versao("prioritario", null)],
      conversations: [{ id: CONVERSA, organization_id: ORG, channel_session_id: NUMERO, active_ai_agent_id: null }],
    }).cliente;
    // Sem grudar: vence a prioridade, e ele não tem horário: sem selo.
    expect((await pedir(`?conversa=${CONVERSA}`)).corpo.data).toEqual({ agente: { id: "prioritario", nome: "Agente prioritario" }, horario: null });
  });

  it("conversa de outra organização não existe para quem pede; id torto é recusado", async () => {
    expect((await pedir("?conversa=0c000000-0000-4000-8000-0000000000ff")).status).toBe(404);
    expect((await pedir("?conversa=nao-e-uuid")).status).toBe(400);
  });
});
