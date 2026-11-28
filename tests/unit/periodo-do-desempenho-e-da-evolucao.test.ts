/**
 * MIA-361 · ponto 3 · O PERÍODO QUE A TELA DIZ É O QUE A CONTA USA.
 *
 * 1. DESEMPENHO (`/app/metrics`): o subtítulo diz "nos últimos 30 dias" e a
 *    tela não passa período. A rota `/api/v1/metrics/attendants` tem de pedir a
 *    `fn_attendant_metrics` exatamente `[agora − 30 dias, agora)`, com a
 *    organização da sessão (nunca da query). Que a função conta essa janela e
 *    só a empresa pedida está em
 *    `tests/invariants/desempenho-por-atendente-isola-a-empresa.test.ts`.
 * 2. EVOLUÇÃO DA IA (`/app/ai/evolution`): o servidor monta o intervalo padrão
 *    e o desenha nos dois campos de data (`app/app/ai/evolution/page.tsx`); a
 *    tela manda esses dois dias para a rota. A rota tem de ler os 30 DIAS
 *    INTEIROS que os campos mostram (do 00:00 do primeiro ao 23:59:59.999 do
 *    último, em UTC) e devolver o mesmo intervalo, e o padrão da rota sem
 *    filtro tem de ser o mesmo da página.
 *
 * O dia é o de UTC, não o fuso da empresa: na Academia Alfa (Brasília) a
 * Evolução aberta às 22h de 28/11 mostra "até 29/11". É do upstream e está
 * descrito na MIA-361 (não se trava aqui o defeito, só a coerência entre o que
 * a tela mostra e o que a rota conta).
 *
 * Dados fictícios (Academia Alfa).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "a1fa0000-0000-4000-8000-00000000a1fa";

const rpc = vi.fn();
const lidos = { gte: [] as Array<[string, unknown]>, lte: [] as Array<[string, unknown]>, tabelas: [] as string[] };

function construtor(tabela: string) {
  lidos.tabelas.push(tabela);
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "not", "is", "order", "limit", "neq"]) b[m] = () => b;
  b.gte = (c: string, v: unknown) => {
    lidos.gte.push([c, v]);
    return b;
  };
  b.lte = (c: string, v: unknown) => {
    lidos.lte.push([c, v]);
    return b;
  };
  b.maybeSingle = async () => ({ data: null, error: null });
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(ok);
  return b;
}

vi.mock("@/lib/api/auth-dual", () => ({
  resolveAuthDual: async () => ({
    ok: true,
    via: "sessao",
    organizationId: ORG,
    idioma: "pt-BR",
    supabase: { rpc: (...a: unknown[]) => rpc(...a), from: construtor },
  }),
  tetoDeEscritaDoToken: async () => null,
}));
vi.mock("@/lib/ai/trava-da-ia-na-rota", () => ({ quemPedeNaRota: async () => ({ is_platform_admin: false, support: null }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), isServiceRoleConfigured: () => false }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/server")>()),
  requireAuth: async () => ({ is_platform_admin: false, support: null, idioma: "pt-BR" }),
  resolveActiveOrg: async () => ({ orgId: ORG, role: "manager" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT ${destino}`);
  },
}));
// A tela de cliente (gráficos) não interessa aqui: só o intervalo que o servidor desce para ela.
vi.mock("@/app/app/ai/evolution/_client", () => ({ EvolutionClient: () => null }));

import { NextRequest } from "next/server";

import EvolutionPage from "@/app/app/ai/evolution/page";
import { GET as getEvolucao } from "@/app/api/v1/ai/evolution/route";
import { GET as getAtendentes } from "@/app/api/v1/metrics/attendants/route";

const AGORA = "2026-11-28T15:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(AGORA));
  rpc.mockReset();
  lidos.gte = [];
  lidos.lte = [];
  lidos.tabelas = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("⭐ Desempenho: 'nos últimos 30 dias' é o que a conta por atendente recebe", () => {
  it("sem período na query: [agora − 30 dias, agora), na organização da sessão", async () => {
    rpc.mockResolvedValue({ data: { funnel: [], attendants: [], excluded_tag: null, excluded_conversations: 0 }, error: null });
    const r = await getAtendentes(new NextRequest(`http://localhost/api/v1/metrics/attendants?organization_id=outra`));
    expect(r.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [nome, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(nome).toBe("fn_attendant_metrics");
    expect(args).toMatchObject({ p_org: ORG, p_from: "2026-10-29T15:00:00.000Z", p_to: AGORA });
    const corpo = (await r.json()) as { data: { window: { from: string; to: string } } };
    expect(corpo.data.window).toEqual({ from: "2026-10-29T15:00:00.000Z", to: AGORA });
  });
});

/** O `defaultRange` que a página desce para os campos de data. */
async function intervaloDaPagina(): Promise<{ from: string; to: string }> {
  const achar = (no: unknown): { from: string; to: string } | null => {
    if (!no || typeof no !== "object") return null;
    if (Array.isArray(no)) {
      for (const x of no) {
        const r = achar(x);
        if (r) return r;
      }
      return null;
    }
    const props = (no as { props?: Record<string, unknown> }).props;
    if (!props) return null;
    if (props.defaultRange) return props.defaultRange as { from: string; to: string };
    return achar(props.children);
  };
  const r = achar(await EvolutionPage());
  if (!r) throw new Error("a página não desceu o intervalo padrão");
  return r;
}

async function lerEvolucao(qs: string) {
  rpc.mockResolvedValue({ data: null, error: { message: "sem uso de IA neste teste" } });
  lidos.gte = [];
  lidos.lte = [];
  lidos.tabelas = [];
  const r = await getEvolucao(new NextRequest(`http://localhost/api/v1/ai/evolution${qs}`));
  expect(r.status).toBe(200);
  const corpo = (await r.json()) as { data: { range: { from: string; to: string } } };
  return { range: corpo.data.range, gte: [...lidos.gte], lte: [...lidos.lte] };
}

describe("⭐ Evolução da IA: os dias dos campos são os dias que a rota conta", () => {
  it("a página mostra 30 dias, terminando hoje (UTC)", async () => {
    expect(await intervaloDaPagina()).toEqual({ from: "2026-10-30", to: "2026-11-28" });
  });

  it("com os dias da página, toda leitura por data vai do 00:00 do primeiro ao fim do último, e a resposta devolve os mesmos dias", async () => {
    const { from, to } = await intervaloDaPagina();
    const lido = await lerEvolucao(`?from=${from}&to=${to}`);
    expect(lido.range).toEqual({ from, to });
    expect(lido.gte.length).toBeGreaterThan(0);
    expect(lido.gte.every(([, v]) => v === `${from}T00:00:00.000Z`)).toBe(true);
    expect(lido.lte.every(([, v]) => v === `${to}T23:59:59.999Z`)).toBe(true);
    const dias = (Date.parse(`${to}T23:59:59.999Z`) + 1 - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;
    expect(dias).toBe(30);
  });

  it("sem filtro, a rota usa o mesmo padrão da página", async () => {
    const daPagina = await intervaloDaPagina();
    const semFiltro = await lerEvolucao("");
    const comOsDiasDaPagina = await lerEvolucao(`?from=${daPagina.from}&to=${daPagina.to}`);
    expect(semFiltro.range).toEqual(daPagina);
    expect(semFiltro.gte).toEqual(comOsDiasDaPagina.gte);
    expect(semFiltro.lte).toEqual(comOsDiasDaPagina.lte);
  });
});
