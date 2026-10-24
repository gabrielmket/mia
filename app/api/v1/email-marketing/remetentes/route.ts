/**
 * FORK MIA (.89) — POST /api/v1/email-marketing/remetentes: garante um
 * remetente pela parte do endereço antes do @ (o domínio é o verificado da
 * empresa). Um padrão por empresa. Só o administrador.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { lerRemetentes } from "@/lib/email-marketing/banco";
import { garantirRemetente, remetenteSchema } from "@/lib/email-marketing/configuracao";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { corpoJson, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;
  const porta = await portaDoEmail("admin", { escreve: true });
  if (!porta.ok) return porta.response;
  try {
    const parsed = remetenteSchema.safeParse(await corpoJson(req));
    if (!parsed.success) {
      throw new RecusaDaCampanha(
        "validation_failed",
        parsed.error.issues[0]?.message ?? "Remetente inválido.",
        422,
      );
    }
    const r = await garantirRemetente(porta.admin, porta.org.orgId, parsed.data, porta.user.id);
    if (r.desfecho !== "ja_estava") {
      void audit({
        action: "email_marketing.remetente_salvo",
        actorUserId: porta.user.id,
        organizationId: porta.org.orgId,
        resourceType: "mia_email_remetentes",
        resourceId: r.id,
        requestId: porta.requestId,
        metadata: {
          local: parsed.data.local,
          desfecho: r.desfecho,
          padrao: parsed.data.padrao === true,
        },
      });
    }
    return ok(
      { ...r, remetentes: await lerRemetentes(porta.admin, porta.org.orgId) },
      { requestId: porta.requestId },
    );
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
