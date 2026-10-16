/**
 * FORK MIA (item 9) — OS DOZE RELATÓRIOS PRONTOS.
 *
 * "Os doze painéis prontos do item 8 viram relatórios prontos: abrem, copiam e
 * editam" (protótipo, tela 1). Cada um é uma configuração do montador, com o
 * MESMO título e a mesma chave do painel pronto (`PAINEIS_PRONTOS`), para que a
 * pessoa reconheça o que já via em Painéis.
 *
 * Decisão do protótipo ("Relatório pronto"): o pronto é referência da
 * plataforma e mora AQUI, no código. Abrir mostra; copiar grava uma linha em
 * `mia_relatorios` com `pronto_de`, e a cópia é de quem copiou. O original não
 * muda e continua igual para todos os clientes.
 *
 * O funil: o pronto que agrupa por etapa usa o funil dos relatórios da empresa
 * (`mia_relatorios_da_empresa`, que a implantação liga ao funil do segmento),
 * ou o principal. Isso é aplicado ao abrir (`normalizarConfig`), não guardado
 * aqui.
 *
 * ⚠️ Módulo PURO.
 */
import { PAINEIS_PRONTOS, TITULO_DO_PAINEL, type ChaveDoPainel } from "@/lib/paineis/catalogo";

import type { ConfigDoRelatorio } from "./config";
import { configPadrao } from "./config";

export interface RelatorioPronto {
  chave: ChaveDoPainel;
  nome: string;
  pergunta: string;
  config: ConfigDoRelatorio;
}

function cfg(base: Pick<ConfigDoRelatorio, "fonte"> & Partial<ConfigDoRelatorio>): ConfigDoRelatorio {
  return { ...configPadrao(base.fonte), ...base };
}

const PERGUNTAS: Record<ChaveDoPainel, string> = {
  resultado: "Quantos negócios fechei este mês, comparado ao mesmo trecho do mês passado?",
  meta: "Vou bater a meta?",
  funil: "Onde os negócios param?",
  origem: "Qual canal traz mais negócios?",
  perdas: "Qual o motivo das perdas?",
  atendimento: "Quanto o agente resolveu sozinho?",
  resposta: "Quanto o cliente espera pela primeira resposta?",
  agenda: "Marcou, confirmou, veio ou faltou?",
  followup: "Quantos voltaram a responder?",
  anuncios: "O que foi informado à Meta e ao Google?",
  previsao: "Quanto deve entrar, etapa por etapa?",
  assuntos: "O que mais ocupa o atendimento?",
};

const CONFIGS: Record<ChaveDoPainel, ConfigDoRelatorio> = {
  resultado: cfg({ fonte: "negocios", medida: "qtd", dim1: "mes", periodo: "mes", filtros: { situacao: "ganho" }, comparar: true, visualizacao: "numero" }),
  // A meta é de faturamento: a soma dos ganhos nos funis em que vencer é receita
  // (a régua de app/api/v1/metas/route.ts, a mesma do painel pronto).
  meta: cfg({ fonte: "negocios", medida: "soma", dim1: "semana", periodo: "mes", filtros: { situacao: "ganho", so_receita: true }, visualizacao: "numero" }),
  funil: cfg({ fonte: "negocios", medida: "qtd", dim1: "etapa", visualizacao: "funil" }),
  origem: cfg({ fonte: "negocios", medida: "qtd", dim1: "origem" }),
  perdas: cfg({ fonte: "negocios", medida: "qtd", dim1: "motivo", filtros: { situacao: "perdido" } }),
  atendimento: cfg({ fonte: "conversas", medida: "qtd", dim1: "quem", visualizacao: "rosca" }),
  resposta: cfg({ fonte: "conversas", medida: "tresp", dim1: "semana", dim2: "quem", periodo: "90", visualizacao: "linha" }),
  agenda: cfg({ fonte: "agenda", medida: "qtd", dim1: "situacao", periodo: "mes" }),
  followup: cfg({ fonte: "followup", medida: "qtd", dim1: "resultado" }),
  anuncios: cfg({ fonte: "anuncios", medida: "qtd", dim1: "evento", dim2: "plataforma" }),
  previsao: cfg({ fonte: "negocios", medida: "prev", dim1: "etapa", periodo: "90" }),
  assuntos: cfg({ fonte: "conversas", medida: "qtd", dim1: "etiqueta" }),
};

export const RELATORIOS_PRONTOS: readonly RelatorioPronto[] = PAINEIS_PRONTOS.map((chave) => ({
  chave,
  nome: TITULO_DO_PAINEL[chave],
  pergunta: PERGUNTAS[chave],
  config: CONFIGS[chave],
}));

export function relatorioPronto(chave: string): RelatorioPronto | null {
  return RELATORIOS_PRONTOS.find((p) => p.chave === chave) ?? null;
}

/**
 * O nome do pronto como a empresa o lê: o de agenda leva a palavra do segmento
 * ("Agenda: avaliações", "Agenda: visitas"), do vocabulário do funil.
 */
export function nomeDoPronto(p: Pick<RelatorioPronto, "chave" | "nome">, compromissos: string | null | undefined, t: (s: string) => string): string {
  if (p.chave === "agenda" && compromissos) return `${t(p.nome)}: ${compromissos.toLocaleLowerCase("pt-BR")}`;
  return t(p.nome);
}
