/**
 * FORK MIA (.89) — /api/v1/contacts/[id]/consentimento-de-email: o
 * consentimento de e-mail marketing NA FICHA do contato.
 *
 * GET   o vigente, o registro de cada aceite e recusa, a situação na lista de
 *       supressão e a recusa de marketing pelo WhatsApp.
 * POST  `aceite` (com origem, data, versão do texto e EVIDÊNCIA obrigatória) ou
 *       `recusa` (entra na supressão na hora; depois disso só a própria pessoa
 *       volta, pelo link de um e-mail).
 *
 * Atendente para cima: é quem ouve a pessoa pedir (protótipo: "atendente
 * registra consentimento"). Vale para todos, com ou sem o módulo de e-mail: o
 * registro existe antes da primeira campanha. A empresa vem da sessão e o
 * contato é conferido nela.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { lerEmpresa } from "@/lib/email-marketing/banco";
import {
  fichaDoConsentimento,
  registrarAceite,
  registrarRecusa,
} from "@/lib/email-marketing/consentimentos";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { corpoJson, nomeDaPessoa, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

const pedidoSchema = z.discriminatedUnion("tipo", [
  z
    .object({
      tipo: z.literal("aceite"),
      origem: z.string().trim().min(1).max(200),
      quando: z.string().trim().min(8).max(40),
      versao: z.string().trim().max(30).nullable().optional(),
      evidencia: z.string().trim().min(1, "Sem evidência, o registro não grava.").max(500),
    })
    .strict(),
  z.object({ tipo: z.literal("recusa"), canal: z.string().trim().min(1).max(120) }).strict(),
]);

const ID = z.string().uuid();

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const porta = await portaDoEmail("agent", {
    escreve: false,
    exigeModulo: false,
    resource: "contacts",
  });
  if (!porta.ok) return porta.response;
  const { id } = await ctx.params;
  if (!ID.safeParse(id).success)
    return fail("validation_failed", "Contato inválido.", 422, { requestId: porta.requestId });
  try {
    return ok(await fichaDoConsentimento(porta.admin, porta.org.orgId, id), {
      requestId: porta.requestId,
    });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;
  const porta = await portaDoEmail("agent", {
    escreve: true,
    exigeModulo: false,
    resource: "contacts",
  });
  if (!porta.ok) return porta.response;
  const { id } = await ctx.params;
  if (!ID.safeParse(id).success)
    return fail("validation_failed", "Contato inválido.", 422, { requestId: porta.requestId });
  try {
    const parsed = pedidoSchema.safeParse(await corpoJson(req));
    if (!parsed.success)
      throw new RecusaDaCampanha(
        "validation_failed",
        parsed.error.issues[0]?.message ?? "Registro inválido.",
        422,
      );
    const p = parsed.data;
    if (p.tipo === "aceite") {
      const empresa = await lerEmpresa(porta.admin, porta.org.orgId);
      await registrarAceite(porta.admin, {
        organizationId: porta.org.orgId,
        contactId: id,
        origem: p.origem,
        quando: p.quando,
        versao: p.versao ?? null,
        evidencia: p.evidencia,
        porta: "ficha",
        registradoPor: porta.user.id,
        empresaNome: empresa.nome,
        requestId: porta.requestId,
      });
    } else {
      await registrarRecusa(porta.admin, {
        organizationId: porta.org.orgId,
        contactId: id,
        canal: p.canal,
        porta: "ficha",
        registradoPor: porta.user.id,
        registradoPorNome: nomeDaPessoa(porta.user),
        requestId: porta.requestId,
      });
    }
    return ok(await fichaDoConsentimento(porta.admin, porta.org.orgId, id), {
      requestId: porta.requestId,
    });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
