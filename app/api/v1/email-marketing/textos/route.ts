/**
 * FORK MIA (.89) — /api/v1/email-marketing/textos: as versões do texto de
 * consentimento da empresa.
 *
 * GET  as versões (as da empresa e as padrão, marcadas como rascunho para
 *      revisão jurídica). Atendente para cima: é quem registra o aceite na ficha.
 * POST uma versão nova (só o administrador). Versão não se edita: o aceite
 *      antigo continua apontando para o texto que a pessoa leu.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { versoesDoTexto } from "@/lib/email-marketing/consentimentos";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { corpoJson, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

const versaoSchema = z
  .object({
    versao: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{1,30}$/, "a versão é um código curto, como v2"),
    texto: z.string().trim().min(10).max(2000),
    inclui_aviso_de_medicao: z.boolean(),
  })
  .strict();

export async function GET(_req: NextRequest): Promise<Response> {
  const porta = await portaDoEmail("agent", { escreve: false, exigeModulo: false });
  if (!porta.ok) return porta.response;
  try {
    return ok(
      { versoes: await versoesDoTexto(porta.admin, porta.org.orgId) },
      { requestId: porta.requestId },
    );
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;
  const porta = await portaDoEmail("admin", { escreve: true });
  if (!porta.ok) return porta.response;
  try {
    const parsed = versaoSchema.safeParse(await corpoJson(req));
    if (!parsed.success)
      throw new RecusaDaCampanha(
        "validation_failed",
        parsed.error.issues[0]?.message ?? "Versão inválida.",
        422,
      );
    const { error } = await porta.admin.from("mia_email_textos_de_consentimento").insert({
      organization_id: porta.org.orgId,
      versao: parsed.data.versao,
      texto: parsed.data.texto,
      inclui_aviso_de_medicao: parsed.data.inclui_aviso_de_medicao,
      created_by: porta.user.id,
    });
    if (error) {
      if (error.code === "23505")
        throw new RecusaDaCampanha(
          "versao_repetida",
          "Já existe uma versão com esse código. Versão não se edita: crie outra.",
          409,
        );
      throw new Error(error.message);
    }
    void audit({
      action: "email_marketing.texto_de_consentimento_salvo",
      actorUserId: porta.user.id,
      organizationId: porta.org.orgId,
      resourceType: "mia_email_textos_de_consentimento",
      requestId: porta.requestId,
      metadata: { versao: parsed.data.versao, medicao: parsed.data.inclui_aviso_de_medicao },
    });
    return ok(
      { versoes: await versoesDoTexto(porta.admin, porta.org.orgId) },
      { requestId: porta.requestId },
    );
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
