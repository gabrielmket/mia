/**
 * FORK MIA (item 9) — DA RESPOSTA DO MOTOR AO DESENHO.
 *
 * O motor devolve chaves (`ganho`, o id de uma etapa, o id de uma pessoa,
 * `2026-10`, `__sem`) e números já somados. Aqui eles ganham NOME e FORMATO,
 * e o período anterior e a meta se alinham a cada grupo. Nenhuma conta é
 * refeita: "o navegador só desenha o resultado" (decisão do protótipo).
 *
 * O nome de uma pessoa da equipe não está no banco do CRM (mora no Auth): quem
 * chama passa `nomes` (id → nome), resolvido no servidor por
 * `lib/relatorios/equipe.ts`. O que é rótulo do produto volta com
 * `traduzir: true` (a tela passa por `t()`); o que é dado (nome de etapa,
 * de etiqueta, de pessoa) volta como está.
 *
 * ⚠️ Módulo PURO (o editor do navegador e a página pública importam).
 */
import {
  CHAVE_OUTROS,
  CHAVE_SEM,
  ROTULO_DA_ORIGEM,
  ROTULO_DA_PLATAFORMA,
  ROTULO_DA_SITUACAO_DA_AGENDA,
  ROTULO_DA_SITUACAO_DO_NEGOCIO,
  ROTULO_DE_OUTROS,
  ROTULO_DE_QUEM_ATENDEU,
  ROTULO_DO_CANAL,
  ROTULO_DO_EVENTO,
  ROTULO_DO_RESULTADO_DO_FOLLOWUP,
  ROTULO_DO_SEM,
  type Dimensao,
  type Fonte,
  type Medida,
} from "@/lib/paineis/catalogo";
import type { GrupoDoMotor, RespostaDoMotor, SerieDoMotor } from "@/lib/paineis/motor";
import { formatValorDoNegocio } from "@/lib/money";
import { rotuloDoMotivoDePerda } from "@/lib/schemas/leads";

import { DIMENSOES_DO_MONTADOR, FONTES_DO_MONTADOR, MEDIDAS_DO_MONTADOR, type FormatoDaMedida, type MedidaDoMontador } from "./catalogo";

// ─── Os rótulos das chaves ──────────────────────────────────────────────────

export interface Rotulo {
  texto: string;
  /** `true`: rótulo do produto, a tela passa por `t()`. `false`: dado, sai como está. */
  traduzir: boolean;
}

export const ROTULO_DA_SITUACAO_DA_OBRIGACAO: Record<string, string> = {
  a_pedir: "A pedir",
  pedido: "Pedido",
  recebido: "Recebido",
  valido: "Válido",
  vencendo: "Vencendo",
  vencido: "Vencido",
  pendente: "Pendente",
  feita: "Feita",
};

export const ROTULO_DA_CATEGORIA: Record<string, string> = {
  documento: "Documento",
  atividade: "Atividade",
};

/** O nome de quem não está mais na equipe (o id ficou no registro). */
export const PESSOA_SEM_NOME = "Pessoa fora da equipe";
export const AGENTE_SEM_NOME = "Agente de IA";

const MESES_CURTOS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function doCodigo(mapa: Record<string, string>, chave: string): Rotulo {
  const r = mapa[chave];
  return r ? { texto: r, traduzir: true } : { texto: chave, traduzir: false };
}

/** "2026-10" → "out/26"; "2026-10-05" → "05/10". Curto, para o eixo. */
export function rotuloDeTempo(dim: "mes" | "semana" | "dia" | "previsto", chave: string): string {
  if (dim === "mes" || dim === "previsto") {
    const m = /^(\d{4})-(\d{2})$/.exec(chave);
    return m ? `${MESES_CURTOS_PT[Number(m[2]) - 1]}/${m[1]!.slice(2)}` : chave;
  }
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(chave);
  if (!d) return chave;
  return dim === "semana" ? `sem. ${d[3]}/${d[2]}` : `${d[3]}/${d[2]}`;
}

/**
 * O nome de uma chave de agrupamento. `rotuloDoBanco` é o que o motor já
 * trouxe (nome da etapa, do tipo, da régua, do agente).
 */
