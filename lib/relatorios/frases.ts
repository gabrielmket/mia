/**
 * FORK MIA (item 9) — as frases que descrevem um relatório: o período ("últimos
 * 30 dias, 16/09 a 15/10") e a linha embaixo do título ("Soma do valor · só
 * ganhos · por mês e origem · últimos 90 dias"), a mesma no editor, no painel,
 * na lista e no MCP.
 *
 * ⚠️ Módulo PURO.
 */
import type { JanelaDoMotor } from "@/lib/paineis/motor";

import { rotuloDaMedida } from "./apresentar";
import { rotuloDaDimensao, type PeriodoDoMontador } from "./catalogo";
import type { ConfigDoRelatorio } from "./config";

const FRASE_DO_PERIODO: Record<PeriodoDoMontador, string> = {
  hoje: "hoje",
  "7": "últimos 7 dias",
  "30": "últimos 30 dias",
  "90": "últimos 90 dias",
  mes: "este mês",
  mesp: "mês passado",
  pers: "período personalizado",
};

function ddmm(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}` : "";
}

function ddmmaaaa(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** "últimos 30 dias (16/09 a 15/10)"; o personalizado com as datas inteiras. */
export function fraseDoPeriodo(periodo: PeriodoDoMontador, janela: Pick<JanelaDoMotor, "de" | "ate"> | null, t: (s: string) => string): string {
  if (periodo === "pers") {
    return janela?.de && janela.ate ? `${ddmmaaaa(janela.de)} ${t("a")} ${ddmmaaaa(janela.ate)}` : t(FRASE_DO_PERIODO.pers);
  }
  const base = t(FRASE_DO_PERIODO[periodo]);
  if (!janela?.de || !janela.ate) return base;
  if (periodo === "hoje") return `${base}, ${ddmm(janela.de)}`;
  return `${base} (${ddmm(janela.de)} ${t("a")} ${ddmm(janela.ate)})`;
}

/** "1 a 15 de setembro", "16/08 a 14/09": o período anterior da comparação. */
export function fraseDoAnterior(janela: Pick<JanelaDoMotor, "de" | "ate"> | null | undefined, t: (s: string) => string): string {
  if (!janela?.de || !janela.ate) return "";
  return `${ddmm(janela.de)} ${t("a")} ${ddmm(janela.ate)}`;
}

/**
 * A linha do relatório. `rotuloDoFiltro` devolve o texto já traduzido de um
 * valor de filtro (a tela sabe o nome da etapa, da pessoa, do funil).
 */
export function fraseDoRelatorio(
  c: ConfigDoRelatorio,
  janela: Pick<JanelaDoMotor, "de" | "ate"> | null,
  t: (s: string) => string,
  rotuloDoFiltro: (chave: string, valor: string) => string,
): string {
  const partes = [rotuloDaMedida(c.medida, c.fonte, t)];
  for (const [k, v] of Object.entries(c.filtros)) {
    if (k === "so_receita" || v === false || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    const valores = Array.isArray(v) ? v : [String(v)];
    const texto = valores.map((x) => rotuloDoFiltro(k, x)).join(` ${t("ou")} `);
    const dim = k as Parameters<typeof rotuloDaDimensao>[1];
    partes.push(`${t(rotuloDaDimensao(c.fonte, dim)).toLowerCase()}: ${texto}`);
  }
  if (c.visualizacao !== "numero" && c.dim1) {
    const d1 = t(rotuloDaDimensao(c.fonte, c.dim1)).toLowerCase();
    const d2 = c.dim2 ? ` ${t("e")} ${t(rotuloDaDimensao(c.fonte, c.dim2)).toLowerCase()}` : "";
    partes.push(`${t("por")} ${d1}${d2}`);
  }
  partes.push(fraseDoPeriodo(c.periodo, janela, t));
  return partes.join(" · ");
}
