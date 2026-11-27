// @vitest-environment node
/**
 * FORK MIA (MIA-304) — `/api/v1/prospecting/agents*` NÃO DEVOLVE O MODELO.
 *
 * Cerca do achado da MIA-262: o `model_label` (o nome do modelo que montou o
 * agente) saía no chat, na sessão salva e no resultado de preparar e publicar.
 * A IA é da plataforma (`docs/fork/ia-da-plataforma.md`, seção 7). Reprova se:
 *
 *  - uma rota de `app/api/v1/prospecting/agents/` (inclusive rota nova do
 *    upstream) responder `ok(...)` sem passar por `semModeloAoCliente`;
 *  - papel por papel, o campo ou o nome do modelo voltar em alguma resposta;
 *  - o resto da resposta (agente, versão, sessão, conversa) deixar de chegar.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { semModeloAoCliente } from "@/lib/prospecting/sem-modelo-ao-cliente";

const MODELO = "modelo-da-plataforma-x";
const ORG = "11111111-1111-4111-8111-111111111111";
const CAMPANHA = "22222222-2222-4222-8222-222222222222";
const AGENTE = "33333333-3333-4333-8333-333333333333";
const VERSAO = "44444444-4444-4444-8444-444444444444";
const UUID = "55555555-5555-4555-8555-555555555555";

const deps = vi.hoisted(() => ({ requireRole: vi.fn() }));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: deps.requireRole }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/ai/pontos/provedores-oferecidos", () => ({ provedorOferecido: async () => "openai" }));

const resultado = () => ({ agent: { id: AGENTE, name: "Clara" }, version_id: VERSAO, model_label: MODELO });
const sessao = () => ({
  revision: 4,
  session: {
    messages: [{ role: "assistant", content: "Como considerar alguém qualificado?" }],
    draft: { name: "Clara", tone: "cordial" },
    input: "",
    ready: false,
    choices: [],
    model_label: MODELO,
    needs_continuity: false,
    enable_router_continuity: false,
    uncertain: false,
    prepared: resultado(),
    completed: resultado(),
  },
});

vi.mock("@/lib/prospecting/agent-setup", () => ({
  AgentSetupError: class extends Error {
    status = 409;
    agentId?: string;
  },
  setupProspectingAgent: vi.fn(async () => resultado()),
}));
vi.mock("@/lib/prospecting/agent-session", () => ({
  getAgentSession: vi.fn(async () => sessao()),
  saveAgentSession: vi.fn(async () => sessao()),
  beginAgentChat: vi.fn(async () => ({ revision: 3 })),
  finishAgentChat: vi.fn(async () => sessao()),
}));
vi.mock("@/lib/prospecting/agent-chat", () => ({
  chatAboutAgent: vi.fn(async () => ({
    message: "Como considerar alguém qualificado?",
    draft: { name: "Clara" },
    ready: false,
    choices: [],
    model_label: MODELO,
    needs_continuity: false,
  })),
}));

const SUPORTE = { status: "active", organization_id: ORG, agency_id: null, access_mode: "full" } as const;
/** Os papéis que passam pelo `requireRole("admin")` destas rotas. */
const PAPEIS = {
  "admin da empresa": { is_platform_admin: false, platform_admin_scope: null, support: null },
  "agência em suporte com edição": {
    is_platform_admin: false,
    platform_admin_scope: null,
    support: { ...SUPORTE, agency_id: "agencia-1" },
  },
  "plataforma em suporte com edição": { is_platform_admin: true, platform_admin_scope: "full", support: SUPORTE },
} as const;
type Papel = keyof typeof PAPEIS;

const setup = {
  request_id: UUID,
  campaign_id: CAMPANHA,
  name: "Clara",
  tone: "cordial",
  instruction: "Oferecer uma avaliação comercial.",
  qualification: "Empresa com equipe de vendas.",
  channel_session_id: UUID,
  pipeline_id: UUID,
  stage_id: UUID,
  qualified_stage_id: UUID,
};

