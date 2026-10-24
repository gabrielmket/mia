/**
 * FORK MIA (.89) — POST /api/v1/email-marketing/consentimentos/importar: os
 * aceites de uma planilha, com DATA e ORIGEM por linha. Linha sem uma das duas
 * é recusada (lista comprada não entra como consentimento), quem já se
 * descadastrou não é tocado, e rodar de novo não duplica. Gestor para cima.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { importarAceites } from "@/lib/email-marketing/consentimentos";
import { lerEmpresa } from "@/lib/email-marketing/banco";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { corpoJson, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

const pedidoSchema = z
  .object({
    linhas: z
      .array(
        z
          .object({
            email: z.string().max(320),
            data: z.string().max(40).nullable(),
            origem: z.string().max(200).nullable(),
            versao: z.string().max(30).nullable().optional(),
            evidencia: z.string().max(500).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20_000),
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
      throw new RecusaDaCampanha(
        "validation_failed",
        "Mande de 1 a 20.000 linhas com e-mail, data e origem.",
        422,
      );
    const empresa = await lerEmpresa(porta.admin, porta.org.orgId);
    const r = await importarAceites(porta.admin, {
      organizationId: porta.org.orgId,
      linhas: parsed.data.linhas,
      registradoPor: porta.user.id,
      porta: "importacao",
      empresaNome: empresa.nome,
      requestId: porta.requestId,
    });
    return ok({ ...r, recusadas: r.recusadas.slice(0, 200) }, { requestId: porta.requestId });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
