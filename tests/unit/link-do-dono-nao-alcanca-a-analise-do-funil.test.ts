/**
 * MIA-361 · ponto 1 · AS DUAS PARCELAS DO PERÍODO NÃO CHEGAM AO LINK DO DONO.
 *
 * O vendido único e a recorrência nova mensal (as "duas parcelas do período")
 * saem de `lib/metrics/valores-do-periodo.ts`, pela Análise do funil
 * (`/api/v1/metrics/funil`, tela Painéis > Análise do funil) e pela meta do
 * mês. Essa conta lê o valor dos negócios sem passar pelo `p_valores` do motor
 * (`fn_mia_relatorio`), que é a régua do "mostrar valores" desligado.
 *
 * O link do dono (`/painel/<token>`) só calcula pelo motor: os doze prontos
 * (`lib/paineis/calcular.ts`) e o painel do montador (`lib/relatorios/link.ts`),
 * provados sem dinheiro em
 * `tests/invariants/link-do-dono-sem-valores-de-ponta-a-ponta.test.ts`. Esta
 * cerca trava a outra metade: NENHUM arquivo alcançável a partir da página
 * importa a conta das parcelas nem qualquer outra de `lib/metrics/`. Quem
 * quiser pôr a Análise do funil no link vai ter de passar por aqui e levar o
 * "mostrar valores" junto.
 *
 * O grafo é lido do código (`import`/`export ... from` e `import()` dinâmico,
 * com `@/` e caminho relativo), sem contar `import type` (não roda). O CONTROLE
 * prova que o mesmo leitor acha a conta das parcelas a partir da rota da
 * Análise do funil.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const IMPORTACAO =
  /(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolver(de: string, especificador: string): string | null {
  let base: string;
  if (especificador.startsWith("@/")) base = path.join(RAIZ, especificador.slice(2));
  else if (especificador.startsWith(".")) base = path.resolve(path.dirname(de), especificador);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Os arquivos do repositório que rodam a partir de `entrada`, relativos à raiz. */
function alcancaveis(entrada: string): string[] {
  const vistos = new Set<string>();
  const fila = [path.join(RAIZ, entrada)];
  while (fila.length > 0) {
    const arquivo = fila.pop()!;
    if (vistos.has(arquivo)) continue;
    vistos.add(arquivo);
    for (const m of readFileSync(arquivo, "utf8").matchAll(IMPORTACAO)) {
      if (m[1]) continue; // import type: não roda.
      const alvo = resolver(arquivo, (m[2] ?? m[3])!);
      if (alvo && !vistos.has(alvo)) fila.push(alvo);
    }
  }
  return [...vistos].map((f) => path.relative(RAIZ, f).split(path.sep).join("/")).sort();
}

describe("⭐ o link do dono não alcança a conta das duas parcelas", () => {
  it("nada de lib/metrics/ a partir de app/painel/[token]/page.tsx", () => {
    const daPagina = alcancaveis("app/painel/[token]/page.tsx");
    // O leitor andou: chegou às duas contas que a página usa.
    expect(daPagina).toEqual(expect.arrayContaining(["lib/paineis/calcular.ts", "lib/relatorios/link.ts", "lib/paineis/motor.ts"]));
    expect(daPagina.filter((f) => f.startsWith("lib/metrics/"))).toEqual([]);
  });

  it("CONTROLE: a rota da Análise do funil alcança lib/metrics/valores-do-periodo.ts", () => {
    expect(alcancaveis("app/api/v1/metrics/funil/route.ts")).toContain("lib/metrics/valores-do-periodo.ts");
  });
});
