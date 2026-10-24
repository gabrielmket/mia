/**
 * FORK MIA (.89) — DELETE /api/v1/email-marketing/segmentos/[id]: arquiva o
 * segmento (a campanha que o usou continua com o recorte congelado). Gestor.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";
import { arquivarSegmento, listarSegmentos } from "@/lib/email-marketing/segmentos-e-modelos";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;
  const porta = await portaDoEmail("manager", { escreve: true });
  if (!porta.ok) return porta.response;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success)
    return fail("validation_failed", "Segmento inválido.", 422, { requestId: porta.requestId });
  try {
    await arquivarSegmento(porta.admin, porta.org.orgId, id);
    void audit({
      action: "email_marketing.segmento_salvo",
      actorUserId: porta.user.id,
      organizationId: porta.org.orgId,
      resourceType: "mia_segmentos",
      resourceId: id,
      requestId: porta.requestId,
      metadata: { desfecho: "arquivou" },
    });
    return ok(
      { segmentos: await listarSegmentos(porta.admin, porta.org.orgId) },
      { requestId: porta.requestId },
    );
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
