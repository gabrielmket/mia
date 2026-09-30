/**
 * FORK MIA — as rotas de /api/v1/leads-da-meta: quem pode, com que corpo, e o que
 * fica gravado. A organização vem SEMPRE da sessão (`requireRole`), e o funil e a
 * etapa do corpo são conferidos contra ela — a rotina grava com service role, e
 * uma etapa de outra empresa aceita aqui seria negócio criado no funil do vizinho.
 *
 * .61 (migration 9004): a PÁGINA também. A empresa só vê e só escolhe formulário
 * de Página atribuída a ela, e o formulário ligado é conferido na Meta. A prova
 * de que o banco segura o mesmo, com o papel sem RLS, é
 * tests/invariants/paginas-da-meta-por-empresa.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  banco: null as null | { cliente: unknown },
  papel: "admin" as string,
  auditorias: [] as Array<Record<string, unknown>>,
  rodadas: [] as Array<Record<string, unknown>>,
  /** O token de conexão de cada empresa (ausente = sem conexão). */
  tokens: {} as Record<string, string>,
}));

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async (minimo: string) => {
    const rank: Record<string, number> = { viewer: 1, agent: 2, manager: 3, admin: 4 };
    if (rank[h.papel]! < rank[minimo]!) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: { code: "forbidden" } }), { status: 403 }),
      };
    }
    return { ok: true, user: { id: "user-1" }, org: { orgId: "org-1", role: h.papel } };
  }),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => h.banco!.cliente) }));
// O client de sessão é o mesmo banco em memória, SEM RLS: o que se prova aqui é
// o filtro da rota. A RLS é provada no banco de verdade (tests/invariants).
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => h.banco!.cliente) }));
vi.mock("@/lib/plataformas-de-anuncio/credenciais-de-leitura", () => ({
  lerCredencialDeLeitura: vi.fn(async (_db: unknown, org: string) =>
    h.tokens[org]
      ? { ok: true, credencial: { accessToken: h.tokens[org], contaPadrao: null } }
      : { ok: false, motivo: "sem_conexao" },
  ),
  existeConexaoDeLeitura: vi.fn(async (_db: unknown, org: string) => ({
    conectada: Boolean(h.tokens[org]),
    contaPadrao: null,
  })),
}));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (a: Record<string, unknown>) => void h.auditorias.push(a)),
}));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, count: 1, limit: 4, window_sec: 60 })),
}));
vi.mock("@/lib/leads-da-meta/rodada", () => ({
  rodarLeadsDaMeta: vi.fn(async (_db: unknown, opcoes: Record<string, unknown>) => {
    h.rodadas.push(opcoes);
    return {
      empresas: 1,
      formularios: 1,
      novos: 2,
      repetidos: 0,
      recusados: 0,
      erros: 0,
      porFormulario: [],
    };
  }),
}));

import { GET as ESTADO, PATCH } from "@/app/api/v1/leads-da-meta/route";
import { GET as DIAGNOSTICO } from "@/app/api/v1/leads-da-meta/paginas/route";
import { PUT } from "@/app/api/v1/leads-da-meta/formularios/route";
import { POST as LER_AGORA } from "@/app/api/v1/leads-da-meta/ler-agora/route";

const FUNIL_MEU = "11111111-1111-4111-8111-111111111111";
const ETAPA_MINHA = "22222222-2222-4222-8222-222222222222";
const FUNIL_DO_VIZINHO = "33333333-3333-4333-8333-333333333333";
const ETAPA_DO_VIZINHO = "44444444-4444-4444-8444-444444444444";
const OUTRO_FUNIL = "55555555-5555-4555-8555-555555555555";

let banco: ReturnType<typeof bancoEmMemoria>;

/**
 * O que o token da agência alcança na Meta: a Página de org-1 (111), a de org-2
 * (999) e uma sem dono (555). Cada Página com os formulários dela.
 */
