/**
 * FORK MIA (MIA-78) — a tela geral (`/api/v1/admin/usage`) e a aba Uso do
 * cliente (`/api/v1/admin/tenants/[id]/usage`) dão o MESMO número para o mesmo
 * cliente e o mesmo período, e leitura que falha é erro, nunca zero.
 *
 * Os três defeitos da seção 2.1 do mapa (MIA-70), um bloco cada:
 *
 *   1. a aba Uso contava as mensagens dos contatos pessoais, que a tela geral
 *      tira (Academia Alfa com a Ana Exemplo marcada pessoal: N numa, N+10 na
 *      outra);
 *   2. "30 dias" era N dias de calendário UTC na tela geral e N×24 h corridas
 *      na aba Uso e no MCP. Agora é uma régua só, `periodoDoPedido`: os N dias
 *      do calendário em Brasília terminados hoje;
 *   3. na aba Uso, a contagem de conversas, a de mensagens e os preços da Meta
 *      que falhavam saíam 0 (o custo de mensagem saía R$ 0,00); na tela geral,
 *      a lista dos pessoais que falhava contava as mensagens deles, e o teto
 *      dela não era dito.
 *
 * Dado fictício (Academia Alfa, Ana Exemplo), no dublê que corta em 1000 linhas
 * e aplica os filtros de verdade (`tests/helpers/postgrest-com-teto.ts`).
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
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

const ACADEMIA = "a1a1a1a1-0000-4000-8000-000000000078";
/** Ana Exemplo, contato PESSOAL da dona da Academia Alfa. */
const ANA = "a7a7a7a7-0000-4000-8000-000000000001";
/** Um aluno, contato comercial. */
const ALUNO = "a7a7a7a7-0000-4000-8000-000000000002";

const ORGANIZACOES: Linha[] = [
  { id: ACADEMIA, display_name: "Academia Alfa", slug: "academia-alfa", settings: {}, demonstracao: false },
];

let seq = 0;
const id = (prefixo: string) => `${prefixo}-${String(++seq).padStart(7, "0")}`;

function mensagem(contact_id: string, created_at: string, campos: Linha = {}): Linha {
  return { id: id("mensagem"), organization_id: ACADEMIA, contact_id, created_at, ...campos };
}

function chamada(created_at: string): Linha {
  return {
    id: id("chamada"),
    organization_id: ACADEMIA,
    agent_id: null,
    purpose: "agent_turn",
    input_tokens: 10,
    output_tokens: 10,
    cache_read_tokens: 0,
    cost_cents: 1,
    contact_id: null,
    created_at,
  };
}

function banco(tabelas: Record<string, Linha[]>) {
  return postgrestComTeto({
    organizations: ORGANIZACOES,
    ai_agents: [],
    contacts: [
      { id: ANA, organization_id: ACADEMIA, is_personal: true },
      { id: ALUNO, organization_id: ACADEMIA, is_personal: false },
    ],
    platform_fx_rates: [{ dia: "2026-09-30", usd_brl: 5 }],
    platform_precos_meta: [{ categoria: "marketing", centavos_brl: 35 }],
    ...tabelas,
  });
}

/**
 * O banco com UMA leitura falhando: a de `tabela` cujo `select` casa com
 * `casa`. Como o PostgREST faz quando o papel perde a permissão: a resposta
 * vem com `error` e sem linha.
 */
function comFalha(
  cliente: ReturnType<typeof postgrestComTeto>["cliente"],
  tabela: string,
  casa: (colunas: string | undefined, opcoes: { head?: boolean } | undefined) => boolean = () => true,
) {
  const resposta = { data: null, error: { message: `permission denied for table ${tabela}` }, count: null };
  const falha: unknown = new Proxy(
    {},
    {
      get: (_alvo, nome) =>
        nome === "then"
          ? (resolver: (r: unknown) => unknown) => Promise.resolve(resposta).then(resolver)
          : nome === "maybeSingle" || nome === "single"
            ? async () => resposta
            : () => falha,
    },
  );
  return {
    ...cliente,
    from: (t: string) => {
      const cadeia = cliente.from(t);
      if (t !== tabela) return cadeia;
      return new Proxy(cadeia, {
        get: (alvo, nome) =>
          nome === "select"
            ? (colunas?: string, opcoes?: { head?: boolean }) =>
                casa(colunas, opcoes) ? falha : alvo.select(colunas, opcoes as never)
            : (alvo as unknown as Record<string | symbol, unknown>)[nome],
      });
    },
  };
}

async function telaGeral(busca: string) {
  const { GET } = await import("@/app/api/v1/admin/usage/route");
  return GET(new NextRequest(`http://localhost/api/v1/admin/usage?${busca}`));
}

async function abaUso(busca: string) {
  const { GET } = await import("@/app/api/v1/admin/tenants/[id]/usage/route");
  return GET(new NextRequest(`http://localhost/api/v1/admin/tenants/${ACADEMIA}/usage?${busca}`), {
    params: Promise.resolve({ id: ACADEMIA }),
  });
}

