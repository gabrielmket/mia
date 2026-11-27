import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/v1/cron/risk-watcher/route";

/**
 * FORK MIA (MIA-320) — A LISTA DE EMPRESAS DO OBSERVADOR DE RISCO LÊ TODOS OS
 * NEGÓCIOS ABERTOS, PÁGINA A PÁGINA.
 *
 * A rota tirava as empresas distintas de um `select organization_id` em
 * `crm_leads` abertos sem `order` nem `range`. O PostgREST devolve no máximo
 * 1000 linhas por pedido: com uma empresa grande na frente da ordem física, a
 * empresa seguinte nunca aparecia, e o observador simplesmente não passava
 * por ela, sem erro nenhum.
 *
 * O banco falso daqui RESPEITA o teto de 1000 por pedido e aplica filtro,
 * ordem e `range`. Um dublê que devolvesse tudo de uma vez passaria com o
 * defeito.
 *
 * A Academia Alfa (fictícia) tem 1.500 negócios abertos e vem PRIMEIRO na
 * ordem física; a Academia Beta tem 3 e vem depois. No código antigo a Beta
 * fica fora da lista.
 */

vi.mock("@/lib/env", () => ({
  env: { INTERNAL_CRON_SECRET: "segredo", INTERNAL_SECRET: "" },
}));

const logado = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: logado }));

const observadas = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/leads/risk-worker", () => ({
  observaTravessias: async (_db: unknown, org: string) => {
    observadas.push(org);
    return { travessias: 0, esfriaram: 0, reativaram: 0, falhasDeAtividade: 0, falhasDeGravacao: 0, propostas: 0 };
  },
}));
vi.mock("@/lib/leads/reactivation", () => ({
  venceReativacoes: async () => ({ vencidas: 0, itensDeCaixa: 0, falhasDeAtividade: 0 }),
}));

const ACADEMIA_ALFA = "00000000-0000-4000-8000-0000000000a1";
const ACADEMIA_BETA = "00000000-0000-4000-8000-0000000000b2";

/** O `max_rows` do PostgREST: nenhum pedido devolve mais que isto. */
const MAX_ROWS = 1000;

interface Negocio {
  id: string;
  organization_id: string;
  status: string;
}

let tabela: Negocio[] = [];
/** Simula o servidor que não manda a contagem e nunca acaba (para o teto). */
let semFim = false;
let falhaDoBanco: string | null = null;

/** Consulta falsa: aplica `eq`, `order` e `range`, com teto de 1000 por pedido. */
class ConsultaFalsa implements PromiseLike<{ data: Negocio[] | null; error: { message: string } | null; count: number | null }> {
  private filtros: Array<[keyof Negocio, string]> = [];
  private ordens: Array<keyof Negocio> = [];
  private faixa: [number, number] | null = null;

  constructor(private readonly comContagem: boolean) {}

  eq(coluna: keyof Negocio, valor: string) {
    this.filtros.push([coluna, valor]);
    return this;
  }

  order(coluna: keyof Negocio) {
    this.ordens.push(coluna);
    return this;
  }

  range(de: number, ate: number) {
    this.faixa = [de, ate];
    return this;
  }

  private resolver() {
    if (falhaDoBanco) return { data: null, error: { message: falhaDoBanco }, count: null };
    if (semFim) {
      const lote = Array.from({ length: MAX_ROWS }, (_, i) => ({ id: `n-${i}`, organization_id: ACADEMIA_ALFA, status: "open" }));
      return { data: lote, error: null, count: null };
    }
    let linhas = tabela.filter((l) => this.filtros.every(([c, v]) => l[c] === v));
    const total = linhas.length;
    if (this.ordens.length > 0) {
      linhas = [...linhas].sort((a, b) => {
        for (const c of this.ordens) {
          if (a[c] < b[c]) return -1;
          if (a[c] > b[c]) return 1;
        }
        return 0;
      });
    }
    const [de, ate] = this.faixa ?? [0, Number.MAX_SAFE_INTEGER];
    const pedido = linhas.slice(de, ate + 1).slice(0, MAX_ROWS);
    return { data: pedido, error: null, count: this.comContagem ? total : null };
  }

  then<A, B>(
    onfulfilled?: ((v: ReturnType<ConsultaFalsa["resolver"]>) => A | PromiseLike<A>) | null,
    onrejected?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.resolver()).then(onfulfilled, onrejected);
  }
}

function adminFalso() {
  return {
    from(nome: string) {
      if (nome !== "crm_leads") throw new Error(`tabela não modelada no dublê: ${nome}`);
      return {
        select: (_colunas: string, opcoes?: { count?: string }) => new ConsultaFalsa(opcoes?.count === "exact"),
      };
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminFalso() }));

function requisicaoAutorizada(): Parameters<typeof GET>[0] {
  return { headers: new Headers({ authorization: "Bearer segredo" }) } as never;
}

function negocios(org: string, quantos: number, prefixo: string, status = "open"): Negocio[] {
  return Array.from({ length: quantos }, (_, i) => ({
    id: `${prefixo}-${String(i).padStart(5, "0")}`,
    organization_id: org,
    status,
  }));
}

beforeEach(() => {
  // Ordem FÍSICA: a Alfa inteira primeiro, a Beta depois da linha 1000.
  tabela = [
    ...negocios(ACADEMIA_ALFA, 1500, "alfa"),
    ...negocios(ACADEMIA_ALFA, 40, "alfa-ganho", "won"),
    ...negocios(ACADEMIA_BETA, 3, "beta"),
  ];
  semFim = false;
  falhaDoBanco = null;
  observadas.length = 0;
  for (const f of Object.values(logado)) f.mockClear();
});

describe("risk-watcher: a lista de empresas", () => {
  it("⛔ inclui a Academia Beta, que vem depois dos 1.500 negócios abertos da Alfa", async () => {
    const resposta = await GET(requisicaoAutorizada());
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(observadas).toEqual([ACADEMIA_ALFA, ACADEMIA_BETA]);
    expect(corpo.data.organizations).toBe(2);
    expect(corpo.data.organizations_truncado).toBe(false);
  });

  it("sai na ordem de organization_id, seja qual for a ordem física", async () => {
    tabela = [...tabela].reverse();
    await GET(requisicaoAutorizada());
    expect(observadas).toEqual([ACADEMIA_ALFA, ACADEMIA_BETA]);
  });

  it("⛔ o teto de páginas não é silencioso: loga erro e responde `organizations_truncado: true`", async () => {
    semFim = true;
    const resposta = await GET(requisicaoAutorizada());
    expect(resposta.status).toBe(200);
    expect((await resposta.json()).data.organizations_truncado).toBe(true);
    expect(logado.error).toHaveBeenCalledWith("[risk-watcher] lista de empresas truncada", expect.anything());
  });

  it("falha do banco segue sendo o 500 de antes", async () => {
    falhaDoBanco = "conexão recusada";
    const resposta = await GET(requisicaoAutorizada());
    expect(resposta.status).toBe(500);
    expect(observadas).toEqual([]);
  });
});
