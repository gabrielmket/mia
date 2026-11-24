/**
 * FORK MIA (MIA-218) · o relatório interno (`cron/report-da-plataforma`) avisa
 * quando há empresa operante com o padrão de IA num provedor sem chave.
 *
 * A régua é a de verdade (`iaDasEmpresas` e `recadoDaIaSemChave`); fica de
 * mentira só o que não é desta seção (grupo, saldo, backup, jornada) e a
 * leitura do `.env`: a instalação daqui tem chave da OpenAI e de mais nenhum.
 *
 * As promessas:
 *  - com empresa sem chave, na rodada da hora cheia ou de 15 em 15 min: um
 *    recado, com a chave anti-ruído do dia e a contagem, sem nome de empresa;
 *  - suspensa não conta;
 *  - fora das rodadas de 15 min, nem lê as empresas;
 *  - todas com chave, ou a leitura falhou: nada ("não sei" não é alarme).
 *
 * Empresas fictícias.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const estado = vi.hoisted(() => ({
  tabelas: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  lidas: [] as string[],
  recados: [] as Array<{ chave: string; horas: number; texto: string; detalhe?: unknown }>,
}));

vi.mock("@/lib/auth/cron-auth", () => ({ autorizaCron: () => true }));
vi.mock("@/lib/avisos/report-da-plataforma", () => ({
  grupoDeReport: async () => ({ limiteSaldoUsd: 10 }),
  reportar: async (_admin: unknown, r: { chave: string; horas: number; texto: string; detalhe?: unknown }) => {
    estado.recados.push(r);
    return true;
  },
}));
vi.mock("@/lib/ai/custo/saldo-da-plataforma", () => ({ saldoDaPlataformaParaOVigia: async () => ({ saldoUsd: null }) }));
vi.mock("@/lib/ai/custo/aviso-do-credito", () => ({ avisoDoCreditoDeIa: () => null }));
vi.mock("@/lib/backup/aviso-do-backup", () => ({ vigiarBackup: async () => ({ avisados: [], resolvidos: [] }) }));
vi.mock("@/lib/planos-mia/recados", () => ({ mandarRecadosDaJornada: async () => [] }));
vi.mock("@/lib/demonstracao/fora-das-metricas", () => ({
  excluirDemonstracao: (q: unknown) => q,
  idsDasEmpresasDeDemonstracao: async () => [],
  SEM_DEMONSTRACAO: "",
}));
vi.mock("@/lib/instalacao/ambiente", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/instalacao/ambiente")>();
  return { ...real, lerAmbiente: () => ({ ...real.lerAmbiente(), chavesDeProvedor: { openai: true } }) };
});

/** O admin: toda consulta vem vazia, menos as duas que `iaDasEmpresas` faz. */
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: null, error: null }),
    from: (tabela: string) => {
      estado.lidas.push(tabela);
      const resposta = estado.tabelas[tabela] ?? { data: [], error: null, count: 0 };
      const cadeia: Record<string, unknown> = {
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        then: (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.resolve(resposta).then(ok, erro),
      };
      for (const m of ["select", "eq", "neq", "in", "is", "not", "gt", "gte", "lt", "lte", "order", "limit", "or"]) {
        cadeia[m] = () => cadeia;
      }
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

function comEmpresas(lista: Array<Record<string, unknown>>) {
  estado.tabelas = {
    organizations: { data: lista, error: null },
    ai_provider_credentials: { data: [], error: null },
  };
}

async function rodarAs(hora: string) {
  vi.setSystemTime(new Date(hora));
  const { GET } = await import("@/app/api/v1/cron/report-da-plataforma/route");
  await GET(new NextRequest("http://localhost/api/v1/cron/report-da-plataforma"));
  return estado.recados.filter((r) => r.chave === "ia_das_empresas_sem_chave");
}

describe("relatório interno — a IA das empresas sem chave", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    estado.lidas = [];
    estado.recados = [];
  });
  afterEach(() => vi.useRealTimers());

  it("⭐ empresa operante sem chave: um recado por dia, com a contagem e sem nome de empresa (a suspensa não conta)", async () => {
    comEmpresas([
      empresa("org-a", "Clínica Exemplo", "openai", { ia_segue_a_plataforma: true }),
      empresa("org-b", "Academia Beta", "anthropic"),
      empresa("org-e", "Studio Delta", "anthropic", { status: "suspended" }),
    ]);
    const recados = await rodarAs("2026-11-24T13:15:00Z");
    expect(recados).toHaveLength(1);
    expect(recados[0]!.horas).toBe(24);
    expect(recados[0]!.detalhe).toEqual({ empresas_sem_chave: 1 });
    expect(recados[0]!.texto).toContain("1 empresa está");
    expect(recados[0]!.texto).toContain("plataforma_ver_ia_das_empresas");
    for (const nome of ["Academia Beta", "Studio Delta", "org-b"]) expect(recados[0]!.texto).not.toContain(nome);
  });

  it("fora das rodadas de 15 em 15 minutos, nem lê as empresas", async () => {
    comEmpresas([empresa("org-b", "Academia Beta", "anthropic")]);
    const recados = await rodarAs("2026-11-24T13:07:00Z");
    expect(recados).toHaveLength(0);
    expect(estado.lidas).not.toContain("ai_provider_credentials");
  });

  it("todas com chave: nada", async () => {
    comEmpresas([empresa("org-a", "Clínica Exemplo", "openai")]);
    expect(await rodarAs("2026-11-24T13:30:00Z")).toHaveLength(0);
  });

  it("a leitura falhou: nada, porque \"não sei\" não é alarme", async () => {
    comEmpresas([empresa("org-b", "Academia Beta", "anthropic")]);
    estado.tabelas.ai_provider_credentials = { data: null, error: { message: "fora do ar" } };
    expect(await rodarAs("2026-11-24T13:45:00Z")).toHaveLength(0);
  });
});
