/**
 * FORK MIA (.85) — o horário de atendimento da IA dos agentes PUBLICADOS, para
 * os selos da equipe.
 *
 *   GET                  → `{ agentes: [{ id, horario }] }`: os agentes no ar
 *                          (publicados, não pausados, não arquivados) que têm
 *                          horário. A lista de agentes mostra o selo deles.
 *   GET ?conversa=<id>   → `{ agente, horario }`: o agente que responde ESTA
 *                          conversa, pela régua do motor
 *                          (`loadConversationAgentConfig`: a conversa grudada
 *                          num agente; senão o publicado no número dela, no ar
 *                          antes de pausado, maior prioridade, mais antigo).
 *
 * Devolve o dado GRAVADO na forma canônica (`horarioGravadoDe`); o estado de
 * agora é calculado na tela, no relógio de quem lê. Só leitura, e de
 * configuração (nenhum dado de contato sai daqui): basta o papel `agent`, o
 * mesmo de quem atende no Inbox.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { horarioGravadoDe, type HorarioDaIaGravado } from "@/lib/agent-engine/agent/horario-da-ia";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AgentePublicado {
  id: string;
  name: string;
  priority: number | null;
  created_at: string;
  paused_at: string | null;
  published_version_id: string;
}

interface VersaoPublicada {
  id: string;
  channel_session_id: string | null;
  trigger_config: unknown;
}

/** A ordem de `loadPublishedAgentConfig`: no ar antes de pausado, maior prioridade, mais antigo. */
function ordemDoMotor(a: AgentePublicado, b: AgentePublicado): number {
  const pausadoA = a.paused_at !== null ? 1 : 0;
  const pausadoB = b.paused_at !== null ? 1 : 0;
  if (pausadoA !== pausadoB) return pausadoA - pausadoB;
  const prioridade = (b.priority ?? 0) - (a.priority ?? 0);
  if (prioridade !== 0) return prioridade;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const admin = createAdminClient();

  const { data: agentesBrutos, error: erroAgentes } = await admin
    .from("ai_agents")
    .select("id, name, priority, created_at, paused_at, published_version_id")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .not("published_version_id", "is", null);
  if (erroAgentes) return fail("internal_error", t("Não consegui ler os agentes."), 500, { requestId });
  const agentes = (agentesBrutos ?? []) as AgentePublicado[];

  const idsDasVersoes = agentes.map((a) => a.published_version_id);
  let versoes: VersaoPublicada[] = [];
  if (idsDasVersoes.length > 0) {
    const { data, error } = await admin
      .from("ai_agent_versions")
      .select("id, channel_session_id, trigger_config")
      .eq("organization_id", orgId)
      .eq("status", "published")
      .in("id", idsDasVersoes);
    if (error) return fail("internal_error", t("Não consegui ler os agentes."), 500, { requestId });
    versoes = (data ?? []) as VersaoPublicada[];
  }
  const versaoDe = (a: AgentePublicado) => versoes.find((v) => v.id === a.published_version_id) ?? null;
  const horarioDe = (a: AgentePublicado): HorarioDaIaGravado | null => {
    const v = versaoDe(a);
    return v ? horarioGravadoDe(v.trigger_config) : null;
  };

  const conversa = req.nextUrl.searchParams.get("conversa");
  if (conversa === null) {
    const comHorario = agentes
      .filter((a) => a.paused_at === null)
      .map((a) => ({ id: a.id, horario: horarioDe(a) }))
      .filter((x): x is { id: string; horario: HorarioDaIaGravado } => x.horario !== null);
    return ok({ agentes: comHorario }, { requestId });
  }

  if (!UUID.test(conversa)) return fail("invalid_request", t("Conversa inválida."), 400, { requestId });
  const { data: linhaDaConversa, error: erroConversa } = await admin
    .from("conversations")
    .select("channel_session_id, active_ai_agent_id")
    .eq("organization_id", orgId)
    .eq("id", conversa)
    .maybeSingle();
  if (erroConversa) return fail("internal_error", t("Não consegui ler a conversa."), 500, { requestId });
  if (!linhaDaConversa) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  const { channel_session_id: numero, active_ai_agent_id: grudado } = linhaDaConversa as {
    channel_session_id: string | null;
    active_ai_agent_id: string | null;
  };

  const doNumero = agentes.filter((a) => numero !== null && versaoDe(a)?.channel_session_id === numero).sort(ordemDoMotor);
  const quemResponde = (grudado ? agentes.find((a) => a.id === grudado) : undefined) ?? doNumero[0] ?? null;
  // Pausado não responde: sem selo, o resto da tela já diz que o agente parou.
  if (!quemResponde || quemResponde.paused_at !== null) return ok({ agente: null, horario: null }, { requestId });
  return ok(
    { agente: { id: quemResponde.id, nome: quemResponde.name }, horario: horarioDe(quemResponde) },
    { requestId },
  );
}
