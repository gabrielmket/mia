/**
 * FORK MIA (MIA-99) — O PREÇO DA META GANHA VIGÊNCIA, E O MÊS FECHADO NÃO MUDA.
 *
 * Defeito 4 da seção 2.1 do mapa (MIA-54, levantamento da MIA-70):
 * `platform_precos_meta` guardava só o preço atual, e a aba Uso multiplicava as
 * mensagens do mês pedido por ele. Mudar o preço em novembro mudava o custo de
 * outubro.
 *
 * O caso, com dado fictício: a Academia Alfa teve 100 mensagens de marketing
 * cobradas em outubro, a R$ 0,35. Em 10/11 o preço vai a R$ 0,50. Outubro
 * continua R$ 35,00 na aba Uso, na tela do custo da Meta e no MCP; novembro
 * cobra R$ 0,35 até o dia 10 e R$ 0,50 dali em diante.
 *
 * O histórico aqui é o que o gatilho da 9165 deixa em `mia_precos_meta_vigencias`
 * (fechar a vigência e abrir a nova). O gatilho em si roda no Postgres de verdade
 * em `tests/invariants/preco-da-meta-com-vigencia.test.ts`.
 *
 *     npx vitest run tests/unit/preco-da-meta-com-vigencia.test.ts
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  calcularCusto,
  calcularCustoPorVigencia,
  instanteDe,
  type VigenciaDoPreco,
} from "@/lib/channels/meta/custo-da-conversa";
import { FERRAMENTA_POR_NOME } from "@/lib/mcp-plataforma/ferramentas";
import type { ContextoDaFerramenta } from "@/lib/mcp-plataforma/tipos";
import { createAdminClient } from "@/lib/supabase/admin";
import { postgrestComTeto, type Linha } from "@/tests/helpers/postgrest-com-teto";

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn(async () => ({ user: { id: "admin-da-plataforma" } })),
  requirePlatformAdminEscrita: vi.fn(async () => ({ user: { id: "admin-da-plataforma" } })),
  falhaDaEscritaDePlatformAdmin: vi.fn(),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ACADEMIA = "a1a1a1a1-0000-4000-8000-000000000099";
const ORGANIZACOES: Linha[] = [
  {
    id: ACADEMIA,
    display_name: "Academia Alfa",
    slug: "academia-alfa",
    settings: {},
    demonstracao: false,
    redacted_at: null,
  },
];

/** O instante do reajuste: 10/11/2026, meio-dia em Brasília. */
const REAJUSTE = "2026-11-10T15:00:00.000Z";

/** Antes do reajuste: o preço de hoje vira a primeira vigência, desde sempre (9165). */
const ANTES: Linha[] = [{ categoria: "marketing", centavos_brl: 35, vigente_desde: "-infinity", vigente_ate: null }];

/** Depois: o gatilho fechou a de R$ 0,35 no instante do reajuste e abriu a de R$ 0,50. */
const DEPOIS: Linha[] = [
  { categoria: "marketing", centavos_brl: 35, vigente_desde: "-infinity", vigente_ate: REAJUSTE },
  { categoria: "marketing", centavos_brl: 50, vigente_desde: REAJUSTE, vigente_ate: null },
];

let seq = 0;
function cobrada(created_at: string, categoria = "marketing"): Linha {
  return {
    id: `mensagem-${String(++seq).padStart(7, "0")}`,
    organization_id: ACADEMIA,
    contact_id: null,
    meta_billable: true,
    meta_pricing_category: categoria,
    created_at,
  };
}

/** 100 de marketing em outubro (dia 15, uma por minuto). */
const OUTUBRO = Array.from({ length: 100 }, (_, i) =>
  cobrada(new Date(Date.parse("2026-10-15T13:00:00Z") + i * 60_000).toISOString()),
);
/** Novembro: 20 antes do reajuste (dia 5) e 30 depois (dia 15). */
const NOVEMBRO = [
  ...Array.from({ length: 20 }, (_, i) => cobrada(new Date(Date.parse("2026-11-05T13:00:00Z") + i * 60_000).toISOString())),
  ...Array.from({ length: 30 }, (_, i) => cobrada(new Date(Date.parse("2026-11-15T13:00:00Z") + i * 60_000).toISOString())),
];

