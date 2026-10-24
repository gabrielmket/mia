/**
 * FORK MIA (.89) — /api/v1/email-marketing/segmentos: os recortes salvos.
 *
 * O segmento guarda o FILTRO e a base legal, não a lista: a conta refaz na
 * hora de usar. Gestor para cima (é quem monta campanha).
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { corpoJson, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";
import {
  garantirSegmento,
  listarSegmentos,
  segmentoSchema,
} from "@/lib/email-marketing/segmentos-e-modelos";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  const porta = await portaDoEmail("manager", { escreve: false });
  if (!porta.ok) return porta.response;
  try {
    return ok(
      { segmentos: await listarSegmentos(porta.admin, porta.org.orgId) },
      { requestId: porta.requestId },
    );
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;
  const porta = await portaDoEmail("manager", { escreve: true });
  if (!porta.ok) return porta.response;
  try {
    const parsed = segmentoSchema.safeParse(await corpoJson(req));
    if (!parsed.success)
      throw new RecusaDaCampanha(
        "validation_failed",
        parsed.error.issues[0]?.message ?? "Segmento inválido.",
        422,
      );
    const r = await garantirSegmento(porta.admin, porta.org.orgId, parsed.data, porta.user.id);
    if (r.desfecho !== "ja_estava") {
      void audit({
        action: "email_marketing.segmento_salvo",
        actorUserId: porta.user.id,
        organizationId: porta.org.orgId,
        resourceType: "mia_segmentos",
        resourceId: r.id,
        requestId: porta.requestId,
        metadata: {
          nome: parsed.data.nome,
          base_legal: parsed.data.base_legal,
          desfecho: r.desfecho,
        },
      });
    }
    return ok(
      { ...r, segmentos: await listarSegmentos(porta.admin, porta.org.orgId) },
      { requestId: porta.requestId },
    );
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
