/**
 * FORK MIA (MIA-372) · as frases e os códigos de auditoria da MIA entram nos
 * arquivos do upstream por UM ponto só, e continuam entrando.
 *
 * O que reprova aqui:
 *   - o `lib/i18n/dicionario.ts` do upstream deixou de importar ou de chamar
 *     `ligarAsFrasesDaMia` (uma fusão que "pegou o lado do upstream" apaga as
 *     duas linhas, e a tela em espanhol volta para o português sem erro);
 *   - um arquivo `dicionario-mia-*` nosso que não passa pelo agregador
 *     `lib/i18n/dicionario-mia.ts` (frase escrita e nunca ligada);
 *   - as duas regras de prevalência trocadas;
 *   - marca `FORK MIA` nova dentro dos dois arquivos do upstream: frase nova vai
 *     para um arquivo nosso, código de auditoria novo vai para o bloco da MIA no
 *     topo do `lib/audit/actions.ts`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { DICIONARIO } from "@/lib/i18n/dicionario";
import { FRASES_DA_MIA, SOBREPOSICOES_DA_MIA, ligarAsFrasesDaMia } from "@/lib/i18n/dicionario-mia";

const RAIZ = process.cwd();
const leia = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const marcas = (fonte: string) => fonte.match(/FORK MIA/g)?.length ?? 0;

describe("o dicionário do upstream liga as frases da MIA num ponto só", () => {
  const fonte = leia("lib/i18n/dicionario.ts");

  it("importa o agregador e chama a ligação uma vez, depois de fechar o objeto", () => {
    expect(fonte).toMatch(/^import \{ ligarAsFrasesDaMia \} from "\.\/dicionario-mia";/m);
    const chamadas = fonte.match(/^ligarAsFrasesDaMia\(DICIONARIO\);$/gm) ?? [];
    expect(chamadas).toHaveLength(1);
    const objeto = fonte.indexOf("export const DICIONARIO");
    const chamada = fonte.indexOf("ligarAsFrasesDaMia(DICIONARIO);");
    const traduzir = fonte.indexOf("export function traduzir");
    expect(objeto).toBeGreaterThan(0);
    expect(chamada).toBeGreaterThan(objeto);
    expect(traduzir).toBeGreaterThan(chamada);
  });

  it("não importa arquivo de frases nosso direto (só o agregador)", () => {
    const diretos = [...fonte.matchAll(/from "\.\/(dicionario-[^"]+)"/g)].map((m) => m[1]);
    expect(diretos).toEqual(["dicionario-mia"]);
  });

  it("catraca: só as 2 marcas FORK MIA do ponto de ligação", () => {
    expect(marcas(fonte)).toBeLessThanOrEqual(2);
  });
});

describe("todo arquivo de frases nosso passa pelo agregador", () => {
  const arquivos = readdirSync(join(RAIZ, "lib/i18n")).filter(
    (f) =>
      /^dicionario-(mia-.+|.+-mia)\.ts$/.test(f) &&
      !f.endsWith(".test.ts") &&
      f !== "dicionario-mia-sobreposicoes.ts",
  );

  it("a varredura acha os arquivos", () => {
    expect(arquivos.length).toBeGreaterThan(20);
  });

  it.each(arquivos)("%s: cada chave dele chega ao DICIONARIO", async (arquivo) => {
    const modulo = (await import(`@/lib/i18n/${arquivo.replace(/\.ts$/, "")}`)) as Record<string, unknown>;
    const tabelas = Object.values(modulo).filter(
      (v): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v),
    );
    expect(tabelas.length, `${arquivo} não exporta tabela de frases`).toBeGreaterThan(0);
    const fora = tabelas.flatMap((t) => Object.keys(t)).filter((k) => !Object.hasOwn(FRASES_DA_MIA, k));
    expect(fora, `${arquivo} não está espalhado em FRASES_DA_MIA (lib/i18n/dicionario-mia.ts)`).toEqual([]);
  });

  it("toda frase nossa está no DICIONARIO montado", () => {
    const fora = Object.keys(FRASES_DA_MIA).filter((k) => !Object.hasOwn(DICIONARIO, k));
    expect(fora).toEqual([]);
  });
});

describe("as duas regras de prevalência", () => {
  const umaNossa = Object.keys(FRASES_DA_MIA).find((k) => !Object.hasOwn(SOBREPOSICOES_DA_MIA, k))!;
  const umaSobreposta = Object.keys(SOBREPOSICOES_DA_MIA)[0]!;

  it("dicionário vazio recebe todas as nossas", () => {
    const dic: Record<string, Partial<Record<"es" | "en", string>>> = {};
    ligarAsFrasesDaMia(dic);
    expect(dic[umaNossa]).toEqual(FRASES_DA_MIA[umaNossa]);
    expect(dic[umaSobreposta]).toEqual(SOBREPOSICOES_DA_MIA[umaSobreposta]);
  });

  it("frase nova nossa: chave igual do upstream prevalece", () => {
    const dic: Record<string, Partial<Record<"es" | "en", string>>> = { [umaNossa]: { es: "do upstream" } };
    ligarAsFrasesDaMia(dic);
    expect(dic[umaNossa]).toEqual({ es: "do upstream" });
  });

  it("sobreposição: a nossa vence, e troca a entrada inteira", () => {
    const dic: Record<string, Partial<Record<"es" | "en", string>>> = {
      [umaSobreposta]: { es: "do upstream", en: "upstream" },
    };
    ligarAsFrasesDaMia(dic);
    expect(dic[umaSobreposta]).toEqual(SOBREPOSICOES_DA_MIA[umaSobreposta]);
  });

  it("o DICIONARIO montado obedece às sobreposições", () => {
    for (const [chave, entrada] of Object.entries(SOBREPOSICOES_DA_MIA)) {
      expect(DICIONARIO[chave], chave).toEqual(entrada);
    }
  });
});

describe("os códigos de auditoria da MIA ficam num bloco só", () => {
  const fonte = leia("lib/audit/actions.ts");

  it("o bloco abre logo no começo da lista e fecha com a marca de fim", () => {
    expect(fonte).toMatch(/export const AUDIT_ACTIONS = \[\n {2}\/\/ FORK MIA \(MIA-372\)/);
    expect(fonte.match(/\/\/ ── fim do bloco da MIA/g) ?? []).toHaveLength(1);
  });

  it("catraca: só a marca FORK MIA do bloco", () => {
    expect(marcas(fonte)).toBeLessThanOrEqual(1);
  });

  it("o bloco tem códigos e todos estão na lista", () => {
    const bloco = fonte.slice(fonte.indexOf("export const AUDIT_ACTIONS"), fonte.indexOf("// ── fim do bloco da MIA"));
    const nossos = [...bloco.matchAll(/^\s*"([^"]+)",\s*$/gm)].map((m) => m[1] as string);
    expect(nossos.length).toBeGreaterThan(100);
    expect(nossos.filter((c) => !(AUDIT_ACTIONS as readonly string[]).includes(c))).toEqual([]);
  });
});
