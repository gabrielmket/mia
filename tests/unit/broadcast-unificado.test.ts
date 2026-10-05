/**
 * FORK MIA — A CERCA DO BROADCAST UNIFICADO (1.21.0-mia.58).
 *
 * Desenho em docs/fork/broadcast-unificado.md. O que cada bloco segura, e o
 * defeito silencioso que ele impede:
 *
 *   1. O MENU. Uma porta só ("Broadcast"); "Campanhas" não volta ao menu numa
 *      fusão do upstream sem ninguém decidir. E quem não tem o módulo não vê a
 *      porta.
 *   2. AS ROTAS DO MÓDULO. Toda rota sob um prefixo que o módulo declara
 *      proteger confere o módulo de fato — inline (`moduloLiberado`) ou pelo
 *      `resource` que o `requireRole` reconhece. O dia em que o upstream
 *      renomear o `resource` das Campanhas, a trava sumiria sem erro nenhum;
 *      aqui ela reprova. (Foi esta cerca que achou a rota de mídia do disparo
 *      oficial sem a conferência.)
 *   3. O `requireRole` DE VERDADE. A trava pelo recurso é medida chamando o
 *      `requireRole` real, com o banco dublado: sem o módulo, 403; com ele, ok;
 *      recurso fora da lista nem pergunta ao banco.
 *   4. AS PORTAS DE TELA. `/app/campaigns` leva ao Broadcast, e as telas de
 *      dentro de `/app/campaigns/*` voltam para o Broadcast quem não pode usá-las.
 *
 *     npx vitest run tests/unit/broadcast-unificado.test.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import type * as AuthServer from "@/lib/auth/server";
import { loadAuthUser, mfaEmDivida, orgAtivaSemPortao, resolveActiveOrg } from "@/lib/auth/server";
import type { AuthUser } from "@/lib/auth/types";
import {
  moduloExigidoPeloRecurso,
  QR_EXIGE_O_MODULO,
  RECURSOS_DO_QR,
  ROTAS_DO_QR,
} from "@/lib/broadcast/canais-do-disparo";
import { MODULOS, moduloDaRota } from "@/lib/modulos/vendaveis";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { hubSections, searchable, sidebarGroups } from "@/lib/navigation/registry";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/server", async (importOriginal) => {
  const real = await importOriginal<typeof AuthServer>();
  return {
    ...real,
    loadAuthUser: vi.fn(),
    resolveActiveOrg: vi.fn(),
    // Desde a 1.70 do upstream o `requireRole` lê a org ativa por aqui (sem o
    // portão que redireciona a org suspensa) e recusa a org não operante.
    orgAtivaSemPortao: vi.fn(),
    mfaEmDivida: vi.fn(),
    requireAuth: vi.fn(),
  };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => false,
  hashEmail: (e: string) => e,
}));

const RAIZ = join(__dirname, "..", "..");

// ─── 1. o menu ────────────────────────────────────────────────────────────

describe("o menu tem uma porta só para os dois caminhos", () => {
  const hrefs = () => NAV_CATALOG.map((d) => d.href as string);
  const doHubDoCrm = (modulos: string[] | undefined, platform = false) =>
    hubSections("crm", platform, "manager", undefined, modulos).flatMap((s) => s.items.map((i) => i.href));

  it("'Campanhas' não está no catálogo; 'Broadcast' está, no CRM, só no hub", () => {
    expect(hrefs()).not.toContain("/app/campaigns");
    const b = NAV_CATALOG.find((d) => d.href === "/app/broadcast");
    expect(b).toMatchObject({ label: "Broadcast", group: "crm", section: "O dia a dia da venda", minRole: "manager" });
    expect((b as { sidebar?: boolean }).sidebar).toBeUndefined();
  });

  it("quem procura 'campanha' no ⌘K acha o Broadcast", () => {
    const b = NAV_CATALOG.find((d) => d.href === "/app/broadcast")!;
    expect(b.description.toLowerCase()).toContain("campanhas");
  });

  it("com o módulo, o hub do CRM mostra o Broadcast; sem ele, nenhum dos dois", () => {
    expect(doHubDoCrm(["disparador"])).toContain("/app/broadcast");
    expect(doHubDoCrm([])).not.toContain("/app/broadcast");
    expect(doHubDoCrm([])).not.toContain("/app/campaigns");
    // Nem pelo menu lateral nem pela busca — as três projeções saem do catálogo.
    const lateral = sidebarGroups(false, "manager", undefined, []).flatMap((g) => g.items.map((i) => i.href));
    expect(lateral).not.toContain("/app/broadcast");
    const busca = searchable(false, "manager", undefined, []).map((d) => d.href);
    expect(busca).not.toContain("/app/broadcast");
    expect(busca).not.toContain("/app/campaigns");
  });

  it("abaixo de manager a porta não aparece, com ou sem módulo", () => {
    const hub = hubSections("crm", false, "agent", undefined, ["disparador"]).flatMap((s) =>
      s.items.map((i) => i.href),
    );
    expect(hub).not.toContain("/app/broadcast");
  });
});

// ─── 2. as rotas do módulo ────────────────────────────────────────────────

function arquivosDeRota(prefixo: string): string[] {
  const dir = join(RAIZ, "app", ...prefixo.split("/").filter(Boolean));
  const achados: string[] = [];
  const visitar = (d: string) => {
    for (const nome of readdirSync(d)) {
      const p = join(d, nome);
      if (statSync(p).isDirectory()) visitar(p);
      else if (nome === "route.ts") achados.push(p);
    }
  };
  visitar(dir);
  return achados;
}

describe("toda rota que o módulo diz proteger, protege de fato", () => {
  const modulo = MODULOS.find((m) => m.chave === "disparador")!;

  // Vale nas DUAS posições do interruptor: virar a chave é uma linha em
  // `canais-do-disparo.ts`, e esta cerca acompanha sem precisar ser reescrita.
  it("as rotas do QR estão no módulo se, e só se, o interruptor está ligado", () => {
    for (const r of ROTAS_DO_QR) {
      expect(modulo.rotas.includes(r)).toBe(QR_EXIGE_O_MODULO);
      expect(moduloDaRota(`${r}/qualquer`)).toBe(QR_EXIGE_O_MODULO ? "disparador" : null);
    }
    // Quem libera lê a descrição: ela diz que o QR vem junto quando vem.
    expect(modulo.descricao.includes("QR")).toBe(QR_EXIGE_O_MODULO);
  });

  it.each(modulo.rotas)("%s: cada arquivo de rota confere o módulo", (prefixo) => {
    const arquivos = arquivosDeRota(prefixo);
    // Controle de vacuidade: prefixo que não acha arquivo passaria sem medir nada.
    expect(arquivos.length, `nenhuma rota encontrada sob ${prefixo}`).toBeGreaterThan(0);

    const semGuarda: string[] = [];
    for (const arquivo of arquivos) {
      const fonte = readFileSync(arquivo, "utf8");
      const recursos = [...fonte.matchAll(/requireRole\([^)]*resource:\s*"([^"]+)"/g)].map((m) => m[1]!);
      const confereInline = fonte.includes("moduloLiberado(");
      const confereNoRequireRole =
        recursos.length > 0 && recursos.every((r) => moduloExigidoPeloRecurso(r) === "disparador");
      if (!confereInline && !confereNoRequireRole) {
        semGuarda.push(`${arquivo.replace(RAIZ, "")} (resource: ${recursos.join(", ") || "nenhum"})`);
      }
    }
    expect(
      semGuarda,
      "rota sob um prefixo do módulo sem conferir o módulo: o menu esconde, mas esconder não é recusar. " +
        "Confira com moduloLiberado() na rota, ou (para as rotas do upstream) garanta que o `resource` do " +
        "requireRole está em RECURSOS_DO_QR (lib/broadcast/canais-do-disparo.ts)",
    ).toEqual([]);
  });

  it("as rotas do QR usam só recursos que a trava conhece — e todos eles aparecem", () => {
    const usados = new Set<string>();
    for (const prefixo of ROTAS_DO_QR) {
      for (const arquivo of arquivosDeRota(prefixo)) {
        for (const m of readFileSync(arquivo, "utf8").matchAll(/requireRole\([^)]*resource:\s*"([^"]+)"/g)) {
          usados.add(m[1]!);
        }
      }
    }
    expect([...usados].sort()).toEqual([...RECURSOS_DO_QR].sort());
  });
});

// ─── 3. o requireRole de verdade ──────────────────────────────────────────

const ORG = "22222222-2222-4222-8222-222222222222";

function bancoDublado(liberado: boolean) {
  const consultas: string[] = [];
  const cadeia = {
    select: () => cadeia,
    eq: () => cadeia,
    is: () => cadeia,
    maybeSingle: async () => ({ data: liberado ? { id: "lib" } : null, error: null }),
  };
  return {
    consultas,
    cliente: {
      rpc: vi.fn(async () => ({ data: "manager", error: null })),
      from: vi.fn((tabela: string) => {
        consultas.push(tabela);
        return cadeia;
      }),
    },
  };
}

function preparar(liberado: boolean) {
  const banco = bancoDublado(liberado);
  vi.mocked(loadAuthUser).mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    email: "gerente@teste.local",
    is_platform_admin: false,
    organizations: [],
  } as unknown as AuthUser);
  vi.mocked(resolveActiveOrg).mockResolvedValue({ orgId: ORG, name: "Org", role: "manager" });
  vi.mocked(orgAtivaSemPortao).mockResolvedValue({ orgId: ORG, name: "Org", role: "manager", org_status: "active" });
  vi.mocked(mfaEmDivida).mockResolvedValue(false);
  vi.mocked(createClient).mockResolvedValue(banco.cliente as unknown as Awaited<ReturnType<typeof createClient>>);
  return banco;
}

describe("o requireRole trava as Campanhas pelo módulo", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(RECURSOS_DO_QR)("%s sem o módulo: 403 com o interruptor ligado, livre com ele desligado", async (resource) => {
    preparar(false);
    const r = await requireRole("manager", { requestId: "req", resource });
    expect(r.ok).toBe(!QR_EXIGE_O_MODULO);
    if (!r.ok) {
      expect(r.response.status).toBe(403);
      const corpo = (await r.response.json()) as { error: { code: string; message: string } };
      expect(corpo.error.code).toBe("forbidden");
      expect(corpo.error.message).toContain("não está contratado");
    }
  });

  it("com o módulo, passa", async () => {
    const banco = preparar(true);
    const r = await requireRole("manager", { requestId: "req", resource: "campaigns" });
    expect(r.ok).toBe(true);
    expect(banco.consultas).toEqual(QR_EXIGE_O_MODULO ? ["organization_modules"] : []);
  });

  it("recurso fora da lista nem pergunta ao banco — nada muda para o resto do produto", async () => {
    const banco = preparar(false);
    const r = await requireRole("manager", { requestId: "req", resource: "leads" });
    expect(r.ok).toBe(true);
    expect(banco.consultas).toEqual([]);
  });
});

// ─── 4. as portas de tela ─────────────────────────────────────────────────

function destinoDoRedirect(fn: () => unknown): string | null {
  try {
    fn();
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    // `NEXT_REDIRECT;replace;/app/broadcast;307;`
    return digest.startsWith("NEXT_REDIRECT") ? (digest.split(";")[2] ?? null) : null;
  }
  return null;
}

describe("as telas de Campanhas levam ao Broadcast", () => {
  it("a lista /app/campaigns redireciona para /app/broadcast", async () => {
    const { default: CampanhasPage } = await import("@/app/app/campaigns/page");
    expect(destinoDoRedirect(() => CampanhasPage())).toBe("/app/broadcast");
  });

  it("quem não pode usar o QR, ao abrir qualquer tela de /app/campaigns, volta para o Broadcast", async () => {
    vi.resetModules();
    vi.doMock("@/lib/broadcast/acesso", () => ({
      acessoAoBroadcast: vi.fn(async () => ({ user: {}, acesso: { estado: "nao_contratado" } })),
    }));
    const { default: Layout } = await import("@/app/app/campaigns/layout");
    let destino: string | null = null;
    try {
      await Layout({ children: null });
    } catch (e) {
      destino = ((e as { digest?: string }).digest ?? "").split(";")[2] ?? null;
    }
    expect(destino).toBe("/app/broadcast");
    vi.doUnmock("@/lib/broadcast/acesso");
  });

  it("quem pode, vê a tela de Campanhas embrulhada na faixa do Broadcast", async () => {
    vi.resetModules();
    vi.doMock("@/lib/broadcast/acesso", () => ({
      acessoAoBroadcast: vi.fn(async () => ({
        user: {},
        acesso: { estado: "liberado", canais: { oficial: true, qr: true } },
      })),
    }));
    const { default: Layout } = await import("@/app/app/campaigns/layout");
    const arvore = (await Layout({ children: "TELA DO UPSTREAM" })) as {
      props: { children: [{ type: { name: string } }, string] };
    };
    expect(arvore.props.children[0].type.name).toBe("FaixaDoQr");
    expect(arvore.props.children[1]).toBe("TELA DO UPSTREAM");
    vi.doUnmock("@/lib/broadcast/acesso");
  });
});
