/**
 * FORK MIA (MIA-136) — O CONSUMO DE IA DA PLATAFORMA NO MCP, e a soma em R$ que
 * fecha com o total.
 *
 * Dois defeitos do mapa (MIA-54, seção 2.1, "Falta"):
 *
 *   1. `plataforma_ver_consumo_de_ia` só lia um cliente; a tela geral
 *      (`/admin/usage`) já mostrava a plataforma inteira. Agora
 *      `plataforma_ver_ranking_de_consumo_de_ia` traz as empresas em ordem de
 *      custo, sem as de demonstração, no mesmo período e com os mesmos números
 *      da tela geral, saídos da mesma leitura (`lerConsumoDoPeriodo`);
 *   2. cada linha arredondada sozinha fazia a soma dos agentes com o Sistema
 *      diferir do total em centavos. O total manda, e as linhas se ajustam
 *      (`fecharPeloTotal`).
 *
 * Dado fictício (Academia Alfa, Academia Beta, Academia Gama e uma empresa de
 * demonstração), no dublê que corta em 1000 linhas e aplica os filtros de
 * verdade (`tests/helpers/postgrest-com-teto.ts`).
 *
 *     npx vitest run --project produto tests/unit/consumo-de-ia-ranking-e-soma-que-fecha.test.ts
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  fecharPeloTotal,
  lerConsumoDoPeriodo,
  lerRankingDoConsumo,
  periodoDoPedido,
  type ConsumoDoPeriodo,
  type LinhaDeConsumo,
  type PeriodoDoConsumo,
  type RankingDoConsumo,
} from "@/lib/ai/usage/consumo-do-periodo";
import { FERRAMENTA_POR_NOME } from "@/lib/mcp-plataforma/ferramentas";
import type { ContextoDaFerramenta } from "@/lib/mcp-plataforma/tipos";
import { postgrestComTeto, type Linha } from "@/tests/helpers/postgrest-com-teto";

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn(async () => ({ user: { id: "admin-da-plataforma" } })),
  requirePlatformAdminEscrita: vi.fn(),
  falhaDaEscritaDePlatformAdmin: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ALFA = "a1a1a1a1-0000-4000-8000-000000000136";
const BETA = "b2b2b2b2-0000-4000-8000-000000000136";
const GAMA = "c3c3c3c3-0000-4000-8000-000000000136";
const DEMO = "d4d4d4d4-0000-4000-8000-000000000136";

const RECEPCAO = "a9e00000-0000-4000-8000-000000000136";
const VENDAS = "a9e00000-0000-4000-8000-000000000137";
const POS_VENDA = "a9e00000-0000-4000-8000-000000000138";

const ORGANIZACOES: Linha[] = [
  { id: ALFA, display_name: "Academia Alfa", slug: "academia-alfa", settings: {}, demonstracao: false },
  { id: BETA, display_name: "Academia Beta", slug: "academia-beta", settings: {}, demonstracao: false },
  // Sem a coluna: o `not is true` deixa passar, como no Postgres com nulo.
  { id: GAMA, display_name: "Academia Gama", slug: "academia-gama", settings: {} },
  { id: DEMO, display_name: "Empresa de Demonstração", slug: "demonstracao", settings: {}, demonstracao: true },
];

const AGENTES: Linha[] = [
  { id: RECEPCAO, organization_id: ALFA, name: "Recepção", archived_at: null, priority: 2, published_version_id: "v1" },
  { id: VENDAS, organization_id: ALFA, name: "Vendas", archived_at: null, priority: 1, published_version_id: "v2" },
  { id: POS_VENDA, organization_id: ALFA, name: "Pós-venda", archived_at: null, priority: 0, published_version_id: "v3" },
];

let seq = 0;
function chamada(campos: Partial<Linha> & { created_at: string }): Linha {
  seq++;
  return {
    id: `chamada-${String(seq).padStart(7, "0")}`,
    organization_id: ALFA,
    agent_id: null,
    purpose: "agent_turn",
    input_tokens: 10,
    output_tokens: 5,
    cache_read_tokens: 0,
    cost_cents: 0,
    contact_id: null,
    ...campos,
  };
}

/** Outubro de 2026 em Brasília: de 01/10 00:00 (03:00Z) a 01/11 00:00 (03:00Z). */
const OUTUBRO = periodoDoPedido({ mes: "2026-10" }) as PeriodoDoConsumo;

