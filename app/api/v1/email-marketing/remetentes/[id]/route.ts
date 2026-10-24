/**
 * FORK MIA (.89) — DELETE /api/v1/email-marketing/remetentes/[id]: arquiva o
 * remetente (não apaga: campanha antiga continua dizendo de quem saiu). Só o
 * administrador.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { lerRemetentes } from "@/lib/email-marketing/banco";
import { arquivarRemetente } from "@/lib/email-marketing/configuracao";
import { portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;
  const porta = await portaDoEmail("admin", { escreve: true });
  if (!porta.ok) return porta.response;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success)
    return fail("validation_failed", "Remetente inválido.", 422, { requestId: porta.requestId });
  try {
    await arquivarRemetente(porta.admin, porta.org.orgId, id);
    void audit({
      action: "email_marketing.remetente_salvo",
      actorUserId: porta.user.id,
      organizationId: porta.org.orgId,
      resourceType: "mia_email_remetentes",
      resourceId: id,
      requestId: porta.requestId,
      metadata: { desfecho: "arquivou" },
    });
    return ok(
      { remetentes: await lerRemetentes(porta.admin, porta.org.orgId) },
      { requestId: porta.requestId },
    );
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
