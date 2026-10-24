/**
 * FORK MIA (.88) — o LIMITE DO DIA do assistente e o CHAMADO NA DEMONSTRAÇÃO.
 *
 *   - A IA do assistente é da plataforma: 50 perguntas por pessoa por dia (o
 *     padrão), ajustável por empresa, contadas no banco. Chegou no limite, a
 *     rota responde 429 e o modelo NÃO é chamado.
 *   - O papel que a empresa desligou recebe 403 e o modelo não é chamado.
 *   - Na empresa de demonstração o assistente funciona, mas o chamado não sai:
 *     fica registrado, a resposta diz isso, e o grupo interno da Time não
 *     recebe recado. Fora da demonstração, o recado sai.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  papel: "agent" as string,
  config: null as Record<string, unknown> | null,
  perguntasHoje: 0,
  chamadoCriado: { id: "0f000000-0000-4000-8000-0000000000c1", numero: 1042, demonstracao: false } as Record<string, unknown>,
  modelo: vi.fn(),
  reportar: vi.fn(async () => true),
  inserts: [] as Array<{ tabela: string; payload: unknown }>,
}));

/** O cliente da sessão de mentira: respostas por tabela. */
function sessaoDeMentira() {
  return {
    from(tabela: string) {
      let payload: unknown = null;
      const resposta = () => {
        if (tabela === "mia_assistente_config") return { data: h.config, error: null };
        if (tabela === "organizations") return { data: { timezone: "America/Sao_Paulo", display_name: "Empresa Modelo" }, error: null };
        if (tabela === "mia_chamados" && payload) return { data: { ...h.chamadoCriado, ...(payload as object) }, error: null };
        if (payload) return { data: { id: "0d000000-0000-4000-8000-000000000001", ...(payload as object) }, error: null };
        return { data: null, error: null };
      };
      const b: Record<string, unknown> = {};
      const devolve = () => b;
      for (const m of ["select", "eq", "neq", "in", "gte", "lt", "order", "limit", "is", "not"]) b[m] = devolve;
      b.insert = (p: unknown) => {
        payload = p;
        h.inserts.push({ tabela, payload: p });
        return b;
      };
      b.update = devolve;
      b.maybeSingle = async () => resposta();
      b.single = async () => resposta();
      b.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve(
          ok(
            tabela === "mia_assistente_mensagens"
              ? { data: null, error: null, count: h.perguntasHoje }
              : { data: [], error: null, count: 0 },
          ),
        );
      return b;
    },
  };
}

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({
    ok: true,
    user: { id: "0b000000-0000-4000-8000-000000000001", idioma: "pt-BR", full_name: "Juliana Prado" },
    org: { orgId: "0a000000-0000-4000-8000-000000000001", role: h.papel, name: "Empresa Modelo" },
  })),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => sessaoDeMentira()) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => sessaoDeMentira()) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), isServiceRoleConfigured: () => true }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, limit: 8, count: 1 })),
}));
vi.mock("@/lib/agent-engine/agent/request-deps", () => ({
  requestTurnDeps: () => ({ llmCfg: {}, registry: undefined, log: undefined }),
}));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => ({}) }));
vi.mock("@/lib/assistente/diretorio", () => ({ diretorioDaEquipe: vi.fn(async () => []) }));
vi.mock("@/lib/assistente/modelo", () => ({ chamadaDoAssistente: () => h.modelo }));
vi.mock("@/lib/avisos/report-da-plataforma", () => ({ reportar: h.reportar }));

const { configDaLinha, janelaDoDia, papelUsaOAssistente, usoDoDia, LIMITE_PADRAO_POR_DIA } = await import(
  "@/lib/assistente/config"
);
const { POST: perguntar } = await import("@/app/api/v1/assistente/chat/route");
const { POST: abrirChamado } = await import("@/app/api/v1/assistente/chamados/route");

function pedidoDePergunta() {
  return new NextRequest("http://localhost/api/v1/assistente/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      turn_id: "0c000000-0000-4000-8000-000000000001",
      pergunta: "Como está minha rotina hoje?",
      tela: { caminho: "/app/kanban" },
    }),
  });
}

beforeEach(() => {
  h.papel = "agent";
  h.config = null;
  h.perguntasHoje = 0;
  h.chamadoCriado = { id: "0f000000-0000-4000-8000-0000000000c1", numero: 1042, demonstracao: false };
  h.modelo.mockReset();
  h.reportar.mockClear();
  h.inserts = [];
});

