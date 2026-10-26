/**
 * FORK MIA (.89) — TODA TELA DO APP TEM AJUDA NO ASSISTENTE.
 *
 * Em 26/10/2026, na tela "Servidor MCP externo", o Gabriel perguntou "como eu
 * uso o mcp aqui" e o assistente respondeu que não sabia. A tela existia; a
 * ajuda dela, não. A causa era cobertura, e cobertura que ninguém mede some
 * calada a cada tela nova.
 *
 * Esta cerca percorre o catálogo de navegação E as páginas do app
 * (`app/app/**\/page.tsx`): toda tela principal (porta do catálogo, ou rota que
 * não mora debaixo de outra, como cada subpágina de Configurações) tem de ter
 * pelo menos um trecho de ajuda ligado a ELA (manual do fork, roteiro ou
 * funcionalidade do guia de operação), e toda subpágina tem de ser alcançada
 * pela ajuda da tela de cima. A linha do mapa do guia não conta: ela só diz
 * "onde fica", não "como faço".
 *
 * Vermelho = escreva o manual da tela em `lib/assistente/manuais-das-telas.ts`
 * (lendo o código da tela) ou ligue a tela a um manual que já existe por `telas`.
 */
import { describe, expect, it } from "vitest";

import { HUBS } from "@/lib/assistente/busca-da-ajuda";
import { TRECHOS_DA_MIA } from "@/lib/assistente/guia-de-operacao";
import { telasDoManual } from "@/lib/assistente/leituras/ajuda";
import { MANUAIS } from "@/lib/assistente/manuais";

import { hrefsDoCatalogo, rotasDoApp, telasPrincipais } from "./helpers/telas-do-app";

/** Cada tela ligada a alguma ajuda "como faço", com a fonte de cada uma. */
function ajudaPorTela(): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  const ligar = (tela: string, fonte: string) => mapa.set(tela, [...(mapa.get(tela) ?? []), fonte]);
  for (const m of MANUAIS) for (const t of telasDoManual(m)) ligar(t, `manual ${m.id}`);
  for (const t of TRECHOS_DA_MIA) if (t.tela && t.tipo !== "mapa") ligar(t.tela, `guia ${t.id}`);
  return mapa;
}

describe("a ajuda do assistente cobre todas as telas", () => {
  const ajuda = ajudaPorTela();

  it("a lista de telas é a do app de verdade (catálogo e páginas)", () => {
    const principais = telasPrincipais();
    expect(principais.length).toBeGreaterThan(80);
    for (const href of hrefsDoCatalogo()) expect(principais).toContain(href);
    // As subpáginas de Configurações entram uma a uma (Configurações é só o hub).
    for (const sub of ["api-tokens", "servidor-mcp-externo", "recursos", "carteira", "marca", "templates", "voip-trunk",
      "canal-oficial", "meta-ads", "conversoes", "leads-da-meta", "email-marketing", "atendimento", "automacoes",
      "notifications", "security", "profile", "tenant", "aplicativo", "atualizacao", "billing", "tags"]) {
      expect(principais).toContain(`/app/settings/${sub}`);
    }
  });

  it("toda tela principal tem ajuda própria", () => {
    const semAjuda = telasPrincipais().filter((t) => !ajuda.has(t));
    expect(semAjuda, `telas sem ajuda no assistente: ${semAjuda.join(", ")}`).toEqual([]);
  });

  it("toda subpágina é alcançada pela ajuda da tela de cima", () => {
    const telasComAjuda = [...ajuda.keys()].filter((t) => !HUBS.has(t));
    const semAjuda = rotasDoApp().filter(
      (r) => !ajuda.has(r) && !telasComAjuda.some((t) => r.startsWith(`${t}/`)),
    );
    expect(semAjuda, `subpáginas sem ajuda: ${semAjuda.join(", ")}`).toEqual([]);
  });

  it("toda tela citada por um manual existe no app", () => {
    const rotas = rotasDoApp();
    const existe = (href: string) => rotas.some((r) => r === href || r.startsWith(`${href}/`));
    const quebradas = MANUAIS.flatMap((m) => telasDoManual(m).filter((t) => !existe(t)).map((t) => `${m.id} → ${t}`));
    expect(quebradas).toEqual([]);
  });

  it("o MCP tem as duas ajudas, uma citando a outra", () => {
    const externo = MANUAIS.find((m) => m.id === "servidor-mcp-externo");
    const daMia = MANUAIS.find((m) => m.id === "mcp-da-mia");
    expect(externo?.href).toBe("/app/settings/servidor-mcp-externo");
    expect(externo?.telas).toContain("/app/ai/agents");
    expect(externo?.vejaTambem).toContain("mcp-da-mia");
    expect(daMia?.href).toBe("/app/settings/api-tokens");
    expect(daMia?.papelMinimo).toBe("admin");
    expect(daMia?.vejaTambem).toContain("servidor-mcp-externo");
    expect(daMia?.passos.join(" ")).toContain("https://app.iamia.com.br/api/mcp");
    expect(daMia?.passos.join(" ")).toMatch(/LER o CRM \(MCP\)/);
    expect(daMia?.passos.join(" ")).toMatch(/AGIR no CRM \(MCP\)/);
  });
});
