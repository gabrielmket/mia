/**
 * FORK MIA — a FICHA no aviso do grupo, e o aviso no HISTÓRICO do negócio.
 *
 * ─── Por que existe ──────────────────────────────────────────────────────────
 *
 * O dono quer que o resumo da qualificação (a ficha que o agente salva com
 * `save_lead_note`) chegue ao grupo do time do cliente E fique registrado no
 * histórico do negócio. A ação `notify_group` só enxergava o que o motor
 * hidrata (`lead`, `contact`, `event`), então a ficha não tinha como entrar no
 * texto; e o envio não deixava rastro nenhum no negócio — a única evidência era
 * uma linha na aba Atividade da regra, que quem cuida do cliente não abre.
 *
 * ─── Por que a ficha entra SÓ no aviso ao time ───────────────────────────────
 *
 * Ela não vai para o contexto geral do motor (`buildContext`): lá ela ficaria
 * ao alcance do template da mensagem ao CLIENTE (`send_whatsapp`), e anotação
 * interna chegando a quem ela descreve é o pior desfecho possível. Aqui ela só
 * é lida por quem manda recado ao time.
 *
 * ─── O registro, nas duas pontas ─────────────────────────────────────────────
 *
 * Mandou → `group_notice_sent`. Não mandou → `group_notice_failed`, com o
 * porquê. Sistema vivo: falha que só existe no log é falha que ninguém vê. A
 * linha vai para a timeline do negócio (`components/kanban/LeadTimeline.tsx`),
 * com ator `rule` ("Automação"). NÃO vira conversa no inbox.
 *
 * O `reason` não leva dado pessoal (a coluna é exibida e exportada no LGPD, e a
 * regra dela é essa): diz o GRUPO, a REGRA e o desfecho. O texto mandado vai no
 * `payload`, que a anonimização da LGPD limpa (0071), e a timeline o mostra
 * logo abaixo da linha.
 *
 * Nunca lança: o aviso já saiu (ou já falhou) quando isto roda, e perder o
 * registro não pode mudar o desfecho da ação. Falha de escrita vira
 * `crm.activity_write_failed` — contada, nunca silêncio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildLeadActivityRow } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";
import { resolveActiveLeadForContact, type LeadCandidate } from "@/lib/leads/active-lead";
import { logger } from "@/lib/logger";

/** A ficha como o template a enxerga: `{{nota.headline}}`, `{{nota.body}}`. */
export interface FichaDoContato {
  headline: string;
  body: string;
  criada_em: string;
}

/**
 * A ficha MAIS RECENTE do contato (`lead_notes`, o que `save_lead_note` grava).
 *
 * `null` quando não há — e é o chamador quem decide o que isso significa. O
 * erro de leitura também vira `null`, mas com log: o aviso ao time é mais
 * importante que a ficha dentro dele.
 */
