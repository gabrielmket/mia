import { addDays, addMonths, startOfDay, startOfMonth } from "date-fns";

import type { VisaoDaAgenda } from "@/components/agenda/tipos";

import { inicioDaSemana } from "./inicio-da-semana";

/**
 * O PERÍODO QUE A GRADE DESENHA — e, por ser a mesma função, o que ela BUSCA.
 *
 * ═══ O defeito ══════════════════════════════════════════════════════════════
 *
 * A visão Mês desenha SEIS semanas a partir da segunda-feira que abre o mês — os
 * últimos dias do mês anterior na primeira linha, os primeiros do seguinte nas
 * últimas. A busca de `_client.tsx`, porém, pedia só `[dia 1, dia 1 do mês
 * seguinte)`. Os dias do mês vizinho eram DESENHADOS e nunca BUSCADOS: a célula
 * de 30/09 na grade de outubro aparecia vazia com um compromisso marcado nela.
 *
 * Achado pelo CI em 2026-09-24: `agenda-ocupacao-do-google-na-grade` marca na
 * quarta da semana seguinte (30/09) e abre a visão Mês com a âncora em 01/10.
 * Na véspera a âncora era 30/09, o mês era setembro, e o dia estava na busca.
 *
 * Desenho e busca moravam em dois arquivos com duas contas; agora os dois leem
 * daqui, e divergir de novo exige mudar esta função. O dia em que a semana
 * começa também é um só, para os dois: `INICIO_DA_SEMANA`.
 */

/** Seis linhas sempre, mesmo quando o mês cabe em cinco — ver `VisaoDeMes`. */
export const SEMANAS_NA_VISAO_DE_MES = 6;

/** O primeiro dia da primeira linha da visão Mês (a segunda-feira que abre o mês). */
export function primeiroDiaDaVisaoDeMes(ancora: Date): Date {
  return inicioDaSemana(startOfMonth(ancora));
}

/** `[de, ate)` em hora local do navegador — o fim é exclusivo. */
export function recorteDaGrade(visao: VisaoDaAgenda, ancora: Date): { de: Date; ate: Date } {
  if (visao === "mes") {
    const de = primeiroDiaDaVisaoDeMes(ancora);
    return { de, ate: addDays(de, SEMANAS_NA_VISAO_DE_MES * 7) };
  }
  const de = visao === "semana" ? inicioDaSemana(ancora) : startOfDay(ancora);
  return { de, ate: addDays(de, visao === "semana" ? 7 : 1) };
}

/**
 * A âncora do período ANTERIOR ou SEGUINTE — o que as setas da tela fazem.
 *
 * Dia anda um dia e semana anda sete: a âncora continua sendo um DIA de
 * calendário, e a grade deriva a semana dele.
 *
 * ⚠️ O MÊS ANDA POR MÊS DE CALENDÁRIO, e não por 30 dias. Era `addDays(ancora,
 * 30)`, e 30 dias não são um mês: com a âncora no dia 1º de um mês de 31 dias
 * (basta clicar em "Hoje" num dia 1º, ou abrir pelo Mês o dia 1º), o "próximo"
 * caía no dia 31 do MESMO mês e a tela não saía do lugar; voltando de 1º de
 * março, caía em 30 de janeiro e fevereiro sumia do caminho.
 *
 * `addMonths` preserva a hora da âncora (o meio-dia de `ancoraLocalDoDia`) e,
 * quando o dia não existe no mês de destino, encosta no último — 31/01 vira
 * 28/02, nunca 03/03.
 */
export function ancoraDoPeriodoVizinho(
  visao: VisaoDaAgenda,
  ancora: Date,
  direcao: 1 | -1,
): Date {
  if (visao === "mes") return addMonths(ancora, direcao);
  return addDays(ancora, visao === "semana" ? 7 * direcao : direcao);
}