describe("a configuração e o limite, puros", () => {
  it("sem linha vale o padrão do protótipo: ligado, todos os papéis, 50 por dia, resumo desligado", () => {
    expect(configDaLinha(null)).toMatchObject({
      ligado: true,
      papeis: ["viewer", "agent", "manager", "admin"],
      perguntasPorPessoaPorDia: LIMITE_PADRAO_POR_DIA,
      resumoDaManhaPadrao: false,
      gravada: false,
    });
    expect(LIMITE_PADRAO_POR_DIA).toBe(50);
  });

  it("o papel desligado não usa; o ai_operator nunca usa", () => {
    const c = configDaLinha({ ligado: true, papeis: ["admin", "manager"], perguntas_por_pessoa_por_dia: 20 });
    expect(papelUsaOAssistente(c, "admin")).toBe(true);
    expect(papelUsaOAssistente(c, "agent")).toBe(false);
    expect(papelUsaOAssistente(c, "ai_operator")).toBe(false);
    expect(papelUsaOAssistente({ ...c, ligado: false }, "admin")).toBe(false);
  });

  it("o dia começa à meia-noite no fuso da empresa", () => {
    const { inicio, dia } = janelaDoDia(new Date("2026-10-26T02:30:00Z"), "America/Sao_Paulo");
    expect(dia).toBe("2026-10-25");
    expect(inicio.toISOString()).toBe("2026-10-25T03:00:00.000Z");
  });

  it("a contagem que falha conta como limite atingido", async () => {
    const quebrado = {
      from: () => {
        const b: Record<string, unknown> = {};
        for (const m of ["select", "eq", "gte"]) b[m] = () => b;
        b.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, error: { message: "fora" }, count: null }));
        return b;
      },
    };
    const uso = await usoDoDia(quebrado as never, {
      organizationId: "o",
      userId: "u",
      fuso: "America/Sao_Paulo",
      agora: new Date(),
      limite: 50,
    });
    expect(uso.restantes).toBe(0);
  });
});

describe("POST /api/v1/assistente/chat", () => {
  it("no limite do dia: 429, e o modelo não é chamado", async () => {
    h.config = { ligado: true, papeis: ["agent"], perguntas_por_pessoa_por_dia: 2 };
    h.perguntasHoje = 2;
    const r = await perguntar(pedidoDePergunta());
    expect(r.status).toBe(429);
    const corpo = (await r.json()) as { error: { code: string; details: { limite: number } } };
    expect(corpo.error.code).toBe("rate_limited");
    expect(corpo.error.details.limite).toBe(2);
    expect(h.modelo).not.toHaveBeenCalled();
    expect(h.inserts.filter((i) => i.tabela === "mia_assistente_mensagens")).toEqual([]);
  });

  it("o padrão é 50: com 49 feitas, ainda passa do limite e chega ao modelo", async () => {
    h.perguntasHoje = 49;
    h.modelo.mockResolvedValue({ texto: "Seu dia está tranquilo.", callId: null });
    const r = await perguntar(pedidoDePergunta());
    expect(r.status).toBe(200);
    expect(h.modelo).toHaveBeenCalledTimes(1);
  });

  it("o papel que a empresa desligou: 403, e o modelo não é chamado", async () => {
    h.config = { ligado: true, papeis: ["admin"], perguntas_por_pessoa_por_dia: 50 };
    const r = await perguntar(pedidoDePergunta());
    expect(r.status).toBe(403);
    expect(h.modelo).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/assistente/chamados", () => {
  function pedidoDeChamado() {
    return new NextRequest("http://localhost/api/v1/assistente/chamados", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0" },
      body: JSON.stringify({ tipo: "erro", texto: "O botão de salvar não funciona.", tela: "/app/kanban?lead=1" }),
    });
  }

  it("na empresa de demonstração o chamado fica registrado e NÃO sai para a Time", async () => {
    h.chamadoCriado = { ...h.chamadoCriado, demonstracao: true };
    const r = await abrirChamado(pedidoDeChamado());
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { demonstracao: boolean; aviso: string | null } };
    expect(corpo.data.demonstracao).toBe(true);
    expect(corpo.data.aviso).toContain("não sai para a Time Company");
    expect(h.reportar).not.toHaveBeenCalled();
  });

  it("fora da demonstração, o recado vai ao grupo interno, sem o texto do chamado", async () => {
    const r = await abrirChamado(pedidoDeChamado());
    expect(r.status).toBe(200);
    expect(h.reportar).toHaveBeenCalledTimes(1);
    const recado = (h.reportar.mock.calls[0] as unknown as [unknown, { texto: string }])[1].texto;
    expect(recado).toContain("#1042");
    expect(recado).not.toContain("botão de salvar");
  });

  it("o contexto é montado no servidor: a tela sem a query string, a versão e o navegador legível", async () => {
    await abrirChamado(pedidoDeChamado());
    const insert = h.inserts.find((i) => i.tabela === "mia_chamados")!.payload as { contexto: Record<string, unknown> };
    expect(insert.contexto.tela).toEqual({ caminho: "/app/kanban", rotulo: "Funis" });
    expect(insert.contexto.navegador).toBe("Chrome no Windows");
    expect(typeof insert.contexto.versao).toBe("string");
  });
});
