/**
 * FORK MIA (MIA-44) — O CONSUMO DE IA DE UM CLIENTE POR MÊS E POR AGENTE.
 *
 * `lib/ai/usage/consumo-do-periodo.ts` é a leitura que a aba Uso do cliente e a
 * ferramenta `plataforma_ver_consumo_de_ia` devolvem. Aqui, com dado fictício
 * (a Academia Alfa, com 2 agentes) e um PostgREST de mentira que corta em 1000
 * linhas como o de verdade:
 *
 *   · mais de 1000 chamadas no mês fecham o total (paginação), e acima do teto
 *     de páginas a leitura diz que foi cortada;
 *   · cada agente separado, e a linha "Sistema" com as chamadas sem agente;
 *   · os tokens do cache contados como parte da entrada;
 *   · a virada do mês no horário de Brasília (22h do último dia é do mês que
 *     termina), com o processo em TZ=America/Sao_Paulo e em TZ=UTC;
 *   · o real convertido pela cotação de cada dia, e o dia sem cotação dito;
 *   · a rota e o MCP devolvendo os mesmos números.
 *
 *     npx vitest run --project produto tests/unit/consumo-de-ia-por-mes-e-por-agente.test.ts
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  diaEmBrasilia,
  lerConsumoDoPeriodo,
  mesAtualEAnterior,
  periodoDoPedido,
  type ConsumoDoPeriodo,
  type FalhaDoConsumo,
  type PeriodoDoConsumo,
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

const ACADEMIA = "a1a1a1a1-0000-4000-8000-000000000001";
const OUTRA = "b2b2b2b2-0000-4000-8000-000000000002";
const RECEPCAO = "a9e00000-0000-4000-8000-00000000000a";
const VENDAS = "a9e00000-0000-4000-8000-00000000000b";
const ARQUIVADO = "a9e00000-0000-4000-8000-00000000000c";
const REMOVIDO = "a9e00000-0000-4000-8000-00000000000d";

const ORGANIZACOES: Linha[] = [
  { id: ACADEMIA, display_name: "Academia Alfa", settings: {}, demonstracao: false },
  { id: OUTRA, display_name: "Estúdio Beta", settings: {}, demonstracao: false },
];

const AGENTES: Linha[] = [
  { id: RECEPCAO, organization_id: ACADEMIA, name: "Recepção", archived_at: null },
  { id: VENDAS, organization_id: ACADEMIA, name: "Vendas", archived_at: null },
  { id: ARQUIVADO, organization_id: ACADEMIA, name: "Antigo", archived_at: "2026-09-01T00:00:00Z" },
  { id: "c3c3c3c3-0000-4000-8000-000000000003", organization_id: OUTRA, name: "Atendente", archived_at: null },
];

let seq = 0;
function chamada(campos: Partial<Linha> & { created_at: string }): Linha {
  seq++;
  return {
    id: `chamada-${String(seq).padStart(7, "0")}`,
    organization_id: ACADEMIA,
    agent_id: null,
    purpose: "agent_turn",
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cost_cents: 0,
    ...campos,
  };
}

/** Outubro de 2026 em Brasília: de 01/10 00:00 (03:00Z) a 01/11 00:00 (03:00Z). */
const OUTUBRO = periodoDoPedido({ mes: "2026-10" }) as PeriodoDoConsumo;

function banco(llm_calls: Linha[], platform_fx_rates: Linha[] = [{ dia: "2026-09-30", usd_brl: 5 }]) {
  return postgrestComTeto({ organizations: ORGANIZACOES, ai_agents: AGENTES, llm_calls, platform_fx_rates });
}

async function ler(llm_calls: Linha[], fx?: Linha[], periodo = OUTUBRO): Promise<ConsumoDoPeriodo> {
  const r = await lerConsumoDoPeriodo(banco(llm_calls, fx).cliente as never, ACADEMIA, periodo);
  expect("erro" in r, (r as FalhaDoConsumo).erro).toBe(false);
  return r as ConsumoDoPeriodo;
}

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
});

