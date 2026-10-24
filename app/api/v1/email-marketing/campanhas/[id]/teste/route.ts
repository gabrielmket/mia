/**
 * FORK MIA (.89) — POST /api/v1/email-marketing/campanhas/[id]/teste: o envio
 * de TESTE da versão atual. Até 5 endereços, [TESTE] no assunto, sem cobrar
 * crédito. Libera o envio da versão. Na empresa de demonstração nada sai, nem
 * o teste (o código recusa antes da Amazon, e o banco segura de novo).
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { enviarTeste } from "@/lib/email-marketing/campanhas";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { corpoJson, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

const testeSchema = z
  .object({
    para: z.array(z.string().trim().max(254)).min(1).max(5),
    ver_como_contato_id: z.string().uuid().nullable().optional(),
  })
  .strict();

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
    const parsed = testeSchema.safeParse(await corpoJson(req));
    if (!parsed.success)
      throw new RecusaDaCampanha("validation_failed", "O teste vai para 1 a 5 endereços.", 422);
    const r = await enviarTeste(porta.admin, {
      organizationId: porta.org.orgId,
      campanhaId: id,
      para: parsed.data.para,
      autorId: porta.user.id,
      verComoContatoId: parsed.data.ver_como_contato_id ?? null,
    });
    void audit({
      action: "email_marketing.teste_enviado",
      actorUserId: porta.user.id,
      organizationId: porta.org.orgId,
      resourceType: "mia_email_campanhas",
      resourceId: id,
      requestId: porta.requestId,
      metadata: { versao: r.versao, enviados: r.enviados.length, recusados: r.recusados.length },
    });
    return ok(r, { requestId: porta.requestId });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
