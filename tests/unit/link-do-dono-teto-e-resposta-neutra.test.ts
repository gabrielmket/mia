/**
 * MIA-361 · ponto 2 · O TETO DE ACESSOS DO LINK DO DONO, e o que o acesso
 * seguinte recebe.
 *
 * ─── O que o código tem (conferido em 28/11/2026) ───────────────────────────
 *
 * 1. O teto é POR IP, não por link: 30 aberturas por minuto
 *    (`LIMITE_DA_PAGINA`, `lib/paineis/link.ts:83`), contadas ANTES de olhar o
 *    token (`app/painel/[token]/page.tsx:78`). Não existe teto de aberturas por
 *    link: a coluna `acessos` é contador ("informação, não portão",
 *    `lib/paineis/link.ts:542`), e o link com um milhão de aberturas continua
 *    abrindo até vencer ou ser revogado.
 * 2. Quem passa do teto recebe "Muitas tentativas" (200), que NÃO é a página
 *    neutra do vencido e do revogado (404, `not-found.tsx`). Não vaza nada:
 *    a resposta é a MESMA para token bom, token ruim, vencido e revogado, e
 *    nenhuma delas vai ao banco. É isso que se trava aqui.
 * 3. Vencido, revogado, inexistente, malformado, de outra linha e de empresa
 *    parada: a mesma página neutra (404), pelo `resolverLink` DE VERDADE, com o
 *    cliente de serviço falso devolvendo a linha.
 * 4. O contador: a abertura que mostra dado conta uma vez; a prévia do
 *    WhatsApp, a recusa do teto e o link que não abre não contam. Cada visita
 *    que desenha a página conta, inclusive a troca de período no link
 *    "escolhe" (`?periodo=`), que redesenha no servidor.
 *
 * A outra metade do teto (as 30 do mesmo IP e a 31ª barrada, outro IP abrindo)
 * já está em `tests/unit/link-do-dono-sem-valores-e-teto.test.ts` (MIA-106).
 *
 * Dados fictícios (Academia Alfa, Ana Exemplo). IPs de documentação (RFC 5737).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let cabecalhos: Record<string, string> = {};
vi.mock("next/headers", () => ({ headers: async () => new Headers(cabecalhos) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined), isServiceRoleConfigured: () => true }));
vi.mock("@/lib/i18n/idiomaAnonimo", () => ({ idiomaDoVisitante: async () => "pt-BR" }));
// Só o transporte: sem Redis, o limitador conta na memória do processo.
vi.mock("@/lib/redis-config", () => ({ validarConfigRedisRest: () => ({ ok: false, reason: "nao_configurado" }) }));

/** O cliente de serviço falso: as linhas de `mia_paineis_links` e o status da empresa. */
const banco = {
  links: [] as Array<Record<string, unknown>>,
  statusDaEmpresa: "active" as string,
  consultas: 0,
};

function adminFalso() {
  return {
    from: (tabela: string) => {
      banco.consultas++;
      const filtros: Array<(l: Record<string, unknown>) => boolean> = [];
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filtros.push((l) => l[col] === val);
          return q;
        },
        is: (col: string, val: unknown) => {
          filtros.push((l) => (l[col] ?? null) === val);
          return q;
        },
        maybeSingle: async () => {
          if (tabela === "organizations") return { data: { status: banco.statusDaEmpresa }, error: null };
          const achada = banco.links.find((l) => filtros.every((f) => f(l))) ?? null;
          return { data: achada, error: null };
        },
      });
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminFalso() }));

const registrarAcesso = vi.fn(async () => undefined);
const resolverLinkEspiao = vi.fn();
vi.mock("@/lib/paineis/link", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/paineis/link")>();
  return {
    ...real,
    // O de verdade, contado: a recusa do teto não pode chegar até ele.
    resolverLink: (...a: Parameters<typeof real.resolverLink>) => {
      resolverLinkEspiao(...a);
      return real.resolverLink(...a);
    },
    registrarAcesso: (...a: unknown[]) => registrarAcesso(...(a as [])),
  };
});
const calcularPaineis = vi.fn();
vi.mock("@/lib/paineis/calcular", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/paineis/calcular")>()),
  calcularPaineis: (...a: unknown[]) => calcularPaineis(...a),
}));