describe("o período", () => {
  const TZ_ORIGINAL = process.env.TZ;
  afterEach(() => {
    process.env.TZ = TZ_ORIGINAL;
  });

  for (const tz of ["America/Sao_Paulo", "UTC"]) {
    it(`com TZ=${tz}: o mês é o de Brasília, e 22h do último dia é do mês que termina`, async () => {
      process.env.TZ = tz;
      // O processo trocou mesmo de fuso: sem isto o teste rodaria duas vezes no mesmo.
      expect(new Date("2026-10-15T12:00:00Z").getTimezoneOffset()).toBe(tz === "UTC" ? 0 : 180);

      const outubro = periodoDoPedido({ mes: "2026-10" })!;
      expect(outubro).toMatchObject({
        tipo: "mes",
        mes: "2026-10",
        dias: 31,
        inicio: "2026-10-01T03:00:00.000Z",
        fim: "2026-11-01T03:00:00.000Z",
        fuso: "America/Sao_Paulo",
      });

      const consumo = await ler(
        [
          // 31/10 às 22h em Brasília = 01/11 01:00Z: é de OUTUBRO.
          chamada({ agent_id: RECEPCAO, created_at: "2026-11-01T01:00:00Z", cost_cents: 10 }),
          // 30/09 às 23:59 em Brasília = 01/10 02:59Z: é de SETEMBRO.
          chamada({ agent_id: RECEPCAO, created_at: "2026-10-01T02:59:00Z", cost_cents: 1000 }),
          // 01/10 à 00:00 em Brasília: o primeiro instante de outubro.
          chamada({ agent_id: RECEPCAO, created_at: "2026-10-01T03:00:00Z", cost_cents: 1 }),
          // 01/11 à 00:00 em Brasília: já é novembro (fim exclusivo).
          chamada({ agent_id: RECEPCAO, created_at: "2026-11-01T03:00:00Z", cost_cents: 2000 }),
        ],
        [
          { dia: "2026-10-01", usd_brl: 5 },
          { dia: "2026-10-31", usd_brl: 6 },
          { dia: "2026-11-01", usd_brl: 9 },
        ],
        outubro,
      );

      expect(consumo.total.chamadas).toBe(2);
      expect(consumo.total.custo_usd_cents).toBe(11);
      // A das 22h do dia 31 é convertida pela cotação do dia 31 (6), não a do dia 1º de novembro.
      expect(diaEmBrasilia("2026-11-01T01:00:00Z")).toBe("2026-10-31");
      expect(consumo.total.custo_brl).toBe(Math.round((0.1 * 6 + 0.01 * 5) * 100) / 100);
    });
  }

  it("mes fora do formato não vira a janela padrão: é null (a rota responde 400)", () => {
    expect(periodoDoPedido({ mes: "2026-13" })).toBeNull();
    expect(periodoDoPedido({ mes: "outubro" })).toBeNull();
    expect(periodoDoPedido({ mes: "2026-1" })).toBeNull();
  });

  it("dias: 30 por padrão, limitado a 1..180, como a rota já fazia; mes vence dias", () => {
    const agora = new Date("2026-11-18T12:00:00Z");
    // MIA-78: os 30 dias do calendário em Brasília terminados hoje (20/10 a 18/11).
    expect(periodoDoPedido({}, agora)).toMatchObject({
      tipo: "dias",
      dias: 30,
      inicio: "2026-10-20T03:00:00.000Z",
      fim: "2026-11-19T03:00:00.000Z",
    });
    expect(periodoDoPedido({ dias: "999" }, agora)?.dias).toBe(180);
    expect(periodoDoPedido({ dias: "0" }, agora)?.dias).toBe(30);
    expect(periodoDoPedido({ dias: "-4" }, agora)?.dias).toBe(1);
    expect(periodoDoPedido({ dias: "7", mes: "2026-02" }, agora)).toMatchObject({ tipo: "mes", dias: 28 });
  });

  it("o mês atual e o anterior são os de Brasília, inclusive na virada do ano", () => {
    // 01/01/2027 01:00Z = 31/12/2026 22h em Brasília.
    expect(mesAtualEAnterior(new Date("2027-01-01T01:00:00Z"))).toEqual({ atual: "2026-12", anterior: "2026-11" });
    expect(mesAtualEAnterior(new Date("2027-01-01T04:00:00Z"))).toEqual({ atual: "2027-01", anterior: "2026-12" });
  });
});

