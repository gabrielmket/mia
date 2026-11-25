/**
 * /api/v1/ai/providers — a plataforma em modo suporte com "Edição permitida"
 * troca a IA da empresa (MIA-218).
 *
 * O admin de plataforma não é membro das empresas: a única porta para a tela
 * Provedores de IA de uma delas é o modo suporte. Até a .116, `escolheIa`
 * recusava toda sessão de suporte, e a tela abria sem "Salvar padrão" e com o
 * PATCH em 403. Aqui a rota de verdade, ponta a ponta: quem passa e quem
 * continua de fora. A régua sozinha está em `lib/ai/trava-da-ia.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";

const banco = vi.hoisted(() => ({
  gravacoes: [] as Array<{ tabela: string; payload: unknown }>,
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

function cadeia(tabela: string, dados: unknown, unico: unknown) {
  const chain: Record<string, unknown> = {
    maybeSingle: async () => ({ data: unico, error: null }),
    upsert: (payload: unknown) => {
      banco.gravacoes.push({ tabela, payload });
      return chain;
    },
    update: (payload: unknown) => {
      banco.gravacoes.push({ tabela, payload });
      return chain;
    },
    then: (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) =>
      Promise.resolve({ data: dados, error: null }).then(ok, erro),
  };
  for (const m of ["select", "eq", "in", "is", "not", "order", "limit"]) chain[m] = () => chain;
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      if (tabela === "platform_config") return cadeia(tabela, [], null);
      if (tabela === "modulos_instalados") return cadeia(tabela, [], null);
      // A trava da MIA-217 confere a chave pelo admin: a empresa tem uma da
      // OpenAI, validada, então salvar a OpenAI não cai em `ia_sem_chave`.
      if (tabela === "ai_provider_credentials") {
        return cadeia(tabela, [{ provider: "openai", is_active: true, validated_at: "2026-10-01T00:00:00Z" }], null);
      }
      return cadeia(tabela, [], { settings: {} });
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (tabela: string) => {
      if (tabela === "ai_provider_credentials") {
        return cadeia(
          tabela,
          [{ id: "c1", provider: "openai", label: "a", api_key_last4: "c0de", validated_at: "2026-10-01T00:00:00Z", is_active: true }],
          null,
        );
      }
      if (tabela === "ai_models") {
        return cadeia(tabela, [], { model_id: "gpt-5.5", supports_tools: true, supports_vision: false });
      }
      return cadeia(tabela, [], null);
    },
  }),
}));

import { GET, PATCH } from "@/app/api/v1/ai/providers/route";

const ORG = "22222222-2222-4222-8222-222222222222";

type Sessao = {
  status: "active" | "expired" | "revoked";
  access_mode: "full" | "support_readonly";
  organization_id: string;
  agency_id?: string;
};

function sessao(extra: Partial<Sessao> = {}): Sessao {
  return { status: "active", access_mode: "full", organization_id: ORG, ...extra };
}

function quem(opts: { plataforma: boolean; scope?: string | null; support: Sessao | null }) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    idioma: "pt-BR",
    is_platform_admin: opts.plataforma,
    platform_admin_scope: opts.plataforma ? (opts.scope === undefined ? "full" : opts.scope) : null,
    support: opts.support,
  };
}

function entraComo(user: ReturnType<typeof quem>, role = "admin") {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user,
    org: { orgId: ORG, role },
  } as unknown as Awaited<ReturnType<typeof requireRole>>);
}

async function podeEditar(): Promise<boolean> {
  const res = await GET();
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { podeEditar: boolean } }).data.podeEditar;
}

const salvarPadrao = () =>
  PATCH(
    new NextRequest("http://localhost/api/v1/ai/providers", {
      method: "PATCH",
      body: JSON.stringify({ provider: "openai", default_model: "gpt-5.5" }),
      headers: { "content-type": "application/json" },
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  banco.gravacoes = [];
});

describe("admin de plataforma em modo suporte com edição permitida", () => {
  beforeEach(() => entraComo(quem({ plataforma: true, support: sessao() })));

  it("vê o painel editável (o 'Salvar padrão' aparece)", async () => {
    expect(await podeEditar()).toBe(true);
  });

  it("salva o padrão da empresa", async () => {
    const res = await salvarPadrao();
    expect(res.status).toBe(200);
    expect(banco.gravacoes.map((g) => g.tabela)).toEqual(["organizations"]);
  });
});

describe("quem continua sem escolher a IA da empresa", () => {
  const casos: Array<[string, ReturnType<typeof quem>]> = [
    ["admin da empresa, sem ser da plataforma", quem({ plataforma: false, support: null })],
    ["plataforma em suporte só de leitura", quem({ plataforma: true, support: sessao({ access_mode: "support_readonly" }) })],
    ["plataforma com scope support_readonly", quem({ plataforma: true, scope: "support_readonly", support: sessao() })],
    ["plataforma sem scope carregado", quem({ plataforma: true, scope: null, support: sessao() })],
    ["sessão aberta por uma agência", quem({ plataforma: true, support: sessao({ agency_id: "55555555-5555-4555-8555-555555555555" }) })],
    ["sessão encerrada", quem({ plataforma: true, support: sessao({ status: "expired" }) })],
    ["suporte de quem não é da plataforma", quem({ plataforma: false, support: sessao() })],
  ];

  it.each(casos)("%s: painel só de leitura e PATCH recusado sem gravar", async (_nome, user) => {
    entraComo(user);
    expect(await podeEditar()).toBe(false);
    const res = await salvarPadrao();
    expect(res.status).toBe(403);
    const corpo = (await res.json()) as { error: { code: string } };
    expect(corpo.error.code).toBe("ia_da_plataforma");
    expect(banco.gravacoes).toEqual([]);
  });

  it("plataforma em suporte com edição, mas papel de leitura na empresa: painel só de leitura", async () => {
    entraComo(quem({ plataforma: true, support: sessao() }), "viewer");
    expect(await podeEditar()).toBe(false);
  });
});
