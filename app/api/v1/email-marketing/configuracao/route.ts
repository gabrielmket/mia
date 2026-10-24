/**
 * FORK MIA (.89) — PUT /api/v1/email-marketing/configuracao: o "responder
 * para", o rodapé obrigatório, o ritmo, a janela e os dias úteis.
 *
 * Só o administrador muda (protótipo: "administrador configura"). Rodar duas
 * vezes com os mesmos dados não muda nada.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { configuracaoSchema, gravarConfiguracao } from "@/lib/email-marketing/configuracao";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { retratoDaConfiguracao } from "@/lib/email-marketing/retrato";
import { corpoJson, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;
  const porta = await portaDoEmail("admin", { escreve: true });
  if (!porta.ok) return porta.response;
  try {
    const parsed = configuracaoSchema.safeParse(await corpoJson(req));
    if (!parsed.success) {
      throw new RecusaDaCampanha(
        "validation_failed",
        parsed.error.issues[0]?.message ?? "Configuração inválida.",
        422,
        parsed.error.flatten(),
      );
    }
    await gravarConfiguracao(porta.admin, porta.org.orgId, parsed.data, porta.user.id);
    void audit({
      action: "email_marketing.configurado",
      actorUserId: porta.user.id,
      organizationId: porta.org.orgId,
      resourceType: "mia_email_config",
      resourceId: porta.org.orgId,
      requestId: porta.requestId,
      metadata: { campos: Object.keys(parsed.data) },
    });
    return ok(await retratoDaConfiguracao(porta.admin, porta.org.orgId), {
      requestId: porta.requestId,
    });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