function banco(vigencias: Linha[], precoAtual: number, mensagens: Linha[] = [...OUTUBRO, ...NOVEMBRO]) {
  return postgrestComTeto({
    organizations: ORGANIZACOES,
    ai_agents: [],
    contacts: [],
    conversations: [],
    llm_calls: [],
    platform_fx_rates: [],
    platform_precos_meta: [{ categoria: "marketing", centavos_brl: precoAtual, atualizado_em: REAJUSTE }],
    mia_precos_meta_vigencias: vigencias,
    messages: mensagens,
  });
}

interface CustoNaResposta {
  total: number;
  totalCentavos: number;
  semPreco: string[];
  linhas: Array<{
    categoria: string;
    cobradas: number;
    centavosUnitarios: number | null;
    totalCentavos: number | null;
    precos: Array<{ centavosUnitarios: number | null; cobradas: number; totalCentavos: number | null }>;
  }>;
}

async function abaUso(mes: string): Promise<CustoNaResposta> {
  const { GET } = await import("@/app/api/v1/admin/tenants/[id]/usage/route");
  const res = await GET(new NextRequest(`http://localhost/api/v1/admin/tenants/${ACADEMIA}/usage?mes=${mes}`), {
    params: Promise.resolve({ id: ACADEMIA }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { mensagens_cobradas: CustoNaResposta } }).data.mensagens_cobradas;
}

async function telaDoCustoDaMeta(mes: string) {
  const { GET } = await import("@/app/api/v1/admin/custo-da-meta/route");
  const res = await GET(new NextRequest(`http://localhost/api/v1/admin/custo-da-meta?mes=${mes}`));
  expect(res.status).toBe(200);
  return (
    (await res.json()) as {
      data: { precos: Array<{ categoria: string; centavos_brl: number }>; clientes: Array<{ organization_id: string; totalCentavos: number }> };
    }
  ).data;
}

function ctx(admin: unknown): ContextoDaFerramenta {
  return { admin, autorUserId: "admin-da-plataforma", tokenId: "t", requestId: "r" } as unknown as ContextoDaFerramenta;
}

async function mcpConsumo(cliente: unknown, mes: string) {
  const f = FERRAMENTA_POR_NOME.get("plataforma_ver_consumo_de_ia")!;
  return (await f.handler(ctx(cliente), { organization_id: ACADEMIA, mes })) as { mensagens_cobradas: CustoNaResposta };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a Academia Alfa: o preço muda em novembro e outubro não muda", () => {
  it("aba Uso: outubro é R$ 35,00 antes e depois do reajuste", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco(ANTES, 35).cliente as never);
    const antes = await abaUso("2026-10");
    expect(antes).toMatchObject({ total: 100, totalCentavos: 3_500, semPreco: [] });

    vi.mocked(createAdminClient).mockReturnValue(banco(DEPOIS, 50).cliente as never);
    const depois = await abaUso("2026-10");
    expect(depois).toMatchObject({ total: 100, totalCentavos: 3_500, semPreco: [] });
    expect(depois.linhas).toEqual([
      {
        categoria: "marketing",
        cobradas: 100,
        centavosUnitarios: 35,
        totalCentavos: 3_500,
        precos: [{ centavosUnitarios: 35, cobradas: 100, totalCentavos: 3_500 }],
      },
    ]);
  });

  it("controle negativo: a conta de antes (preço de hoje × mensagens do mês) dava R$ 50,00 para outubro", () => {
    // O que a rota fazia: `calcularCusto` com a tabela ATUAL. É o número que
    // mudava de ideia depois do reajuste.
    const contaDeAntes = calcularCusto([{ categoria: "marketing", cobradas: 100 }], [{ categoria: "marketing", centavos_brl: 50 }]);
    expect(contaDeAntes.totalCentavos).toBe(5_000);
  });

  it("aba Uso: novembro cobra R$ 0,35 até o reajuste e R$ 0,50 dali em diante", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco(DEPOIS, 50).cliente as never);
    const novembro = await abaUso("2026-11");
    expect(novembro).toMatchObject({ total: 50, totalCentavos: 20 * 35 + 30 * 50, semPreco: [] });
    expect(novembro.linhas[0]).toEqual({
      categoria: "marketing",
      cobradas: 50,
      // O da mensagem mais recente: a quebra está em `precos`.
      centavosUnitarios: 50,
      totalCentavos: 2_200,
      precos: [
        { centavosUnitarios: 35, cobradas: 20, totalCentavos: 700 },
        { centavosUnitarios: 50, cobradas: 30, totalCentavos: 1_500 },
      ],
    });
  });

  it("tela do custo da Meta: outubro continua R$ 35,00, e a tabela que a tela edita mostra o preço de hoje", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco(DEPOIS, 50).cliente as never);
    const outubro = await telaDoCustoDaMeta("2026-10");
    expect(outubro.clientes.find((c) => c.organization_id === ACADEMIA)?.totalCentavos).toBe(3_500);
    expect(outubro.precos.map((p) => [p.categoria, p.centavos_brl])).toEqual([["marketing", 50]]);

    const novembro = await telaDoCustoDaMeta("2026-11");
    expect(novembro.clientes.find((c) => c.organization_id === ACADEMIA)?.totalCentavos).toBe(2_200);
  });

  it("MCP plataforma_ver_consumo_de_ia: as mesmas mensagens cobradas da aba Uso", async () => {
    const b = banco(DEPOIS, 50);
    vi.mocked(createAdminClient).mockReturnValue(b.cliente as never);
    for (const mes of ["2026-10", "2026-11"]) {
      const daRota = await abaUso(mes);
      const doMcp = await mcpConsumo(b.cliente, mes);
      expect(doMcp.mensagens_cobradas).toEqual(daRota);
    }
    expect((await mcpConsumo(b.cliente, "2026-10")).mensagens_cobradas.totalCentavos).toBe(3_500);
  });
});