const NA_META: Record<string, { nome: string; token: string; forms: Array<Record<string, unknown>> }> = {
  "111": {
    nome: "Clínica",
    token: "TOKEN-P111",
    forms: [
      { id: "222", name: "Avaliação (na Meta)", status: "ACTIVE", questions: [{ key: "full_name", label: "Nome completo" }] },
    ],
  },
  "999": {
    nome: "Página do vizinho",
    token: "TOKEN-P999",
    forms: [{ id: "888", name: "Formulário do vizinho", status: "ACTIVE", questions: [] }],
  },
  "555": { nome: "Página sem dono", token: "TOKEN-P555", forms: [] },
};
let chamadasNaMeta: string[] = [];

beforeEach(() => {
  h.papel = "admin";
  h.auditorias = [];
  h.rodadas = [];
  h.tokens = { "org-1": "TOKEN-DA-AGENCIA" };
  chamadasNaMeta = [];
  banco = bancoEmMemoria({
    crm_stages: [
      { id: ETAPA_MINHA, organization_id: "org-1", pipeline_id: FUNIL_MEU },
      { id: ETAPA_DO_VIZINHO, organization_id: "org-2", pipeline_id: FUNIL_DO_VIZINHO },
    ],
    mia_paginas_da_meta: [
      { page_id: "111", organization_id: "org-1", page_name: "Clínica" },
      { page_id: "999", organization_id: "org-2", page_name: "Página do vizinho" },
    ],
  });
  h.banco = banco;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: string | URL) => {
      const url = new URL(String(entrada));
      chamadasNaMeta.push(url.pathname);
      if (url.pathname.endsWith("/me/accounts")) {
        const data = Object.entries(NA_META).map(([id, p]) => ({ id, name: p.nome, access_token: p.token }));
        return new Response(JSON.stringify({ data }), { status: 200 });
      }
      if (url.pathname.endsWith("/me/permissions")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      const pagina = /\/(\d+)\/leadgen_forms$/.exec(url.pathname)?.[1];
      if (pagina && NA_META[pagina]) {
        return new Response(JSON.stringify({ data: NA_META[pagina]!.forms }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { code: 100, message: "rota inesperada" } }), {
        status: 400,
      });
    }),
  );
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function pedido(corpo: unknown): never {
  return new Request("http://x/api", {
    method: "PUT",
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  }) as never;
}

const FORM = {
  page_id: "111",
  page_name: "Clínica",
  form_id: "222",
  form_name: "Avaliação",
  perguntas: { full_name: "Nome completo" },
  pipeline_id: FUNIL_MEU,
  stage_id: ETAPA_MINHA,
  ativo: true,
};

describe("PUT /api/v1/leads-da-meta/formularios", () => {
  it("grava o formulário da empresa da sessão, com nome e perguntas da META, e audita", async () => {
    const r = await PUT(pedido({ ...FORM, form_name: "nome inventado no corpo" }));
    expect(r.status).toBe(200);
    expect(banco.tabela("mia_leads_da_meta_formularios")[0]).toMatchObject({
      organization_id: "org-1",
      page_id: "111",
      form_id: "222",
      form_name: "Avaliação (na Meta)",
      perguntas: { full_name: "Nome completo" },
      pipeline_id: FUNIL_MEU,
      stage_id: ETAPA_MINHA,
      ativo: true,
    });
    expect(h.auditorias[0]).toMatchObject({
      action: "leads_da_meta.formulario_salvo",
      organizationId: "org-1",
    });
  });

  it("etapa de OUTRA empresa é recusada, e nada é gravado", async () => {
    const r = await PUT(
      pedido({ ...FORM, pipeline_id: FUNIL_DO_VIZINHO, stage_id: ETAPA_DO_VIZINHO }),
    );
    expect(r.status).toBe(422);
    expect(banco.tabela("mia_leads_da_meta_formularios")).toHaveLength(0);
  });

  it("etapa que não é do funil escolhido é recusada", async () => {
    const r = await PUT(pedido({ ...FORM, pipeline_id: OUTRO_FUNIL }));
    expect(r.status).toBe(422);
  });

  it("salvar de novo ATUALIZA e mantém a marca de leitura (não recomeça do zero)", async () => {
    await PUT(pedido(FORM));
    banco.tabela("mia_leads_da_meta_formularios")[0]!.lido_ate = "2026-09-29T10:00:00.000Z";
    await PUT(pedido({ ...FORM, ativo: false }));
    const linhas = banco.tabela("mia_leads_da_meta_formularios");
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ ativo: false, lido_ate: "2026-09-29T10:00:00.000Z" });
  });

  it("id que não é da Meta, e campo a mais, são recusados na validação", async () => {
    expect((await PUT(pedido({ ...FORM, form_id: "abc" }))).status).toBe(422);
    expect((await PUT(pedido({ ...FORM, organization_id: "org-2" }))).status).toBe(422);
  });

  it("gerente não configura: só admin", async () => {
    h.papel = "manager";
    expect((await PUT(pedido(FORM))).status).toBe(403);
  });
});

