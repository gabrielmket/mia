import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * FORK MIA — POST /api/v1/leads/[id]/campos-confirmados — "Confirmar" o campo
 * que a IA preencheu a partir da conversa.
 *
 * O campo do negócio preenchido pela IA aparece no cartão aberto com a marca
 * "veio da conversa" até alguém confirmar. Quem preencheu cada campo sai da
 * linha do tempo: a edição do negócio (`lead_edited`) passou a dizer QUAIS
 * campos personalizados mudaram (`payload.custom_field_keys`, no
 * `updateLeadHandler`), com o ator. Confirmar é uma edição humana SEM mudança
 * de valor — por isso não passa pelo PATCH (que só registra o que mudou): grava
 * a mesma linha `lead_edited`, pelo usuário, com a chave e `confirmado: true`.
 * A marca some porque a última palavra sobre aquele campo passa a ser humana.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const Corpo = z.object({ chave: z.string().trim().min(1).max(120) });

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;

  const parsed = Corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Diga qual campo confirmar."), 422, { requestId });
  }

  const supabase = await createClient();
  const { data: lead, error } = await supabase
    .from("crm_leads")
    .select("id, contact_id, custom_fields")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!lead) return fail("not_found", t("Negócio não encontrado."), 404, { requestId });

  const campos = ((lead as { custom_fields: Record<string, unknown> | null }).custom_fields ?? {}) as Record<string, unknown>;
  if (!(parsed.data.chave in campos)) {
    return fail("validation_failed", t("Este campo não tem valor para confirmar."), 422, { requestId });
  }

  const atividade = await emitLeadActivity(supabase, {
    organizationId: authz.org.orgId,
    leadId: id,
    contactId: (lead as { contact_id: string | null }).contact_id,
    type: "lead_edited",
    sourceModule: "crm",
    sourceId: id,
    actor: { type: "user", id: authz.user.id },
    // Nomeia o GESTO, nunca o valor (doutrina do reason no _handler do upstream).
    reason: "Confirmou um campo que veio da conversa",
    payload: { fields: ["custom_fields"], custom_field_keys: [parsed.data.chave], confirmado: true },
  });
  if (!atividade.ok) {
    return fail("internal_error", atividade.error ?? "activity insert failed", 500, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "lead.campo_confirmado",
    resourceType: "crm_leads",
    resourceId: id,
    requestId,
    metadata: { chave: parsed.data.chave },
  });

  return ok({ lead_id: id, chave: parsed.data.chave }, { requestId });
}
