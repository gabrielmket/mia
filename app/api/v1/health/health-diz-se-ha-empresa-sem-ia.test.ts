import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * FORK MIA (MIA-218) — GET /api/v1/health diz quantas empresas estão com o
 * padrão de IA num provedor sem chave (`data.ia.empresas_sem_chave`).
 *
 * As promessas, todas aqui:
 *  - a régua é a de `iaDasEmpresas` (MIA-217), de verdade: chave própria só
 *    ativa e validada, chave da instalação pelo `.env`;
 *  - conta só as empresas que operam (a suspensa fica de fora);
 *  - leitura que falhou: `null` (desconhecido), nunca 0;
 *  - só a contagem sai, igual com e sem o segredo: nem id, nem nome;
 *  - nada disso muda o `status` nem o HTTP da saúde.
 *
 * Empresas fictícias. A instalação daqui tem chave da OpenAI e de mais nenhum.
 *
 *     npx vitest run app/api/v1/health/health-diz-se-ha-empresa-sem-ia.test.ts
 */

const SEGREDO = "segredo-interno-de-teste-com-tamanho-suficiente";

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://projeto-do-cliente.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "chave-anon-de-teste",
    SUPABASE_SERVICE_ROLE_KEY: "chave-de-teste",
    UPSTASH_REDIS_REST_URL: "https://redis-de-teste.exemplo",
    UPSTASH_REDIS_REST_TOKEN: "token-de-teste",
    INTERNAL_CRON_SECRET: "segredo-interno-de-teste-com-tamanho-suficiente",
    INTERNAL_SECRET: "",
  },
}));

vi.mock("@/lib/instalacao/ambiente", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/instalacao/ambiente")>();
  return {
    ...real,
    lerAmbiente: () => ({ ...real.lerAmbiente(), chavesDeProvedor: { openai: true } }),
  };
});

type Tabela = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
const banco = vi.hoisted(() => ({
  tabelas: {} as Record<string, { data: Array<Record<string, unknown>> | null; error: { message: string } | null }>,
}));

/** O mínimo do cliente que `iaDasEmpresas` usa: select, order, eq, not e o await. */
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const resposta: Tabela = banco.tabelas[tabela] ?? { data: [], error: null };
      const cadeia: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.resolve(resposta).then(ok, erro),
      };
      for (const m of ["select", "order", "eq", "not"]) cadeia[m] = () => cadeia;
      return cadeia;
    },
  }),
}));

const empresa = (id: string, nome: string, provider: string, extra: Record<string, unknown> = {}) => ({
  id,
  display_name: nome,
  status: "active",
  settings: { llm: { provider } },
  ia_segue_a_plataforma: false,
  ...extra,
});

function cenarioComDuasSemChave() {
  banco.tabelas = {
    organizations: {
      data: [
        empresa("org-a", "Clínica Exemplo", "openai", { ia_segue_a_plataforma: true }), // chave da instalação
        empresa("org-b", "Academia Beta", "anthropic"), // sem chave
        empresa("org-c", "Loja Gama", "google"), // chave própria validada
        empresa("org-d", "Escola Épsilon", "google"), // chave própria NÃO validada: sem chave
        empresa("org-e", "Studio Delta", "anthropic", { status: "suspended" }), // sem chave, mas não opera
      ],
      error: null,
    },
    ai_provider_credentials: {
      // a leitura de verdade já filtra ativa e validada no banco
      data: [{ organization_id: "org-c", provider: "google", is_active: true, validated_at: "2026-11-01T00:00:00Z" }],
      error: null,
    },
  };
}

function stubDoResto() {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("[]", { status: 200 })));
}

async function saude(comSegredo = false) {
  const { GET } = await import("./route");
  const res = await GET(
    new NextRequest(
      `https://crm.exemplo.com.br/api/v1/health${comSegredo ? "?verbose=1" : ""}`,
      comSegredo ? { headers: { authorization: `Bearer ${SEGREDO}` } } : undefined,
    ),
  );
  return { http: res.status, corpo: (await res.json()) as { data: Record<string, unknown> } };
}

describe("GET /api/v1/health — o bloco ia", () => {
  beforeEach(() => {
    vi.resetModules();
    stubDoResto();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("⭐ conta as operantes sem chave utilizável: 2 (a suspensa não conta)", async () => {
    cenarioComDuasSemChave();
    const { corpo } = await saude();
    expect(corpo.data.ia).toEqual({ empresas_sem_chave: 2 });
  });

  it("⭐ todas com chave: 0, e a saúde não muda", async () => {
    banco.tabelas = {
      organizations: { data: [empresa("org-a", "Clínica Exemplo", "openai")], error: null },
      ai_provider_credentials: { data: [], error: null },
    };
    const referencia = await saude();
    expect(referencia.corpo.data.ia).toEqual({ empresas_sem_chave: 0 });

    vi.resetModules();
    cenarioComDuasSemChave();
    const { http, corpo } = await saude();
    expect(http, "empresa sem chave derrubou a saúde").toBe(referencia.http);
    expect(corpo.data.status, "empresa sem chave mudou o status da saúde").toBe(referencia.corpo.data.status);
  });

  it("⭐ a leitura falhou: null (desconhecido), não 0", async () => {
    cenarioComDuasSemChave();
    banco.tabelas.ai_provider_credentials = { data: null, error: { message: "fora do ar" } };
    const { http, corpo } = await saude();
    expect(corpo.data.ia).toEqual({ empresas_sem_chave: null });
    expect(http).toBe(200);
  });

  it("só a contagem sai, igual com e sem o segredo: nem id, nem nome, nem provedor", async () => {
    cenarioComDuasSemChave();
    const sem = await saude(false);
    vi.resetModules();
    const com = await saude(true);
    expect(com.corpo.data.ia).toEqual(sem.corpo.data.ia);
    const texto = JSON.stringify(com.corpo.data.ia);
    for (const vazado of ["org-b", "Academia Beta", "anthropic", "Escola"]) {
      expect(texto, `${vazado} vazou na saúde`).not.toContain(vazado);
    }
  });
});