export async function fichaMaisRecente(
  admin: SupabaseClient,
  organizationId: string,
  contactId: string | null | undefined,
): Promise<FichaDoContato | null> {
  if (!contactId) return null;
  try {
    const { data, error } = await admin
      .from("lead_notes")
      .select("headline, body, created_at")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      logger.warn("[aviso-ao-time] não consegui ler a ficha do contato", {
        organization_id: organizationId,
        error: error.message,
      });
      return null;
    }
    if (!data) return null;
    const linha = data as { headline: string; body: string; created_at: string };
    return { headline: linha.headline, body: linha.body, criada_em: linha.created_at };
  } catch (err) {
    logger.warn("[aviso-ao-time] leitura da ficha lançou", {
      organization_id: organizationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Em qual NEGÓCIO o aviso fica registrado.
 *
 * O do evento, quando há (lead.stage_changed, lead.tag_added). Num gatilho de
 * contato, o negócio aberto dele pelo MESMO roteador que o resto do sistema usa
 * — e com mais de um aberto, nenhum: registrar no negócio errado é pior que não
 * registrar, e o "sem negócio" vai para o detalhe da ação, visível na regra.
 */
export async function negocioDoAviso(
  admin: SupabaseClient,
  organizationId: string,
  contexto: Record<string, unknown>,
): Promise<{ leadId: string; contactId: string | null } | { leadId: null; motivo: string }> {
  const lead = contexto.lead as { id?: string; contact_id?: string | null } | undefined;
  if (lead?.id) return { leadId: lead.id, contactId: lead.contact_id ?? null };
  const contato = contexto.contact as { id?: string } | undefined;
  if (!contato?.id) return { leadId: null, motivo: "sem_contato" };
  const { data, error } = await admin
    .from("crm_leads")
    .select("id, organization_id, pipeline_id, status, last_activity_at, created_at")
    .eq("organization_id", organizationId)
    .eq("contact_id", contato.id);
  if (error) return { leadId: null, motivo: "leitura_falhou" };
  const alvo = resolveActiveLeadForContact((data ?? []) as LeadCandidate[]);
  if (!alvo.routed) return { leadId: null, motivo: alvo.reason };
  return { leadId: alvo.leadId, contactId: contato.id };
}

/** Os motivos de não-envio em português — o que aparece no histórico. */
const MOTIVO_EM_PORTUGUES: Record<string, string> = {
  sem_numero_de_avisos: "nenhum número de avisos está marcado na plataforma",
  numero_nao_entrega_em_grupo: "o número de avisos não entrega em grupo",
  sem_grupo_no_cliente: "esta empresa ainda não tem grupo escolhido no painel",
  destino_nao_e_grupo: "o destino configurado não é um grupo",
  canal_nao_encontrado: "o número configurado na regra não existe mais",
  canal_sem_grupo: "o número configurado na regra não entrega em grupo",
  missing_config: "a regra está sem o texto do aviso",
};

export function motivoDoAvisoEmPortugues(erro: string): string {
  return MOTIVO_EM_PORTUGUES[erro] ?? "o WhatsApp recusou o envio";
}

export interface AvisoParaRegistrar {
  organizationId: string;
  leadId: string;
  contactId: string | null;
  ruleId: string;
  ruleName: string;
  /** Como o grupo se chama (ou o id, quando não se sabe o nome). `null` = não chegou a haver destino. */
  grupo: string | null;
  /** O texto que saiu (ou teria saído). */
  texto: string | null;
  ok: boolean;
  /** O código do erro, quando não saiu. */
  erro?: string;
  externalId?: string | null;
  ficha: "usada" | "ausente" | "nao_pedida";
}

/** Grava a linha na timeline do negócio. `true` = gravou. */
export async function registrarAvisoNoHistorico(
  admin: SupabaseClient,
  a: AvisoParaRegistrar,
): Promise<boolean> {
  const grupo = a.grupo ? `«${a.grupo}»` : null;
  const reason = a.ok
    ? `Aviso enviado ao grupo ${grupo ?? "do time"} pela regra «${a.ruleName}».`
    : `O aviso da regra «${a.ruleName}» não saiu: ${motivoDoAvisoEmPortugues(a.erro ?? "")}.`;
  const linha = buildLeadActivityRow({
    organizationId: a.organizationId,
    leadId: a.leadId,
    contactId: a.contactId,
    type: a.ok ? "group_notice_sent" : "group_notice_failed",
    sourceModule: "automation",
    sourceId: a.ruleId,
    actor: { type: "webhook_source", id: a.ruleId },
    reason,
    payload: {
      grupo: a.grupo,
      texto: a.texto,
      ficha: a.ficha,
      ...(a.ok ? { external_id: a.externalId ?? null } : { erro: a.erro ?? null }),
    },
  });
  try {
    // Quem agiu foi a REGRA — `actor_kind = 'rule'` ("Automação" na timeline),
    // e não o `system` genérico que o tradutor de ator devolve para quem não é
    // pessoa nem agente.
    const { error } = await admin.from("crm_lead_activities").insert({ ...linha, actor_kind: "rule" });
    if (!error) return true;
    await registraFalhaDeAtividade(admin, {
      organizationId: a.organizationId,
      leadId: a.leadId,
      tipo: linha.type,
      origem: "lib/avisos/registro-do-aviso",
      erro: error.message,
    });
    return false;
  } catch (err) {
    logger.error("[aviso-ao-time] registro no histórico lançou", {
      organization_id: a.organizationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
