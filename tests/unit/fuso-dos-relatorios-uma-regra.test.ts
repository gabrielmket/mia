// @vitest-environment node
/**
 * MIA-102 · O FUSO DOS RELATÓRIOS, UMA REGRA SÓ — e a gravação que recusa o
 * fuso que não existe.
 *
 * ─── O defeito, medido ──────────────────────────────────────────────────────
 *
 * Eram três comportamentos para o mesmo `organizations.timezone` torto:
 *
 *   relatório comercial (`lib/relatorios/janela.ts`)   → UTC
 *   série do Desempenho (`fusoUtilizavel`)             → America/Sao_Paulo
 *   motor dos relatórios montados (9041)               → erro (só recuava no vazio)
 *
 * A venda das 22h de 31/10 em Brasília (01h de 01/11 em UTC) caía em novembro
 * no comercial e em outubro no Desempenho. Agora os três recuam para
 * `America/Sao_Paulo` (o motor na 9166, provado em
 * `tests/invariants/fuso-invalido-nos-relatorios.test.ts`), e a gravação
 * (`tenantSchema`, boas-vindas, MCP) recusa o nome que não existe.
 *
 * Dados fictícios (Academia Alfa).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { requireRole } from "@/lib/auth/require-role";
import { fusoDoRelatorio, janelaDoRelatorio, periodoPadrao, TZ_PADRAO } from "@/lib/relatorios/janela";
import { welcomeSchema } from "@/lib/schemas/onboarding";
import { tenantSchema } from "@/lib/schemas/settings";
import { createClient } from "@/lib/supabase/server";
import { fusoGravavel, MENSAGEM_DO_FUSO_INVALIDO } from "@/lib/tempo/fuso-gravavel";
import { FUSO_PADRAO, FUSOS_DO_ONBOARDING, FUSOS_OFERECIDOS, fusoUtilizavel } from "@/lib/tempo/fusos";

const RAIZ = path.resolve(__dirname, "../..");

/** A venda da reprodução: 22h de 31/10/2026 em Brasília. */
const VENDA = Date.parse("2026-10-31T22:00:00-03:00");

const TORTOS: (string | null | undefined)[] = [null, undefined, "", "   ", "America/Sao_Pualo", "America/Asunción", "Marte/Olimpo"];

describe("a leitura: vazio ou inválido vale Brasília", () => {
  it("o padrão do relatório comercial é o mesmo do resto do sistema", () => {
    expect(TZ_PADRAO).toBe(FUSO_PADRAO);
    expect(FUSO_PADRAO).toBe("America/Sao_Paulo");
  });

  it.each(TORTOS)("⭐ %j: o comercial e o Desempenho dão o mesmo fuso, Brasília", (tz) => {
    expect(fusoDoRelatorio(tz)).toBe("America/Sao_Paulo");
    expect(fusoDoRelatorio(tz)).toBe(fusoUtilizavel(tz));
  });

  it("fuso válido de outro lugar continua valendo (controle positivo)", () => {
    expect(fusoDoRelatorio("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(fusoDoRelatorio("Europe/Lisbon")).toBe(fusoUtilizavel("Europe/Lisbon"));
  });

  it("⭐ a venda das 22h de 31/10 em Brasília é de outubro com o fuso torto", () => {
    const outubro = janelaDoRelatorio("2026-10-01", "2026-10-31", "America/Sao_Pualo");
    expect(outubro.tz).toBe("America/Sao_Paulo");
    expect(Date.parse(outubro.from) <= VENDA && VENDA < Date.parse(outubro.to)).toBe(true);
    // E é a mesma janela do fuso escrito certo.
    expect(outubro).toEqual(janelaDoRelatorio("2026-10-01", "2026-10-31", "America/Sao_Paulo"));

    const novembro = janelaDoRelatorio("2026-11-01", "2026-11-30", null);
    expect(Date.parse(novembro.from) <= VENDA).toBe(false);
  });

  it("o período padrão (mês corrente) também é o de Brasília", () => {
    // 01h de 01/11 em UTC ainda é 31/10 em Brasília: o mês corrente é outubro.
    expect(periodoPadrao(new Date(VENDA), "America/Sao_Pualo")).toEqual({ de: "2026-10-01", ate: "2026-10-31" });
    expect(periodoPadrao(new Date(VENDA), null)).toEqual({ de: "2026-10-01", ate: "2026-10-31" });
  });
});

describe("a rota do relatório comercial", () => {
  beforeEach(() => vi.clearAllMocks());

  function dbQueRegistra() {
    const filtros: string[] = [];
    const builder = () => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        is: () => b,
        order: () => b,
        range: () => b,
        gte: (c: string, v: unknown) => (filtros.push(`gte:${c}=${String(v)}`), b),
        lt: (c: string, v: unknown) => (filtros.push(`lt:${c}=${String(v)}`), b),
        then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null, count: 0 }).then(ok, falha),
      };
      return b;
    };
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn(builder) } as never);
    return filtros;
  }

  it.each([null, "America/Sao_Pualo"])("⭐ organização com fuso %j: a janela é a de Brasília", async (timezone) => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: { id: "u1", idioma: "pt-BR", is_platform_admin: false, support: false },
      org: { orgId: "11111111-1111-4111-8111-111111111111", name: "Academia Alfa", role: "viewer", timezone, currency: "BRL" },
    } as never);
    const filtros = dbQueRegistra();

    const { GET } = await import("@/app/api/v1/reports/comercial/route");
    const res = await GET(new NextRequest("http://localhost/api/v1/reports/comercial?de=2026-10-01&ate=2026-10-31"));

    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { data: { janela: { tz: string; from: string; to: string } } };
    expect(corpo.data.janela).toMatchObject({
      tz: "America/Sao_Paulo",
      from: "2026-10-01T03:00:00.000Z",
      to: "2026-11-01T03:00:00.000Z",
    });
    expect(filtros).toContain("gte:closed_at=2026-10-01T03:00:00.000Z");
  });
});

