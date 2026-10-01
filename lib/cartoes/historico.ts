/**
 * FORK MIA — o HISTÓRICO do cartão aberto: filtros e o agrupamento das ações
 * da IA.
 *
 * A linha do tempo do negócio (`crm_lead_activities`) registra tudo — inclusive
 * cada turno da IA e cada decisão dela de NÃO enviar (decisão do upstream: o
 * silêncio do agente também é evento). Isso é certo para auditoria e errado para
 * quem abre o cartão querendo saber o que aconteceu: numa semana de conversa, os
 * turnos da IA soterram a nota fixada e a troca de etapa.
 *
 * Então: tudo continua registrado e à vista em "Tudo"; em "Importante", as ações
 * rotineiras da IA de um MESMO DIA viram UMA linha expansível ("A IA fez 14
 * ações · 12 decisões de não enviar"), e as notas fixadas sobem ao topo.
 */
import type { TimelineItemView } from "@/lib/types/contacts";

export const FILTROS_DO_HISTORICO = ["importante", "tudo", "conversas", "tarefas"] as const;
export type FiltroDoHistorico = (typeof FILTROS_DO_HISTORICO)[number];

export const ROTULO_DO_FILTRO = {
  importante: "Importante",
  tudo: "Tudo",
  conversas: "Conversas",
  tarefas: "Tarefas",
} as const satisfies Record<FiltroDoHistorico, string>;

/** O que a IA faz em rotina — relato, não decisão. Agrupa por dia em "Importante". */
const ROTINA_DA_IA = new Set(["ai_turn", "send_vetoed", "lead_cooled", "followup_scheduled", "followup_cancelled"]);

/** O que é TAREFA ou decisão sobre o que fazer. */
const DE_TAREFA = new Set([
  "task_created",
  "task_completed",
  "next_action_approved",
  "next_action_dismissed",
  "promise_unowned",
  "reactivation_accepted",
  "reactivation_dismissed",
  "reactivation_expired",
]);

/** O que é CONVERSA (além das mensagens, que vêm de outra fonte). */
const DE_CONVERSA = new Set([
  "conversation_claimed",
  "conversation_transferred",
  "conversation_released",
  "conversation_ai_paused",
  "handoff_triggered",
  "handoff_resolved",
  "voice_call",
  "voice_call_missed",
  "voice_call_unanswered",
  "group_notice_sent",
  "group_notice_failed",
]);

export function ehRotinaDaIa(item: Pick<TimelineItemView, "type" | "actor_kind">): boolean {
  if (ROTINA_DA_IA.has(item.type)) return true;
  // Edição feita pela IA (campos que ela preencheu) também é relato de rotina.
  return item.type === "lead_edited" && item.actor_kind === "ai";
}

export function ehFixada(item: Pick<TimelineItemView, "type" | "payload">): boolean {
  return item.type === "note" && item.payload?.fixada === true;
}

export function passaNoFiltro(item: Pick<TimelineItemView, "type" | "actor_kind">, filtro: FiltroDoHistorico): boolean {
  if (filtro === "tudo") return true;
  if (filtro === "tarefas") return DE_TAREFA.has(item.type);
  if (filtro === "conversas") return DE_CONVERSA.has(item.type);
  return true; // "importante": a rotina não sai — é agrupada (ver `montarHistorico`).
}

export type EntradaDoHistorico =
  | { tipo: "item"; item: TimelineItemView; fixada: boolean }
  | {
      tipo: "ia-do-dia";
      /** `YYYY-MM-DD`. */
      dia: string;
      itens: TimelineItemView[];
      naoEnviou: number;
    };

function diaDe(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Monta a lista do filtro. Itens já vêm do mais novo para o mais velho (é a
 * ordem da rota da timeline); a ordem é preservada, com as fixadas no topo em
 * "Importante".
 */
export function montarHistorico(itens: TimelineItemView[], filtro: FiltroDoHistorico): EntradaDoHistorico[] {
  const ordenados = [...itens].sort(
    (a, b) => new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime(),
  );
  if (filtro !== "importante") {
    return ordenados.filter((i) => passaNoFiltro(i, filtro)).map((item) => ({ tipo: "item", item, fixada: ehFixada(item) }));
  }
  const fixadas: EntradaDoHistorico[] = [];
  const resto: EntradaDoHistorico[] = [];
  const grupos = new Map<string, Extract<EntradaDoHistorico, { tipo: "ia-do-dia" }>>();
  for (const item of ordenados) {
    if (ehFixada(item)) {
      fixadas.push({ tipo: "item", item, fixada: true });
      continue;
    }
    if (ehRotinaDaIa(item)) {
      const dia = diaDe(item.performed_at);
      let g = grupos.get(dia);
      if (!g) {
        g = { tipo: "ia-do-dia", dia, itens: [], naoEnviou: 0 };
        grupos.set(dia, g);
        resto.push(g);
      }
      g.itens.push(item);
      if (item.type === "send_vetoed") g.naoEnviou += 1;
      continue;
    }
    resto.push({ tipo: "item", item, fixada: false });
  }
  return [...fixadas, ...resto];
}

export function contagemDoFiltro(itens: TimelineItemView[], filtro: FiltroDoHistorico): number {
  if (filtro === "importante") return itens.filter((i) => !ehRotinaDaIa(i)).length;
  return itens.filter((i) => passaNoFiltro(i, filtro)).length;
}
