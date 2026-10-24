/**
 * FORK MIA (.89) — POST /api/v1/email-marketing/dominio: cria a identidade do
 * domínio na Amazon (região sa-east-1) e confere os seis registros de DNS
 * (3 DKIM, MX e SPF do retorno, DMARC). Chamada de novo, confere e diz o que
 * falta. Sem os seis, o envio trava. Remetente de provedor gratuito é recusado.
 *
 * Só o administrador. Sem as chaves da Amazon no servidor, recusa dizendo o que
 * falta (o módulo nasce desligado).
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { verificarDominio } from "@/lib/email-marketing/configuracao";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { corpoJson, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

const pedidoSchema = z
  .object({
    dominio: z.string().trim().max(253).optional(),
    subdominio_de_retorno: z.string().trim().max(32).optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;
  const porta = await portaDoEmail("admin", { escreve: true });
  if (!porta.ok) return porta.response;
  try {
    const parsed = pedidoSchema.safeParse(await corpoJson(req));
    if (!parsed.success)
      throw new RecusaDaCampanha(
        "validation_failed",
        "Pedido inválido.",
        422,
        parsed.error.flatten(),
      );
    const r = await verificarDominio(porta.admin, {
      organizationId: porta.org.orgId,
      dominio: parsed.data.dominio,
      subdominioDeRetorno: parsed.data.subdominio_de_retorno,
    });
    void audit({
      action: "email_marketing.dominio_conferido",
      actorUserId: porta.user.id,
      organizationId: porta.org.orgId,
      resourceType: "mia_email_dominios",
      resourceId: r.dominio.id,
      requestId: porta.requestId,
      metadata: {
        dominio: r.dominio.dominio,
        verificado: r.verificado,
        faltam: r.dominio.faltam,
        criou_identidade: r.criouAgora,
      },
    });
    return ok(
      {
        dominio: r.dominio.dominio,
        verificado: r.verificado,
        faltam: r.dominio.faltam,
        registros: r.registros,
      },
      { requestId: porta.requestId },
    );
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
