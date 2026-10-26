/**
 * FORK MIA (.89) — as telas do app, lidas do disco, para as cercas do assistente.
 *
 * `rotasDoApp`: toda rota de `app/app/**\/page.tsx`, com os segmentos dinâmicos
 * como estão (`/app/ai/agents/[id]`).
 *
 * `telasPrincipais`: as telas que precisam de ajuda PRÓPRIA. São as portas do
 * catálogo de navegação e toda rota estática que não mora debaixo de outra
 * tela (as subpáginas de Configurações entram, porque Configurações é só o
 * hub). O que mora debaixo de uma tela (`/app/ai/agents/[id]`,
 * `/app/relatorios/novo`) é coberto pela ajuda dela.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { HUBS } from "@/lib/assistente/busca-da-ajuda";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";

const RAIZ = join(__dirname, "..", "..", "..");

export function rotasDoApp(dir = join(RAIZ, "app", "app"), base = "/app"): string[] {
  const rotas: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const semSegmento = e.name.startsWith("(") || e.name.startsWith("_");
      rotas.push(...rotasDoApp(join(dir, e.name), semSegmento ? base : `${base}/${e.name}`));
    } else if (e.name === "page.tsx") {
      rotas.push(base);
    }
  }
  return rotas.sort();
}

export function hrefsDoCatalogo(): string[] {
  return (NAV_CATALOG as ReadonlyArray<{ href: string }>).map((d) => d.href);
}

/** Debaixo de outra tela (que não é hub)? */
function debaixoDe(rota: string, outra: string): boolean {
  return !HUBS.has(outra) && rota !== outra && rota.startsWith(`${outra}/`);
}

export function telasPrincipais(): string[] {
  const catalogo = hrefsDoCatalogo();
  const estaticas = rotasDoApp().filter((r) => !r.includes("["));
  const principais = new Set(catalogo);
  for (const r of estaticas) {
    if (catalogo.some((c) => debaixoDe(r, c))) continue;
    if (estaticas.some((o) => debaixoDe(r, o))) continue;
    principais.add(r);
  }
  return [...principais].sort();
}