import PainelDoDonoPage from "@/app/painel/[token]/page";
import { hashDoToken, LIMITE_DA_PAGINA, resolverLink, tokenDoLink } from "@/lib/paineis/link";

const ORG = "a1fa0000-0000-4000-8000-00000000a1fa";
const ID_VIVO = "a1fa0000-9999-4000-8000-000000000001";
const ID_VENCIDO = "a1fa0000-9999-4000-8000-000000000002";
const ID_REVOGADO = "a1fa0000-9999-4000-8000-000000000003";
const ID_SEM_LINHA = "a1fa0000-9999-4000-8000-000000000004";
const DIA = 86_400_000;

function linha(id: string, parcial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    organization_id: ORG,
    para_quem: "Ana Exemplo, dona da Academia Alfa",
    paineis: ["resultado", "meta"],
    periodo: "escolhe",
    mostrar_valores: false,
    pipeline_id: null,
    painel_id: null,
    token_hash: hashDoToken(tokenDoLink(id)),
    expires_at: new Date(Date.now() + 30 * DIA).toISOString(),
    revoked_at: null,
    last_used_at: null,
    acessos: 0,
    created_by: null,
    created_via: "tela",
    created_at: "2026-10-01T00:00:00Z",
    ...parcial,
  };
}

const CALCULADOS = {
  organizationId: ORG,
  empresa: { nome: "Academia Alfa", demonstracao: false, fuso: "America/Manaus", moeda: "BRL" },
  periodo: "30",
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

/** Abre a página e devolve o que a pessoa vê: o texto, ou "404" (a página neutra). */
async function abrir(token: string, ip: string, extra: { agente?: string; periodo?: string } = {}): Promise<string> {
  cabecalhos = { "x-forwarded-for": ip, "user-agent": extra.agente ?? "Mozilla/5.0 (Linux; Android 14)" };
  try {
    const arvore = await PainelDoDonoPage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve(extra.periodo ? { periodo: extra.periodo } : {}),
    });
    return texto(arvore);
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_NOT_FOUND") return "404";
    throw e;
  }
}

beforeEach(() => {
  banco.links = [
    linha(ID_VIVO),
    linha(ID_VENCIDO, { expires_at: new Date(Date.now() - DIA).toISOString() }),
    linha(ID_REVOGADO, { revoked_at: new Date(Date.now() - DIA).toISOString() }),
  ];
  banco.statusDaEmpresa = "active";
  banco.consultas = 0;
  registrarAcesso.mockClear();
  resolverLinkEspiao.mockClear();
  calcularPaineis.mockReset();
  calcularPaineis.mockResolvedValue(CALCULADOS);
});

describe("⭐ o acesso seguinte ao teto", () => {
  it("passado o teto, token bom, ruim, vencido e revogado recebem a MESMA resposta, sem ir ao banco nem contar", async () => {
    const IP = "203.0.113.61";
    for (let i = 0; i < LIMITE_DA_PAGINA.porMinuto; i++) {
      expect(await abrir(tokenDoLink(ID_VIVO), IP), `abertura ${i + 1}`).toContain("Academia Alfa");
    }
    registrarAcesso.mockClear();
    resolverLinkEspiao.mockClear();
    banco.consultas = 0;

    const respostas = [
      await abrir(tokenDoLink(ID_VIVO), IP),
      await abrir(tokenDoLink(ID_VENCIDO), IP),
      await abrir(tokenDoLink(ID_REVOGADO), IP),
      await abrir(tokenDoLink(ID_SEM_LINHA), IP),
      await abrir("isto-nao-e-um-token", IP),
    ];
    expect(new Set(respostas).size).toBe(1);
    expect(respostas[0]).toContain("Muitas tentativas");
    expect(respostas[0]).not.toContain("Academia Alfa");
    expect(resolverLinkEspiao).not.toHaveBeenCalled();
    expect(banco.consultas).toBe(0);
    expect(registrarAcesso).not.toHaveBeenCalled();
    expect(calcularPaineis).not.toHaveBeenCalled();
  });
});