describe("as quebras", () => {
  it("agente x Sistema: cada agente na sua linha, os sem chamada com zero, e o Sistema separado", async () => {
    const consumo = await ler([
      chamada({ agent_id: RECEPCAO, created_at: "2026-10-05T15:00:00Z", input_tokens: 1000, output_tokens: 100, cost_cents: 4 }),
      chamada({ agent_id: RECEPCAO, created_at: "2026-10-06T15:00:00Z", input_tokens: 500, output_tokens: 50, cost_cents: 2 }),
      chamada({ agent_id: null, purpose: "checkpoint", created_at: "2026-10-05T16:00:00Z", input_tokens: 3000, output_tokens: 300, cost_cents: 5 }),
      chamada({ agent_id: null, purpose: "classifier", created_at: "2026-10-07T16:00:00Z", input_tokens: 200, output_tokens: 1, cost_cents: 1 }),
      // O agente arquivado no meio do caminho gastou antes: aparece.
      chamada({ agent_id: ARQUIVADO, created_at: "2026-10-02T12:00:00Z", input_tokens: 10, output_tokens: 1, cost_cents: 0.5 }),
      // Agente que não existe mais na empresa: a chamada fica, com nome nulo.
      chamada({ agent_id: REMOVIDO, created_at: "2026-10-03T12:00:00Z", input_tokens: 10, output_tokens: 1, cost_cents: 0.25 }),
      // De outra empresa: não entra.
      chamada({ organization_id: OUTRA, agent_id: null, created_at: "2026-10-05T16:00:00Z", cost_cents: 999 }),
    ]);

    expect(consumo.total).toMatchObject({ chamadas: 6, tokens_entrada: 4720, tokens_saida: 453, custo_usd_cents: 12.75 });
    expect(consumo.sistema).toMatchObject({ chamadas: 2, tokens_entrada: 3200, tokens_saida: 301, custo_usd_cents: 6 });

    expect(consumo.por_agente.map((a) => [a.nome, a.chamadas, a.custo_usd_cents, a.arquivado])).toEqual([
      ["Recepção", 2, 6, false],
      ["Antigo", 1, 0.5, true],
      [null, 1, 0.25, false],
      // O segundo agente não gastou nada: a linha aparece com zero.
      ["Vendas", 0, 0, false],
    ]);
    expect(consumo.por_agente.find((a) => a.nome === null)?.agent_id).toBe(REMOVIDO);

    // As linhas fecham com o total: agentes + Sistema = total.
    const somaDasLinhas = consumo.por_agente.reduce((s, a) => s + a.custo_usd_cents, 0) + consumo.sistema.custo_usd_cents;
    expect(somaDasLinhas).toBeCloseTo(consumo.total.custo_usd_cents, 6);

    expect(consumo.por_finalidade.map((f) => [f.finalidade, f.chamadas, f.custo_usd_cents])).toEqual([
      ["agent_turn", 4, 6.75],
      ["checkpoint", 1, 5],
      ["classifier", 1, 1],
    ]);
  });

  it("cache: os tokens lidos do cache são contados, como parte da entrada", async () => {
    const consumo = await ler([
      chamada({ agent_id: VENDAS, created_at: "2026-10-10T12:00:00Z", input_tokens: 10_000, cache_read_tokens: 8_000, output_tokens: 200, cost_cents: 1 }),
      chamada({ agent_id: VENDAS, created_at: "2026-10-11T12:00:00Z", input_tokens: 4_000, cache_read_tokens: 0, output_tokens: 100, cost_cents: 1 }),
      chamada({ agent_id: null, purpose: "checkpoint", created_at: "2026-10-11T13:00:00Z", input_tokens: 3_000, cache_read_tokens: 2_500, output_tokens: 50, cost_cents: 1 }),
    ]);
    expect(consumo.total).toMatchObject({ tokens_entrada: 17_000, tokens_do_cache: 10_500, tokens_saida: 350 });
    expect(consumo.por_agente.find((a) => a.agent_id === VENDAS)).toMatchObject({ tokens_entrada: 14_000, tokens_do_cache: 8_000 });
    expect(consumo.sistema).toMatchObject({ tokens_entrada: 3_000, tokens_do_cache: 2_500 });
  });

  it("chamada sem preço entra como zero (a régua do teto) e é contada à parte", async () => {
    const consumo = await ler([
      chamada({ agent_id: RECEPCAO, created_at: "2026-10-10T12:00:00Z", cost_cents: null }),
      chamada({ agent_id: RECEPCAO, created_at: "2026-10-10T13:00:00Z", cost_cents: "2.5" }),
    ]);
    expect(consumo.total).toMatchObject({ chamadas: 2, custo_usd_cents: 2.5, sem_preco: 1 });
  });
});

