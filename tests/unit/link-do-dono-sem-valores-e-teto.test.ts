/**
 * MIA-106 · O LINK DO DONO (`/painel/<token>`): "mostrar valores" desligado não
 * deixa sair R$, e o teto de acessos vale de verdade.
 *
 * ─── Os caminhos por onde um valor poderia sair ─────────────────────────────
 *
 * 1. PÁGINA. Ela é o único caminho: nenhuma rota de API, JSON ou CSV resolve o
 *    token (a cerca do fim deste arquivo trava isso; quem criar outro caminho
 *    tem de passar por aqui). A exportação em CSV do montador exige sessão de
 *    gestor (`app/api/v1/relatorios/exportar`), e o link não tem sessão.
 * 2. JSON. As props do `GradeDoPainel` (componente de cliente) viajam no
 *    payload do RSC. O que vai nelas vem do motor, então o que se trava aqui é
 *    que TODA chamada ao motor feita para o link leva `p_valores = false`:
 *    os prontos (`calcularPaineis`), o painel do montador
 *    (`calcularPainelDoDono`, inclusive o item com período próprio) e o cartão
 *    "resultado" que a página calcula para o nome da empresa. Que o motor com
 *    `p_valores = false` não devolve dinheiro em lugar nenhum do jsonb é
 *    provado no banco, em `tests/invariants/anuncios-e-sem-valores-no-montador.test.ts`.
 *
 * ─── O teto ─────────────────────────────────────────────────────────────────
 *
 * 30 aberturas por minuto por IP (`LIMITE_DA_PAGINA`), contadas ANTES de olhar
 * o token, com o limitador de verdade (só o Redis é trocado pela memória do
 * processo, o caminho que ele já tem quando o Redis falta): a 31ª do mesmo IP
 * recebe "Muitas tentativas" sem ir ao banco, e outro IP continua abrindo.
 *
 * Dados fictícios (Academia Alfa).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

let cabecalhos: Record<string, string> = {};
vi.mock("next/headers", () => ({ headers: async () => new Headers(cabecalhos) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), isServiceRoleConfigured: () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/i18n/idiomaAnonimo", () => ({ idiomaDoVisitante: async () => "pt-BR" }));
// Só o transporte: sem Redis, o limitador conta na memória do processo.
vi.mock("@/lib/redis-config", () => ({ validarConfigRedisRest: () => ({ ok: false, reason: "nao_configurado" }) }));

const resolverLink = vi.fn();
const registrarAcesso = vi.fn(async () => undefined);
vi.mock("@/lib/paineis/link", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/paineis/link")>()),
  resolverLink: (...a: unknown[]) => resolverLink(...a),
  registrarAcesso: (...a: unknown[]) => registrarAcesso(...(a as [])),
}));
const calcularPaineis = vi.fn();
vi.mock("@/lib/paineis/calcular", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/paineis/calcular")>()),
  calcularPaineis: (...a: unknown[]) => calcularPaineis(...a),
}));
const calcularPainelDoDono = vi.fn();
vi.mock("@/lib/relatorios/link", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/relatorios/link")>()),
  calcularPainelDoDono: (...a: unknown[]) => calcularPainelDoDono(...a),
}));

import PainelDoDonoPage from "@/app/painel/[token]/page";

const ORG = "a1fa0000-0000-4000-8000-00000000a1fa";
const TOKEN = "0123456789abcdefghjkmnpq";

function link(parcial: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    link: {
      id: "a1fa0000-9999-4000-8000-000000000001",
      paraQuem: "Dono da Academia Alfa",
      paineis: ["resultado", "meta"],
      periodo: "mes",
      mostrarValores: false,
      pipelineId: null,
      painelId: null,
      validoAte: "2026-12-31T00:00:00Z",
      revogadoEm: null,
      ultimoAcesso: null,
      acessos: 0,
      criadoEm: "2026-10-01T00:00:00Z",
      criadoPor: "tela",
      situacao: "ativo",
      url: `https://exemplo.invalid/painel/${TOKEN}`,
      ...parcial,
    },
  };
}

const CALCULADOS = {
  organizationId: ORG,
  empresa: { nome: "Academia Alfa", demonstracao: false, fuso: "America/Manaus", moeda: "BRL" },
  periodo: "mes",
  janela: { de: null, ate: null, hoje: null },
  funil: null,
  funis: [],
  valores: false,
  paineis: [],
  calculadoEm: "2026-10-15T12:00:00Z",
};

/** O texto de uma árvore de elementos React, sem renderizar (props.children). */
function texto(no: unknown): string {
  if (no === null || no === undefined || typeof no === "boolean") return "";
  if (typeof no === "string" || typeof no === "number") return String(no);
  if (Array.isArray(no)) return no.map(texto).join(" ");
  const props = (no as { props?: { children?: unknown } }).props;
  return props ? texto(props.children) : "";
}

