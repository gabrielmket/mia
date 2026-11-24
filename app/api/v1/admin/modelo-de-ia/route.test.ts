/**
 * /api/v1/admin/modelo-de-ia — a IA da plataforma é a de toda empresa que segue
 * (FORK MIA, 9172, MIA-217).
 *
 * O GET conta as empresas que operam (`seguem`, `propria`, `sem_chave`) para o
 * cartão mostrar quantas mudam com a escolha. O PUT recusa, com 422
 * `ia_sem_chave` e sem gravar, o provedor sem chave da instalação (todas as que
 * seguem ficariam sem IA) e o "automático" enquanto alguém segue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const banco = vi.hoisted(() => ({
  empresas: [] as Array<{ id: string; status: string; settings: unknown; ia_segue_a_plataforma: boolean }>,
  credenciais: [] as Array<{ organization_id: string; provider: string; is_active: boolean; validated_at: string | null }>,
  gravacoes: [] as Array<{ tabela: string; payload: unknown }>,
}));

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn(async () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } })),
  requirePlatformAdminEscrita: vi.fn(async () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } })),
  falhaDaEscritaDePlatformAdmin: vi.fn(() => new Response(null, { status: 403 })),
}));

function cadeia(tabela: string, lista: unknown[], unico: unknown) {
  const chain: Record<string, unknown> = {
    maybeSingle: async () => ({ data: unico, error: null }),
    upsert: async (payload: unknown) => {
      banco.gravacoes.push({ tabela, payload });
      return { error: null };
    },
    then: (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) =>
      Promise.resolve({ data: lista, error: null }).then(ok, erro),
  };
  for (const m of ["select", "eq", "is", "not", "order"]) chain[m] = () => chain;
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      if (tabela === "platform_ia") return cadeia(tabela, [], { provider: "openai", model_id: "gpt-5.6-luna" });
      if (tabela === "ai_models") {
        return cadeia(
          tabela,
          [{ provider: "openai", model_id: "gpt-5.6-luna", supports_tools: true }],
          { model_id: "gpt-5.6-luna" },
        );
      }
      if (tabela === "organizations") return cadeia(tabela, banco.empresas, null);
      if (tabela === "ai_provider_credentials") return cadeia(tabela, banco.credenciais, null);
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  }),
}));

import { GET, PUT } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
});

const LUNA = { llm: { provider: "openai", default_model: "gpt-5.6-luna" } };
const SONNET = { llm: { provider: "anthropic", default_model: "claude-sonnet-5" } };

function put(corpo: unknown) {
  return PUT(
    new NextRequest("http://localhost/api/v1/admin/modelo-de-ia", {
      method: "PUT",
      body: JSON.stringify(corpo),
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  banco.gravacoes = [];
  // A instalação tem a chave da OpenAI e não a da Anthropic — o retrato da produção.
  vi.stubEnv("OPENAI_API_KEY", "sk-teste-da-instalacao");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  banco.empresas = [
    { id: "a", status: "active", settings: LUNA, ia_segue_a_plataforma: true },
    { id: "b", status: "active", settings: LUNA, ia_segue_a_plataforma: true },
    // escolha própria com chave da empresa
    { id: "c", status: "active", settings: SONNET, ia_segue_a_plataforma: false },
    // escolha própria SEM chave: está sem IA
    { id: "d", status: "active", settings: SONNET, ia_segue_a_plataforma: false },
    // suspensa: não conta
    { id: "e", status: "suspended", settings: SONNET, ia_segue_a_plataforma: false },
  ];
  banco.credenciais = [{ organization_id: "c", provider: "anthropic", is_active: true, validated_at: "2026-11-01T00:00:00Z" }];
});

describe("GET — quantas empresas a escolha alcança", () => {
  it("devolve seguem, propria e sem_chave das empresas que operam", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { empresas: unknown } };
    expect(json.data.empresas).toEqual({ seguem: 2, propria: 2, sem_chave: 1 });
  });
});

describe("PUT — a trava", () => {
  it("provedor com chave da instalação grava", async () => {
    const res = await put({ provider: "openai", model_id: "gpt-5.6-luna" });
    expect(res.status).toBe(200);
    expect(banco.gravacoes.map((g) => g.tabela)).toEqual(["platform_ia"]);
  });

  it("provedor sem chave da instalação: 422 ia_sem_chave, com quantas ficariam sem IA, e nada gravado", async () => {
    const res = await put({ provider: "anthropic", model_id: "claude-sonnet-5" });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe("ia_sem_chave");
    expect(json.error.message).toBe(
      "Não dá para salvar: Anthropic (Claude) não tem chave nesta instalação. " +
        "As 2 empresas que seguem a plataforma ficariam sem IA. Escolha um provedor com chave.",
    );
    expect(banco.gravacoes).toEqual([]);
  });

  it("'automático' com empresas seguindo: 422 e nada gravado", async () => {
    const res = await put({ provider: null, model_id: null });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe("ia_sem_chave");
    expect(json.error.message).toContain("2 empresas seguem a plataforma");
    expect(banco.gravacoes).toEqual([]);
  });

  it("'automático' sem ninguém seguindo grava, como antes", async () => {
    banco.empresas = banco.empresas.map((e) => ({ ...e, ia_segue_a_plataforma: false }));
    const res = await put({ provider: null, model_id: null });
    expect(res.status).toBe(200);
    expect(banco.gravacoes.map((g) => g.tabela)).toEqual(["platform_ia"]);
  });
});