describe("PATCH /api/v1/leads-da-meta (a chave)", () => {
  it("liga, carimba quando ligou e audita com o antes", async () => {
    const r = await PATCH(pedido({ ativo: true, dias_de_recuperacao: 30 }));
    expect(r.status).toBe(200);
    const [linha] = banco.tabela("mia_leads_da_meta_config");
    expect(linha).toMatchObject({ organization_id: "org-1", ativo: true, dias_de_recuperacao: 30 });
    expect(linha!.ativado_em).toBeTruthy();
    expect(h.auditorias[0]).toMatchObject({
      action: "leads_da_meta.configurado",
      metadata: { antes: null },
    });
  });

  it("dias fora de 0 a 90 são recusados", async () => {
    expect((await PATCH(pedido({ dias_de_recuperacao: 91 }))).status).toBe(422);
    expect((await PATCH(pedido({}))).status).toBe(422);
  });
});

describe("POST /api/v1/leads-da-meta/ler-agora", () => {
  it("com a chave desligada, recusa sem chamar a Meta", async () => {
    const r = await LER_AGORA();
    expect(r.status).toBe(422);
    expect(h.rodadas).toHaveLength(0);
  });

  it("com a chave ligada, roda SÓ a empresa da sessão e audita o resultado", async () => {
    banco.tabela("mia_leads_da_meta_config").push({ organization_id: "org-1", ativo: true });
    const r = await LER_AGORA();
    expect(r.status).toBe(200);
    expect(h.rodadas[0]).toMatchObject({ organizationId: "org-1" });
    expect(h.auditorias[0]).toMatchObject({
      action: "leads_da_meta.lido_agora",
      metadata: { novos: 2 },
    });
  });
});

describe("PUT /api/v1/leads-da-meta/formularios · a Página é da empresa (.61)", () => {
  it("formulário de Página de OUTRA empresa é recusado (403), e nada é gravado", async () => {
    const r = await PUT(pedido({ ...FORM, page_id: "999", form_id: "888" }));
    expect(r.status).toBe(403);
    expect(banco.tabela("mia_leads_da_meta_formularios")).toHaveLength(0);
  });

  it("Página sem dono é recusada, mesmo o token alcançando", async () => {
    const r = await PUT(pedido({ ...FORM, page_id: "555" }));
    expect(r.status).toBe(403);
    expect(banco.tabela("mia_leads_da_meta_formularios")).toHaveLength(0);
  });

  it("formulário do vizinho colado ao lado da Página da empresa é recusado pela Meta (422)", async () => {
    // Página 111 é de org-1, mas o formulário 888 é da Página 999, de org-2.
    const r = await PUT(pedido({ ...FORM, page_id: "111", form_id: "888" }));
    expect(r.status).toBe(422);
    expect(banco.tabela("mia_leads_da_meta_formularios")).toHaveLength(0);
  });

  it("desligar o formulário que ficou de uma Página que deixou de ser da empresa é permitido", async () => {
    banco.tabela("mia_leads_da_meta_formularios").push({
      id: "linha-legada",
      organization_id: "org-1",
      page_id: "999",
      form_id: "888",
      ativo: true,
    });
    const r = await PUT(pedido({ ...FORM, page_id: "999", form_id: "888", ativo: false }));
    expect(r.status).toBe(200);
    expect(banco.tabela("mia_leads_da_meta_formularios")[0]).toMatchObject({
      page_id: "999",
      ativo: false,
    });
    // Desligar não consulta a Meta.
    expect(chamadasNaMeta).toHaveLength(0);
  });

  it("sem conexão própria, confere pela conexão da plataforma", async () => {
    h.tokens = { "org-agencia": "TOKEN-DA-AGENCIA" };
    banco.tabela("mia_meta_conexao_da_plataforma").push({ id: 1, organizacao_da_conexao: "org-agencia" });
    const r = await PUT(pedido(FORM));
    expect(r.status).toBe(200);
  });
});

