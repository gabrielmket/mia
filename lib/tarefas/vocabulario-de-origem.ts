/**
 * De onde uma `crm_tasks` nasceu — vocabulário ABERTO (sem CHECK no banco,
 * CLAUDE.md doutrina de Migrations). `null`/ausente = criada à mão.
 */
export type TaskSourceKind =
  | "promised_proposal"
  | "promised_followup"
  // FORK MIA — aprovar a próxima ação da IA cria a tarefa (lib/cartoes/tarefa-da-proxima-acao.ts).
  | "next_action_approved";

export const TASK_SOURCE_LABELS: Record<TaskSourceKind, string> = {
  promised_proposal: "Promessa de proposta detectada pelo assistente",
  promised_followup: "Compromisso detectado pelo assistente",
  next_action_approved: "Próxima ação da IA aprovada",
};
