/**
 * FORK MIA — O PAINEL DE CUSTO NÃO PARA NA LINHA 1000.
 *
 * `/admin/custo-da-meta` (a conta do mês por cliente) e a aba de consumo de um
 * cliente (`/admin/tenants/[id]/usage`) liam `messages` e `llm_calls` com
 * `.limit(50_000)` e contavam o que vinha. O PostgREST corta em 1000 linhas, e o
 * `truncado` das duas telas comparava o tamanho da lista com 50.000: nunca
 * ligava. O custo saía de 1000 linhas e a tela dizia que era o total.
 *
 * Aqui: 2.500 linhas no período dão o total certo, e acima do teto de páginas o
 * `truncado` que as telas já sabem mostrar passa a ligar.
 *
 *     npx vitest run --project produto tests/unit/painel-de-custo-nao-para-na-linha-1000.test.ts
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn(async () => ({ user: { id: "admin-da-plataforma" } })),
  requirePlatformAdminEscrita: vi.fn(),
  falhaDaEscritaDePlatformAdmin: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { postgrestComTeto, type Linha, type PostgrestComTeto } from "@/tests/helpers/postgrest-com-teto";

const CLINICA = "22222222-2222-4222-8222-222222222222";
const ACADEMIA = "33333333-3333-4333-8333-333333333333";
const PRECOS = [
  { categoria: "marketing", centavos_brl: 40 },
  { categoria: "utility", centavos_brl: 5 },
];

function ligar(banco: PostgrestComTeto): void {
  vi.mocked(createAdminClient).mockReturnValue(banco.cliente as never);
}

/** Um instante do mês corrente (UTC), que é o padrão das duas rotas. */
function nesteMes(i: number): string {
  const agora = new Date();
  const inicio = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1, 0, 0, 1);
  // Entre o começo do mês e agora, para caber também na janela de 30 dias.
  const ate = Math.max(inicio + 1_000, agora.getTime() - 60_000);
  return new Date(inicio + ((i * 7_919) % Math.max(1, ate - inicio))).toISOString();
}

function cobrada(i: number, organization_id: string, categoria: string | null): Linha {
  return {
    id: `mensagem-${organization_id.slice(0, 4)}-${String(i).padStart(6, "0")}`,
    organization_id,
    meta_billable: true,
    meta_pricing_category: categoria,
    created_at: nesteMes(i),
  };
}

function chamada(i: number, organization_id: string): Linha {
  return {
    id: `chamada-${String(i).padStart(6, "0")}`,
    organization_id,
    cost_cents: 3,
    total_tokens: 1_000,
    created_at: new Date(Date.now() - 60_000 - i * 1_000).toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/admin/custo-da-meta", () => {
  const pedir = async () => {
    const { GET } = await import("@/app/api/v1/admin/custo-da-meta/route");
    return GET(new NextRequest("http://localhost/api/v1/admin/custo-da-meta"));
  };

  it("2.500 mensagens cobradas no mês, em dois clientes: a conta de cada um fecha", async () => {
    const banco = postgrestComTeto({
      organizations: [
        { id: CLINICA, display_name: "Clínica Modelo", redacted_at: null, demonstracao: false },
        { id: ACADEMIA, display_name: "Academia Modelo", redacted_at: null, demonstracao: false },
      ],
      platform_precos_meta: PRECOS,
      messages: [
        ...Array.from({ length: 1_800 }, (_, i) => cobrada(i, CLINICA, "marketing")),
        ...Array.from({ length: 700 }, (_, i) => cobrada(i, ACADEMIA, "utility")),
      ],
    });
    ligar(banco);

    const res = await pedir();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { truncado: boolean; clientes: Array<{ organization_id: string; totalCentavos: number }> };
    };

    expect(data.truncado).toBe(false);
    expect(data.clientes.find((c) => c.organization_id === CLINICA)?.totalCentavos).toBe(1_800 * 40);
    expect(data.clientes.find((c) => c.organization_id === ACADEMIA)?.totalCentavos).toBe(700 * 5);
    expect(banco.pedidosEm("messages")).toBe(3);
  });

  it("controle negativo: a leitura antiga (.limit(50_000)) contava 1000 mensagens de 2.500", async () => {
    const banco = postgrestComTeto({
      messages: Array.from({ length: 2_500 }, (_, i) => cobrada(i, CLINICA, "marketing")),
    });

    const antiga = await banco.cliente
      .from("messages")
      .select("organization_id, meta_pricing_category")
      .eq("meta_billable", true)
      .limit(50_000);

    expect(antiga.data).toHaveLength(1_000);
    // E o `truncado` antigo comparava com 50.000: nunca ligava.
    expect((antiga.data ?? []).length >= 50_000).toBe(false);
  });

  it("acima do teto de páginas: o truncado que a tela já mostra passa a ligar", async () => {
    const banco = postgrestComTeto({
      organizations: [{ id: CLINICA, display_name: "Clínica Modelo", redacted_at: null, demonstracao: false }],
      platform_precos_meta: PRECOS,
      messages: Array.from({ length: 50_001 }, (_, i) => cobrada(i, CLINICA, "marketing")),
    });
    ligar(banco);

    const res = await pedir();
    const { data } = (await res.json()) as { data: { truncado: boolean } };

    expect(data.truncado).toBe(true);
    expect(banco.pedidosEm("messages")).toBe(50);
  });
});

describe("GET /api/v1/admin/tenants/[id]/usage", () => {
  const pedir = async () => {
    const { GET } = await import("@/app/api/v1/admin/tenants/[id]/usage/route");
    return GET(new NextRequest(`http://localhost/api/v1/admin/tenants/${CLINICA}/usage`), {
      params: Promise.resolve({ id: CLINICA }),
    });
  };

  it("2.500 chamadas de IA e 2.500 mensagens cobradas em 30 dias: custo e contagem fecham", async () => {
    const banco = postgrestComTeto({
      conversations: [],
      platform_precos_meta: PRECOS,
      llm_calls: [
        ...Array.from({ length: 2_500 }, (_, i) => chamada(i, CLINICA)),
        // De outro cliente: não entra.
        ...Array.from({ length: 300 }, (_, i) => chamada(90_000 + i, ACADEMIA)),
      ],
      messages: Array.from({ length: 2_500 }, (_, i) => cobrada(i, CLINICA, "marketing")),
    });
    ligar(banco);

    const res = await pedir();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        ia: { chamadas: number; tokens: number; custo_usd_cents: number; truncado: boolean };
        mensagens_cobradas: { total: number; totalCentavos: number; truncado: boolean };
      };
    };

    expect(data.ia).toEqual({ chamadas: 2_500, tokens: 2_500_000, custo_usd_cents: 7_500, truncado: false });
    expect(data.mensagens_cobradas).toMatchObject({ total: 2_500, totalCentavos: 100_000, truncado: false });
  });

  it("acima do teto de páginas: o truncado do custo de IA passa a ligar", async () => {
    const banco = postgrestComTeto({
      conversations: [],
      platform_precos_meta: PRECOS,
      llm_calls: Array.from({ length: 50_001 }, (_, i) => chamada(i, CLINICA)),
      messages: [],
    });
    ligar(banco);

    const res = await pedir();
    const { data } = (await res.json()) as { data: { ia: { chamadas: number; truncado: boolean } } };

    expect(data.ia.truncado).toBe(true);
    expect(data.ia.chamadas).toBe(50_000);
  });
});
