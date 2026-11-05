/**
 * FORK MIA (.101) · A EVOLUÇÃO ENTRE UM RAIO-X E O ANTERIOR (decisão 13). PURO.
 *
 * Todo raio-X novo da MESMA empresa (mesmo WhatsApp comercial normalizado, ou a
 * mesma conta da MIA quando ligada) é comparado com o anterior; no mensal, mês a
 * mês. Os indicadores vão em PROPORÇÃO (o total de conversas muda de um para o
 * outro) e em mediana de minutos, nunca em contagem.
 *
 * A nota só se compara com a MESMA versão dos critérios: se a régua mudou entre
 * os dois relatórios, a linha da nota sai com o aviso `criterios_diferentes` e
 * sem "melhorou/piorou" (comparar notas de réguas diferentes seria inventar
 * evolução).
 */
import { samePhone } from "@/lib/channels/phone-variants";

import type { FonteDoRaioX } from "./regras";

/** Os sete indicadores da .101: todo relatório guardado os tem. */
export const INDICADORES_DA_V1 = [
  "medianaPrimeiraRespostaMin",
  "medianaComALojaFechadaMin",
  "proporcaoSemResposta",
  "proporcaoSumiuSemRetorno",
  "proporcaoPediuValorSemReceber",
  "proporcaoAgendou",
  "notaMedia",
] as const;
export type IndicadorDaV1 = (typeof INDICADORES_DA_V1)[number];

/**
 * FORK MIA (.102): os indicadores do "antes e depois" do protótipo de
 * 05/11/2026 (tela 6). Os relatórios da .101 não os têm: do lado deles a linha
 * vem sem valor e sem direção, e a espera depois da passagem, que só o cliente
 * ativo mede, sai como "novo".
 */
export const INDICADORES_NOVOS = ["proporcaoSemRespostaOuRetorno", "proporcaoRespondidoForaDoHorario", "medianaEsperaDaPassagemMin"] as const;
export type IndicadorNovo = (typeof INDICADORES_NOVOS)[number];

/** A ordem da tabela (a do protótipo de 05/11/2026, com os da .101 no meio). */
export const INDICADORES = [
  "proporcaoSemResposta",
  "proporcaoSemRespostaOuRetorno",
  "medianaPrimeiraRespostaMin",
  "medianaComALojaFechadaMin",
  "proporcaoRespondidoForaDoHorario",
  "proporcaoSumiuSemRetorno",
  "proporcaoPediuValorSemReceber",
  "proporcaoAgendou",
  "medianaEsperaDaPassagemMin",
  "notaMedia",
] as const satisfies readonly (IndicadorDaV1 | IndicadorNovo)[];
export type Indicador = (typeof INDICADORES)[number];

/** Menor é melhor em tempo e nos desfechos ruins; maior é melhor no resto. */
const MENOR_E_MELHOR: ReadonlySet<Indicador> = new Set([
  "medianaPrimeiraRespostaMin",
  "medianaComALojaFechadaMin",
  "proporcaoSemResposta",
  "proporcaoSumiuSemRetorno",
  "proporcaoPediuValorSemReceber",
  "proporcaoSemRespostaOuRetorno",
  "medianaEsperaDaPassagemMin",
]);

export const ROTULO_DO_INDICADOR: Record<Indicador, string> = {
  medianaPrimeiraRespostaMin: "Metade das conversas respondida em até",
  medianaComALojaFechadaMin: "Primeira resposta com a loja fechada",
  proporcaoSemResposta: "Ficaram sem resposta",
  proporcaoSumiuSemRetorno: "Sumiram e a loja não voltou a chamar",
  proporcaoPediuValorSemReceber: "Pediram o valor e não receberam",
  proporcaoAgendou: "Agendaram o próximo passo",
  notaMedia: "Nota do atendimento",
  proporcaoSemRespostaOuRetorno: "Sem resposta ou sumiu sem retorno",
  proporcaoRespondidoForaDoHorario: "Respondido fora do horário",
  medianaEsperaDaPassagemMin: "Espera depois de passar para um vendedor (mediana)",
};

/** Os da .101 sempre; os novos (.102), quando o relatório os tem. */
export type Indicadores = Record<IndicadorDaV1, number | null> & Partial<Record<IndicadorNovo, number | null>>;

export type Direcao = "melhor" | "pior" | "igual";

