/**
 * FORK MIA (MIA-309) · a trava da VISÃO no PUT de `/api/v1/admin/modelo-de-ia`.
 *
 * Desde a MIA-309 o modelo da plataforma atende também os agentes JÁ
 * publicados das empresas que seguem (`lib/ai/agente-segue-a-plataforma.ts`).
 * Um modelo que não enxerga imagem faria o agente que lê foto ignorar o
 * comprovante do cliente, calado. A de ferramentas já existia (o catálogo,
 * `supports_tools`) e continua.
 *
 * O provedor é a OpenRouter de propósito: num roteador a visão vem do catálogo
 * (`supports_vision`), e é o caso em que o mesmo fabricante tem modelo que
 * enxerga e modelo que não. Empresas e modelos fictícios.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const banco = vi.hoisted(() => ({
  empresas: [] as Array<{ id: string; status: string; settings: unknown; ia_segue_a_plataforma: boolean }>,
  agentes: [] as Array<{ organization_id: string; versao: Record<string, unknown> | null }>,
  modelos: [] as Array<{ provider: string; model_id: string; supports_tools: boolean; supports_vision: boolean }>,
  falhaNosAgentes: false,
  gravacoes: [] as Array<{ tabela: string; payload: unknown }>,
}));

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn(async () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } })),
  requirePlatformAdminEscrita: vi.fn(async () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } })),
  falhaDaEscritaDePlatformAdmin: vi.fn(() => new Response(null, { status: 403 })),
}));

/** Uma cadeia do supabase-js que filtra por `eq` e corta por `range`, como o PostgREST. */
function cadeia(tabela: string, linhas: Array<Record<string, unknown>>, erro: { message: string } | null = null) {
  const filtros: Array<[string, unknown]> = [];
  let corte: [number, number] | null = null;
  const resultado = () => {
    const filtradas = linhas.filter((l) => filtros.every(([c, v]) => l[c] === v));
    return corte ? filtradas.slice(corte[0], corte[1] + 1) : filtradas;
  };
  const chain: Record<string, unknown> = {
    eq: (c: string, v: unknown) => (filtros.push([c, v]), chain),
    range: (de: number, ate: number) => ((corte = [de, ate]), chain),
    maybeSingle: async () => ({ data: resultado()[0] ?? null, error: erro }),
    upsert: async (payload: unknown) => {
      banco.gravacoes.push({ tabela, payload });
      return { error: null };
    },
    then: (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
      Promise.resolve(erro ? { data: null, error: erro } : { data: resultado(), error: null }).then(ok, falha),
  };
  for (const m of ["select", "is", "not", "order"]) chain[m] = () => chain;
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      if (tabela === "ai_models") return cadeia(tabela, banco.modelos);
      if (tabela === "organizations") return cadeia(tabela, banco.empresas);
      if (tabela === "ai_provider_credentials") return cadeia(tabela, []);
      if (tabela === "ai_agents") return cadeia(tabela, banco.agentes, banco.falhaNosAgentes ? { message: "caiu" } : null);
      if (tabela === "platform_ia") return cadeia(tabela, []);
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  }),
}));

import { PUT } from "./route";

const SEGUE = { provider: "openrouter", default_model: "fabricante/modelo-que-enxerga" };

function put(corpo: unknown) {
  return PUT(
    new NextRequest("http://localhost/api/v1/admin/modelo-de-ia", {
      method: "PUT",
      body: JSON.stringify(corpo),
      headers: { "content-type": "application/json" },
    }),
  );
}

function agente(organization_id: string, multimodal_input: boolean, image_vision_enabled: boolean | null = true) {
  return {
    organization_id,
    versao: { provider: "openrouter", model: "fabricante/modelo-que-enxerga", status: "published", multimodal_input, image_vision_enabled },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  banco.gravacoes = [];
  banco.falhaNosAgentes = false;
  vi.stubEnv("OPENROUTER_API_KEY", "chave-ficticia-da-instalacao");
  banco.empresas = [
    { id: "segue", status: "active", settings: { llm: SEGUE }, ia_segue_a_plataforma: true },
    { id: "propria", status: "active", settings: { llm: SEGUE }, ia_segue_a_plataforma: false },
    { id: "suspensa", status: "suspended", settings: { llm: SEGUE }, ia_segue_a_plataforma: true },
  ];
  banco.modelos = [
    { provider: "openrouter", model_id: "fabricante/modelo-que-enxerga", supports_tools: true, supports_vision: true },
    { provider: "openrouter", model_id: "fabricante/modelo-sem-visao", supports_tools: true, supports_vision: false },
    { provider: "openrouter", model_id: "fabricante/modelo-sem-ferramentas", supports_tools: false, supports_vision: true },
  ];
  banco.agentes = [agente("segue", true)];
});

describe("PUT — a trava da visão", () => {
  it("⭐ modelo sem visão com um agente de quem segue lendo foto: 422 modelo_sem_visao, e nada gravado", async () => {
    const res = await put({ provider: "openrouter", model_id: "fabricante/modelo-sem-visao" });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe("modelo_sem_visao");
    expect(json.error.message).toBe(
      "Não dá para salvar: esse modelo não enxerga imagem, e 1 agente de uma empresa que segue a plataforma " +
        "lê as fotos que os clientes mandam. Escolha um modelo que enxerga imagem.",
    );
    expect(banco.gravacoes).toEqual([]);
  });

  it("no plural, conta os agentes", async () => {
    banco.agentes = [agente("segue", true), agente("segue", true)];
    const res = await put({ provider: "openrouter", model_id: "fabricante/modelo-sem-visao" });
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toContain("2 agentes de empresas que seguem a plataforma leem as fotos");
  });

  it.each([
    ["o agente não recebe mídia", [agente("segue", false)]],
    ["o agente recebe mídia mas não vê imagem", [agente("segue", true, false)]],
    ["quem lê foto tem escolha própria", [agente("propria", true)]],
    ["quem lê foto está suspensa", [agente("suspensa", true)]],
    ["nenhum agente publicado", []],
  ])("modelo sem visão grava quando %s", async (_caso, agentes) => {
    banco.agentes = agentes;
    const res = await put({ provider: "openrouter", model_id: "fabricante/modelo-sem-visao" });
    expect(res.status).toBe(200);
    expect(banco.gravacoes.map((g) => g.tabela)).toEqual(["platform_ia"]);
  });

  it("modelo que enxerga grava sem nem ler os agentes", async () => {
    banco.falhaNosAgentes = true;
    const res = await put({ provider: "openrouter", model_id: "fabricante/modelo-que-enxerga" });
    expect(res.status).toBe(200);
  });

  it("leitura dos agentes que falhou: recusa (a ação falha fechada) e nada gravado", async () => {
    banco.falhaNosAgentes = true;
    const res = await put({ provider: "openrouter", model_id: "fabricante/modelo-sem-visao" });
    expect(res.status).toBe(500);
    expect(banco.gravacoes).toEqual([]);
  });

  it("a de ferramentas continua antes: modelo que não usa ferramentas é recusado", async () => {
    const res = await put({ provider: "openrouter", model_id: "fabricante/modelo-sem-ferramentas" });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toBe("Esse modelo não está no catálogo ou não usa ferramentas.");
    expect(banco.gravacoes).toEqual([]);
  });
});
