/**
 * FORK MIA (.85) — o horário da IA do agente que armou a régua, lido pelo
 * atalho do texto fixo (`enviarTextoFixoPendente`, que fala Supabase).
 *
 * É o espelho em Supabase de `horarioDaIaDoEnrollment`
 * (`lib/agent-engine/agent/horario-da-ia-no-motor.ts`, que fala `pg`), com as
 * mesmas três leituras de `followupPublicado` em `janela-de-disparo.ts`: a
 * inscrição dá o agente, o agente dá a versão PUBLICADA, a versão dá o horário.
 *
 * Sem agente ou sem versão publicada (dado legado) = `null`, sem horário. Erro
 * de banco SOBE: o job volta para `pending`, como a leitura da faixa do
 * follow-up ao lado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { lerHorarioDaIa, type HorarioDaIa } from "@/lib/agent-engine/agent/horario-da-ia";

export async function horarioDaIaDaReguaViaSupabase(
  admin: SupabaseClient,
  organizationId: string,
  enrollmentId: string,
): Promise<HorarioDaIa | null> {
  const { data: inscricao, error: falhaInscricao } = await admin
    .from("followup_enrollments")
    .select("agent_id")
    .eq("organization_id", organizationId)
    .eq("id", enrollmentId)
    .maybeSingle();
  if (falhaInscricao) throw new Error(falhaInscricao.message);
  const agentId = (inscricao as { agent_id?: string | null } | null)?.agent_id;
  if (typeof agentId !== "string" || agentId === "") return null;

  const { data: agente, error: falhaAgente } = await admin
    .from("ai_agents")
    .select("published_version_id")
    .eq("organization_id", organizationId)
    .eq("id", agentId)
    .maybeSingle();
  if (falhaAgente) throw new Error(falhaAgente.message);
  const versionId = (agente as { published_version_id?: string | null } | null)?.published_version_id;
  if (typeof versionId !== "string" || versionId === "") return null;

  const { data: versao, error: falhaVersao } = await admin
    .from("ai_agent_versions")
    .select("trigger_config")
    .eq("organization_id", organizationId)
    .eq("id", versionId)
    .maybeSingle();
  if (falhaVersao) throw new Error(falhaVersao.message);
  return lerHorarioDaIa((versao as { trigger_config?: unknown } | null)?.trigger_config ?? null);
}