async function abrir(ip: string) {
  cabecalhos = { "x-forwarded-for": ip, "user-agent": "Mozilla/5.0 (Linux; Android 14)" };
  return PainelDoDonoPage({ params: Promise.resolve({ token: TOKEN }), searchParams: Promise.resolve({}) });
}

beforeEach(() => {
  resolverLink.mockReset();
  calcularPaineis.mockReset();
  calcularPainelDoDono.mockReset();
  calcularPaineis.mockResolvedValue(CALCULADOS);
  calcularPainelDoDono.mockResolvedValue({ nome: "Painel da Academia Alfa", itens: [], deFora: 0, calculadoEm: "2026-10-15T12:00:00Z" });
});

describe("⭐ o teto de acessos da página", () => {
  it("30 aberturas por minuto do mesmo IP; a 31ª não chega ao banco; outro IP continua abrindo", async () => {
    resolverLink.mockResolvedValue(link());
    for (let i = 1; i <= 30; i++) {
      expect(texto(await abrir("203.0.113.10")), `abertura ${i}`).not.toContain("Muitas tentativas");
    }
    expect(resolverLink).toHaveBeenCalledTimes(30);

    expect(texto(await abrir("203.0.113.10"))).toContain("Muitas tentativas");
    expect(resolverLink).toHaveBeenCalledTimes(30);

    expect(texto(await abrir("198.51.100.20"))).not.toContain("Muitas tentativas");
    expect(resolverLink).toHaveBeenCalledTimes(31);
  });
});

describe("⭐ 'mostrar valores' desligado chega ao cálculo", () => {
  it("os prontos são calculados sem valores", async () => {
    resolverLink.mockResolvedValue(link());
    await abrir("192.0.2.1");
    expect(calcularPaineis).toHaveBeenCalledTimes(1);
    expect(calcularPaineis.mock.calls[0]![1]).toMatchObject({ organizationId: ORG, valores: false });
    expect(calcularPainelDoDono).not.toHaveBeenCalled();
  });

  it("o painel do montador e o cartão do nome da empresa também", async () => {
    resolverLink.mockResolvedValue(link({ painelId: "a1fa0000-8888-4000-8000-000000000001", paineis: [] }));
    await abrir("192.0.2.2");
    expect(calcularPainelDoDono.mock.calls[0]![1]).toMatchObject({ organizationId: ORG, valores: false });
    expect(calcularPaineis.mock.calls[0]![1]).toMatchObject({ organizationId: ORG, valores: false });
  });

  it("CONTROLE: com 'mostrar valores' ligado, o cálculo pede valores", async () => {
    resolverLink.mockResolvedValue(link({ mostrarValores: true }));
    await abrir("192.0.2.3");
    expect(calcularPaineis.mock.calls[0]![1]).toMatchObject({ valores: true });
  });
});

// ─── Do cálculo ao motor: toda chamada leva p_valores = false ───────────────

type Rpc = { nome: string; args: Record<string, unknown> };

/** Um cliente de serviço falso: cada tabela responde o que se pôs; o motor não responde (o item vira "erro"). */
function adminFalso(tabelas: Record<string, unknown>): { db: never; rpc: Rpc[] } {
  const rpc: Rpc[] = [];
  const db = {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpc.push({ nome, args });
      return { data: null, error: null };
    },
    from: (tabela: string) => {
      const dado = tabelas[tabela] ?? null;
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        in: () => q,
        is: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: Array.isArray(dado) ? (dado[0] ?? null) : dado, error: null }),
        then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
          Promise.resolve({ data: Array.isArray(dado) ? dado : dado ? [dado] : [], error: null }).then(ok, falha),
      });
      return q;
    },
  };
  return { db: db as never, rpc };
}