function banco(llm_calls: Linha[], platform_fx_rates: Linha[] = [{ dia: "2026-09-30", usd_brl: 5 }]) {
  return postgrestComTeto({
    organizations: ORGANIZACOES,
    ai_agents: AGENTES,
    contacts: [],
    messages: [],
    conversations: [],
    llm_calls,
    platform_fx_rates,
  });
}

const somaBrl = (linhas: readonly LinhaDeConsumo[]) =>
  Math.round(linhas.reduce((s, l) => s + l.custo_brl, 0) * 100) / 100;
const somaUsd = (linhas: readonly LinhaDeConsumo[]) =>
  Math.round(linhas.reduce((s, l) => s + l.custo_usd_cents, 0) * 10_000) / 10_000;

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
});

// ---------------------------------------------------------------------------
// 2. A soma que fecha
// ---------------------------------------------------------------------------

describe("fecharPeloTotal: o total manda, as partes se ajustam", () => {
  it("três terços de R$ 1,00 viram 0,34 + 0,33 + 0,33 (e não 0,99)", () => {
    const terco = 1 / 3;
    // O controle: arredondar cada linha sozinha, como antes, dava R$ 0,99.
    expect(3 * (Math.round(terco * 100) / 100)).toBeCloseTo(0.99, 10);

    const r = fecharPeloTotal(1, [terco, terco, terco], 2);
    expect(r.total).toBe(1);
    expect(r.partes).toEqual([0.34, 0.33, 0.33]);
  });

  it("o centavo que falta vai para a maior fração, e cada parte fica no seu valor para baixo ou para cima", () => {
    const partes = [0.334, 0.336, 0.332];
    const r = fecharPeloTotal(1.002, partes, 2);
    expect(r.total).toBe(1);
    expect(r.partes).toEqual([0.33, 0.34, 0.33]);
  });

  it("resíduo de ponto flutuante não tira centavo: 0,1 + 0,2 é 0,30", () => {
    const r = fecharPeloTotal(0.1 + 0.2, [0.1, 0.2], 2);
    expect(r).toEqual({ total: 0.3, partes: [0.1, 0.2] });
  });

  it("parte zero continua zero, e lista vazia dá zero", () => {
    expect(fecharPeloTotal(0.5, [0.5, 0, 0], 2).partes).toEqual([0.5, 0, 0]);
    expect(fecharPeloTotal(0, [], 2)).toEqual({ total: 0, partes: [] });
  });

  it("em US$ (4 casas de centavo) também fecha", () => {
    const r = fecharPeloTotal(0.00005 * 3, [0.00005, 0.00005, 0.00005], 4);
    expect(Math.round(r.partes.reduce((s, n) => s + n, 0) * 10_000)).toBe(Math.round(r.total * 10_000));
  });

  it("varredura: 500 partições aleatórias, a soma das partes é sempre o total", () => {
    let semente = 136;
    const aleatorio = () => ((semente = (semente * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
    for (let caso = 0; caso < 500; caso++) {
      const partes = Array.from({ length: 1 + Math.floor(aleatorio() * 12) }, () => aleatorio() * 3);
      const exato = partes.reduce((s, n) => s + n, 0);
      const r = fecharPeloTotal(exato, partes, 2);
      expect(Math.round(r.partes.reduce((s, n) => s + n, 0) * 100), `caso ${caso}`).toBe(Math.round(r.total * 100));
      expect(r.total).toBe(Math.round(exato * 100) / 100);
      r.partes.forEach((p, i) => expect(Math.abs(p - partes[i]!)).toBeLessThan(0.01 + 1e-9));
    }
  });
});

describe("a aba Uso e plataforma_ver_consumo_de_ia: agentes + Sistema fecham com o total", () => {
  // Cada agente gasta 6,68 centavos de dólar a R$ 5: R$ 0,334 cada, e o
  // Sistema R$ 0,334 também. Total exato R$ 1,336 = R$ 1,34. Cada linha sozinha
  // dava R$ 0,33, e 4 × 0,33 = R$ 1,32: dois centavos de diferença.
  const chamadas = () => [
    chamada({ agent_id: RECEPCAO, cost_cents: 6.68, created_at: "2026-10-10T12:00:00Z" }),
    chamada({ agent_id: VENDAS, cost_cents: 6.68, created_at: "2026-10-11T12:00:00Z", purpose: "checkpoint" }),
    chamada({ agent_id: POS_VENDA, cost_cents: 6.68, created_at: "2026-10-12T12:00:00Z", purpose: "classifier" }),
    chamada({ agent_id: null, cost_cents: 6.68, created_at: "2026-10-13T12:00:00Z", purpose: "transcription" }),
  ];

  async function ler(): Promise<ConsumoDoPeriodo> {
    const r = await lerConsumoDoPeriodo(banco(chamadas()).cliente as never, ALFA, OUTUBRO);
    expect("erro" in r).toBe(false);
    return r as ConsumoDoPeriodo;
  }

  it("o total é o exato arredondado, e os agentes com o Sistema somam exatamente ele", async () => {
    const c = await ler();
    expect(c.total.custo_brl).toBe(1.34);
    expect(somaBrl([...c.por_agente, c.sistema])).toBe(c.total.custo_brl);
    expect(somaUsd([...c.por_agente, c.sistema])).toBe(c.total.custo_usd_cents);
    // Cada linha fica a menos de um centavo do exato (R$ 0,334).
    for (const l of [...c.por_agente, c.sistema]) expect([0.33, 0.34]).toContain(l.custo_brl);
  });

  it("as finalidades também somam o total", async () => {
    const c = await ler();
    expect(c.por_finalidade).toHaveLength(4);
    expect(somaBrl(c.por_finalidade)).toBe(c.total.custo_brl);
    expect(somaUsd(c.por_finalidade)).toBe(c.total.custo_usd_cents);
  });

  it("a rota da aba Uso e o MCP devolvem as linhas já fechadas", async () => {
    const b = banco(chamadas());
    vi.mocked(createAdminClient).mockReturnValue(b.cliente as never);
    const ferramenta = FERRAMENTA_POR_NOME.get("plataforma_ver_consumo_de_ia")!;
    const ctx = { admin: b.cliente } as unknown as ContextoDaFerramenta;
    const doMcp = (await ferramenta.handler(ctx, { organization_id: ALFA, mes: "2026-10" })) as ConsumoDoPeriodo;
    expect(somaBrl([...doMcp.por_agente, doMcp.sistema])).toBe(doMcp.total.custo_brl);
    expect(doMcp.total.custo_brl).toBe(1.34);
  });
});

// ---------------------------------------------------------------------------
// 1. O ranking da plataforma
// ---------------------------------------------------------------------------

/**
 * Outubro: a Beta gasta mais que a Alfa; a demonstração gasta mais que as duas
 * (e fica de fora); a Gama não gasta nada. Nas pontas de Brasília, a Alfa tem
 * uma chamada às 22h de 31/10 (é de outubro) e uma às 23h59 de 30/09 tão cara
 * que, se entrasse, passaria a Beta.
 */
function chamadasDoRanking(): Linha[] {
  return [
    chamada({ organization_id: ALFA, agent_id: RECEPCAO, cost_cents: 30, created_at: "2026-10-05T15:00:00Z" }),
    // 31/10 às 22h em Brasília = 01/11 01:00Z: é de OUTUBRO.
    chamada({ organization_id: ALFA, agent_id: null, cost_cents: 10, created_at: "2026-11-01T01:00:00Z" }),
    // 30/09 às 23:59 em Brasília = 01/10 02:59Z: é de SETEMBRO.
    chamada({ organization_id: ALFA, agent_id: RECEPCAO, cost_cents: 5000, created_at: "2026-10-01T02:59:00Z" }),
    // 01/11 à 00:00 em Brasília: já é novembro (fim exclusivo).
    chamada({ organization_id: ALFA, agent_id: RECEPCAO, cost_cents: 5000, created_at: "2026-11-01T03:00:00Z" }),
    chamada({ organization_id: BETA, cost_cents: 25, created_at: "2026-10-02T12:00:00Z" }),
    chamada({ organization_id: BETA, cost_cents: 25, created_at: "2026-10-20T12:00:00Z" }),
    chamada({ organization_id: BETA, cost_cents: null, created_at: "2026-10-21T12:00:00Z" }),
    chamada({ organization_id: DEMO, cost_cents: 9000, created_at: "2026-10-15T12:00:00Z" }),
  ];
}

async function ranking(llm: Linha[], fx?: Linha[], periodo = OUTUBRO): Promise<RankingDoConsumo> {
  const r = await lerRankingDoConsumo(banco(llm, fx).cliente as never, periodo);
  expect("erro" in r, (r as { erro?: string }).erro).toBe(false);
  return r as RankingDoConsumo;
}

describe("lerRankingDoConsumo: a plataforma inteira, em ordem de custo", () => {
  it("a demonstração fica de fora, a ordem é por custo, e quem não gastou vem com zero no fim", async () => {
    const r = await ranking(chamadasDoRanking());
    expect(r.empresas.map((e) => [e.posicao, e.empresa, e.custo_usd_cents])).toEqual([
      [1, "Academia Beta", 50],
      [2, "Academia Alfa", 40],
      [3, "Academia Gama", 0],
    ]);
    expect(r.empresas.map((e) => e.organization_id)).not.toContain(DEMO);
    expect(r.total).toMatchObject({ chamadas: 5, custo_usd_cents: 90, sem_preco: 1 });
  });

  it("o mês é o de Brasília: 22h de 31/10 entra, 23h59 de 30/09 e 00:00 de 01/11 não", async () => {
    const r = await ranking(chamadasDoRanking());
    const alfa = r.empresas.find((e) => e.organization_id === ALFA)!;
    expect(alfa).toMatchObject({ chamadas: 2, custo_usd_cents: 40 });
    expect(r.periodo).toMatchObject({ inicio: "2026-10-01T03:00:00.000Z", fim: "2026-11-01T03:00:00.000Z" });
  });

  it("cada empresa tem os números da aba Uso dela (a mesma leitura)", async () => {
    const r = await ranking(chamadasDoRanking());
    for (const org of [ALFA, BETA, GAMA]) {
      const sozinha = (await lerConsumoDoPeriodo(banco(chamadasDoRanking()).cliente as never, org, OUTUBRO)) as ConsumoDoPeriodo;
      const linha = r.empresas.find((e) => e.organization_id === org)!;
      for (const campo of ["chamadas", "tokens_entrada", "tokens_saida", "tokens_do_cache", "custo_usd_cents", "custo_brl", "sem_preco"] as const) {
        expect(linha[campo], `${org} ${campo}`).toBe(sozinha.total[campo]);
      }
    }
  });

  it("a soma das empresas fecha com o total da plataforma em R$ e em US$", async () => {
    // Três empresas de R$ 0,334 cada (6,68 centavos de dólar a R$ 5): total
    // R$ 1,00; cada uma sozinha dava R$ 0,33, e a soma, R$ 0,99.
    const r = await ranking([
      chamada({ organization_id: ALFA, cost_cents: 6.68, created_at: "2026-10-10T12:00:00Z" }),
      chamada({ organization_id: BETA, cost_cents: 6.68, created_at: "2026-10-10T12:00:00Z" }),
      chamada({ organization_id: GAMA, cost_cents: 6.68, created_at: "2026-10-10T12:00:00Z" }),
    ]);
    expect(r.total.custo_brl).toBe(1);
    expect(somaBrl(r.empresas)).toBe(r.total.custo_brl);
    expect(somaUsd(r.empresas)).toBe(r.total.custo_usd_cents);
  });

  it("dia sem cotação é dito, na empresa e na plataforma", async () => {
    const r = await ranking(
      [chamada({ organization_id: BETA, cost_cents: 10, created_at: "2026-10-10T12:00:00Z" })],
      [],
    );
    expect(r.reais.dias_sem_cotacao).toEqual(["2026-10-10"]);
    expect(r.empresas.find((e) => e.organization_id === BETA)!.dias_sem_cotacao).toEqual(["2026-10-10"]);
    expect(r.total.custo_brl).toBe(0);
  });

  it("leitura que falha é erro, nunca zero", async () => {
    const b = postgrestComTeto(
      { organizations: ORGANIZACOES, ai_agents: [], llm_calls: chamadasDoRanking(), platform_fx_rates: [] },
      { falhaEm: (_n, tabela) => (tabela === "llm_calls" ? "banco fora do ar" : null) },
    );
    const r = await lerRankingDoConsumo(b.cliente as never, OUTUBRO);
    expect(r).toEqual({ erro: "banco fora do ar" });
  });
});

describe("plataforma_ver_ranking_de_consumo_de_ia: o MCP e a tela geral dão o mesmo número", () => {
  async function doMcp(args: Record<string, unknown>, llm = chamadasDoRanking()) {
    const ferramenta = FERRAMENTA_POR_NOME.get("plataforma_ver_ranking_de_consumo_de_ia")!;
    const ctx = { admin: banco(llm).cliente, autorUserId: "u", tokenId: "t", requestId: "r" } as unknown as ContextoDaFerramenta;
    return (await ferramenta.handler(ctx, args)) as {
      mes: string | null;
      total: LinhaDeConsumo;
      empresas: Array<LinhaDeConsumo & { organization_id: string; empresa: string; posicao: number }>;
      empresas_no_total: number;
    };
  }

  it("só lê (sem operação) e o exemplo passa no próprio esquema", async () => {
    const ferramenta = FERRAMENTA_POR_NOME.get("plataforma_ver_ranking_de_consumo_de_ia");
    expect(ferramenta?.operacao).toBeNull();
    const { z } = await import("zod");
    expect(z.object(ferramenta!.inputSchema).safeParse(ferramenta!.exemplo).success).toBe(true);
  });

  it("as mesmas empresas, na mesma ordem e com o mesmo custo da tela geral (`/api/v1/admin/usage?mes=`)", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco(chamadasDoRanking()).cliente as never);
    const { GET } = await import("@/app/api/v1/admin/usage/route");
    const res = await GET(new NextRequest("http://localhost/api/v1/admin/usage?mes=2026-10"));
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { tenants: Array<{ organization_id: string; ai_cost_cents: number; ai_invocations_count: number }>; reais: { total: number } };
    };

    const mcp = await doMcp({ mes: "2026-10" });
    expect(mcp.mes).toBe("2026-10");
    expect(mcp.empresas.map((e) => [e.organization_id, e.custo_usd_cents, e.chamadas])).toEqual(
      data.tenants.map((t) => [t.organization_id, t.ai_cost_cents, t.ai_invocations_count]),
    );
    // O R$ da plataforma é o da tela geral, arredondado ao centavo.
    expect(mcp.total.custo_brl).toBe(Math.round(data.reais.total * 100) / 100);
  });

  it("`limite` corta a lista, não o total", async () => {
    const mcp = await doMcp({ mes: "2026-10", limite: 1 });
    expect(mcp.empresas.map((e) => e.empresa)).toEqual(["Academia Beta"]);
    expect(mcp.empresas_no_total).toBe(3);
    expect(mcp.total.custo_usd_cents).toBe(90);
  });

  it("mês fora do formato é recusado com o exemplo certo", async () => {
    await expect(doMcp({ mes: "2026-10-01" })).rejects.toThrow(/AAAA-MM/);
  });
});
