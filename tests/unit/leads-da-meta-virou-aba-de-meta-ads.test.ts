/**
 * FORK MIA (.61) — Configurações › Formulários da Meta virou a aba "Formulários
 * de leads" de Configurações › Meta Ads.
 *
 * O que se prova:
 *
 *   - o endereço antigo redireciona para a aba (há link salvo para ele);
 *   - o menu tem UM item da Meta em Configurações, e não dois: as duas telas usam
 *     o mesmo token, e dois itens faziam procurar num e achar no outro;
 *   - a página de Meta Ads monta a aba com o corpo que era da tela antiga.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ destino: null as string | null }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    h.destino = url;
    // O `redirect` de verdade interrompe a renderização lançando; o dublê faz igual.
    throw new Error("NEXT_REDIRECT");
  }),
}));

import LeadsDaMetaPage from "@/app/app/settings/leads-da-meta/page";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";

const RAIZ = path.resolve(__dirname, "../..");

describe("a tela antiga dos formulários", () => {
  it("redireciona para a aba Formulários de leads de Meta Ads", () => {
    expect(() => LeadsDaMetaPage()).toThrow("NEXT_REDIRECT");
    expect(h.destino).toBe("/app/settings/meta-ads?aba=formularios");
  });
});

describe("o menu", () => {
  it("não tem mais o item Formulários da Meta; Meta Ads fica, e fala dos formulários", () => {
    const hrefs = NAV_CATALOG.map((d) => d.href as string);
    expect(hrefs).not.toContain("/app/settings/leads-da-meta");
    const metaAds = NAV_CATALOG.filter((d) => d.href === "/app/settings/meta-ads");
    expect(metaAds).toHaveLength(1);
    expect(metaAds[0]!.description).toContain("formulários");
  });
});

describe("a página de Meta Ads", () => {
  it("tem as duas abas e usa o corpo que era da tela antiga", () => {
    const pagina = fs.readFileSync(path.join(RAIZ, "app/app/settings/meta-ads/page.tsx"), "utf8");
    expect(pagina).toContain('t("Contas de anúncio")');
    expect(pagina).toContain('t("Formulários de leads")');
    expect(pagina).toContain("<LeadsDaMetaClient />");
    // A aba só existe para quem pode usar a importação (módulo vendável).
    expect(pagina).toContain("leadsDaMetaLiberados");
    expect(fs.existsSync(path.join(RAIZ, "app/app/settings/leads-da-meta/_client.tsx"))).toBe(false);
  });
});