describe("a régua de Brasília (MIA-78) continua a do período", () => {
  // Reajuste à meia-noite de 1º/11 em Brasília (03:00 UTC).
  const VIRADA = "2026-11-01T03:00:00.000Z";
  const NA_VIRADA: Linha[] = [
    { categoria: "marketing", centavos_brl: 35, vigente_desde: "-infinity", vigente_ate: VIRADA },
    { categoria: "marketing", centavos_brl: 50, vigente_desde: VIRADA, vigente_ate: null },
  ];
  // 31/10 às 23:30 em Brasília (já é 1º/11 em UTC) e 1º/11 às 00:30.
  const MENSAGENS = [cobrada("2026-11-01T02:30:00.000Z"), cobrada("2026-11-01T03:30:00.000Z")];

  it("a mensagem das 23:30 de 31/10 é de outubro, ao preço de outubro; a das 00:30 é de novembro, ao novo", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco(NA_VIRADA, 50, MENSAGENS).cliente as never);
    expect(await abaUso("2026-10")).toMatchObject({ total: 1, totalCentavos: 35 });
    expect(await abaUso("2026-11")).toMatchObject({ total: 1, totalCentavos: 50 });
  });
});

describe("leitura que falha é erro, nunca custo zero", () => {
  it("o histórico de preços falha → 500 db_error na aba Uso e na tela do custo da Meta", async () => {
    const b = banco(DEPOIS, 50);
    const quebrado = {
      ...b.cliente,
      from: (t: string) => {
        if (t !== "mia_precos_meta_vigencias") return b.cliente.from(t);
        const falha = { data: null, error: { message: "permission denied for table mia_precos_meta_vigencias" }, count: null };
        const cadeia: Record<string, unknown> = {};
        for (const m of ["select", "order", "range"]) cadeia[m] = () => cadeia;
        cadeia.then = (r: (v: unknown) => unknown) => Promise.resolve(falha).then(r);
        return cadeia;
      },
    };
    vi.mocked(createAdminClient).mockReturnValue(quebrado as never);

    const { GET: aba } = await import("@/app/api/v1/admin/tenants/[id]/usage/route");
    const r1 = await aba(new NextRequest(`http://localhost/api/v1/admin/tenants/${ACADEMIA}/usage?mes=2026-10`), {
      params: Promise.resolve({ id: ACADEMIA }),
    });
    expect(r1.status).toBe(500);

    const { GET: tela } = await import("@/app/api/v1/admin/custo-da-meta/route");
    const r2 = await tela(new NextRequest("http://localhost/api/v1/admin/custo-da-meta?mes=2026-10"));
    expect(r2.status).toBe(500);

    await expect(mcpConsumo(quebrado, "2026-10")).rejects.toThrow(/mensagens cobradas/);
  });
});

