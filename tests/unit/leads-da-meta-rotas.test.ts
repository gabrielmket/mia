/**
 * FORK MIA — as rotas de /api/v1/leads-da-meta: quem pode, com que corpo, e o que
 * fica gravado. A organização vem SEMPRE da sessão (`requireRole`), e o funil e a
 * etapa do corpo são conferidos contra ela — a rotina grava com service role, e
 * uma etapa de outra empresa aceita aqui seria negócio criado no funil do vizinho.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria } from "../helpers/banco-em-memoria";

const h = vi.hoisted(() => ({
  banco: null as null | { cliente: unknown },
  papel: "admin" as string,
  auditorias: [] as Array<Record<string, unknown>>,
  rodadas: [] as Array<Record<string, unknown>>,
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

import { PATCH } from "@/app/api/v1/leads-da-meta/route";
import { PUT } from "@/app/api/v1/leads-da-meta/formularios/route";
import { POST as LER_AGORA } from "@/app/api/v1/leads-da-meta/ler-agora/route";

const FUNIL_MEU = "11111111-1111-4111-8111-111111111111";
const ETAPA_MINHA = "22222222-2222-4222-8222-222222222222";
const FUNIL_DO_VIZINHO = "33333333-3333-4333-8333-333333333333";
const ETAPA_DO_VIZINHO = "44444444-4444-4444-8444-444444444444";
const OUTRO_FUNIL = "55555555-5555-4555-8555-555555555555";

let banco: ReturnType<typeof bancoEmMemoria>;

beforeEach(() => {
  h.papel = "admin";
  h.auditorias = [];
  h.rodadas = [];
  banco = bancoEmMemoria({
    crm_stages: [
      { id: ETAPA_MINHA, organization_id: "org-1", pipeline_id: FUNIL_MEU },
      { id: ETAPA_DO_VIZINHO, organization_id: "org-2", pipeline_id: FUNIL_DO_VIZINHO },
    ],
  });
  h.banco = banco;
});
afterEach(() => vi.clearAllMocks());

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
  it("grava o formulário da empresa da sessão e audita", async () => {
    const r = await PUT(pedido(FORM));
    expect(r.status).toBe(200);
    expect(banco.tabela("mia_leads_da_meta_formularios")[0]).toMatchObject({
      organization_id: "org-1",
      form_id: "222",
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
