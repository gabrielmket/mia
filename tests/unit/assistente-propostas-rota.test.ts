/**
 * FORK MIA (.91, .94) · as rotas do cartão da proposta: quem decide, desfaz,
 * pede e ajusta.
 *
 *   - a guarda do suporte vem PRIMEIRO: o acompanhamento somente leitura não
 *     decide nada, e nada é lido nem escrito;
 *   - (.94) o piso é o atendente; quem aprova AQUELA peça é conferido no
 *     servidor (`conferirQuem`), com a sessão de quem clicou (`pelaSessao`);
 *   - a etiqueta pede a verificação em duas etapas, como a tela de Etiquetas;
 *   - a empresa é a da sessão, nunca do corpo;
 *   - corpo fora do formato é recusado antes de qualquer papel;
 *   - "sem permissão" do servidor vira 403, a trava do desfazer vira 409.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  bloqueio: null as Response | null,
  papelPedido: [] as string[],
  mfaEmDivida: false,
  tipo: "etapa_criar",
  decisoes: [] as Array<Record<string, unknown>>,
  desfeitas: [] as Array<Record<string, unknown>>,
  pedidos: [] as Array<Record<string, unknown>>,
  ajustes: [] as Array<Record<string, unknown>>,
  respostaDoDecidir: null as unknown,
  respostaDoDesfazer: null as unknown,
}));

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => h.bloqueio }));
vi.mock("@/lib/auth/server", () => ({ mfaEmDivida: async () => h.mfaEmDivida }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async (papel: string) => {
    h.papelPedido.push(papel);
    return { ok: true, user: { id: "u1", idioma: "pt-BR", full_name: "Carla Mendes" }, org: { orgId: "org-da-sessao", role: "agent" } };
  },
}));
vi.mock("@/lib/assistente/propostas/contexto-da-rota", () => ({
  contextoDaRotaDasPropostas: async () => ({
    db: { sessao: true },
    admin: {
      from: () => {
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: { tipo: h.tipo } }),
        };
        return q;
      },
    },
    orgId: "org-da-sessao",
    userId: "u1",
    nome: "Carla Mendes",
    papel: "agent",
    idioma: "pt-BR",
    equipe: [],
    fuso: "America/Sao_Paulo",
    podePedir: true,
  }),
}));
vi.mock("@/lib/assistente/propostas/decidir", () => ({
  decidirProposta: async (quem: Record<string, unknown>, id: string, decisao: string) => {
    h.decisoes.push({ orgId: quem.orgId, id, decisao, conferirQuem: quem.conferirQuem, pelaSessao: quem.pelaSessao, papel: quem.papel });
    return h.respostaDoDecidir ?? { ok: true, desfecho: decisao === "aplicar" ? "aplicada" : "rejeitada", proposta: { id }, avisos: [] };
  },
}));
vi.mock("@/lib/assistente/propostas/desfazer", () => ({
  desfazerProposta: async (quem: Record<string, unknown>, id: string, opcoes: Record<string, unknown>) => {
    h.desfeitas.push({ orgId: quem.orgId, id, conferirQuem: opcoes.conferirQuem, pelaSessao: quem.pelaSessao });
    return h.respostaDoDesfazer ?? { ok: true, desfecho: "desfeita", proposta: { id }, avisos: [] };
  },
}));
vi.mock("@/lib/assistente/propostas/pedir", () => ({
  pedirProposta: async (quem: Record<string, unknown>, id: string, para: string | null) => {
    h.pedidos.push({ orgId: quem.orgId, id, para });
    return { ok: true, desfecho: "pedida", proposta: { id }, para: { user_id: "u2", nome: "Marina Souza" } };
  },
}));
vi.mock("@/lib/assistente/propostas/ajustar", () => ({
  ajustarProposta: async (quem: Record<string, unknown>, id: string, campos: Record<string, string>) => {
    h.ajustes.push({ orgId: quem.orgId, id, campos });
    return { ok: true, proposta: { id } };
  },
}));

const { POST } = await import("@/app/api/v1/assistente/propostas/[id]/route");
const { POST: DESFAZER } = await import("@/app/api/v1/assistente/propostas/[id]/desfazer/route");
const { POST: PEDIR } = await import("@/app/api/v1/assistente/propostas/[id]/pedir/route");
const { POST: AJUSTAR } = await import("@/app/api/v1/assistente/propostas/[id]/ajustar/route");

const ID = "0f000000-0000-4000-8000-000000000091";
const params = { params: Promise.resolve({ id: ID }) };

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
  h.mfaEmDivida = false;
  h.tipo = "etapa_criar";
  h.decisoes = [];
  h.desfeitas = [];
  h.pedidos = [];
  h.ajustes = [];
  h.respostaDoDecidir = null;
  h.respostaDoDesfazer = null;
});

describe("quem decide a proposta", () => {
  it("aplicar pede o piso do atendente; quem aprova a peça é conferido no servidor, com a sessão; a empresa é a da sessão", async () => {
    const r = await POST(pedido({ decisao: "aplicar" }) as never, params);
    expect(r.status).toBe(200);
    expect(h.papelPedido).toEqual(["agent"]);
    expect(h.decisoes).toEqual([{ orgId: "org-da-sessao", id: ID, decisao: "aplicar", conferirQuem: true, pelaSessao: true, papel: "agent" }]);
  });

  it("recusar também passa pela regra do servidor", async () => {
    await POST(pedido({ decisao: "rejeitar" }) as never, params);
    expect(h.papelPedido).toEqual(["agent"]);
    expect(h.decisoes[0]).toMatchObject({ decisao: "rejeitar", conferirQuem: true });
  });

  it("quem não aprova recebe 403, com a frase do servidor", async () => {
    h.respostaDoDecidir = { ok: false, codigo: "sem_permissao", mensagem: "Quem aprova isto: gestor ou administrador. Você pode pedir a quem aprova." };
    const r = await POST(pedido({ decisao: "aplicar" }) as never, params);
    expect(r.status).toBe(403);
    expect(JSON.stringify(await r.json())).toMatch(/gestor ou administrador/);
  });

  it("a etiqueta pede a verificação em duas etapas, como a tela de Etiquetas", async () => {
    h.tipo = "etiqueta";
    h.mfaEmDivida = true;
    const r = await POST(pedido({ decisao: "aplicar" }) as never, params);
    expect(r.status).toBe(403);
    expect(h.decisoes).toEqual([]);
  });

  it("o acompanhamento somente leitura é barrado antes de tudo", async () => {
    h.bloqueio = new Response("somente leitura", { status: 403 });
    const r = await POST(pedido({ decisao: "aplicar" }) as never, params);
    expect(r.status).toBe(403);
    expect(h.papelPedido).toEqual([]);
    expect(h.decisoes).toEqual([]);
  });

  it("corpo fora do formato (e organização no corpo) é recusado sem decidir", async () => {
    const r = await POST(pedido({ decisao: "aplicar", organization_id: "outra" }) as never, params);
    expect(r.status).toBe(422);
    expect(h.decisoes).toEqual([]);
  });
});

describe("desfazer, pedir e ajustar", () => {
  it("desfazer: pela sessão, conferindo quem aprova; a trava vira 409 com o porquê", async () => {
    const r = await DESFAZER(pedido({}) as never, params);
    expect(r.status).toBe(200);
    expect(h.desfeitas).toEqual([{ orgId: "org-da-sessao", id: ID, conferirQuem: true, pelaSessao: true }]);

    h.respostaDoDesfazer = { ok: false, codigo: "travada", mensagem: "1 negócio já está nesta etapa." };
    const travada = await DESFAZER(pedido({}) as never, params);
    expect(travada.status).toBe(409);
    expect(JSON.stringify(await travada.json())).toMatch(/negócio já está nesta etapa/);
  });

  it("desfazer a etiqueta também pede a verificação em duas etapas", async () => {
    h.tipo = "etiqueta";
    h.mfaEmDivida = true;
    const r = await DESFAZER(pedido({}) as never, params);
    expect(r.status).toBe(403);
    expect(h.desfeitas).toEqual([]);
  });

  it("pedir: a empresa da sessão, a pessoa escolhida opcional", async () => {
    const r = await PEDIR(pedido({ para_user_id: "0f000000-0000-4000-8000-0000000000b2" }) as never, params);
    expect(r.status).toBe(200);
    expect(h.pedidos).toEqual([{ orgId: "org-da-sessao", id: ID, para: "0f000000-0000-4000-8000-0000000000b2" }]);
    const semNinguem = await PEDIR(pedido({}) as never, params);
    expect(semNinguem.status).toBe(200);
    expect(h.pedidos[1]).toMatchObject({ para: null });
  });

  it("ajustar: só os campos, sem nada de empresa no corpo", async () => {
    const r = await AJUSTAR(pedido({ campos: { texto: "Estamos na Rua das Acácias, 120." } }) as never, params);
    expect(r.status).toBe(200);
    expect(h.ajustes).toEqual([{ orgId: "org-da-sessao", id: ID, campos: { texto: "Estamos na Rua das Acácias, 120." } }]);
    const errado = await AJUSTAR(pedido({ campos: {}, organization_id: "outra" }) as never, params);
    expect(errado.status).toBe(422);
  });
});
