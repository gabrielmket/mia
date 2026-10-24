// @vitest-environment node
/**
 * FORK MIA (.81) — o servidor MCP externo do upstream (registro desde a 0580,
 * tela na v1.83, #2948) numa empresa de DEMONSTRAÇÃO.
 *
 * Da demonstração nada sai (migration 9010), e o servidor externo é rede para
 * o sistema de um terceiro (o ERP do cliente). Três portas, provadas aqui e no
 * invariante da trava:
 *
 *   1. a CARGA (`carregarServidorMcpExterno`, o turno e o editor do agente):
 *      com a marca ligada devolve `null` sem abrir a chave e sem um byte de
 *      rede. Controle: a mesma linha sem a marca chega a chamar o `fetch`;
 *   2. o CADASTRO (`definirServidorMcpExterno`): recusa gravar endereço e chave
 *      na demonstração, e APAGAR continua valendo;
 *   3. o BANCO (9043, `trg_mia_demonstracao_sem_mcp_externo`) — no invariante
 *      `empresa-de-demonstracao-nao-envia`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => {
  // Antes de qualquer import: `lib/env.ts` lê a chave de cifragem no carregamento.
  process.env.AI_CRED_AES_KEY = "iBc1Z2gYaAH4rEHs1dHQ2dvNQ6t4OfrdE1/Y6OSvtZY=";
  return {
    linha: null as Record<string, unknown> | null,
    updates: [] as Array<Record<string, unknown>>,
  };
});

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(async () => ({
    id: "11111111-1111-4111-8111-111111111111",
    is_platform_admin: true,
    support: null,
    idioma: "pt",
  })),
  resolveActiveOrg: vi.fn(async () => ({ orgId: ORG, name: "Demonstração" })),
  mfaEmDivida: vi.fn(async () => false),
  // v1.88 (#3207, 0747): as ações da instalação usam a régua ESTRITA (sem dispositivo confiável).
  mfaEmDividaEstrita: vi.fn(async () => false),
  sessionAal: vi.fn(async () => "aal2"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

function cadeia() {
  const c = {
    select: () => c,
    update: (payload: Record<string, unknown>) => {
      estado.updates.push(payload);
      return c;
    },
    eq: () => c,
    maybeSingle: async () => ({ data: estado.linha, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(ok, ko),
  };
  return c;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => cadeia() }) }));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    createClient: vi.fn(async () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({ maybeSingle: async () => ({ data: { scope: "full", mfa_required: false }, error: null }) }),
          }),
        }),
      }),
    })),
  };
});

import { definirServidorMcpExterno } from "@/app/actions/settings/definirServidorMcpExterno";
import { carregarServidorMcpExterno } from "@/lib/mcp/servidor-externo/carregar";
import { cifrarChaveMcpExterno } from "@/lib/mcp/servidor-externo/segredo";

const ORG = "9010d3e0-0000-4000-8000-000000000081";
const CHAVE = "chave-do-erp-de-exemplo";

beforeEach(() => {
  estado.linha = null;
  estado.updates = [];
});

describe("a carga do servidor externo na demonstração", () => {
  function banco(demonstracao: boolean) {
    const linha = {
      settings: { mcp_externo: { endpoint: "http://127.0.0.1:1/mcp" } },
      ...cifrarChaveMcpExterno(CHAVE),
      demonstracao,
    };
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      maybeSingle: async () => ({ data: linha, error: null }),
    };
    return { from: () => c } as never;
  }

  it("com a marca ligada, nenhum byte de rede", async () => {
    const espiao = vi.fn(async () => {
      throw new Error("sem rede no teste");
    });
    const montado = await carregarServidorMcpExterno(banco(true), ORG, { fetch: espiao as never });
    expect(montado).toBeNull();
    expect(espiao, "a demonstração falou com o servidor de fora").not.toHaveBeenCalled();
  });

  it("CONTROLE: sem a marca, a mesma linha chega a chamar o servidor", async () => {
    const espiao = vi.fn(async () => {
      throw new Error("sem rede no teste");
    });
    await carregarServidorMcpExterno(banco(false), ORG, { fetch: espiao as never });
    expect(espiao, "o controle não abriu rede: o teste acima não prova nada").toHaveBeenCalled();
  });
});

describe("o cadastro do servidor externo na demonstração", () => {
  it("gravar endereço e chave é recusado, e nada é escrito", async () => {
    estado.linha = { settings: {}, demonstracao: true };
    const r = await definirServidorMcpExterno({ endpoint: "https://erp.loja/mcp", chave: CHAVE });
    expect(r).toEqual({ ok: false, error: "organizacao_de_demonstracao" });
    expect(estado.updates).toEqual([]);
  });

  it("apagar continua valendo (é como se limpa uma demonstração)", async () => {
    estado.linha = { settings: { mcp_externo: { endpoint: "https://erp.loja/mcp" } }, demonstracao: true };
    const r = await definirServidorMcpExterno({ endpoint: "", chave: "" });
    expect(r.ok).toBe(true);
    expect(estado.updates).toHaveLength(1);
  });

  it("CONTROLE: numa empresa de verdade o cadastro grava", async () => {
    estado.linha = { settings: {}, demonstracao: false };
    const r = await definirServidorMcpExterno({ endpoint: "https://erp.loja/mcp", chave: CHAVE });
    expect(r.ok).toBe(true);
    expect(estado.updates).toHaveLength(1);
  });
});