describe("a paginação", () => {
  it("2.500 chamadas no mês (mais de 1000): o total fecha, por agente e no Sistema", async () => {
    const linhas = Array.from({ length: 2_500 }, (_, i) =>
      chamada({
        agent_id: i % 5 === 0 ? null : i % 2 === 0 ? RECEPCAO : VENDAS,
        purpose: i % 5 === 0 ? "checkpoint" : "agent_turn",
        created_at: new Date(Date.parse("2026-10-02T12:00:00Z") + i * 60_000).toISOString(),
        input_tokens: 100,
        output_tokens: 10,
        cost_cents: 2,
      }),
    );
    const b = banco(linhas);
    const r = (await lerConsumoDoPeriodo(b.cliente as never, ACADEMIA, OUTUBRO)) as ConsumoDoPeriodo;

    expect(b.pedidosEm("llm_calls")).toBeGreaterThanOrEqual(3);
    expect(r.truncado).toBe(false);
    expect(r.chamadas_no_banco).toBe(2_500);
    expect(r.total).toMatchObject({ chamadas: 2_500, tokens_entrada: 250_000, tokens_saida: 25_000, custo_usd_cents: 5_000 });
    expect(r.sistema.chamadas).toBe(500);
    expect(r.por_agente.reduce((s, a) => s + a.chamadas, 0)).toBe(2_000);
  });

  it("acima do teto de páginas: sai truncado, e o que fica de fora é o começo do mês", async () => {
    const linhas = Array.from({ length: 100_001 }, (_, i) =>
      chamada({ agent_id: RECEPCAO, created_at: new Date(Date.parse("2026-10-02T12:00:00Z") + i * 1_000).toISOString(), cost_cents: 1 }),
    );
    const r = await ler(linhas);
    expect(r.truncado).toBe(true);
    expect(r.total.chamadas).toBe(100_000);
    expect(r.chamadas_no_banco).toBe(100_001);
  });

  it("leitura que falha não vira custo zero: devolve o erro", async () => {
    const b = postgrestComTeto(
      { ai_agents: AGENTES, llm_calls: [chamada({ created_at: "2026-10-02T12:00:00Z" })], platform_fx_rates: [] },
      { falhaEm: (_n, tabela) => (tabela === "llm_calls" ? "banco fora do ar" : null) },
    );
    expect(await lerConsumoDoPeriodo(b.cliente as never, ACADEMIA, OUTUBRO)).toEqual({ erro: "banco fora do ar" });
  });
});

describe("o real", () => {
  it("cada dia pela cotação dele; dia sem captura usa a anterior; nunca uma posterior", async () => {
    const consumo = await ler(
      [
        chamada({ agent_id: RECEPCAO, created_at: "2026-10-01T12:00:00Z", cost_cents: 100 }), // dia 1º: 5,00
        chamada({ agent_id: RECEPCAO, created_at: "2026-10-02T12:00:00Z", cost_cents: 100 }), // dia 2, sem captura: a do 1º
        chamada({ agent_id: null, created_at: "2026-10-03T12:00:00Z", cost_cents: 100 }), // dia 3: 6,00
      ],
      [
        // A de antes do mês é a que cobre o dia 1º... mas o dia 1º tem a dele.
        { dia: "2026-09-29", usd_brl: 4 },
        { dia: "2026-10-01", usd_brl: 5 },
        { dia: "2026-10-03", usd_brl: 6 },
        { dia: "2026-10-04", usd_brl: 50 },
      ],
    );
    expect(consumo.total.custo_brl).toBe(16);
    expect(consumo.por_agente.find((a) => a.agent_id === RECEPCAO)?.custo_brl).toBe(10);
    expect(consumo.sistema.custo_brl).toBe(6);
    expect(consumo.reais.dias_sem_cotacao).toEqual([]);
    expect(consumo.reais.ultima_cotacao).toEqual({ dia: "2026-10-04", usd_brl: 50 });
  });

  it("dia com custo e sem cotação nenhuma: fica fora do real e é dito, sem inventar", async () => {
    const consumo = await ler(
      [
        chamada({ agent_id: RECEPCAO, created_at: "2026-10-01T12:00:00Z", cost_cents: 100 }),
        chamada({ agent_id: RECEPCAO, created_at: "2026-10-02T12:00:00Z", cost_cents: 100 }),
        chamada({ agent_id: RECEPCAO, created_at: "2026-10-05T12:00:00Z", cost_cents: 100 }),
        // Sem custo: não entra na lista de dias sem cotação.
        chamada({ agent_id: RECEPCAO, created_at: "2026-10-01T13:00:00Z", cost_cents: 0 }),
      ],
      [{ dia: "2026-10-05", usd_brl: 5 }],
    );
    expect(consumo.total.custo_usd_cents).toBe(300);
    expect(consumo.total.custo_brl).toBe(5);
    expect(consumo.reais.dias_sem_cotacao).toEqual(["2026-10-01", "2026-10-02"]);
  });
});

