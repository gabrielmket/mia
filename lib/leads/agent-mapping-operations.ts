/**
 * FORK MIA — a GRAVAÇÃO do mapeamento passo-do-agente → etapa, fora do Route Handler.
 *
 * As regras puras já viviam em `lib/leads/agent-mapping.ts` (`validarMapeamento`
 * e `diffParaUpdates`). O que estava preso em
 * `app/api/v1/pipelines/[id]/agent-mapping/route.ts` era a SEQUÊNCIA que as usa:
 * validar antes de tocar no banco, gravar os updates na ordem do diff (o índice
 * único do passo é imediato) e traduzir as duas recusas do banco. O MCP de
 * plataforma monta o funil de um cliente com o passo de cada etapa, e uma cópia
 * dessa sequência divergiria da tela no primeiro ajuste.
 *
 * A rota continua lendo o funil (antes e depois) e fazendo o transporte. A
 * recusa viaja como `ApiError`, com as mesmas frases de antes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import type { Actor } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import {
  diffParaUpdates,
  validarMapeamento,
  type EntradaDeMapeamento,
  type EtapaDoMapa,
  type UpdateDeEtapa,
} from "@/lib/leads/agent-mapping";

export interface DepsDoMapeamento {
  supabase: SupabaseClient;
  organizationId: string;
  /** Quem está agindo. NUNCA sai do input: é resolvido de fonte confiável pelo chamador. */
  actor: Actor;
  requestId: string;
}

/**
 * Valida e grava o mapa. `etapas` são as etapas VIVAS do funil, já lidas por
 * quem chama com o filtro de organização. Devolve os updates que saíram
 * (vazio = o mapa pedido já era o que estava gravado).
 */
export async function gravarMapeamentoDoAgente(
  deps: DepsDoMapeamento,
  input: { pipelineId: string; etapas: EtapaDoMapa[]; mapeamento: EntradaDeMapeamento },
): Promise<UpdateDeEtapa[]> {
  const { pipelineId, etapas, mapeamento } = input;

  // ⚠️ VALIDAR ANTES DE TOCAR O BANCO. O CHECK da 0084 é a rede de segurança, não
  // a primeira linha: um `23514` cru chega ao dono da clínica como "violates
  // check constraint crm_stages_hint_coerente_com_won_lost". As mensagens daqui
  // são texto de tela — vão inteiras para o corpo, sem reescrita.
  const veredito = validarMapeamento(mapeamento, etapas);
  if (!veredito.ok) {
    throw new ApiError(
      422,
      "unprocessable_entity",
      { erros: veredito.erros },
      deps.requestId,
      veredito.erros[0]!,
    );
  }

  const updates = diffParaUpdates(etapas, mapeamento);

  // ⚠️ EM SEQUÊNCIA, NA ORDEM DO DIFF. O índice único `uniq_crm_stages_pipeline_hint`
  // é imediato: as liberações precisam estar gravadas antes das ocupações, senão
  // o banco recusa. Disparar em paralelo desfaz essa proteção.
  //
  // Ceiling conhecido: não há transação — se um update falhar no meio, os
  // anteriores ficam. É recuperável porque a gravação é total e idempotente
  // (reenviar o mesmo mapa converge) e a resposta de erro não mente sobre o
  // estado; a saída definitiva seria uma função SQL, que só vale a pena se isto
  // deixar de ser uma tela de configuração ocasional.
  for (const u of updates) {
    const { error } = await deps.supabase
      .from("crm_stages")
      .update({ agent_stage_hint: u.hint })
      .eq("id", u.stageId)
      .eq("organization_id", deps.organizationId)
      .eq("pipeline_id", pipelineId);
    if (!error) continue;

    // As duas recusas do banco significam a mesma coisa para o usuário: o funil
    // mudou entre a leitura e a gravação. Nenhuma das duas pode chegar à tela
    // como texto do Postgres — `violates check constraint
    // crm_stages_hint_coerente_com_won_lost` é exatamente a mensagem que a
    // camada pura existe para evitar, e devolvê-la no 500 a traria de volta.
    const nome = etapas.find((e) => e.id === u.stageId)?.name ?? "escolhida";
    const conflito: Record<string, string> = {
      "23505": `A etapa «${nome}» já está representando esse passo do atendimento.`,
      "23514": `A etapa «${nome}» mudou de papel neste funil (ganho ou perda) enquanto você editava.`,
    };
    const motivo = conflito[(error as { code?: string }).code ?? ""];
    if (motivo) {
      throw new ApiError(
        409,
        "state_conflict",
        undefined,
        deps.requestId,
        `${motivo} Recarregue a página e tente de novo.`,
      );
    }
    throw new ApiError(500, "internal_error", undefined, deps.requestId, error.message);
  }

  if (updates.length > 0) {
    void audit({
      action: "pipeline.agent_mapping_updated",
      actorUserId: deps.actor.type === "user" ? deps.actor.id : null,
      organizationId: deps.organizationId,
      resourceType: "crm_pipeline",
      resourceId: pipelineId,
      requestId: deps.requestId,
      metadata: { mapeamento, updates },
    });
  }

  return updates;
}
