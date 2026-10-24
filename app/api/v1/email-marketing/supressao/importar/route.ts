/**
 * FORK MIA (.89) — POST /api/v1/email-marketing/supressao/importar: a lista de
 * descadastros da ferramenta anterior (RD, Mailchimp...). Só acrescenta, nunca
 * tira; guarda só o hash e o começo do endereço. Gestor para cima.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { corpoJson, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";
import { importarSupressao } from "@/lib/email-marketing/supressao";

export const dynamic = "force-dynamic";

const pedidoSchema = z
  .object({
    enderecos: z.array(z.string().max(320)).min(1).max(50_000),
    de_onde: z.string().trim().min(1).max(120).default("Importada da ferramenta anterior"),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;
  const porta = await portaDoEmail("manager", { escreve: true });
  if (!porta.ok) return porta.response;
  try {
    const parsed = pedidoSchema.safeParse(await corpoJson(req));
    if (!parsed.success)
      throw new RecusaDaCampanha("validation_failed", "Mande de 1 a 50.000 endereços.", 422);
    const r = await importarSupressao(porta.admin, {
      organizationId: porta.org.orgId,
      enderecos: parsed.data.enderecos,
      deOnde: parsed.data.de_onde,
      criadoPor: porta.user.id,
    });
    if (r.acrescentadas > 0) {
      void audit({
        action: "email_marketing.supressao_importada",
        actorUserId: porta.user.id,
        organizationId: porta.org.orgId,
        resourceType: "campaign_suppressions",
        requestId: porta.requestId,
        metadata: { lidas: r.lidas, acrescentadas: r.acrescentadas, recusadas: r.recusadas.length },
      });
    }
    return ok({ ...r, recusadas: r.recusadas.slice(0, 200) }, { requestId: porta.requestId });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