describe("a rota da aba Uso e a ferramenta do MCP", () => {
  const CHAMADAS = () => [
    chamada({ agent_id: RECEPCAO, created_at: "2026-10-05T15:00:00Z", input_tokens: 1000, cache_read_tokens: 600, output_tokens: 100, cost_cents: 4 }),
    chamada({ agent_id: null, purpose: "checkpoint", created_at: "2026-10-05T16:00:00Z", input_tokens: 3000, output_tokens: 300, cost_cents: 5 }),
    // 22h de 31/10 em Brasília: outubro.
    chamada({ agent_id: VENDAS, created_at: "2026-11-01T01:00:00Z", input_tokens: 10, output_tokens: 10, cost_cents: 1 }),
    // Novembro: fora.
    chamada({ agent_id: VENDAS, created_at: "2026-11-02T12:00:00Z", input_tokens: 10, output_tokens: 10, cost_cents: 50 }),
  ];
  const tabelas = () =>
    postgrestComTeto({
      organizations: ORGANIZACOES,
      ai_agents: AGENTES,
      llm_calls: CHAMADAS(),
      platform_fx_rates: [{ dia: "2026-09-30", usd_brl: 5 }],
      conversations: [
        { id: "conversa-1", organization_id: ACADEMIA, created_at: "2026-10-05T15:00:00Z" },
        { id: "conversa-2", organization_id: ACADEMIA, created_at: "2026-11-02T15:00:00Z" },
      ],
      messages: [],
      platform_precos_meta: [],
      mia_precos_meta_vigencias: [],
    });

  const pedir = async (consulta: string) => {
    const { GET } = await import("@/app/api/v1/admin/tenants/[id]/usage/route");
    return GET(new NextRequest(`http://localhost/api/v1/admin/tenants/${ACADEMIA}/usage${consulta}`), {
      params: Promise.resolve({ id: ACADEMIA }),
    });
  };

  it("mes=2026-10: todos os números são do mês, com as quebras novas e sem tirar os campos de antes", async () => {
    vi.mocked(createAdminClient).mockReturnValue(tabelas().cliente as never);
    const res = await pedir("?mes=2026-10");
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> & { consumo: ConsumoDoPeriodo } };

    // Os campos que a tela lê hoje continuam.
    expect(data).toMatchObject({
      dias: 31,
      mes: "2026-10",
      conversas: 1,
      mensagens: 0,
      ia: { chamadas: 3, tokens: 4420, custo_usd_cents: 10, truncado: false },
      mensagens_cobradas: { total: 0, truncado: false },
    });
    expect(data.consumo.sistema).toMatchObject({ chamadas: 1, custo_usd_cents: 5 });
    expect(data.consumo.total).toMatchObject({ tokens_do_cache: 600, custo_brl: 0.5 });
    expect(data.consumo.por_agente.map((a) => [a.nome, a.custo_usd_cents])).toEqual([
      ["Recepção", 4],
      ["Vendas", 1],
    ]);
  });

  it("mes fora do formato: 400, e nada é lido", async () => {
    const b = tabelas();
    vi.mocked(createAdminClient).mockReturnValue(b.cliente as never);
    const res = await pedir("?mes=2026-10-01");
    expect(res.status).toBe(400);
    expect(b.pedidosEm("llm_calls")).toBe(0);
  });

  it("plataforma_ver_consumo_de_ia devolve os mesmos números da rota", async () => {
    vi.mocked(createAdminClient).mockReturnValue(tabelas().cliente as never);
    const { data } = (await (await pedir("?mes=2026-10")).json()) as { data: { consumo: ConsumoDoPeriodo } };

    const ferramenta = FERRAMENTA_POR_NOME.get("plataforma_ver_consumo_de_ia");
    expect(ferramenta?.operacao).toBeNull();
    const ctx = { admin: tabelas().cliente, autorUserId: "u", tokenId: "t", requestId: "r" } as unknown as ContextoDaFerramenta;
    const doMcp = (await ferramenta!.handler(ctx, { organization_id: ACADEMIA, mes: "2026-10" })) as Record<string, unknown>;

    expect(doMcp).toMatchObject({ empresa: "Academia Alfa", mes: "2026-10" });
    for (const chave of ["total", "por_agente", "sistema", "por_finalidade", "reais", "truncado", "chamadas_no_banco"] as const) {
      expect(doMcp[chave], chave).toEqual(data.consumo[chave]);
    }
  });

  it("a ferramenta recusa cliente que não existe, com o caminho para achar o id", async () => {
    const ferramenta = FERRAMENTA_POR_NOME.get("plataforma_ver_consumo_de_ia")!;
    const ctx = { admin: tabelas().cliente } as unknown as ContextoDaFerramenta;
    await expect(
      ferramenta.handler(ctx, { organization_id: "dddddddd-0000-4000-8000-000000000009", mes: "2026-10" }),
    ).rejects.toThrow(/plataforma_listar_clientes/);
  });
});
