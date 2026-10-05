/**
 * FORK MIA — O RELATÓRIO DE VENDAS E AS METAS NÃO PARAM NA LINHA 1000.
 *
 * ## O defeito
 *
 * O PostgREST de produção devolve no máximo 1000 linhas por pedido
 * (`PGRST_DB_MAX_ROWS`), sem erro. As duas rotas pediam `.limit(50_000)` e
 * `.limit(10_000)`, recebiam 1000 e somavam no JavaScript: numa casa com mais
 * de 1000 fechamentos no período, a taxa de ganho, a receita do mês e a barra
 * da meta saíam de um recorte arbitrário, com cara de total.
 *
 * ## O que cada caso prova
 *
 *  1. 2.500 linhas no período, servidor que corta em 1000: o total é o certo;
 *  2. controle negativo: a leitura ANTIGA, contra o mesmo servidor, traz 1000 e
 *     a mesma conta dá um número menor. É este vermelho que a paginação derruba;
 *  3. acima do teto de páginas: a resposta diz `truncado`, e o mês pedido (o
 *     mais recente) continua inteiro;
 *  4. página que falha no meio: 500, e não um total pela metade.
 *
 * O dublê é `tests/helpers/postgrest-com-teto.ts`: ele aplica os filtros e corta
 * em 1000 como o servidor, então apagar o `organization_id` da rota também
 * reprova.
 *
 *     npx vitest run --project produto tests/unit/relatorios-nao-param-na-linha-1000.test.ts
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import { resumoDoMes, type LeadFechadoComPrazo } from "@/lib/crm/metas/progresso";
import { taxaDeGanho, type LeadDoRelatorio } from "@/lib/crm/relatorio/vendas";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { postgrestComTeto, type Linha, type PostgrestComTeto } from "@/tests/helpers/postgrest-com-teto";

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const FUNIL = "44444444-4444-4444-8444-444444444444";
const VENDEDORA = "55555555-5555-4555-8555-555555555555";
const PERIODO = "2026-09";

function sessao(): void {
  const user: AuthUser = {
    id: VENDEDORA,
    email: "gestora@empresa-modelo.example",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR" as const,
    organizations: [{ organization_id: ORG, organization_name: "Empresa Modelo", role: "manager" }],
  };
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user,
    org: { orgId: ORG, name: "Empresa Modelo", role: "manager" },
  });
}

function ligar(banco: PostgrestComTeto): void {
  vi.mocked(createClient).mockResolvedValue(banco.cliente as never);
}

/** Um instante dentro de setembro de 2026, espalhado pelo mês (UTC). */
function emSetembro(i: number): string {
  return new Date(Date.parse("2026-09-01T12:00:00.000Z") + (i % 28) * 86_400_000 + i * 1_000).toISOString();
}

/** Negócio fechado: ganho de R$ 100,00 ou perdido, sempre em setembro. */
function negocio(i: number, over: Linha = {}): Linha {
  return {
    id: `negocio-${String(i).padStart(6, "0")}`,
    organization_id: ORG,
    status: "won",
    pipeline_id: FUNIL,
    value_cents: 10_000,
    revenue_kind: "avulso",
    recurring_months: null,
    lost_reason: null,
    owner_user_id: VENDEDORA,
    originated_by_user_id: null,
    created_at: "2026-08-20T12:00:00.000Z",
    closed_at: emSetembro(i),
    ...over,
  };
}

function reuniao(i: number, over: Linha = {}): Linha {
  return {
    id: `reuniao-${String(i).padStart(6, "0")}`,
    organization_id: ORG,
    created_by_user_id: VENDEDORA,
    created_by_agent_id: null,
    created_at: emSetembro(i),
    status: "completed",
    ...over,
  };
}