function pedido(metodo: string, corpo?: unknown, query = "") {
  return new Request(`http://localhost/api/v1/prospecting/agents${query}`, {
    method: metodo,
    headers: { "content-type": "application/json" },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
}

/** Cada rota da prospecção de agentes e o pedido válido que a faz responder 200. */
const ROTAS: Array<{ nome: string; chamar: () => Promise<Response> }> = [
  { nome: "POST /agents (publicar)", chamar: async () => (await import("@/app/api/v1/prospecting/agents/route")).POST(pedido("POST", setup)) },
  {
    nome: "POST /agents/prepare",
    chamar: async () => (await import("@/app/api/v1/prospecting/agents/prepare/route")).POST(pedido("POST", setup)),
  },
  {
    nome: "GET /agents/session",
    chamar: async () =>
      (await import("@/app/api/v1/prospecting/agents/session/route")).GET(pedido("GET", undefined, `/session?campaign_id=${CAMPANHA}`)),
  },
  {
    nome: "PATCH /agents/session",
    chamar: async () =>
      (await import("@/app/api/v1/prospecting/agents/session/route")).PATCH(
        pedido("PATCH", {
          campaign_id: CAMPANHA,
          revision: 3,
          session: { messages: [], draft: { name: "Clara" }, input: "", enable_router_continuity: false, uncertain: false },
        }),
      ),
  },
  {
    nome: "POST /agents/chat",
    chamar: async () =>
      (await import("@/app/api/v1/prospecting/agents/chat/route")).POST(
        pedido("POST", { campaign_id: CAMPANHA, revision: 3, messages: [{ role: "user", content: "Quero vender consultoria." }] }),
      ),
  },
];

beforeEach(() => {
  deps.requireRole.mockReset();
});

describe.each(Object.keys(PAPEIS) as Papel[])("%s", (papel) => {
  beforeEach(() => {
    deps.requireRole.mockResolvedValue({
      ok: true,
      user: { id: "usuario-1", ...PAPEIS[papel] },
      org: { orgId: ORG, role: "admin" },
    });
  });

  it.each(ROTAS.map((r) => [r.nome, r] as const))("%s: responde sem o modelo", async (_nome, rota) => {
    const res = await rota.chamar();
    expect(res.status).toBe(200);
    const texto = await res.text();
    expect(texto).not.toContain("model_label");
    expect(texto).not.toContain(MODELO);
  });
});

describe("o resto da resposta chega inteiro", () => {
  beforeEach(() => {
    deps.requireRole.mockResolvedValue({ ok: true, user: { id: "usuario-1", ...PAPEIS["admin da empresa"] }, org: { orgId: ORG, role: "admin" } });
  });

  it("publicar: o agente e a versão, que a tela usa para seguir", async () => {
    const { data } = await (await ROTAS[0]!.chamar()).json();
    expect(data).toEqual({ agent: { id: AGENTE, name: "Clara" }, version_id: VERSAO });
  });

  it("sessão: a conversa, o resumo e o preparado/concluído, sem o rótulo", async () => {
    const { data } = await (await ROTAS[2]!.chamar()).json();
    expect(data.revision).toBe(4);
    expect(data.session.messages).toHaveLength(1);
    expect(data.session.prepared).toEqual({ agent: { id: AGENTE, name: "Clara" }, version_id: VERSAO });
    expect(data.session.completed).toEqual({ agent: { id: AGENTE, name: "Clara" }, version_id: VERSAO });
  });

  it("chat: a resposta da IA e a sessão salva", async () => {
    const { data } = await (await ROTAS[4]!.chamar()).json();
    expect(data.message).toBe("Como considerar alguém qualificado?");
    expect(data.revision).toBe(4);
    expect(data.session.draft).toEqual({ name: "Clara", tone: "cordial" });
  });
});

describe("semModeloAoCliente", () => {
  it("tira o campo em qualquer nível e não toca no original", () => {
    const original = sessao();
    const limpo = semModeloAoCliente(original);
    expect(JSON.stringify(limpo)).not.toContain("model_label");
    expect(original.session.model_label).toBe(MODELO);
    expect(original.session.prepared.model_label).toBe(MODELO);
  });

  it("o texto da conversa não é filtrado: só a CHAVE sai", () => {
    const limpo = semModeloAoCliente({ messages: [{ role: "user", content: "o model_label é o quê?" }] });
    expect(limpo.messages[0]?.content).toBe("o model_label é o quê?");
  });
});

describe("cerca: toda rota de /prospecting/agents responde pelo limpador", () => {
  const raiz = join(process.cwd(), "app/api/v1/prospecting/agents");
  const rotas: string[] = [];
  (function andar(dir: string) {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) andar(caminho);
      else if (nome === "route.ts") rotas.push(caminho);
    }
  })(raiz);

  it("as quatro rotas de hoje estão na varredura", () => {
    expect(rotas.length).toBeGreaterThanOrEqual(4);
  });

  it.each(rotas.map((r) => [r.slice(process.cwd().length + 1)] as const))("%s", (rota) => {
    const fonte = readFileSync(join(process.cwd(), rota), "utf8");
    const respostas = fonte.match(/\bok\(/g)?.length ?? 0;
    const limpas = fonte.match(/\bok\(\s*semModeloAoCliente\(/g)?.length ?? 0;
    expect(respostas, "toda resposta ok(...) passa por semModeloAoCliente(...)").toBeGreaterThan(0);
    expect(limpas).toBe(respostas);
  });
});
