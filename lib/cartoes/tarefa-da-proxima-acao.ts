/**
 * FORK MIA — APROVAR A PRÓXIMA AÇÃO DA IA CRIA UMA TAREFA DE VERDADE.
 *
 * Até aqui "Aprovar" (no cartão e no cartão aberto) só registrava a decisão na
 * linha do tempo (`next_action_approved`) e tirava a proposta de cena: a ação
 * aprovada não ia para lugar nenhum onde alguém a cumprisse. Agora ela vira
 * `crm_tasks` — com prazo, responsável, ligada ao negócio e ao contato —, e é
 * essa tarefa que aparece no Foco do cartão aberto, na lista de Tarefas e no
 * "1 tarefa atrasada" do cartão fechado quando o prazo passa (o anti-morte).
 *
 * ─── As duas regras que a tela anuncia ANTES do clique ─────────────────────
 *
 *  - PRAZO: hoje às 18h (no fuso da empresa) se ainda são menos de 17h; senão,
 *    amanhã às 10h. Uma hora de folga é o mínimo para a tarefa não nascer
 *    vencida; amanhã cedo é o próximo momento em que alguém a vê.
 *  - RESPONSÁVEL: o dono HUMANO do negócio; negócio sem dono humano (dono é o
 *    agente, ou ninguém), quem aprovou. Tarefa sem responsável não lembra
 *    ninguém — `criarTarefaInterna` recusa pelo mesmo motivo.
 *
 * Plugada na rota do upstream (`POST /api/v1/leads/[id]/next-action`) por uma
 * chamada, depois de a decisão ser registrada. A falha aqui NÃO desfaz a
 * aprovação (já gravada e auditada): a rota devolve `tarefa: null` e a tela
 * avisa que a tarefa não foi criada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { fusoUtilizavel } from "@/lib/tempo/fusos";
import { registraAtividadeDaTarefa } from "@/lib/tarefas/atividade";
import type { TaskSourceKind } from "@/lib/tarefas/vocabulario-de-origem";

import { prazoDaProximaAcao, responsavelDaProximaAcao } from "./regras-da-proxima-acao";

// As duas regras moram num módulo sem nada de servidor, porque o cartão aberto
// as usa no navegador para anunciar prazo e responsável antes do clique.
export { prazoDaProximaAcao, responsavelDaProximaAcao };

/** De onde a tarefa nasceu (`crm_tasks.source_kind`, vocabulário aberto). */
export const ORIGEM_PROXIMA_ACAO_APROVADA: TaskSourceKind = "next_action_approved";

export interface TarefaCriada {
  id: string;
  title: string;
  due_date: string;
  assigned_to: string;
}

export async function criarTarefaDaProximaAcao(
  db: SupabaseClient,
  args: {
    organizationId: string;
    leadId: string;
    contactId: string | null;
    texto: string;
    quemAprovou: string;
    requestId: string;
    agora?: Date;
  },
): Promise<TarefaCriada | null> {
  const [{ data: lead }, { data: org }] = await Promise.all([
    db
      .from("crm_leads")
      .select("owner_kind, owner_user_id")
      .eq("organization_id", args.organizationId)
      .eq("id", args.leadId)
      .maybeSingle(),
    db.from("organizations").select("timezone").eq("id", args.organizationId).maybeSingle(),
  ]);
  const fuso = fusoUtilizavel((org as { timezone?: string | null } | null)?.timezone);
  const prazo = prazoDaProximaAcao(args.agora ?? new Date(), fuso);
  const responsavel = responsavelDaProximaAcao(
    (lead as { owner_kind: string | null; owner_user_id: string | null } | null) ?? {
      owner_kind: null,
      owner_user_id: null,
    },
    args.quemAprovou,
  );
  const titulo = args.texto.trim().slice(0, 255);

  const { data, error } = await db
    .from("crm_tasks")
    .insert({
      organization_id: args.organizationId,
      title: titulo,
      description: null,
      due_date: prazo.toISOString(),
      priority: "medium",
      status: "pending",
      lead_id: args.leadId,
      contact_id: args.contactId,
      assigned_to: responsavel,
      created_by: args.quemAprovou,
      source_kind: ORIGEM_PROXIMA_ACAO_APROVADA,
    })
    .select("id, title, due_date, priority, lead_id, contact_id, assigned_to")
    .single();
  if (error || !data) return null;

  const tarefa = data as {
    id: string;
    title: string;
    due_date: string;
    priority: "low" | "medium" | "high" | "urgent";
    lead_id: string;
    contact_id: string | null;
    assigned_to: string;
  };

  await audit({
    organizationId: args.organizationId,
    actorUserId: args.quemAprovou,
    action: "crm_task.created",
    resourceType: "crm_tasks",
    resourceId: tarefa.id,
    requestId: args.requestId,
    metadata: {
      origem: ORIGEM_PROXIMA_ACAO_APROVADA,
      lead_id: args.leadId,
      assigned_to: responsavel,
      due_date: tarefa.due_date,
    },
  });

  // A tarefa entra na linha do tempo do negócio como a criada pela tela.
  await registraAtividadeDaTarefa(db, {
    organizationId: args.organizationId,
    tarefa,
    tipo: "task_created",
    actor: { type: "user", id: args.quemAprovou },
  });

  return { id: tarefa.id, title: tarefa.title, due_date: tarefa.due_date, assigned_to: responsavel };
}