export function rotuloDaChave(
  fonte: Fonte,
  dim: Dimensao,
  chave: string,
  rotuloDoBanco: string | null | undefined,
  nomes: Readonly<Record<string, string>>,
): Rotulo {
  if (chave === CHAVE_SEM) return { texto: ROTULO_DO_SEM[dim] ?? "Sem valor", traduzir: true };
  if (chave === CHAVE_OUTROS) return { texto: ROTULO_DE_OUTROS, traduzir: true };
  switch (dim) {
    case "mes":
    case "semana":
    case "dia":
    case "previsto":
      return { texto: rotuloDeTempo(dim, chave), traduzir: false };
    case "situacao":
      if (fonte === "negocios") return doCodigo(ROTULO_DA_SITUACAO_DO_NEGOCIO, chave);
      if (fonte === "agenda") return doCodigo(ROTULO_DA_SITUACAO_DA_AGENDA, chave);
      return doCodigo(ROTULO_DA_SITUACAO_DA_OBRIGACAO, chave);
    case "resp":
    case "prof":
      if (chave.startsWith("ia:")) return rotuloDoBanco ? { texto: rotuloDoBanco, traduzir: false } : { texto: AGENTE_SEM_NOME, traduzir: true };
      return nomes[chave] ? { texto: nomes[chave]!, traduzir: false } : { texto: PESSOA_SEM_NOME, traduzir: true };
    case "origem":
      return doCodigo(ROTULO_DA_ORIGEM, chave);
    case "motivo": {
      const r = rotuloDoMotivoDePerda(chave);
      return { texto: r, traduzir: r !== chave };
    }
    case "quem":
      return doCodigo(ROTULO_DE_QUEM_ATENDEU, chave);
    case "canal":
      return doCodigo(ROTULO_DO_CANAL, chave);
    case "resultado":
      return doCodigo(ROTULO_DO_RESULTADO_DO_FOLLOWUP, chave);
    case "categoria":
      return doCodigo(ROTULO_DA_CATEGORIA, chave);
    case "plataforma":
      return doCodigo(ROTULO_DA_PLATAFORMA, chave);
    case "evento":
      if (chave.startsWith("etapa:")) return { texto: rotuloDoBanco ?? chave.slice(6), traduzir: false };
      return doCodigo(ROTULO_DO_EVENTO, chave);
    case "tipo":
      if (rotuloDoBanco) return { texto: rotuloDoBanco, traduzir: false };
      return { texto: chave.startsWith("nome:") ? chave.slice(5) : chave, traduzir: false };
    default:
      return { texto: rotuloDoBanco ?? chave, traduzir: false };
  }
}

// ─── Os formatos ────────────────────────────────────────────────────────────

export interface Formato {
  /** Etiqueta BCP-47 (número, mês). */
  tag: string;
  moeda: string;
  t: (texto: string) => string;
}

/** Segundos em "12 s", "7 min", "1 h 20 min", "3 dias". */
export function tempoDeEspera(segundos: number, t: (s: string) => string): string {
  if (segundos < 60) return `${Math.round(segundos)} s`;
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas >= 48) return `${Math.round(horas / 24)} ${t("dias")}`;
  return resto > 0 ? `${horas} h ${resto} min` : `${horas} h`;
}

/** O número de uma medida, no formato dela. `curto` encurta dinheiro grande para o eixo. */
export function formatarValor(formato: FormatoDaMedida, v: number | null | undefined, f: Formato, curto = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return f.t("sem dado");
  switch (formato) {
    case "n":
      return new Intl.NumberFormat(f.tag, { maximumFractionDigits: 0 }).format(v);
    case "r":
      if (curto && Math.abs(v) >= 1_000_000) {
        return new Intl.NumberFormat(f.tag, { style: "currency", currency: f.moeda, notation: "compact", maximumFractionDigits: 1 }).format(v / 100);
      }
      return formatValorDoNegocio(Math.round(v), f.moeda, { semCentavos: true });
    case "%":
      return `${new Intl.NumberFormat(f.tag, { maximumFractionDigits: 0 }).format(v)}%`;
    case "d": {
      const n = new Intl.NumberFormat(f.tag, { maximumFractionDigits: 1 }).format(v);
      return curto ? `${n} d` : `${n} ${Math.round(v * 10) === 10 ? f.t("dia") : f.t("dias")}`;
    }
    case "t":
      return tempoDeEspera(v, f.t);
  }
}