const FUNIS = [{ id: "a1fa0000-2222-4000-8000-00000000000a", name: "Matrículas", vocabulary: {}, is_default: true, is_archived: false, position: 1 }];

describe("⭐ do cálculo ao motor", () => {
  it("os doze prontos: toda chamada ao motor leva p_valores = false", async () => {
    const { calcularPaineis: real } = await vi.importActual<typeof import("@/lib/paineis/calcular")>("@/lib/paineis/calcular");
    const { db, rpc } = adminFalso({
      organizations: { display_name: "Academia Alfa", timezone: "America/Manaus", currency: "BRL", demonstracao: false },
      crm_pipelines: FUNIS,
    });
    await real(db, { organizationId: ORG, periodo: "mes", valores: false });
    expect(rpc.length).toBeGreaterThanOrEqual(12);
    for (const c of rpc) {
      expect(c.nome).toBe("fn_mia_relatorio");
      expect(c.args.p_org).toBe(ORG);
      expect(c.args.p_valores).toBe(false);
    }
  });

  it("o painel do montador: o pronto, o salvo com período próprio, e nada do que identifica pessoa", async () => {
    const { calcularPainelDoDono: real } = await vi.importActual<typeof import("@/lib/relatorios/link")>("@/lib/relatorios/link");
    const PAINEL = "a1fa0000-8888-4000-8000-000000000001";
    const SALVO = "a1fa0000-7777-4000-8000-000000000001";
    const POR_PESSOA = "a1fa0000-7777-4000-8000-000000000002";
    const salvo = (id: string, nome: string, dim1: string) => ({
      id,
      nome,
      fonte: "negocios",
      medida: "soma",
      dim1,
      dim2: null,
      filtros: {},
      periodo: "30",
      de: null,
      ate: null,
      comparar: true,
      visualizacao: "barras",
    });
    const item = (id: string, posicao: number, extra: Record<string, unknown>) => ({
      id,
      painel_id: PAINEL,
      relatorio_id: null,
      pronto: null,
      tamanho: "M",
      periodo_proprio: false,
      posicao,
      ...extra,
    });
    const { db, rpc } = adminFalso({
      mia_paineis_usuario: { id: PAINEL, nome: "Painel da Academia Alfa", periodo: "30", compartilhado: true, created_by: null, criado_via: "tela", updated_at: "2026-10-01T00:00:00Z" },
      mia_paineis_usuario_itens: [
        item("a1fa0000-6666-4000-8000-000000000001", 1, { pronto: "resultado" }),
        item("a1fa0000-6666-4000-8000-000000000002", 2, { relatorio_id: SALVO, periodo_proprio: true }),
        item("a1fa0000-6666-4000-8000-000000000003", 3, { relatorio_id: POR_PESSOA }),
      ],
      crm_pipelines: FUNIS,
      mia_relatorios_da_empresa: null,
      mia_relatorios: [salvo(SALVO, "Vendas por origem", "origem"), salvo(POR_PESSOA, "Vendas por responsável", "resp")],
    });
    const painel = await real(db, { organizationId: ORG, painelId: PAINEL, periodo: "mes", valores: false });
    expect(painel?.deFora).toBe(1);
    expect(painel?.itens.map((i) => i.titulo)).not.toContain("Vendas por responsável");
    expect(rpc).toHaveLength(2);
    for (const c of rpc) {
      expect(c.args.p_org).toBe(ORG);
      expect(c.args.p_valores).toBe(false);
    }
  });
});

// ─── A cerca: a página é o único caminho que resolve o token ────────────────

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const p = path.join(dir, nome);
    return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(nome) ? [p] : [];
  });
}

describe("⭐ o link do dono só abre pela página", () => {
  it("só app/painel/[token]/page.tsx resolve o token do link dos painéis (nenhuma rota de JSON ou CSV)", () => {
    const raiz = process.cwd();
    const quem = arquivos(path.join(raiz, "app"))
      .filter((p) => {
        const fonte = readFileSync(p, "utf8");
        return /from\s+["']@\/lib\/paineis\/link["']/.test(fonte) && /\bresolverLink\b/.test(fonte);
      })
      .map((p) => path.relative(raiz, p).split(path.sep).join("/"));
    expect(quem).toEqual(["app/painel/[token]/page.tsx"]);
  });
});
