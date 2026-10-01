import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * FORK MIA — POST /api/v1/leads/[id]/notas — a nota interna do cartão aberto.
 *
 * A equipe vê; o cliente não. Vira uma linha `note` na linha do tempo do
 * negócio (o tipo já existe no vocabulário do upstream), com o texto no
 * `payload` — nunca no `reason`, que a tela mostra em qualquer lugar e que a
 * doutrina proíbe de carregar conteúdo de cliente — e a marca de FIXADA, que
 * põe a nota no topo do histórico ("o marido só pode aos sábados").
 *
 * O texto some na anonimização (LGPD): a cascata do upstream zera `payload`,
 * `metadata` e `reason` das atividades do contato e dos negócios dele.
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

const Corpo = z.object({
  texto: z.string().trim().min(1).max(4000),
  fixada: z.boolean().optional().default(false),
});

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
    return fail("validation_failed", t("Escreva a nota antes de salvar."), 422, {
      requestId,
      details: { issues: parsed.error.issues },
    });
  }

  const supabase = await createClient();
  const { data: lead, error } = await supabase
    .from("crm_leads")
    .select("id, contact_id")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!lead) return fail("not_found", t("Negócio não encontrado."), 404, { requestId });

  const atividade = await emitLeadActivity(supabase, {
    organizationId: authz.org.orgId,
    leadId: id,
    contactId: (lead as { contact_id: string | null }).contact_id,
    type: "note",
    sourceModule: "crm",
    sourceId: id,
    actor: { type: "user", id: authz.user.id },
    reason: parsed.data.fixada ? "Nota interna fixada" : "Nota interna",
    payload: { texto: parsed.data.texto, fixada: parsed.data.fixada },
  });
  if (!atividade.ok) {
    return fail("internal_error", atividade.error ?? "activity insert failed", 500, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "lead.nota_adicionada",
    resourceType: "crm_leads",
    resourceId: id,
    requestId,
    metadata: { fixada: parsed.data.fixada },
  });

  return ok({ lead_id: id, fixada: parsed.data.fixada }, { requestId, status: 201 });
}