describe("⭐ o link que não abre: a mesma página neutra (404), pelo resolverLink de verdade", () => {
  it("vencido, revogado, inexistente e malformado: 404, sem calcular nem contar", async () => {
    const respostas = [
      await abrir(tokenDoLink(ID_VENCIDO), "198.51.100.1"),
      await abrir(tokenDoLink(ID_REVOGADO), "198.51.100.2"),
      await abrir(tokenDoLink(ID_SEM_LINHA), "198.51.100.3"),
      await abrir("0000", "198.51.100.4"),
    ];
    expect(respostas).toEqual(["404", "404", "404", "404"]);
    expect(calcularPaineis).not.toHaveBeenCalled();
    expect(registrarAcesso).not.toHaveBeenCalled();
  });

  it("empresa parada e token de outra linha (o hash bate, a derivação não): também 404", async () => {
    banco.statusDaEmpresa = "suspended";
    expect(await abrir(tokenDoLink(ID_VIVO), "198.51.100.5")).toBe("404");

    banco.statusDaEmpresa = "active";
    // A linha do ID_SEM_LINHA guardando o hash do token do ID_VIVO: a busca acha, a derivação recusa.
    banco.links = [linha(ID_SEM_LINHA, { token_hash: hashDoToken(tokenDoLink(ID_VIVO)) })];
    expect(await abrir(tokenDoLink(ID_VIVO), "198.51.100.6")).toBe("404");
    expect(registrarAcesso).not.toHaveBeenCalled();
  });

  it("CONTROLE: o link vivo abre e conta uma vez", async () => {
    expect(await abrir(tokenDoLink(ID_VIVO), "198.51.100.7")).toContain("Academia Alfa");
    expect(registrarAcesso).toHaveBeenCalledTimes(1);
  });
});

describe("⭐ não há teto por link: o contador não é portão", () => {
  it("o link vivo com um milhão de aberturas continua abrindo", async () => {
    banco.links = [linha(ID_VIVO, { acessos: 1_000_000 })];
    const r = await resolverLink(adminFalso() as never, tokenDoLink(ID_VIVO));
    expect(r?.link.acessos).toBe(1_000_000);
    expect(r?.link.situacao).toBe("ativo");
    expect(await abrir(tokenDoLink(ID_VIVO), "198.51.100.8")).toContain("Academia Alfa");
  });
});

describe("⭐ o que conta como abertura", () => {
  it("a prévia do WhatsApp não vai ao banco nem conta; a pessoa conta", async () => {
    const previa = await abrir(tokenDoLink(ID_VIVO), "198.51.100.9", { agente: "WhatsApp/2.24.1 A" });
    expect(previa).not.toContain("Academia Alfa");
    expect(banco.consultas).toBe(0);
    expect(registrarAcesso).not.toHaveBeenCalled();

    await abrir(tokenDoLink(ID_VIVO), "198.51.100.9");
    expect(registrarAcesso).toHaveBeenCalledTimes(1);
  });

  it("no link 'escolhe', cada troca de período redesenha no servidor e conta outra abertura", async () => {
    await abrir(tokenDoLink(ID_VIVO), "198.51.100.10");
    await abrir(tokenDoLink(ID_VIVO), "198.51.100.10", { periodo: "7" });
    await abrir(tokenDoLink(ID_VIVO), "198.51.100.10", { periodo: "90" });
    expect(registrarAcesso).toHaveBeenCalledTimes(3);
    expect(registrarAcesso.mock.calls.map((c) => (c as unknown[])[2])).toEqual(["30", "7", "90"]);
  });
});
