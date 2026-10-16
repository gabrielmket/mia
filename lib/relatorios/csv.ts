/**
 * FORK MIA (item 9) — A PLANILHA (CSV) do relatório e da lista.
 *
 * A decisão do protótipo (tela 6): CSV, que abre no Excel e no Google
 * Planilhas; separador escolhível (ponto e vírgula para o Excel em português,
 * vírgula para o resto), decimais com vírgula, datas em dd/mm/aaaa, UTF-8. O
 * BOM vai na frente: sem ele o Excel lê "Negócio" como "NegÃ³cio".
 *
 * A célula de texto que começa com `=`, `+`, `-` ou `@` ganha um apóstrofo na
 * frente: um nome de contato como `=HYPERLINK(...)` viraria fórmula ao abrir a
 * planilha (injeção de fórmula). Número não passa por isso: sai como número.
 *
 * ⚠️ Módulo PURO.
 */
import { textoDoRotulo, variacao, type Formato, type ModeloDoGrafico } from "./apresentar";
import { MEDIDAS_DO_MONTADOR, rotuloDaDimensao, type FormatoDaMedida } from "./catalogo";
import type { Celula, ColunaDaLista, ContextoDaLista, LinhaDaLista } from "./lista";

export type Separador = ";" | ",";
export const SEPARADORES: readonly Separador[] = [";", ","];
export const BOM = "﻿";

/** Um número com vírgula decimal, sem separador de milhar (a planilha soma). */
export function numeroBr(v: number | null | undefined, casas = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  const arred = Math.round(v * 10 ** casas) / 10 ** casas;
  return String(arred).replace(".", ",");
}

/** Uma célula de texto, protegida e escapada para o separador. */
export function celulaCsv(valor: string, sep: Separador): string {
  let s = valor;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes(sep) || /["\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function linhaCsv(celulas: string[], sep: Separador): string {
  return celulas.join(sep);
}

/** O número da medida na unidade da planilha: reais (não centavos), minutos (não segundos). */
export function numeroDaMedida(formato: FormatoDaMedida, v: number | null): string {
  if (v === null) return "";
  if (formato === "r") return numeroBr(v / 100, 2);
  if (formato === "t") return numeroBr(v / 60, 1);
  if (formato === "n") return numeroBr(v, 0);
  return numeroBr(v, 1);
}

/** A unidade que vai no cabeçalho, para a planilha não ter número sem nome. */
export function unidadeDaMedida(formato: FormatoDaMedida, moeda: string, t: (s: string) => string): string {
  if (formato === "r") return ` (${moeda})`;
  if (formato === "t") return ` (${t("minutos")})`;
  if (formato === "d") return ` (${t("dias")})`;
  if (formato === "%") return " (%)";
  return "";
}

/**
 * A planilha do RELATÓRIO: os números somados, uma linha por grupo e uma coluna
 * por série; o período anterior e a variação quando compara; o total no fim.
 * Sem nome de cliente.
 */
export function csvDoRelatorio(
  m: ModeloDoGrafico,
  opcoes: { sep: Separador; rotuloDaMedida: string; f: Formato },
): { texto: string; linhas: number } {
  const { sep, f } = opcoes;
  const t = f.t;
  const unidade = unidadeDaMedida(m.formato, m.moeda, t);
  const series = m.series ?? [];
  const compara = Boolean(m.anterior) && series.length === 0;
  const aditiva = MEDIDAS_DO_MONTADOR[m.medida].aditiva;
  const cab: string[] = [m.dim1 ? t(rotuloDaDimensao(m.fonte, m.dim1)) : t("Total")];
  for (const s of series) cab.push(`${textoDoRotulo(s.rotulo, t, s.quantos)}${unidade}`);
  cab.push(series.length ? `${aditiva ? t("Total") : t("Geral")}${unidade}` : `${opcoes.rotuloDaMedida}${unidade}`);
  if (compara) cab.push(`${t("Período anterior")}${unidade}`, t("Variação"));
  const linhas: string[][] = [cab.map((c) => celulaCsv(c, sep))];
  const grupos = m.dim1 ? m.grupos : [];
  for (const g of grupos) {
    const l = [celulaCsv(textoDoRotulo(g.rotulo, t, g.quantos), sep)];
    for (const s of series) l.push(numeroDaMedida(m.formato, g.series[s.chave]?.valor ?? (aditiva ? 0 : null)));
    l.push(numeroDaMedida(m.formato, g.valor));
    if (compara) {
      const v = variacao(g.valor, g.anterior, m.formato, f);
      l.push(numeroDaMedida(m.formato, g.anterior), celulaCsv(v?.texto ?? "", sep));
    }
    linhas.push(l);
  }
  const tot = [celulaCsv(aditiva ? t("Total") : t("Geral"), sep)];
  for (const s of series) {
    const soma = aditiva ? m.grupos.reduce((acc, g) => acc + (g.series[s.chave]?.valor ?? 0), 0) : null;
    tot.push(numeroDaMedida(m.formato, soma));
  }
  tot.push(numeroDaMedida(m.formato, m.total.valor));
  if (compara) {
    const v = variacao(m.total.valor, m.anterior?.valor ?? null, m.formato, f);
    tot.push(numeroDaMedida(m.formato, m.anterior?.valor ?? null), celulaCsv(v?.texto ?? "", sep));
  }
  linhas.push(tot);
  return { texto: BOM + linhas.map((l) => linhaCsv(l, sep)).join("\r\n") + "\r\n", linhas: linhas.length - 1 };
}

function celulaDaLista(c: Celula, sep: Separador): string {
  if (c.tipo === "texto") return celulaCsv(c.texto, sep);
  if (c.tipo === "numero") return numeroBr(c.valor, 2);
  return c.centavos === null ? "" : numeroBr(c.centavos / 100, 2);
}

/** A planilha da LISTA por trás de um número: uma linha por registro, com nome e telefone. */
export function csvDaLista(
  colunas: readonly ColunaDaLista[],
  linhas: readonly LinhaDaLista[],
  opcoes: { sep: Separador; ctx: ContextoDaLista; moeda: string },
): { texto: string; linhas: number } {
  const { sep, ctx } = opcoes;
  const cab = colunas.map((c) => celulaCsv(c.valor ? `${ctx.t(c.titulo)} (${opcoes.moeda})` : ctx.t(c.titulo), sep));
  const corpo = linhas.map((l) => colunas.map((c) => celulaDaLista(c.celula(l, ctx), sep)));
  return {
    texto: BOM + [cab, ...corpo].map((l) => linhaCsv(l, sep)).join("\r\n") + "\r\n",
    linhas: corpo.length,
  };
}

/** O nome do arquivo: `empresa_relatorio[_lista-grupo]_AAAA-MM-DD.csv`, sem acento nem espaço. */
export function nomeDoArquivo(partes: { empresa: string; relatorio: string; grupo?: string | null; hoje: string }): string {
  const slug = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "relatorio";
  return `${slug(partes.empresa)}_${slug(partes.relatorio)}${partes.grupo ? `_lista-${slug(partes.grupo)}` : ""}_${partes.hoje}.csv`;
}
