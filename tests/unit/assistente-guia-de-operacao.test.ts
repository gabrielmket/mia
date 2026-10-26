/**
 * FORK MIA (.89) — O GUIA DE OPERAÇÃO DO UPSTREAM QUE O ASSISTENTE USA ESTÁ EM DIA.
 *
 * `lib/assistente/guia-de-operacao.gen.ts` é DERIVADO de
 * `.claude/skills/deskcomm-operacao/` (o guia tela a tela do upstream). A
 * imagem de produção não leva `.claude/`, então o assistente lê o módulo
 * gerado, e um derivado sem guarda envelhece calado: a fusão traz o guia novo
 * e o assistente segue respondendo pelo velho.
 *
 * Esta cerca gera de novo a partir da fonte e compara. Vermelha = rode
 * `npx tsx scripts/gerar-guia-de-operacao.ts` e confira o que mudou (e se
 * alguma correção do fork em SUPERADOS_PELO_CODIGO deixou de valer).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PASTA_DO_GUIA, moduloDoGuia, trechosDoGuia } from "@/lib/assistente/guia-de-operacao/ler-o-guia";
import { TRECHOS_DO_GUIA } from "@/lib/assistente/guia-de-operacao.gen";
import { EQUIVALENCIAS_DO_FORK, SUPERADOS_PELO_CODIGO, TRECHOS_DA_MIA } from "@/lib/assistente/guia-de-operacao";
import { MANUAIS } from "@/lib/assistente/manuais";
import { NAV_CATALOG } from "@/lib/navigation/catalogo";

import { rotasDoApp } from "./helpers/telas-do-app";

const RAIZ = join(__dirname, "..", "..");
const PASTA = join(RAIZ, PASTA_DO_GUIA);
const GERADO = join(RAIZ, "lib", "assistente", "guia-de-operacao.gen.ts");

function arquivosDoGuia(): Record<string, string> {
  const arquivos: Record<string, string> = {};
  const visitar = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const relativo = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name !== "scripts") visitar(join(dir, e.name), relativo);
      } else if (e.name.endsWith(".md")) {
        arquivos[relativo] = readFileSync(join(dir, e.name), "utf8");
      }
    }
  };
  visitar(PASTA, "");
  return arquivos;
}

describe("o guia de operação gerado", () => {
  it("a fonte existe no repositório", () => {
    expect(existsSync(join(PASTA, "SKILL.md"))).toBe(true);
    expect(existsSync(join(PASTA, "references", "mapa-da-interface.md"))).toBe(true);
  });

  it("o módulo gravado é o que a fonte gera hoje (senão: npx tsx scripts/gerar-guia-de-operacao.ts)", () => {
    const esperado = moduloDoGuia(arquivosDoGuia());
    const gravado = readFileSync(GERADO, "utf8").replace(/\r\n/g, "\n");
    expect(
      gravado === esperado,
      "lib/assistente/guia-de-operacao.gen.ts está fora de dia com .claude/skills/deskcomm-operacao/. Rode: npx tsx scripts/gerar-guia-de-operacao.ts",
    ).toBe(true);
  });

  it("vira trechos de verdade: centenas, com título e texto, e ids únicos", () => {
    const trechos = trechosDoGuia(arquivosDoGuia());
    expect(trechos.length).toBeGreaterThan(300);
    expect(new Set(trechos.map((t) => t.id)).size).toBe(trechos.length);
    for (const t of trechos) {
      expect(t.titulo.length, t.id).toBeGreaterThan(0);
      expect(t.texto.length, t.id).toBeGreaterThan(0);
    }
    // A maior parte das funcionalidades se liga a uma tela.
    const funcionalidades = trechos.filter((t) => t.tipo === "funcionalidade");
    expect(funcionalidades.filter((t) => t.href).length / funcionalidades.length).toBeGreaterThan(0.9);
  });

  it("a tela de cada trecho existe no app", () => {
    const rotas = rotasDoApp();
    const existe = (href: string) => rotas.some((r) => r === href || r.startsWith(`${href}/`));
    const quebrados = TRECHOS_DA_MIA.filter((t) => t.tela && !existe(t.tela)).map((t) => `${t.id} → ${t.tela}`);
    expect(quebrados).toEqual([]);
  });

  it("cada correção do fork aponta para um trecho que ainda existe e para um manual que existe", () => {
    const ids = new Set(TRECHOS_DO_GUIA.map((t) => t.id));
    const manuais = new Set(MANUAIS.map((m) => m.id));
    for (const [id, c] of Object.entries(SUPERADOS_PELO_CODIGO)) {
      expect(ids.has(id), `o trecho ${id} saiu do guia: tire a correção de SUPERADOS_PELO_CODIGO`).toBe(true);
      expect(manuais.has(c.manual), `o manual ${c.manual} não existe`).toBe(true);
    }
    // E o superado não chega à busca.
    expect(TRECHOS_DA_MIA.some((t) => SUPERADOS_PELO_CODIGO[t.id])).toBe(false);
  });

  it("o guia que diz que o MCP externo não tem tela é desmentido pelo código", () => {
    expect(existsSync(join(RAIZ, "app", "app", "settings", "servidor-mcp-externo", "page.tsx"))).toBe(true);
    expect(SUPERADOS_PELO_CODIGO["so-api-ou-sem-tela/base-de-mcp-externo"]?.manual).toBe("servidor-mcp-externo");
  });

  it("toda equivalência do fork leva a uma porta do catálogo", () => {
    const hrefs = new Set((NAV_CATALOG as ReadonlyArray<{ href: string }>).map((d) => d.href));
    for (const destino of Object.values(EQUIVALENCIAS_DO_FORK)) expect(hrefs.has(destino), destino).toBe(true);
  });

  it("nada do assistente lê a pasta .claude em tempo de execução", () => {
    for (const arquivo of ["guia-de-operacao.ts", "guia-de-operacao.gen.ts", "leituras/ajuda.ts", "busca-da-ajuda.ts"]) {
      const fonte = readFileSync(join(RAIZ, "lib", "assistente", arquivo), "utf8");
      expect(fonte, arquivo).not.toMatch(/from "node:fs"|from "fs"|readFileSync/);
    }
  });
});
