/**
 * FORK MIA (item 9) — A CONFIGURAÇÃO DE UM RELATÓRIO e as regras do editor.
 *
 * Um relatório é: fonte, medida, até dois agrupamentos, filtros, período,
 * comparar com o anterior e a visualização. É o que `mia_relatorios` guarda
 * (9040) e o que vira um pedido ao motor (`fn_mia_relatorio`, 9030/9041).
 *
 * As regras automáticas do protótipo (tela 3) moram aqui, num lugar só, para o
 * editor, as rotas e o MCP dizerem a MESMA coisa:
 *  - "Etapa depende do funil": agrupar por etapa (ou desenhar o funil) usa um
 *    funil; sem filtro, o dos prontos da empresa ou o principal;
 *  - "Motivo de perda só existe em negócio perdido";
 *  - quem não vê valor volta para quantidade;
 *  - a visualização que não combina fica desligada e DIZ o motivo.
 *
 * ⚠️ Módulo PURO (o editor do navegador importa).
 */
import { z } from "zod";

import { CATALOGO_DO_MOTOR, type Dimensao, type Fonte, type Medida } from "@/lib/paineis/catalogo";
import type { PedidoAoMotor, RespostaDoMotor } from "@/lib/paineis/motor";

import {
  DIMENSOES_DO_MONTADOR,
  FATIAS_DA_ROSCA,
  FILTROS_DE_UM_VALOR,
  FONTES,
  FONTES_DO_MONTADOR,
  MEDIDAS_DO_MONTADOR,
  PERIODOS_DO_MONTADOR,
  PERIODO_PADRAO_DO_MONTADOR,
  VISUALIZACOES,
  ehDimensaoDeTempo,
  medidasDaFonte,
  type MedidaDoMontador,
  type PeriodoDoMontador,
  type Visualizacao,
} from "./catalogo";

// ─── O tipo ─────────────────────────────────────────────────────────────────

/** Um valor de filtro: um texto, uma lista (qualquer um passa) ou o `so_receita` (booleano). */
export type ValorDeFiltro = string | string[] | boolean;