const base = (extra: Record<string, Linha[]>) => ({
  organizations: [{ id: ORG, timezone: "UTC" }],
  crm_pipelines: [{ id: FUNIL, organization_id: ORG, settings: {} }],
  sales_targets: [],
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/relatorio-de-vendas", () => {
  const pedir = async () => {
    const { GET } = await import("@/app/api/v1/relatorio-de-vendas/route");
    return GET(new NextRequest(`http://localhost/api/v1/relatorio-de-vendas?periodo=${PERIODO}`));
  };

  it("2.500 negócios fechados no mês: conta os 2.500, e a receita fecha", async () => {
    sessao();
    // 1.500 ganhos e 1.000 perdidos, intercalados; e 300 de OUTRA organização,
    // que não podem entrar na conta.
    const leads = [
      ...Array.from({ length: 2_500 }, (_, i) =>
        negocio(i, i % 5 < 3 ? {} : { status: "lost", lost_reason: "price", value_cents: 5_000 }),
      ),
      ...Array.from({ length: 300 }, (_, i) => negocio(90_000 + i, { organization_id: OUTRA_ORG })),
    ];
    const banco = postgrestComTeto(base({ crm_leads: leads }));
    ligar(banco);

    const res = await pedir();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        truncado: boolean;
        taxa_de_ganho: { ganhos: number; perdidos: number; taxa: number };
        ciclo_de_venda: { vendas: number };
        motivos_de_perda: Array<{ motivo: string; quantidade: number; valorCents: number }>;
        historico: Array<{ periodo: string; receitaCents: number; vendas: number; perdas: number }>;
      };
    };

    expect(data.truncado).toBe(false);
    expect(data.taxa_de_ganho).toEqual({ ganhos: 1_500, perdidos: 1_000, taxa: 0.6 });
    expect(data.ciclo_de_venda.vendas).toBe(1_500);
    expect(data.motivos_de_perda).toEqual([{ motivo: "price", quantidade: 1_000, valorCents: 5_000_000 }]);
    const setembro = data.historico.find((m) => m.periodo === PERIODO);
    expect(setembro).toMatchObject({ receitaCents: 15_000_000, vendas: 1_500, perdas: 1_000 });
    // 1000 + 1000 + 500: três idas, e nenhuma delas sem `range`.
    expect(banco.pedidosEm("crm_leads")).toBe(3);
    expect(banco.pedidos.filter((p) => p.tabela === "crm_leads").every((p) => p.range !== null)).toBe(true);
  });

  it("controle negativo: a leitura antiga (.limit(50_000)) contaria 1000 fechamentos em vez de 2.500", async () => {
    const leads = Array.from({ length: 2_500 }, (_, i) =>
      negocio(i, i % 5 < 3 ? {} : { status: "lost", lost_reason: "price", value_cents: 5_000 }),
    );
    const banco = postgrestComTeto(base({ crm_leads: leads }));

    // A consulta exatamente como a rota fazia antes.
    const antiga = await banco.cliente
      .from("crm_leads")
      .select("status, pipeline_id, value_cents, revenue_kind, recurring_months, lost_reason, created_at, closed_at")
      .eq("organization_id", ORG)
      .not("closed_at", "is", null)
      .gte("closed_at", "2026-04-01T00:00:00.000Z")
      .lt("closed_at", "2026-10-01T00:00:00.000Z")
      .limit(50_000);

    expect(antiga.error).toBeNull();
    expect(antiga.data).toHaveLength(1_000);
    const taxaAntiga = taxaDeGanho((antiga.data ?? []) as unknown as LeadDoRelatorio[], PERIODO, "UTC", null);
    // A mesma função pura, o mesmo banco: 1000 fechamentos no lugar de 2.500.
    expect(taxaAntiga.ganhos + taxaAntiga.perdidos).toBe(1_000);
    expect(taxaAntiga.ganhos).toBeLessThan(1_500);
    expect(taxaAntiga.perdidos).toBeLessThan(1_000);
  });

  it("acima do teto de páginas: truncado, e o mês pedido continua inteiro", async () => {
    sessao();
    // 800 ganhos em setembro (o mês pedido) e 50.000 fechamentos em maio: 50.800
    // linhas na série, 800 acima das 50 páginas.
    const maio = Date.parse("2026-05-10T12:00:00.000Z");
    const leads = [
      ...Array.from({ length: 50_000 }, (_, i) =>
        negocio(100_000 + i, { status: "lost", closed_at: new Date(maio + i * 1_000).toISOString() }),
      ),
      ...Array.from({ length: 800 }, (_, i) => negocio(i)),
    ];
    const banco = postgrestComTeto(base({ crm_leads: leads }));
    ligar(banco);

    const res = await pedir();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        truncado: boolean;
        taxa_de_ganho: { ganhos: number; perdidos: number };
        historico: Array<{ periodo: string; perdas: number; vendas: number }>;
      };
    };

    expect(data.truncado).toBe(true);
    // Lido do fechamento mais novo para o mais antigo: setembro veio inteiro…
    expect(data.taxa_de_ganho.ganhos).toBe(800);
    // …e o que ficou de fora é do mês mais antigo, que a tela avisa.
    const deMaio = data.historico.find((m) => m.periodo === "2026-05");
    expect(deMaio?.perdas).toBe(49_200);
    expect(banco.pedidosEm("crm_leads")).toBe(50);
  });

  it("página que falha no meio: 500, e não um relatório pela metade", async () => {
    sessao();
    const leads = Array.from({ length: 2_500 }, (_, i) => negocio(i));
    let idasAosNegocios = 0;
    const banco = postgrestComTeto(base({ crm_leads: leads }), {
      falhaEm: (_n, tabela) => {
        if (tabela !== "crm_leads") return null;
        idasAosNegocios += 1;
        return idasAosNegocios === 2 ? "canceling statement due to statement timeout" : null;
      },
    });
    ligar(banco);

    const res = await pedir();
    expect(res.status).toBe(500);
  });
});

