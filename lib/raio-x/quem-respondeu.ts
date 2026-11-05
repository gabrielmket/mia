/**
 * FORK MIA (.102) · QUEM RESPONDEU PRIMEIRO, no raio-X do cliente ativo
 * (protótipo de 05/11/2026, tela 5). PURO.
 *
 * Só a fonte "conversas da MIA" sabe quem mandou cada mensagem da loja: o
 * produto carimba `messages.sent_via` em toda linha que grava. A leitura:
 *
 *   direction = inbound                → o CLIENTE (a ingestão carimba
 *                                        `external_device` também nele; quem
 *                                        separa é a direção)
 *   outbound + ai                      → a IA da MIA
 *   outbound + user | crm              → a equipe, pela MIA (o Inbox ou a API)
 *   outbound + external_device         → o CELULAR do número, fora da MIA (fica
 *                                        no histórico, sem quem respondeu e sem
 *                                        o funil)
 *   outbound + automation | system     → follow-up, automação ou integração
 *
 * A conta é por CONVERSA, como no protótipo (IA + equipe + celular + sem
 * resposta = clientes que chamaram): o primeiro episódio do período que o
 * cliente abriu, e quem deu a primeira resposta nele. A mediana da primeira
 * resposta é em SEGUNDOS (a IA responde em segundos), e "fora do horário" é
 * quantas dessas conversas chegaram com a loja fechada.
 */
import type { ConversaMedida, QuemDaLoja } from "./metricas";
import { mediana } from "./metricas";

/** A ordem das linhas na tela. */
export const QUEM_RESPONDE: readonly QuemDaLoja[] = ["ia", "equipe", "celular", "automacao"];

export type QuemEnviou = QuemDaLoja | "cliente";

/** Quem mandou a mensagem, pelo `direction` e pelo `sent_via` da linha de `messages`. */
export function quemEnviou(direcao: string | null | undefined, sentVia: string | null | undefined): QuemEnviou {
  if (direcao !== "outbound") return "cliente";
  switch (sentVia) {
    case "ai":
      return "ia";
    case "user":
    case "crm":
      return "equipe";
    case "external_device":
      return "celular";
    default:
      // `automation` e `system` (o CHECK de `messages_sent_via_check` não deixa outro valor).
      return "automacao";
  }
}

/** Uma pessoa da equipe respondeu (pela MIA ou pelo celular)? É o que conta como "alguém assumiu". */
export function ehPessoa(quem: QuemEnviou | null | undefined): boolean {
  return quem === "equipe" || quem === "celular";
}

export interface LinhaDeQuemRespondeu {
  quem: QuemDaLoja;
  /** Conversas em que este foi o primeiro a responder. */
  conversas: number;
  /** Mediana da primeira resposta nessas conversas, em segundos. */
  medianaSeg: number | null;
  /** Dessas, quantas chegaram com a loja fechada. */
  foraDoHorario: number;
}

export interface QuemRespondeu {
  /** Todas as conversas de cliente que têm episódio no período. */
  conversas: number;
  respondidas: number;
  semResposta: number;
  /** O primeiro episódio ainda está dentro das 24 horas: nem respondido, nem sem resposta. */
  emAberto: number;
  /** Quantas chegaram com a loja fechada (o "de N" da coluna "fora do horário"). */
  chegaramComALojaFechada: number;
  /** Uma linha por quem respondeu, na ordem de `QUEM_RESPONDE`; a de conta zero fica de fora (menos a IA). */
  linhas: LinhaDeQuemRespondeu[];
}

/** Junta as conversas medidas na tabela "quem respondeu primeiro". */
export function medirQuemRespondeu(conversas: readonly ConversaMedida[]): QuemRespondeu {
  const primeiros = conversas.flatMap((c) => (c.doCliente && c.episodios[0] ? [c.episodios[0]] : []));
  const por = new Map<QuemDaLoja, { tempos: number[]; foraDoHorario: number; conversas: number }>();
  for (const q of QUEM_RESPONDE) por.set(q, { tempos: [], foraDoHorario: 0, conversas: 0 });
  let semResposta = 0;
  let emAberto = 0;
  for (const e of primeiros) {
    if (e.desfecho === "sem_resposta") {
      semResposta += 1;
      continue;
    }
    if (e.desfecho === "em_aberto") {
      emAberto += 1;
      continue;
    }
    // Respondido sem saber quem (não acontece na fonte da MIA): conta como automação, a categoria neutra.
    const linha = por.get(e.primeiraRespostaQuem ?? "automacao")!;
    linha.conversas += 1;
    if (e.primeiraRespostaMs !== null) linha.tempos.push(e.primeiraRespostaMs);
    if (!e.aberta) linha.foraDoHorario += 1;
  }
  const linhas = QUEM_RESPONDE.map((quem) => {
    const l = por.get(quem)!;
    const m = mediana(l.tempos);
    return { quem, conversas: l.conversas, medianaSeg: m === null ? null : Math.round(m / 1000), foraDoHorario: l.foraDoHorario };
  }).filter((l) => l.conversas > 0 || l.quem === "ia");
  return {
    conversas: primeiros.length,
    respondidas: primeiros.length - semResposta - emAberto,
    semResposta,
    emAberto,
    chegaramComALojaFechada: primeiros.filter((e) => !e.aberta).length,
    linhas,
  };
}
