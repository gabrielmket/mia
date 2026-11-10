/**
 * FORK MIA (.101) · Os rótulos das telas do raio-X (Admin, conexão e link do
 * dono). Tabelas de módulo: a tela os passa por `t()` e a cerca do espanhol
 * resolve os valores (lib/i18n/dicionario-mia-raio-x.ts).
 */
import type { SituacaoDoRaioX } from "@/lib/raio-x/regras";

import type { DiaDaSemana } from "@/lib/raio-x/horario";

/** 0 = segunda ... 6 = domingo (a ordem das colunas do mapa). */
export const DIAS: readonly DiaDaSemana[] = [0, 1, 2, 3, 4, 5, 6];
export const ROTULO_DO_DIA: Record<DiaDaSemana, string> = { 0: "Seg", 1: "Ter", 2: "Qua", 3: "Qui", 4: "Sex", 5: "Sáb", 6: "Dom" };

export type IndiceDaFaixa = 0 | 1 | 2 | 3;
export const FAIXAS: readonly IndiceDaFaixa[] = [0, 1, 2, 3];
export const ROTULO_DA_FAIXA: Record<IndiceDaFaixa, string> = { 0: "8h a 12h", 1: "12h a 14h", 2: "14h a 18h", 3: "18h às 8h" };

/** Índice de dia ou faixa vindo do relatório guardado, já no intervalo. */
export function diaValido(n: unknown): DiaDaSemana {
  const v = Math.trunc(Number(n));
  return (v >= 0 && v <= 6 ? v : 0) as DiaDaSemana;
}
export function faixaValida(n: unknown): IndiceDaFaixa {
  const v = Math.trunc(Number(n));
  return (v >= 0 && v <= 3 ? v : 0) as IndiceDaFaixa;
}

export const ROTULO_DA_SITUACAO: Record<SituacaoDoRaioX, string> = {
  aguardando: "aguardando o cliente conectar",
  conectando: "autorizado, aguardando conectar",
  lendo: "lendo o histórico",
  analisando: "preparando o relatório",
  pronto: "relatório pronto",
  encerrado: "encerrado",
};

/** FORK MIA (.107): de onde veio o raio-X (a lista e o detalhe do Admin). */
export const ROTULO_DA_ORIGEM_NA_LISTA = {
  time: "Time",
  cadastro_gratis: "cadastro grátis",
  avulsa: "avulsa",
  mensal: "mensal",
} as const;

/** FORK MIA (.107): a situação do pedido de nova análise. */
export const ROTULO_DA_SITUACAO_DO_PEDIDO = {
  interesse: "interesse (sem pagamento)",
  aguardando: "aguardando o pagamento",
  pago: "pago",
  cancelado: "cancelado",
} as const;

export const ROTULO_DO_TIPO = {
  unico: "Diagnóstico único",
  mensal: "Acompanhamento mensal",
} as const;

export const ROTULO_DE_QUEM_ATENDE = {
  humano: "Pessoas da loja",
  agente: "Agente automático",
  misto: "Os dois",
} as const;

export const ROTULO_DA_FASE = {
  sincronizando: "recebendo o histórico do WhatsApp",
  lendo: "lendo as conversas",
  conferindo: "conferindo as últimas mensagens",
  concluida: "leitura concluída",
} as const;

export const ROTULO_DA_SITUACAO_DO_LINK = {
  ativo: "ativo",
  vencido: "vencido",
  revogado: "revogado",
} as const;

/** "38 min", "3h20", "12h": o tempo como o relatório escreve. */
export function minutosParaLer(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return "·";
  const v = Math.round(m);
  if (v < 60) return `${v} min`;
  const h = Math.floor(v / 60);
  const resto = v % 60;
  return resto ? `${h}h${String(resto).padStart(2, "0")}` : `${h}h`;
}

/** "15%" a partir de 0,15. */
export function proporcaoParaLer(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "·";
  return `${Math.round(p * 100)}%`;
}

/** "6,2" com uma casa, no formato do idioma. */
export function notaParaLer(n: number | null | undefined, tag: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "·";
  return new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
}

/** A cor do quadro do mapa: até 15 min, até 1 hora, mais que isso. */
export function tomDoTempo(m: number | null): "ok" | "warn" | "danger" | "vazio" {
  if (m === null) return "vazio";
  if (m <= 15) return "ok";
  if (m <= 60) return "warn";
  return "danger";
}

export const CLASSE_DO_TOM = {
  ok: "bg-success-bg text-success-fg",
  warn: "bg-warning-bg text-warning-fg",
  danger: "bg-error-bg text-error-fg",
  vazio: "bg-surface-elevated text-text-muted",
} as const;

// ─── FORK MIA (.102) · o raio-X do cliente ativo ─────────────────────────────

/** Quem respondeu (as linhas de "quem respondeu primeiro"). */
export const ROTULO_DE_QUEM = {
  ia: "IA",
  equipe: "Equipe pela MIA",
  celular: "Celular do número",
  automacao: "Follow-up e automação",
} as const;

/** As faixas da espera depois da passagem para um vendedor. */
export const ROTULO_DA_FAIXA_DA_ESPERA = {
  ate_15_min: "Até 15 min",
  de_15_min_a_2_h: "De 15 min a 2 h",
  mais_de_2_h: "Mais de 2 h",
  ninguem: "Ninguém assumiu",
} as const;

/** "9 s", "14 min", "2 h 05 min": o tempo em SEGUNDOS, como o protótipo escreve. */
export function segundosParaLer(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "·";
  const v = Math.max(0, Math.round(s));
  if (v < 60) return `${v} s`;
  const min = Math.round(v / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h} h ${String(resto).padStart(2, "0")} min` : `${h} h`;
}

/**
 * O tempo de um indicador em minutos. Os relatórios da .102 guardam a fração
 * (9 s = 0,15 min); os da .101, minutos inteiros. Menos de 1 minuto com fração
 * sai em segundos; o resto, como `minutosParaLer`.
 */
export function minutosOuSegundosParaLer(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return "·";
  if (m < 1 && !Number.isInteger(m)) return segundosParaLer(m * 60);
  return minutosParaLer(m);
}

/** FORK MIA (.106): a etapa da análise em que o último erro aconteceu (`analise.ultimo_erro.etapa`). */
export type EtapaDaAnaliseNaTela = "preparo" | "transcricao" | "classificacao" | "relatorio";
export const ROTULO_DA_ETAPA_DA_ANALISE: Record<EtapaDaAnaliseNaTela, string> = {
  preparo: "preparo dos áudios",
  transcricao: "transcrição dos áudios",
  classificacao: "análise das conversas",
  relatorio: "montagem do relatório",
};
export function etapaDaAnalise(bruto: string): EtapaDaAnaliseNaTela {
  return bruto in ROTULO_DA_ETAPA_DA_ANALISE ? (bruto as EtapaDaAnaliseNaTela) : "preparo";
}
