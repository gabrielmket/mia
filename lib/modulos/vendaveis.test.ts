import { describe, expect, it } from "vitest";

import { NAV_CATALOG } from "@/lib/navigation/catalogo";
import { MODULOS, moduloDaRota, moduloDaTela } from "@/lib/modulos/vendaveis";

/**
 * A CATRACA DO QUE SE VENDE SEPARADO.
 *
 * Dois defeitos silenciosos moram aqui, e nenhum dos dois aparece em tela:
 *
 *  1. O módulo declara TELAS por `href`. Se um href mudar no catálogo de
 *     navegação e não aqui, a tela volta a aparecer para quem não comprou — e
 *     o menu continua bonito, então ninguém desconfia.
 *  2. Acrescentar uma chave ao catálogo TIRA acesso de quem não tem liberação.
 *     Fazer isso com uma tela que os clientes já usam seria um apagão silencioso
 *     no dia do deploy.
 *
 *     npx vitest run lib/modulos/vendaveis.test.ts
 */

describe("o catálogo de módulos aponta para telas que existem", () => {
  it("toda tela declarada por um módulo está no catálogo de navegação", () => {
    const hrefs = new Set(NAV_CATALOG.map((d) => d.href as string));
    const orfas: string[] = [];
    for (const m of MODULOS) {
      for (const tela of m.telas) if (!hrefs.has(tela)) orfas.push(`${m.chave} → ${tela}`);
    }
    expect(
      orfas,
      "um módulo protege uma tela que não existe mais no menu: o href mudou de um lado só, e a tela voltou a aparecer para quem não comprou",
    ).toEqual([]);
  });

  it("nenhuma tela é reivindicada por dois módulos", () => {
    const vistas = new Map<string, string>();
    const repetidas: string[] = [];
    for (const m of MODULOS) {
      for (const tela of m.telas) {
        const dono = vistas.get(tela);
        if (dono) repetidas.push(`${tela}: ${dono} e ${m.chave}`);
        else vistas.set(tela, m.chave);
      }
    }
    expect(
      repetidas,
      "duas chaves protegem a mesma tela: liberar uma e não a outra dá resultados diferentes conforme a ordem da lista",
    ).toEqual([]);
  });

  it("a rota casa por prefixo, e o prefixo não pega vizinho de nome parecido", () => {
    expect(moduloDaRota("/api/v1/carteira")).toBe("disparador");
    expect(moduloDaRota("/api/v1/carteira/extrato")).toBe("disparador");
    // O vizinho do painel administrativo NÃO pode cair na trava do tenant: quem
    // libera módulo é a plataforma, e travá-la por falta de liberação deixaria
    // o próprio botão de liberar inacessível.
    expect(moduloDaRota("/api/v1/admin/carteira")).toBeNull();
    // Prefixo mal escolhido pegaria isto; o teste existe para o dia em que
    // alguém encurtar a string do catálogo.
    expect(moduloDaRota("/api/v1/carteiras-antigas")).toBeNull();
    expect(moduloDaRota("/api/v1/leads")).toBeNull();
  });

  it("tela fora de módulo NÃO é protegida — a regra vale para a exceção, não para o produto", () => {
    expect(moduloDaTela("/app/inbox")).toBeNull();
    expect(moduloDaTela("/app/settings/carteira")).toBe("disparador");
  });
});