export interface LinhaDaComparacao {
  indicador: Indicador;
  anterior: number | null;
  agora: number | null;
  /** `null` = sem dado de um dos lados, ou critérios diferentes na nota. */
  direcao: Direcao | null;
  /** FORK MIA (.102): `novo` = o anterior não media isso (a espera depois da passagem). */
  aviso: "criterios_diferentes" | "novo" | null;
}

export interface Comparacao {
  anteriorId: string;
  /** Quando o relatório anterior foi gerado (ISO). */
  anteriorEm: string;
  conversasAntes: number;
  conversasAgora: number;
  criteriosIguais: boolean;
  linhas: LinhaDaComparacao[];
  melhorou: number;
  piorou: number;
  comparaveis: number;
  /** FORK MIA (.102): os períodos e as fontes dos dois lados (ausentes nas comparações da .101). */
  anteriorPeriodo?: { inicio: string; fim: string };
  agoraPeriodo?: { inicio: string; fim: string };
  anteriorFonte?: FonteDoRaioX;
  fonte?: FonteDoRaioX;
}

/** Diferença que não conta como mudança, por natureza do indicador. */
function igual(indicador: Indicador, antes: number, agora: number): boolean {
  if (indicador === "notaMedia") return Math.abs(agora - antes) < 0.2;
  if (indicador.startsWith("proporcao")) return Math.abs(agora - antes) < 0.01;
  // Tempo em minutos: menos de 2 minutos ou menos de 5% não é mudança.
  const delta = Math.abs(agora - antes);
  return delta < 2 || delta / Math.max(antes, 1) < 0.05;
}

export function direcaoDoIndicador(indicador: Indicador, antes: number | null, agora: number | null): Direcao | null {
  if (antes === null || agora === null || !Number.isFinite(antes) || !Number.isFinite(agora)) return null;
  if (igual(indicador, antes, agora)) return "igual";
  const caiu = agora < antes;
  return MENOR_E_MELHOR.has(indicador) === caiu ? "melhor" : "pior";
}

export interface RelatorioParaComparar {
  id: string;
  criadoEm: string;
  criteriosVersao: string;
  conversas: number;
  indicadores: Indicadores;
  /** FORK MIA (.102). */
  periodo?: { inicio: string; fim: string };
  fonte?: FonteDoRaioX;
}

export function compararComOAnterior(atual: RelatorioParaComparar, anterior: RelatorioParaComparar): Comparacao {
  const criteriosIguais = atual.criteriosVersao === anterior.criteriosVersao;
  const linhas: LinhaDaComparacao[] = INDICADORES.map((indicador) => {
    const antes = anterior.indicadores[indicador] ?? null;
    const agora = atual.indicadores[indicador] ?? null;
    if (indicador === "notaMedia" && !criteriosIguais) {
      return { indicador, anterior: antes, agora, direcao: null, aviso: "criterios_diferentes" };
    }
    if (indicador === "medianaEsperaDaPassagemMin" && antes === null && agora !== null) {
      return { indicador, anterior: null, agora, direcao: null, aviso: "novo" };
    }
    return { indicador, anterior: antes, agora, direcao: direcaoDoIndicador(indicador, antes, agora), aviso: null };
  });
  return {
    anteriorId: anterior.id,
    anteriorEm: anterior.criadoEm,
    conversasAntes: anterior.conversas,
    conversasAgora: atual.conversas,
    criteriosIguais,
    linhas,
    melhorou: linhas.filter((l) => l.direcao === "melhor").length,
    piorou: linhas.filter((l) => l.direcao === "pior").length,
    comparaveis: linhas.filter((l) => l.direcao !== null).length,
    ...(anterior.periodo ? { anteriorPeriodo: anterior.periodo } : {}),
    ...(atual.periodo ? { agoraPeriodo: atual.periodo } : {}),
    ...(anterior.fonte ? { anteriorFonte: anterior.fonte } : {}),
    ...(atual.fonte ? { fonte: atual.fonte } : {}),
  };
}

/**
 * "Mesma empresa" (decisão 13): o mesmo WhatsApp (com ou sem o nono dígito,
 * `samePhone`), ou a mesma conta da MIA.
 */
export function mesmaEmpresa(
  a: { whatsapp: string; organization_id: string | null },
  b: { whatsapp: string; organization_id: string | null },
): boolean {
  if (a.whatsapp && b.whatsapp && samePhone(a.whatsapp, b.whatsapp)) return true;
  return Boolean(a.organization_id && a.organization_id === b.organization_id);
}