describe("a gravação: nome fora da base é recusado", () => {
  it("todo fuso que as telas oferecem pode ser gravado", () => {
    for (const f of FUSOS_OFERECIDOS) expect(fusoGravavel(f.codigo), f.codigo).toBe(true);
    for (const f of FUSOS_DO_ONBOARDING) expect(fusoGravavel(f.id), f.id).toBe(true);
    // Fuso real fora da lista (a API e o MCP aceitam).
    expect(fusoGravavel("America/Chihuahua")).toBe(true);
    expect(fusoGravavel("Etc/GMT+3")).toBe(true);
  });

  it.each([
    "America/Sao_Pualo",
    "America/Asunción",
    "São Paulo",
    " America/Sao_Paulo",
    // O `Intl` aceita estes dois e o Postgres não: gravados, o TypeScript e o
    // motor dos relatórios dariam meses diferentes para a mesma venda.
    "america/manaus",
    "+03:00",
  ])("⭐ %j é recusado", (tz) => {
    expect(fusoGravavel(tz)).toBe(false);
  });

  const empresa = {
    display_name: "Academia Alfa",
    legal_name: "Academia Alfa Ltda",
    locale: "pt-BR",
    currency: "BRL",
    media_retention_days: 365,
    media_retention_enforced: true,
  };

  it("⭐ tenantSchema (Configurações, admin e MCP) recusa com a frase que diz o que mandar", () => {
    const r = tenantSchema.safeParse({ ...empresa, timezone: "America/Sao_Pualo" });
    expect(r.success).toBe(false);
    const problema = r.error!.issues.find((i) => i.path[0] === "timezone");
    expect(problema?.message).toBe(MENSAGEM_DO_FUSO_INVALIDO);
    expect(MENSAGEM_DO_FUSO_INVALIDO).toContain("America/Sao_Paulo");
  });

  it("tenantSchema aceita o fuso certo (controle positivo)", () => {
    const r = tenantSchema.safeParse({ ...empresa, timezone: "America/Sao_Paulo" });
    expect(r.error?.issues.filter((i) => i.path[0] === "timezone") ?? []).toEqual([]);
  });

  it("⭐ as boas-vindas recusam o fuso inválido e seguem com o padrão quando ele não vem", () => {
    const base = { display_name: "Academia Alfa" };
    expect(welcomeSchema.safeParse({ ...base, timezone: "America/Sao_Pualo" }).success).toBe(false);
    expect(welcomeSchema.parse(base).timezone).toBe("America/Sao_Paulo");
    expect(welcomeSchema.parse({ ...base, timezone: "America/Manaus" }).timezone).toBe("America/Manaus");
  });
});

describe("catraca: nenhum leitor de relatório com recuo próprio", () => {
  // O defeito era exatamente este: cada rota com o seu `?? "UTC"` ou `|| padrão`,
  // que deixa o nulo virar UTC ou o inválido passar direto para o `Intl`.
  it.each([
    "app/api/v1/reports/comercial/route.ts",
    "app/api/v1/relatorios/exportar/route.ts",
    "app/api/v1/relatorio-de-vendas/route.ts",
    "app/api/v1/metrics/serie/route.ts",
  ])("%s passa o fuso pela régua", (arquivo) => {
    const fonte = readFileSync(path.join(RAIZ, arquivo), "utf8");
    expect(fonte).not.toMatch(/timezone\)?(\s+as\s+[^?|;]+)?\s*(\?\?|\|\|)/);
    expect(fonte).toMatch(/fusoDoRelatorio\(|fusoUtilizavel\(/);
  });
});