describe("GET /api/v1/leads-da-meta/paginas · empresa A não vê Página da empresa B (.61)", () => {
  it("o token alcança três Páginas; a empresa vê SÓ a dela", async () => {
    const r = await DIAGNOSTICO();
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { paginas: Array<{ id: string; formularios: unknown[] }> } };
    expect(corpo.data.paginas.map((p) => p.id)).toEqual(["111"]);
    // Nem os formulários das outras são lidos na Meta.
    expect(chamadasNaMeta.some((c) => c.includes("/999/") || c.includes("/555/"))).toBe(false);
  });

  it("a outra direção: org-2 vê só a 999", async () => {
    h.tokens = { "org-2": "TOKEN-DA-AGENCIA" };
    const requireRole = (await import("@/lib/auth/require-role")).requireRole as unknown as {
      mockResolvedValueOnce: (v: unknown) => void;
    };
    requireRole.mockResolvedValueOnce({
      ok: true,
      user: { id: "user-2" },
      org: { orgId: "org-2", role: "admin" },
    });
    const r = await DIAGNOSTICO();
    const corpo = (await r.json()) as { data: { paginas: Array<{ id: string }> } };
    expect(corpo.data.paginas.map((p) => p.id)).toEqual(["999"]);
  });

  it("empresa sem Página atribuída: nada, e a Meta nem é consultada", async () => {
    banco.db.mia_paginas_da_meta = [];
    const r = await DIAGNOSTICO();
    const corpo = (await r.json()) as { data: { paginas: unknown[] } };
    expect(corpo.data.paginas).toEqual([]);
    expect(chamadasNaMeta).toHaveLength(0);
  });

  it("Página da empresa que o token não alcança aparece, com o motivo", async () => {
    banco.tabela("mia_paginas_da_meta").push({ page_id: "777", organization_id: "org-1", page_name: "Fora do token" });
    const r = await DIAGNOSTICO();
    const corpo = (await r.json()) as { data: { paginas: Array<{ id: string; erro: string | null }> } };
    expect(corpo.data.paginas.find((p) => p.id === "777")).toMatchObject({ erro: "pagina_nao_atribuida" });
  });
});

describe("GET /api/v1/leads-da-meta (o estado) · só as Páginas da empresa (.61)", () => {
  it("devolve as Páginas da empresa da sessão e diz de onde vem o token", async () => {
    const r = await ESTADO();
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as {
      data: { paginas: Array<{ page_id: string }>; conectada: boolean; origem_da_conexao: string };
    };
    expect(corpo.data.paginas.map((p) => p.page_id)).toEqual(["111"]);
    expect(corpo.data).toMatchObject({ conectada: true, origem_da_conexao: "propria" });
  });

  it("sem conexão própria, conectada pela plataforma", async () => {
    h.tokens = { "org-agencia": "TOKEN-DA-AGENCIA" };
    banco.tabela("mia_meta_conexao_da_plataforma").push({ id: 1, organizacao_da_conexao: "org-agencia" });
    const corpo = (await (await ESTADO()).json()) as { data: { conectada: boolean; origem_da_conexao: string } };
    expect(corpo.data).toMatchObject({ conectada: true, origem_da_conexao: "plataforma" });
  });
});