async function mcp(cliente: unknown, args: Record<string, unknown>) {
  const ferramenta = FERRAMENTA_POR_NOME.get("plataforma_ver_consumo_de_ia")!;
  const ctx = { admin: cliente, autorUserId: "u", tokenId: "t", requestId: "r" } as unknown as ContextoDaFerramenta;
  return (await ferramenta.handler(ctx, { organization_id: ACADEMIA, ...args })) as {
    dias: number;
    periodo: { inicio: string; fim: string };
    total: { chamadas: number };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("1. as mensagens dos contatos pessoais ficam fora nas duas telas", () => {
  // 5 mensagens do aluno e 10 da Ana Exemplo (pessoal) em outubro.
  const tabelas = () =>
    banco({
      messages: [
        ...Array.from({ length: 5 }, (_, i) => mensagem(ALUNO, `2026-10-1${i}T15:00:00Z`)),
        ...Array.from({ length: 10 }, (_, i) => mensagem(ANA, `2026-10-${String(i + 1).padStart(2, "0")}T15:00:00Z`)),
      ],
    });

  it("outubro da Academia Alfa: 5 mensagens na tela geral e 5 na aba Uso", async () => {
    vi.mocked(createAdminClient).mockReturnValue(tabelas().cliente as never);
    const geral = (await (await telaGeral(`mes=2026-10&tenant_id=${ACADEMIA}`)).json()) as {
      data: { tenants: Array<{ messages_count: number }>; pessoais_truncado: boolean };
    };
    vi.mocked(createAdminClient).mockReturnValue(tabelas().cliente as never);
    const res = await abaUso("mes=2026-10");
    expect(res.status).toBe(200);
    const aba = (await res.json()) as { data: { mensagens: number; pessoais_truncado: boolean } };

    expect(geral.data.tenants[0]!.messages_count).toBe(5);
    expect(aba.data.mensagens).toBe(5);
    expect(aba.data.pessoais_truncado).toBe(false);
    expect(geral.data.pessoais_truncado).toBe(false);
  });

  it("controle: sem a Ana marcada pessoal, as 15 contam nas duas", async () => {
    const semPessoal = () => {
      const b = tabelas();
      for (const c of b.tabelas.contacts!) c.is_personal = false;
      return b;
    };
    vi.mocked(createAdminClient).mockReturnValue(semPessoal().cliente as never);
    const geral = (await (await telaGeral(`mes=2026-10&tenant_id=${ACADEMIA}`)).json()) as {
      data: { tenants: Array<{ messages_count: number }> };
    };
    vi.mocked(createAdminClient).mockReturnValue(semPessoal().cliente as never);
    const aba = (await (await abaUso("mes=2026-10")).json()) as { data: { mensagens: number } };

    expect(geral.data.tenants[0]!.messages_count).toBe(15);
    expect(aba.data.mensagens).toBe(15);
  });
});

describe("2. 30 dias é a mesma janela na tela geral, na aba Uso e no MCP", () => {
  // Hoje, 18/11/2026 às 12h UTC (9h em Brasília). Os 30 dias vão de 20/10 00:00
  // a 19/11 00:00 em Brasília: de 2026-10-20T03:00Z a 2026-11-19T03:00Z.
  const AGORA = new Date("2026-11-18T12:00:00Z");
  const tabelas = () =>
    banco({
      llm_calls: [
        // 19/10 às 23h59 em Brasília: fora. Era DENTRO na tela geral (UTC já
        // era 20/10) e na aba Uso (30×24 h começavam em 19/10 às 12h UTC).
        chamada("2026-10-20T02:59:59Z"),
        // 19/10 às 13h em Brasília: fora; era dentro na aba Uso (30×24 h).
        chamada("2026-10-19T16:00:00Z"),
        // 20/10 à 0h em Brasília: o primeiro instante, dentro.
        chamada("2026-10-20T03:00:00Z"),
        // Hoje cedo, dentro.
        chamada("2026-11-18T11:00:00Z"),
      ],
    });

  it("as três contam as mesmas 2 chamadas, no mesmo início e fim", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);

    vi.mocked(createAdminClient).mockReturnValue(tabelas().cliente as never);
    const geral = (await (await telaGeral(`range=30d&tenant_id=${ACADEMIA}`)).json()) as {
      data: {
        tenants: Array<{ ai_invocations_count: number; ai_cost_cents: number }>;
        series: { ai_cost: Array<{ date: string; cents: number }> };
      };
    };
    vi.mocked(createAdminClient).mockReturnValue(tabelas().cliente as never);
    const aba = (await (await abaUso("dias=30")).json()) as {
      data: { dias: number; periodo: { inicio: string; fim: string }; ia: { chamadas: number } };
    };
    const doMcp = await mcp(tabelas().cliente, { dias: 30 });

    expect(geral.data.tenants[0]).toMatchObject({ ai_invocations_count: 2, ai_cost_cents: 2 });
    expect(aba.data.ia.chamadas).toBe(2);
    expect(doMcp.total.chamadas).toBe(2);

    const janela = { inicio: "2026-10-20T03:00:00.000Z", fim: "2026-11-19T03:00:00.000Z" };
    expect(aba.data.periodo).toMatchObject(janela);
    expect(doMcp.periodo).toMatchObject(janela);
    expect(doMcp.dias).toBe(30);

    // A série da tela geral: 30 dias inteiros de Brasília, de 20/10 a hoje.
    expect(geral.data.series.ai_cost).toHaveLength(30);
    expect(geral.data.series.ai_cost[0]).toEqual({ date: "2026-10-20", cents: 1 });
    expect(geral.data.series.ai_cost[29]).toEqual({ date: "2026-11-18", cents: 1 });
  });

  it("o MCP sem mes e sem dias continua no mês corrente; mes vence dias", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    const semNada = await mcp(tabelas().cliente, {});
    expect(semNada).toMatchObject({ mes: "2026-11", dias: 30, periodo: { inicio: "2026-11-01T03:00:00.000Z" } });
    const osDois = await mcp(tabelas().cliente, { mes: "2026-10", dias: 7 });
    expect(osDois).toMatchObject({ mes: "2026-10", dias: 31 });
  });
});