export interface ConfigDoRelatorio {
  fonte: Fonte;
  medida: MedidaDoMontador;
  dim1: Dimensao | null;
  dim2: Dimensao | null;
  filtros: Record<string, ValorDeFiltro>;
  periodo: PeriodoDoMontador;
  /** Só em "pers": `AAAA-MM-DD`, no fuso da empresa. */
  de: string | null;
  ate: string | null;
  comparar: boolean;
  visualizacao: Visualizacao;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** O contrato de entrada (rotas e MCP). O banco confere de novo (`mia_relatorios_config`). */
export const configDoRelatorioSchema = z
  .object({
    fonte: z.enum(FONTES),
    medida: z.string().min(1).max(20),
    dim1: z.string().min(1).max(20).nullable(),
    dim2: z.string().min(1).max(20).nullable(),
    filtros: z
      .record(
        z.string().min(1).max(20),
        z.union([z.string().min(1).max(200), z.array(z.string().min(1).max(200)).max(50), z.boolean()]),
      )
      .default({}),
    periodo: z.enum(PERIODOS_DO_MONTADOR).default(PERIODO_PADRAO_DO_MONTADOR),
    de: z.string().regex(DATA).nullable().default(null),
    ate: z.string().regex(DATA).nullable().default(null),
    comparar: z.boolean().default(false),
    visualizacao: z.enum(VISUALIZACOES).default("barras"),
  })
  .strict()
  .superRefine((c, ctx) => {
    const cat = CATALOGO_DO_MOTOR[c.fonte];
    if (!(medidasDaFonte(c.fonte) as string[]).includes(c.medida)) {
      ctx.addIssue({ code: "custom", path: ["medida"], message: `medida fora da fonte ${c.fonte}: ${c.medida}` });
    }
    if (c.dim1 && !(cat.dims as readonly string[]).includes(c.dim1)) {
      ctx.addIssue({ code: "custom", path: ["dim1"], message: `agrupamento fora da fonte ${c.fonte}: ${c.dim1}` });
    }
    if (c.dim2 && (!c.dim1 || c.dim2 === c.dim1 || !(cat.dims as readonly string[]).includes(c.dim2))) {
      ctx.addIssue({ code: "custom", path: ["dim2"], message: "segundo agrupamento inválido" });
    }
    for (const [k, v] of Object.entries(c.filtros)) {
      if (!(cat.filtros as readonly string[]).includes(k)) {
        ctx.addIssue({ code: "custom", path: ["filtros", k], message: `filtro fora da fonte ${c.fonte}: ${k}` });
      }
      if (Array.isArray(v) && FILTROS_DE_UM_VALOR.has(k)) {
        ctx.addIssue({ code: "custom", path: ["filtros", k], message: `o filtro ${k} é de um valor só` });
      }
    }
    if (c.periodo === "pers" && (!c.de || !c.ate)) {
      ctx.addIssue({ code: "custom", path: ["de"], message: "período personalizado pede as duas datas" });
    }
  });

/** A configuração padrão de uma fonte (o editor abre com uma conta que faz sentido para ela). */
export function configPadrao(fonte: Fonte): ConfigDoRelatorio {
  const p = FONTES_DO_MONTADOR[fonte].padrao;
  return {
    fonte,
    medida: p.medida,
    dim1: p.dim1,
    dim2: null,
    filtros: {},
    periodo: PERIODO_PADRAO_DO_MONTADOR,
    de: null,
    ate: null,
    comparar: false,
    visualizacao: "barras",
  };
}

// ─── As regras automáticas ──────────────────────────────────────────────────

export interface ContextoDoEditor {
  /** Quem olha vê valor em reais? (`lib/relatorios/acesso.ts`) */
  valores: boolean;
  /** O funil dos relatórios da empresa (o dos prontos, ou o principal). */
  funilPadrao: { id: string; nome: string } | null;
}

/** Um aviso que o editor mostra quando ajusta a configuração sozinho. */
export interface Aviso {
  texto: string;
  /** Parte que é dado (nome do funil), fora da tradução. */
  dado?: string;
}

function semFiltro(filtros: Record<string, ValorDeFiltro>, chave: string): Record<string, ValorDeFiltro> {
  const { [chave]: _fora, ...resto } = filtros;
  return resto;
}

/**
 * Deixa a configuração coerente, e diz o que mudou. Nunca falha: o que não cabe
 * volta para o padrão da fonte. É a `normalizar` do protótipo.
 */
export function normalizarConfig(entrada: ConfigDoRelatorio, ctx: ContextoDoEditor): { config: ConfigDoRelatorio; avisos: Aviso[] } {
  const avisos: Aviso[] = [];
  const c: ConfigDoRelatorio = { ...entrada, filtros: { ...entrada.filtros } };
  const cat = CATALOGO_DO_MOTOR[c.fonte];
  const padrao = FONTES_DO_MONTADOR[c.fonte].padrao;

  if (!(medidasDaFonte(c.fonte) as string[]).includes(c.medida)) c.medida = padrao.medida;
  if (!c.dim1 || !(cat.dims as readonly string[]).includes(c.dim1)) c.dim1 = padrao.dim1;
  if (c.dim2 && (c.dim2 === c.dim1 || !(cat.dims as readonly string[]).includes(c.dim2) || ehDimensaoDeTempo(c.dim2))) {
    c.dim2 = null;
  }
  for (const k of Object.keys(c.filtros)) {
    if (!(cat.filtros as readonly string[]).includes(k)) c.filtros = semFiltro(c.filtros, k);
  }
  if (c.periodo === "pers" && (!c.de || !c.ate)) c.periodo = PERIODO_PADRAO_DO_MONTADOR;
  if (c.periodo !== "pers") {
    c.de = null;
    c.ate = null;
  }

  if (MEDIDAS_DO_MONTADOR[c.medida].valor && !ctx.valores) {
    c.medida = "qtd";
    avisos.push({ texto: "Seu acesso não mostra valores em reais: a medida voltou para quantidade." });
  }

  const precisaDeFunil =
    c.fonte === "negocios" && (c.dim1 === "etapa" || c.dim2 === "etapa" || c.visualizacao === "funil");
  if (precisaDeFunil && !c.filtros.funil && ctx.funilPadrao) {
    c.filtros = { ...c.filtros, funil: ctx.funilPadrao.id };
    avisos.push({
      texto: "Etapa depende do funil: o relatório passou a usar o funil abaixo. Troque no filtro Funil.",
      dado: ctx.funilPadrao.nome,
    });
  }

  if (c.fonte === "negocios" && (c.dim1 === "motivo" || c.dim2 === "motivo") && c.filtros.situacao !== "perdido") {
    c.filtros = { ...c.filtros, situacao: "perdido" };
    avisos.push({ texto: 'Motivo de perda só existe em negócio perdido: a situação foi para "perdido".' });
  }

  return { config: c, avisos };
}

/**
 * Por que a visualização `v` não combina com a configuração (ou `null`, quando
 * combina). A tela desliga o botão e escreve o motivo. `resposta` (opcional)
 * conta as fatias da rosca.
 */
export function motivoDaVisualizacao(
  c: ConfigDoRelatorio,
  v: Visualizacao,
  resposta?: Pick<RespostaDoMotor, "grupos"> | null,
): string | null {
  const d1 = c.dim1 ? DIMENSOES_DO_MONTADOR[c.dim1] : null;
  const m = MEDIDAS_DO_MONTADOR[c.medida];
  if (v === "linha" && !d1?.tempo) return "Linha mostra a evolução no tempo: agrupe por mês, semana ou dia.";
  if (v === "rosca") {
    if (d1?.tempo) return "Rosca não mostra tempo: use barras ou linha.";
    if (!m.aditiva) return "Rosca reparte um total: média, taxa e tempo não se repartem.";
    if (c.dim2) return "Rosca não tem segundo agrupamento.";
    if (d1?.multi) return "Um registro pode estar em mais de um grupo: as fatias somariam mais que o total.";
    if (resposta) {
      const comValor = resposta.grupos.filter((g) => {
        const x = g.valores[c.medida as Medida];
        return typeof x === "number" ? x > 0 : g.n > 0;
      }).length;
      if (comValor > FATIAS_DA_ROSCA) return "Mais de 8 fatias ninguém lê: use barras.";
    }
  }
  if (v === "funil") {
    if (c.fonte !== "negocios" || c.dim1 !== "etapa") return "Funil só agrupando negócios por etapa.";
    if (c.dim2) return "Funil não tem segundo agrupamento.";
    if (c.medida !== "qtd" && c.medida !== "soma") return "Funil conta quantidade ou soma do valor.";
  }
  return null;
}

/** A visualização que vale: a pedida, ou barras quando a pedida não combina. */
export function visualizacaoQueVale(c: ConfigDoRelatorio, resposta?: Pick<RespostaDoMotor, "grupos"> | null): Visualizacao {
  return motivoDaVisualizacao(c, c.visualizacao, resposta) ? "barras" : c.visualizacao;
}

// ─── O pedido ao motor ──────────────────────────────────────────────────────

/** Os filtros como o motor os recebe: sem os que a medida ignora, sem listas vazias. */
export function filtrosParaOMotor(c: ConfigDoRelatorio): Record<string, string | boolean | string[]> {
  const fora = MEDIDAS_DO_MONTADOR[c.medida].ignoraSituacao;
  const saida: Record<string, string | boolean | string[]> = {};
  for (const [k, v] of Object.entries(c.filtros)) {
    if (k === "situacao" && fora) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (v === "" || v === false) continue;
    saida[k] = v;
  }
  return saida;
}

/**
 * O pedido ao motor de um relatório. O funil desenhado pede "chegaram" (com a
 * soma quando a medida é soma); o número grande não agrupa.
 */
export function pedidoDoRelatorio(
  c: ConfigDoRelatorio,
  opcoes: { organizationId: string; valores: boolean; agora?: string | null; periodo?: PeriodoDoMontador | null },
): PedidoAoMotor {
  const vis = visualizacaoQueVale(c);
  const periodo = opcoes.periodo ?? c.periodo;
  const base = {
    organizationId: opcoes.organizationId,
    fonte: c.fonte,
    filtros: filtrosParaOMotor(c) as PedidoAoMotor["filtros"],
    periodo,
    de: periodo === "pers" ? c.de : null,
    ate: periodo === "pers" ? c.ate : null,
    valores: opcoes.valores,
    agora: opcoes.agora ?? null,
  };
  if (vis === "funil") {
    return {
      ...base,
      medidas: c.medida === "soma" ? ["chegaram", "soma"] : ["chegaram"],
      dim1: "etapa",
      dim2: null,
      comparar: false,
    };
  }
  if (vis === "numero") {
    return { ...base, medidas: [c.medida], dim1: null, dim2: null, comparar: c.comparar };
  }
  return { ...base, medidas: [c.medida], dim1: c.dim1, dim2: c.dim2, comparar: c.comparar };
}

/** O que um relatório agrupa ou filtra que identifica uma pessoa da equipe (fica fora do link do dono). */
export function identificaPessoa(c: Pick<ConfigDoRelatorio, "dim1" | "dim2" | "filtros">): boolean {
  const pessoa = (d: Dimensao | null) => Boolean(d && DIMENSOES_DO_MONTADOR[d].pessoa);
  if (pessoa(c.dim1) || pessoa(c.dim2)) return true;
  return Object.keys(c.filtros).some((k) => k in DIMENSOES_DO_MONTADOR && DIMENSOES_DO_MONTADOR[k as Dimensao].pessoa);
}

/** A configuração que vem do banco (colunas de `mia_relatorios`). */
export interface LinhaDeConfig {
  fonte: string;
  medida: string;
  dim1: string | null;
  dim2: string | null;
  filtros: unknown;
  periodo: string;
  de: string | null;
  ate: string | null;
  comparar: boolean;
  visualizacao: string;
}

export function configDaLinha(l: LinhaDeConfig): ConfigDoRelatorio {
  return {
    fonte: l.fonte as Fonte,
    medida: l.medida as MedidaDoMontador,
    dim1: (l.dim1 as Dimensao | null) ?? null,
    dim2: (l.dim2 as Dimensao | null) ?? null,
    filtros: (l.filtros && typeof l.filtros === "object" ? l.filtros : {}) as Record<string, ValorDeFiltro>,
    periodo: (PERIODOS_DO_MONTADOR as readonly string[]).includes(l.periodo) ? (l.periodo as PeriodoDoMontador) : PERIODO_PADRAO_DO_MONTADOR,
    de: l.de,
    ate: l.ate,
    comparar: l.comparar,
    visualizacao: (VISUALIZACOES as readonly string[]).includes(l.visualizacao) ? (l.visualizacao as Visualizacao) : "barras",
  };
}

/** As colunas de `mia_relatorios` de uma configuração. */
export function colunasDaConfig(c: ConfigDoRelatorio) {
  return {
    fonte: c.fonte,
    medida: c.medida,
    dim1: c.dim1,
    dim2: c.dim2,
    filtros: c.filtros,
    periodo: c.periodo,
    de: c.periodo === "pers" ? c.de : null,
    ate: c.periodo === "pers" ? c.ate : null,
    comparar: c.comparar,
    visualizacao: c.visualizacao,
  };
}
