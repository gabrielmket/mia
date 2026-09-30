/**
 * FORK MIA — A ORDEM DOS CARTÕES NA COLUNA: o mais urgente em cima.
 *
 * O semáforo do Pipedrive, com o que só um CRM de WhatsApp sabe (a bola):
 *
 *   0 · o lead falou por último e ninguém respondeu — do que espera há mais
 *       tempo para o que espera há menos;
 *   1 · tarefa atrasada;
 *   2 · compromisso hoje;
 *   3 · proposta da IA esperando aprovação;
 *   4 · esfriando (o Radar disse que passou do prazo da etapa);
 *   5 · sem próximo passo (nenhum compromisso nem tarefa marcados);
 *   6 · próximo passo no futuro — está andando;
 *   9 · encerrado (ganho/perdido), sempre no fim.
 *
 * Dentro do mesmo degrau, o mais quente primeiro.
 *
 * ⚠️ A ordem é da TELA: a posição salva (`position_in_stage`) não muda. Quem
 * quiser a ordem arrastada à mão escolhe "Manual" no filtro de ordem — e só
 * nela o arrasto DENTRO da coluna reordena (ver `KanbanBoard`).
 */
import type { Lead } from "@/lib/types/leads";

export const ORDENS_DO_QUADRO = ["urgencia", "quentes", "valor", "manual"] as const;
export type OrdemDoQuadro = (typeof ORDENS_DO_QUADRO)[number];

export const ROTULO_DA_ORDEM = {
  urgencia: "Urgência",
  quentes: "Quentes primeiro",
  valor: "Maior valor",
  manual: "Manual (arrastar)",
} as const satisfies Record<OrdemDoQuadro, string>;

export const ORDEM_PADRAO: OrdemDoQuadro = "urgencia";

type LeadDoQuadro = Pick<
  Lead,
  "status" | "value_cents" | "score" | "next_action" | "cartao" | "position_in_stage"
>;

export function grauDeUrgencia(
  lead: LeadDoQuadro,
  contexto: { esfriando: boolean; agora: Date },
): number {
  if (lead.status !== "open") return 9;
  const c = lead.cartao;
  if (c?.bola?.com === "nos") return 0;
  if ((c?.tarefasAtrasadas ?? 0) > 0) return 1;
  if (c?.compromisso && ehHoje(c.compromisso.inicio, contexto.agora)) return 2;
  if (lead.next_action?.label) return 3;
  if (contexto.esfriando) return 4;
  if (!c?.compromisso && !c?.temTarefaFutura) return 5;
  return 6;
}

function ehHoje(iso: string, agora: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === agora.getFullYear() &&
    d.getMonth() === agora.getMonth() &&
    d.getDate() === agora.getDate()
  );
}

function probabilidade(lead: LeadDoQuadro): number {
  return typeof lead.score?.probability === "number" ? lead.score.probability : -1;
}

/**
 * Ordena uma coluna. Estável: empate total mantém a posição salva, para a
 * coluna não "pular" a cada atualização do quadro.
 */
export function ordenarColuna<T extends LeadDoQuadro & { id: string }>(
  leads: T[],
  ordem: OrdemDoQuadro,
  contexto: { esfriando: Set<string>; agora: Date },
): T[] {
  const porPosicao = (a: T, b: T) => a.position_in_stage - b.position_in_stage;
  if (ordem === "manual") return [...leads].sort(porPosicao);
  if (ordem === "valor") {
    return [...leads].sort((a, b) => (b.value_cents ?? -1) - (a.value_cents ?? -1) || porPosicao(a, b));
  }
  if (ordem === "quentes") {
    return [...leads].sort((a, b) => probabilidade(b) - probabilidade(a) || porPosicao(a, b));
  }
  const grau = new Map(
    leads.map((l) => [l.id, grauDeUrgencia(l, { esfriando: contexto.esfriando.has(l.id), agora: contexto.agora })]),
  );
  return [...leads].sort((a, b) => {
    const ga = grau.get(a.id)!;
    const gb = grau.get(b.id)!;
    if (ga !== gb) return ga - gb;
    if (ga === 0) {
      // Quem espera há mais tempo primeiro: a bola mais antiga.
      const da = new Date(a.cartao!.bola!.desde).getTime();
      const db = new Date(b.cartao!.bola!.desde).getTime();
      if (da !== db) return da - db;
    }
    return probabilidade(b) - probabilidade(a) || porPosicao(a, b);
  });
}
