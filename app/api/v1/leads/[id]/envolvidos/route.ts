import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * FORK MIA — POST|DELETE /api/v1/leads/[id]/envolvidos — as PESSOAS de um
 * negócio além do contato principal, com o papel de cada uma NESTE negócio
 * (decisor, financeiro, usuário, influenciador, outro).
 *
 * Mora em `crm_lead_links` (target_kind `contact`, link_kind `envolvido`,
 * `metadata.papel`), a tabela de vínculos do negócio que o upstream criou e que
 * já aceita contato — nenhuma coluna nova. A anonimização do upstream já olha
 * este vínculo: anonimizar uma pessoa envolvida redige a linha do tempo dos
 * negócios em que ela está.
 *
 * POST inclui ou troca o papel (a chave única do vínculo é negócio + alvo +
 * tipo); DELETE `?contact_id=` retira. As duas entram na linha do tempo do
 * negócio e na auditoria.
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
import { VINCULO_DE_ENVOLVIDO } from "@/lib/cartoes/cartao-aberto-servidor";
import { PAPEIS } from "@/lib/cartoes/papel";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const Corpo = z.object({
  contact_id: z.string().uuid(),
  papel: z.enum(PAPEIS).nullable().optional(),
});

async function preparar(ctx: RouteCtx, requestId: string) {
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return { ok: false, resposta: authz.response as Response } as const;
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: lead, error } = await supabase
    .from("crm_leads")
    .select("id, contact_id")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  if (error) return { ok: false, resposta: fail("internal_error", error.message, 500, { requestId }) } as const;
  if (!lead) return { ok: false, resposta: fail("not_found", t("Negócio não encontrado."), 404, { requestId }) } as const;
  return { ok: true, authz, supabase, lead: lead as { id: string; contact_id: string | null }, t } as const;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;
  const requestId = randomUUID();
  const p = await preparar(ctx, requestId);
  if (!p.ok) return p.resposta;
  const { authz, supabase, lead, t } = p;

  const parsed = Corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Escolha a pessoa e o papel dela."), 422, {
      requestId,
      details: { issues: parsed.error.issues },
    });
  }
  const { contact_id, papel } = parsed.data;
  if (contact_id === lead.contact_id) {
    return fail("validation_failed", t("Esta pessoa já é o contato principal do negócio."), 422, { requestId });
  }

  // A pessoa tem de ser da MESMA organização: o id vem do corpo, e a RLS +
  // o filtro explícito é o que impede apontar para contato de outra empresa.
  const { data: contato } = await supabase
    .from("contacts")
    .select("id, is_anonymized")
    .eq("organization_id", authz.org.orgId)
    .eq("id", contact_id)
    .maybeSingle();
  if (!contato) return fail("not_found", t("Contato não encontrado."), 404, { requestId });

  const { error } = await supabase.from("crm_lead_links").upsert(
    {
      organization_id: authz.org.orgId,
      lead_id: lead.id,
      target_kind: "contact",
      target_id: contact_id,
      link_kind: VINCULO_DE_ENVOLVIDO,
      metadata: { papel: papel ?? null },
      created_by_user_id: authz.user.id,
    },
    { onConflict: "lead_id,target_kind,target_id,link_kind" },
  );
  if (error) return fail("internal_error", error.message, 500, { requestId });

  await emitLeadActivity(supabase, {
    organizationId: authz.org.orgId,
    leadId: lead.id,
    contactId: lead.contact_id,
    type: "lead_edited",
    sourceModule: "crm",
    sourceId: lead.id,
    actor: { type: "user", id: authz.user.id },
    reason: "Incluiu uma pessoa no negócio",
    payload: { fields: ["contatos_envolvidos"], papel: papel ?? null },
  });
  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "lead.contato_envolvido_incluido",
    resourceType: "crm_leads",
    resourceId: lead.id,
    requestId,
    metadata: { contact_id, papel: papel ?? null },
  });

  return ok({ lead_id: lead.id, contact_id, papel: papel ?? null }, { requestId, status: 201 });
}

export async function DELETE(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;
  const requestId = randomUUID();
  const p = await preparar(ctx, requestId);
  if (!p.ok) return p.resposta;
  const { authz, supabase, lead, t } = p;

  const alvo = z.string().uuid().safeParse(new URL(req.url).searchParams.get("contact_id"));
  if (!alvo.success) return fail("validation_failed", t("Diga qual pessoa tirar do negócio."), 422, { requestId });

  const { data: apagados, error } = await supabase
    .from("crm_lead_links")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("lead_id", lead.id)
    .eq("target_kind", "contact")
    .eq("target_id", alvo.data)
    .eq("link_kind", VINCULO_DE_ENVOLVIDO)
    .select("id");
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!apagados || apagados.length === 0) {
    return fail("not_found", t("Esta pessoa não está neste negócio."), 404, { requestId });
  }

  await emitLeadActivity(supabase, {
    organizationId: authz.org.orgId,
    leadId: lead.id,
    contactId: lead.contact_id,
    type: "lead_edited",
    sourceModule: "crm",
    sourceId: lead.id,
    actor: { type: "user", id: authz.user.id },
    reason: "Tirou uma pessoa do negócio",
    payload: { fields: ["contatos_envolvidos"] },
  });
  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "lead.contato_envolvido_retirado",
    resourceType: "crm_leads",
    resourceId: lead.id,
    requestId,
    metadata: { contact_id: alvo.data },
  });

  return ok({ lead_id: lead.id, contact_id: alvo.data }, { requestId });
}
