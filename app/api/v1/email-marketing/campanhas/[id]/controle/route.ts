/**
 * FORK MIA (.89) — POST /api/v1/email-marketing/campanhas/[id]/controle:
 * pausar, retomar e cancelar.
 *
 *   pausar    agendada ou enviando → pausada (quem ainda não recebeu fica na fila)
 *   retomar   pausada → enviando (ou agendada). A pausa pela TRAVA DE SAÚDE só
 *             volta com `mesmo_assim: true`: retomar arrisca a conta da Amazon
 *   cancelar  agendada → rascunho (nada saiu, nada foi cobrado); pausada →
 *             cancelada (quem não recebeu fica de fora, com o motivo)
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { cancelarCampanha, pausarCampanha, retomarCampanha } from "@/lib/email-marketing/campanhas";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { corpoJson, nomeDaPessoa, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

const pedidoSchema = z
  .object({ acao: z.enum(["pausar", "retomar", "cancelar"]), mesmo_assim: z.boolean().optional() })
  .strict();

const ACAO = {
  pausar: "email_marketing.campanha_pausada",
  retomar: "email_marketing.campanha_retomada",
  cancelar: "email_marketing.campanha_cancelada",
} as const;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;
  const porta = await portaDoEmail("manager", { escreve: true });
  if (!porta.ok) return porta.response;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success)
    return fail("validation_failed", "Campanha inválida.", 422, { requestId: porta.requestId });
  try {
    const parsed = pedidoSchema.safeParse(await corpoJson(req));
    if (!parsed.success) throw new RecusaDaCampanha("validation_failed", "Ação inválida.", 422);
    const { acao, mesmo_assim } = parsed.data;
    const campanha =
      acao === "pausar"
        ? await pausarCampanha(porta.admin, porta.org.orgId, id, nomeDaPessoa(porta.user))
        : acao === "retomar"
          ? await retomarCampanha(porta.admin, porta.org.orgId, id, { mesmoAssim: mesmo_assim })
          : await cancelarCampanha(porta.admin, porta.org.orgId, id);
    void audit({
      action: ACAO[acao],
      actorUserId: porta.user.id,
      organizationId: porta.org.orgId,
      resourceType: "mia_email_campanhas",
      resourceId: id,
      requestId: porta.requestId,
      metadata: { status: campanha.status, mesmo_assim: mesmo_assim === true },
    });
    return ok({ campanha }, { requestId: porta.requestId });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