describe("calcularCustoPorVigencia", () => {
  const v = (categoria: string, centavos_brl: number, vigente_desde: string, vigente_ate: string | null): VigenciaDoPreco => ({
    categoria,
    centavos_brl,
    vigente_desde,
    vigente_ate,
  });

  it("o fim da vigência é exclusivo: a mensagem no instante do reajuste já é do preço novo", () => {
    const r = calcularCustoPorVigencia(
      [
        { categoria: "marketing", created_at: "2026-11-10T14:59:59.999Z" },
        { categoria: "marketing", created_at: REAJUSTE },
      ],
      [v("marketing", 35, "-infinity", REAJUSTE), v("marketing", 50, REAJUSTE, null)],
    );
    expect(r.totalCentavos).toBe(85);
  });

  it("categoria cujo preço foi apagado: o antes soma, o depois fica sem preço e a categoria vai para `semPreco`", () => {
    const r = calcularCustoPorVigencia(
      [
        { categoria: "utility", created_at: "2026-11-05T13:00:00Z" },
        { categoria: "utility", created_at: "2026-11-15T13:00:00Z" },
        { categoria: "authentication", created_at: "2026-11-15T13:00:00Z" },
      ],
      [v("utility", 4, "-infinity", REAJUSTE)],
    );
    expect(r.totalCentavos).toBe(4);
    expect(r.semPreco.sort()).toEqual(["authentication", "utility"]);
    const utility = r.linhas.find((l) => l.categoria === "utility")!;
    expect(utility).toMatchObject({ cobradas: 2, centavosUnitarios: 4, totalCentavos: 4 });
    expect(utility.precos).toEqual([
      { centavosUnitarios: 4, cobradas: 1, totalCentavos: 4 },
      { centavosUnitarios: null, cobradas: 1, totalCentavos: null },
    ]);
    // Nunca zero: sem preço nenhum, o total da linha é nulo.
    expect(r.linhas.find((l) => l.categoria === "authentication")).toMatchObject({ centavosUnitarios: null, totalCentavos: null });
  });

  it("lê as pontas como o PostgREST (texto, `-infinity`) e como o `pg` (Date, ±Infinity)", () => {
    expect(instanteDe("-infinity")).toBe(Number.NEGATIVE_INFINITY);
    expect(instanteDe("infinity")).toBe(Number.POSITIVE_INFINITY);
    expect(instanteDe(new Date(REAJUSTE))).toBe(Date.parse(REAJUSTE));
    expect(instanteDe(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
    expect(() => instanteDe("ontem")).toThrow(/ilegível/);
  });
});

/** Um dublê mínimo de `platform_precos_meta` que registra o upsert. */
function tabelaDePrecos(atuais: Linha[], vigencias: Linha[]) {
  const upserts: Linha[][] = [];
  const lista = (linhas: Linha[]) => {
    const cadeia: Record<string, unknown> = {};
    for (const m of ["select", "order", "range"]) cadeia[m] = () => cadeia;
    cadeia.then = (r: (v: unknown) => unknown) =>
      Promise.resolve({ data: linhas, error: null, count: linhas.length }).then(r);
    return cadeia;
  };
  const admin = {
    from: (t: string) => {
      if (t === "mia_precos_meta_vigencias") return lista(vigencias);
      if (t !== "platform_precos_meta") throw new Error(`tabela inesperada: ${t}`);
      return {
        ...lista(atuais),
        upsert: async (linhas: Linha[], opcoes: { onConflict: string }) => {
          expect(opcoes.onConflict).toBe("categoria");
          upserts.push(linhas);
          return { error: null };
        },
      };
    },
  };
  return { admin, upserts };
}

describe("MCP: plataforma_ver_precos_da_meta e plataforma_definir_precos_da_meta", () => {
  const ver = FERRAMENTA_POR_NOME.get("plataforma_ver_precos_da_meta")!;
  const definir = FERRAMENTA_POR_NOME.get("plataforma_definir_precos_da_meta")!;

  it("ver: o preço de hoje, as categorias sem preço e o histórico (`null` = desde sempre / ainda vale)", async () => {
    const { admin } = tabelaDePrecos([{ categoria: "marketing", centavos_brl: 50, atualizado_em: REAJUSTE }], DEPOIS);
    const r = (await ver.handler(ctx(admin), {})) as {
      atuais: unknown[];
      sem_preco: string[];
      historico: Array<{ centavos_brl: number; vigente_desde: string | null; vigente_ate: string | null }>;
    };
    expect(ver.operacao).toBeNull();
    expect(r.atuais).toEqual([{ categoria: "marketing", centavos_brl: 50, atualizado_em: REAJUSTE }]);
    expect(r.sem_preco).toEqual(["utility", "authentication", "service"]);
    expect(r.historico).toEqual([
      { categoria: "marketing", centavos_brl: 35, vigente_desde: null, vigente_ate: REAJUSTE },
      { categoria: "marketing", centavos_brl: 50, vigente_desde: REAJUSTE, vigente_ate: null },
    ]);
  });

  it("definir: grava só o que mudou, com o autor; o mesmo preço responde `ja_estava`", async () => {
    const { admin, upserts } = tabelaDePrecos([{ categoria: "marketing", centavos_brl: 35 }], ANTES);
    const r = (await definir.handler(ctx(admin), {
      precos: [
        { categoria: "marketing", centavos_brl: 50 },
        { categoria: "utility", centavos_brl: 4 },
      ],
    })) as { precos: Array<{ categoria: string; antes: number | null; resultado: string }> };

    expect(definir.operacao).toBe("definir_custo_da_meta");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.map((l) => [l.categoria, l.centavos_brl, l.atualizado_por])).toEqual([
      ["marketing", 50, "admin-da-plataforma"],
      ["utility", 4, "admin-da-plataforma"],
    ]);
    expect(r.precos).toEqual([
      { categoria: "marketing", centavos_brl: 50, antes: 35, resultado: "mudou" },
      // Nunca teve preço: o gatilho o faz valer desde sempre.
      { categoria: "utility", centavos_brl: 4, antes: null, resultado: "primeiro_preco" },
    ]);

    // Reexecução segura: o mesmo pedido sobre o estado novo não escreve.
    const depois = tabelaDePrecos(
      [
        { categoria: "marketing", centavos_brl: 50 },
        { categoria: "utility", centavos_brl: 4 },
      ],
      DEPOIS,
    );
    const de_novo = (await definir.handler(ctx(depois.admin), {
      precos: [
        { categoria: "marketing", centavos_brl: 50 },
        { categoria: "utility", centavos_brl: 4 },
      ],
    })) as { precos: Array<{ resultado: string }> };
    expect(depois.upserts).toHaveLength(0);
    expect(de_novo.precos.map((p) => p.resultado)).toEqual(["ja_estava", "ja_estava"]);
  });

  it("definir: a categoria que já teve preço e foi apagada recomeça agora (`mudou`, não `primeiro_preco`)", async () => {
    const { admin } = tabelaDePrecos([], [{ categoria: "service", centavos_brl: 2, vigente_desde: "-infinity", vigente_ate: REAJUSTE }]);
    const r = (await definir.handler(ctx(admin), { precos: [{ categoria: "service", centavos_brl: 3 }] })) as {
      precos: Array<{ resultado: string }>;
    };
    expect(r.precos[0]!.resultado).toBe("mudou");
  });

  it("definir: a mesma categoria duas vezes é recusada, sem escrever", async () => {
    const { admin, upserts } = tabelaDePrecos([], []);
    await expect(
      definir.handler(ctx(admin), {
        precos: [
          { categoria: "marketing", centavos_brl: 35 },
          { categoria: "marketing", centavos_brl: 50 },
        ],
      }),
    ).rejects.toThrow(/duas vezes/);
    expect(upserts).toHaveLength(0);
  });
});