/** O rótulo da medida, com o plural da fonte ("Quantidade de negócios"), já traduzido. */
export function rotuloDaMedida(medida: MedidaDoMontador, fonte: Fonte, t: (s: string) => string): string {
  return t(MEDIDAS_DO_MONTADOR[medida].rotulo).replace("{varios}", t(FONTES_DO_MONTADOR[fonte].varios));
}

/** "05/10/2026" de um `AAAA-MM-DD` ou de um instante, no fuso da empresa. */
export function dataCurta(valor: string | null | undefined, fuso: string): string {
  if (!valor) return "";
  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (soData) return `${soData[3]}/${soData[2]}/${soData[1]}`;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return "";
  // O idioma aqui só extrai os NÚMEROS de dia, mês e ano no fuso da empresa; o
  // texto (dd/mm/aaaa) é montado abaixo. `en-US` com algarismos latinos é neutro:
  // nenhum idioma de leitura muda a saída, e nenhum sistema de numeração vaza.
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: fuso, day: "2-digit", month: "2-digit", year: "numeric", numberingSystem: "latn" }).formatToParts(d);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? "";
  return `${p("day")}/${p("month")}/${p("year")}`;
}

// ─── O modelo do gráfico ────────────────────────────────────────────────────

export interface SerieDesenhada {
  chave: string;
  rotulo: Rotulo;
  sem: boolean;
  outros: boolean;
  quantos: number | null;
  n: number;
}

export interface CelulaDesenhada {
  n: number;
  valor: number | null;
}

export interface GrupoDesenhado {
  chave: string;
  rotulo: Rotulo;
  sem: boolean;
  outros: boolean;
  quantos: number | null;
  n: number;
  valor: number | null;
  /** O valor do mesmo grupo no período anterior (comparar). */
  anterior: number | null;
  /** A meta daquele pedaço de tempo (soma dos ganhos por mês, semana ou dia). */
  meta: number | null;
  series: Record<string, CelulaDesenhada>;
}

export interface ModeloDoGrafico {
  fonte: Fonte;
  medida: MedidaDoMontador;
  /** A medida que o motor somou (no funil, `chegaram` ou `soma`). */
  medidaDoMotor: Medida;
  /** O funil desenhado: cada etapa conta quem chegou até ela (a lista pede o modo funil). */
  ehFunil: boolean;
  formato: FormatoDaMedida;
  dim1: Dimensao | null;
  dim2: Dimensao | null;
  grupos: GrupoDesenhado[];
  series: SerieDesenhada[] | null;
  total: { n: number; valor: number | null };
  anterior: { valor: number | null; de: string | null; ate: string | null } | null;
  meta: RespostaDoMotor["meta"];
  dobrados: string[];
  seriesDobradas: string[];
  janela: RespostaDoMotor["janela"];
  moeda: string;
  valores: boolean;
  foraDaMoeda: number;
  funil: RespostaDoMotor["funil"];
}

function valorDe(alvo: { n: number; valores: Partial<Record<Medida, number | null>> } | undefined, medida: Medida): number | null {
  if (!alvo) return null;
  const v = alvo.valores[medida];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return medida === "qtd" || medida === "chegaram" ? alvo.n : null;
}

/**
 * O modelo que o gráfico desenha. No funil, a medida é "chegaram" (ou a soma
 * de quem chegou, quando o relatório soma o valor).
 */