describe("GET /api/v1/metas", () => {
  const pedir = async () => {
    const { GET } = await import("@/app/api/v1/metas/route");
    return GET(new NextRequest(`http://localhost/api/v1/metas?periodo=${PERIODO}`));
  };

  const meta = (metrica: string, alvo: Linha): Linha => ({
    id: `meta-${metrica}`,
    organization_id: ORG,
    periodo: `${PERIODO}-01`,
    metrica,
    alvo_cents: null,
    alvo_quantidade: null,
    user_id: null,
    agent_id: null,
    ...alvo,
  });

  it("2.500 vendas e 2.500 reuniões no mês: o realizado das duas metas é o total", async () => {
    sessao();
    const banco = postgrestComTeto(
      base({
        sales_targets: [
          meta("receita_total", { alvo_cents: 50_000_000 }),
          meta("reunioes", { alvo_quantidade: 5_000 }),
        ],
        crm_leads: [
          ...Array.from({ length: 2_500 }, (_, i) => negocio(i)),
          ...Array.from({ length: 300 }, (_, i) => negocio(90_000 + i, { organization_id: OUTRA_ORG })),
        ],
        // 2.500 de pé e 200 canceladas, que não contam como marcadas.
        calendar_appointments: [
          ...Array.from({ length: 2_500 }, (_, i) => reuniao(i, i % 2 === 0 ? {} : { status: "no_show" })),
          ...Array.from({ length: 200 }, (_, i) => reuniao(50_000 + i, { status: "cancelled" })),
        ],
      }),
    );
    ligar(banco);

    const res = await pedir();
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        truncado: boolean;
        metas: Array<{ metrica: string; realizado: number; fracao: number }>;
        resumo: { total: number; avulso: number };
        reunioes: { marcadas: number; realizadas: number; faltas: number };
        reunioes_no_mes: number;
      };
    };

    expect(data.truncado).toBe(false);
    expect(data.metas.find((m) => m.metrica === "receita_total")).toMatchObject({
      realizado: 25_000_000,
      fracao: 0.5,
    });
    expect(data.metas.find((m) => m.metrica === "reunioes")).toMatchObject({ realizado: 2_500, fracao: 0.5 });
    expect(data.resumo).toMatchObject({ total: 25_000_000, avulso: 25_000_000 });
    expect(data.reunioes).toMatchObject({ marcadas: 2_500, realizadas: 1_250, faltas: 1_250 });
    expect(data.reunioes_no_mes).toBe(2_500);
    // 1000 + 1000 + 500 nas vendas; 1000 + 1000 + 700 nas reuniões (com as canceladas).
    expect(banco.pedidosEm("crm_leads")).toBe(3);
    expect(banco.pedidosEm("calendar_appointments")).toBe(3);
  });

  it("controle negativo: a leitura antiga (.limit(10_000)) somaria R$ 100 mil em vez de R$ 250 mil", async () => {
    const banco = postgrestComTeto(base({ crm_leads: Array.from({ length: 2_500 }, (_, i) => negocio(i)) }));

    const antiga = await banco.cliente
      .from("crm_leads")
      .select("status, value_cents, revenue_kind, recurring_months, owner_user_id, originated_by_user_id, closed_at, pipeline_id")
      .eq("organization_id", ORG)
      .eq("status", "won")
      .gte("closed_at", "2026-09-01T00:00:00.000Z")
      .lt("closed_at", "2026-10-01T00:00:00.000Z")
      .limit(10_000);

    expect(antiga.error).toBeNull();
    expect(antiga.data).toHaveLength(1_000);
    const resumoAntigo = resumoDoMes(
      (antiga.data ?? []) as unknown as LeadFechadoComPrazo[],
      `${PERIODO}-01`,
      null,
      "UTC",
    );
    expect(resumoAntigo.total).toBe(10_000_000);
    expect(resumoAntigo.total).not.toBe(25_000_000);
  });

  it("acima do teto de páginas em qualquer das duas leituras: truncado", async () => {
    sessao();
    const banco = postgrestComTeto(
      base({
        crm_leads: Array.from({ length: 400 }, (_, i) => negocio(i)),
        calendar_appointments: Array.from({ length: 10_001 }, (_, i) => reuniao(i)),
      }),
    );
    ligar(banco);

    const res = await pedir();
    const { data } = (await res.json()) as {
      data: { truncado: boolean; resumo: { total: number }; reunioes: { marcadas: number } };
    };

    expect(data.truncado).toBe(true);
    // A leitura que coube continua exata; a que não coube traz o que o teto deixa.
    expect(data.resumo.total).toBe(4_000_000);
    expect(data.reunioes.marcadas).toBe(10_000);
    expect(banco.pedidosEm("calendar_appointments")).toBe(10);
  });

  it("página que falha no meio: 500, e não um mês com zero vendas", async () => {
    sessao();
    let idas = 0;
    const banco = postgrestComTeto(
      base({ crm_leads: Array.from({ length: 2_500 }, (_, i) => negocio(i)), calendar_appointments: [] }),
      {
        falhaEm: (_n, tabela) => {
          if (tabela !== "crm_leads") return null;
          idas += 1;
          return idas === 3 ? "canceling statement due to statement timeout" : null;
        },
      },
    );
    ligar(banco);

    const res = await pedir();
    expect(res.status).toBe(500);
  });
});