describe("3. leitura que falha vira erro, nunca zero", () => {
  const tabelas = () =>
    banco({
      conversations: [{ id: "conversa-1", organization_id: ACADEMIA, created_at: "2026-10-05T15:00:00Z" }],
      messages: [
        mensagem(ALUNO, "2026-10-05T15:00:00Z", { meta_billable: true, meta_pricing_category: "marketing" }),
      ],
    });

  it("controle: com tudo lido, a aba Uso responde 200 com o custo da mensagem", async () => {
    vi.mocked(createAdminClient).mockReturnValue(tabelas().cliente as never);
    const res = await abaUso("mes=2026-10");
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { conversas: number; mensagens: number } };
    expect(data).toMatchObject({ conversas: 1, mensagens: 1 });
  });

  type Casa = (colunas: string | undefined, opcoes: { head?: boolean } | undefined) => boolean;
  const soAContagem: Casa = (_colunas, opcoes) => opcoes?.head === true;
  const qualquer: Casa = () => true;
  const FALHAS: Array<[string, string, Casa]> = [
    ["a contagem de conversas", "conversations", soAContagem],
    // Só a contagem: a leitura das mensagens cobradas (a outra de `messages`) já era conferida.
    ["a contagem de mensagens", "messages", soAContagem],
    ["os preços da Meta (era custo R$ 0,00)", "platform_precos_meta", qualquer],
    ["a lista dos contatos pessoais", "contacts", qualquer],
  ];

  it.each(FALHAS)("aba Uso: %s falha → 500 db_error, sem número", async (_nome, tabela, casa) => {
    vi.mocked(createAdminClient).mockReturnValue(comFalha(tabelas().cliente, tabela, casa) as never);
    const res = await abaUso("mes=2026-10");
    expect(res.status).toBe(500);
    const corpo = (await res.json()) as { data?: unknown; error: { code: string } };
    expect(corpo.error.code).toBe("db_error");
    expect(corpo.data).toBeUndefined();
  });

  it("tela geral: a lista dos contatos pessoais falha → 500, em vez de contar as mensagens deles", async () => {
    vi.mocked(createAdminClient).mockReturnValue(comFalha(tabelas().cliente, "contacts") as never);
    const res = await telaGeral(`mes=2026-10&tenant_id=${ACADEMIA}`);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("db_error");
  });

  it("acima de 2000 pessoais: as duas telas dizem pessoais_truncado; com 2000, não", async () => {
    const comPessoais = (n: number) => {
      const b = banco({
        messages: [mensagem(ALUNO, "2026-10-05T15:00:00Z")],
      });
      b.tabelas.contacts!.push(
        ...Array.from({ length: n }, (_, i) => ({
          id: `b0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          organization_id: ACADEMIA,
          is_personal: true,
        })),
      );
      return b;
    };

    // Com a Ana, 2001 pessoais: passa do teto.
    vi.mocked(createAdminClient).mockReturnValue(comPessoais(2000).cliente as never);
    const geral = (await (await telaGeral(`mes=2026-10&tenant_id=${ACADEMIA}`)).json()) as {
      data: { pessoais_truncado: boolean };
    };
    vi.mocked(createAdminClient).mockReturnValue(comPessoais(2000).cliente as never);
    const aba = (await (await abaUso("mes=2026-10")).json()) as { data: { pessoais_truncado: boolean } };
    expect(geral.data.pessoais_truncado).toBe(true);
    expect(aba.data.pessoais_truncado).toBe(true);

    // Exatamente 2000 (a Ana e mais 1999): cabe, e nada é dito.
    vi.mocked(createAdminClient).mockReturnValue(comPessoais(1999).cliente as never);
    const cabe = (await (await telaGeral(`mes=2026-10&tenant_id=${ACADEMIA}`)).json()) as {
      data: { pessoais_truncado: boolean };
    };
    expect(cabe.data.pessoais_truncado).toBe(false);
  });
});