export function modeloDoGrafico(
  r: RespostaDoMotor,
  medida: MedidaDoMontador,
  nomes: Readonly<Record<string, string>>,
): ModeloDoGrafico {
  const funil = r.medidas.includes("chegaram");
  const medidaDoMotor: Medida = funil ? (medida === "soma" ? "soma" : "chegaram") : medida;
  const formato = funil && medidaDoMotor === "chegaram" ? "n" : MEDIDAS_DO_MONTADOR[medida].formato;
  const dim1 = funil ? "etapa" : r.dim1;
  const ant = r.anterior;
  const grupos: GrupoDesenhado[] = (r.grupos as GrupoDoMotor[]).map((g) => {
    const rotulo = dim1 ? rotuloDaChave(r.fonte, dim1, g.chave, g.rotulo, nomes) : { texto: "", traduzir: false };
    const series: Record<string, CelulaDesenhada> = {};
    for (const [k, cel] of Object.entries(g.series ?? {})) {
      series[k] = { n: cel.n, valor: valorDe(cel, medidaDoMotor) };
    }
    return {
      chave: g.chave,
      rotulo,
      sem: g.sem,
      outros: g.outros,
      quantos: g.quantos ?? null,
      n: g.n,
      valor: valorDe(g, medidaDoMotor),
      anterior: ant ? valorDe(ant.grupos[g.chave] as never, medidaDoMotor) : null,
      meta: typeof g.meta_cents === "number" ? g.meta_cents : null,
      series,
    };
  });
  // No tempo, o anterior casa pela POSIÇÃO (a 1ª semana com a 1ª semana).
  if (ant && dim1 && DIMENSOES_DO_MONTADOR[dim1].tempo) {
    const anteriores = Object.entries(ant.grupos)
      .filter(([k]) => k !== CHAVE_SEM)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    grupos.forEach((g, i) => {
      const a = anteriores[i];
      g.anterior = a ? valorDe(a[1] as never, medidaDoMotor) : null;
    });
  }
  const series: SerieDesenhada[] | null = r.series
    ? (r.series as SerieDoMotor[]).map((s) => ({
        chave: s.chave,
        rotulo: r.dim2 ? rotuloDaChave(r.fonte, r.dim2, s.chave, s.rotulo, nomes) : { texto: s.chave, traduzir: false },
        sem: s.sem,
        outros: s.outros,
        quantos: s.quantos ?? null,
        n: s.n,
      }))
    : null;
  return {
    fonte: r.fonte,
    medida,
    medidaDoMotor,
    ehFunil: funil,
    formato,
    dim1,
    dim2: r.dim2,
    grupos,
    series,
    total: { n: r.total.n, valor: valorDe(r.total, medidaDoMotor) },
    anterior: ant ? { valor: valorDe(ant.total, medidaDoMotor), de: ant.janela?.de ?? null, ate: ant.janela?.ate ?? null } : null,
    meta: r.meta,
    dobrados: r.dobrados ?? [],
    seriesDobradas: r.series_dobradas ?? [],
    janela: r.janela,
    moeda: r.moeda,
    valores: r.valores,
    foraDaMoeda: r.fora_da_moeda,
    funil: r.funil,
  };
}

/** A variação contra o período anterior: "+12%" ou, em taxa, "+3,5 pontos". */
export function variacao(
  atual: number | null,
  anterior: number | null,
  formato: FormatoDaMedida,
  f: Formato,
): { texto: string; sobe: boolean } | null {
  if (atual === null || anterior === null) return null;
  if (formato === "%") {
    const d = atual - anterior;
    const n = new Intl.NumberFormat(f.tag, { maximumFractionDigits: 1 }).format(d);
    return { texto: `${d >= 0 ? "+" : ""}${n} ${f.t("pontos")}`, sobe: d >= 0 };
  }
  if (anterior === 0) return atual ? { texto: f.t("sem base anterior"), sobe: true } : { texto: f.t("igual"), sobe: true };
  const p = Math.round(((atual - anterior) * 100) / anterior);
  return { texto: `${p >= 0 ? "+" : ""}${p}%`, sobe: p >= 0 };
}

/** O texto de "Sem …" e "Outros (n)". */
export function textoDoRotulo(r: Rotulo, t: (s: string) => string, quantos?: number | null): string {
  const base = r.traduzir ? t(r.texto) : r.texto;
  return quantos ? `${base} (${quantos})` : base;
}
