/**
 * FORK MIA (.91) — O FOLLOW-UP PROPOSTO SAI JUNTO COM O AGENTE PUBLICADO.
 *
 * A proposta de follow-up nasce em rascunho e fica armada no rascunho do agente
 * (`aplicar.ts`). Quando uma pessoa PUBLICA o agente (pela tela, pelo passo a
 * passo ou pelo MCP; todos passam por `publishAgentVersion`), os fluxos
 * propostos que a versão publicada carrega são publicados também: um clique
 * humano, as duas peças no ar. É a regra do protótipo: "nasce em rascunho e sai
 * junto com o agente publicado".
 *
 * Só sai o fluxo de uma proposta APLICADA para ESTE agente e que ainda não
 * saiu, e só se a versão publicada o tem armado. Nunca lança: o agente já está
 * no ar, e um follow-up que não publicou continua no "o que falta" como
 * "publicar o follow-up", em vez de derrubar a publicação de quem clicou.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { publicarFollowup } from "@/lib/implantacao/followup";
import { logger } from "@/lib/logger";

export async function publicarFollowupsQueSaemComOAgente(
  admin: SupabaseClient,
  entrada: { orgId: string; agentId: string; versionId: string; actorUserId?: string | null; requestId?: string | null },
): Promise<{ publicados: string[] }> {
  const publicados: string[] = [];
  try {
    const { data: propostas, error } = await admin
      .from("mia_assistente_propostas")
      .select("id, resultado")
      .eq("organization_id", entrada.orgId)
      .eq("tipo", "followup")
      .eq("situacao", "aplicada")
      .is("saiu_com_o_agente_em", null)
      .limit(20);
    if (error || !propostas || propostas.length === 0) return { publicados };
    const doAgente = (propostas as Array<{ id: string; resultado: { fluxo_id?: string; agente_id?: string } | null }>).filter(
      (p) => p.resultado?.agente_id === entrada.agentId && typeof p.resultado?.fluxo_id === "string",
    );
    if (doAgente.length === 0) return { publicados };

    const { data: versao } = await admin
      .from("ai_agent_versions")
      .select("followup")
      .eq("organization_id", entrada.orgId)
      .eq("id", entrada.versionId)
      .maybeSingle();
    const armados = new Set(
      ((versao as { followup?: { enabled?: boolean; flow_pointer_ids?: string[] } | null } | null)?.followup?.flow_pointer_ids ?? []),
    );
    const autor = entrada.actorUserId ?? null;

    for (const p of doAgente) {
      const fluxoId = p.resultado!.fluxo_id!;
      if (!armados.has(fluxoId)) continue;
      try {
        if (autor) {
          await publicarFollowup(
            { admin, orgId: entrada.orgId, autorUserId: autor, requestId: entrada.requestId ?? "" },
            { fluxo: fluxoId, ativo: true },
          );
        } else {
          // Sem ator não se publica fluxo (a versão do fluxo pede quem publicou):
          // ele fica no "o que falta" como "publicar o follow-up".
          continue;
        }
        await admin
          .from("mia_assistente_propostas")
          .update({ saiu_com_o_agente_em: new Date().toISOString() })
          .eq("organization_id", entrada.orgId)
          .eq("id", p.id)
          .eq("situacao", "aplicada");
        publicados.push(fluxoId);
        void audit({
          action: "assistente.followup_saiu_com_o_agente",
          actorUserId: autor,
          organizationId: entrada.orgId,
          resourceType: "followup_flow_pointer",
          resourceId: fluxoId,
          requestId: entrada.requestId ?? undefined,
          metadata: { agente_id: entrada.agentId, proposta_id: p.id },
        });
      } catch (err) {
        logger.warn("[assistente] o follow-up proposto não saiu com o agente", {
          organization_id: entrada.orgId,
          fluxo_id: fluxoId,
          erro: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.warn("[assistente] não deu para conferir os follow-ups que saem com o agente", {
      organization_id: entrada.orgId,
      erro: err instanceof Error ? err.message : String(err),
    });
  }
  return { publicados };
}
