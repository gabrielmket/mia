import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * FORK MIA — DELETE /api/v1/obrigacoes/tipos/[id] — tira um tipo do catálogo.
 *
 * O tipo é ARQUIVADO, não apagado, e os itens que nasceram dele continuam como
 * estão: cada item guarda as próprias regras (validade, avisos, recorrência).
 * Gerente em diante.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { arquivarTipo } from "@/lib/obrigacoes/catalogo-servidor";
import { prepararRota, respostaDoErro } from "@/lib/obrigacoes/rota";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const rota = await prepararRota("manager", requestId);
  if (!rota.ok) return rota.resposta;
  const { id: tipoId } = await ctx.params;
  if (!z.string().uuid().safeParse(tipoId).success) {
    return fail("not_found", rota.t("Tipo não encontrado."), 404, { requestId });
  }

  try {
    const { nome } = await arquivarTipo(rota.supabase, rota.orgId, tipoId);
    await audit({
      organizationId: rota.orgId,
      actorUserId: rota.userId,
      action: "obrigacao.tipo_arquivado",
      resourceType: "mia_obrigacoes_tipos",
      resourceId: tipoId,
      requestId,
      metadata: { nome },
    });
    return ok({ id: tipoId, arquivado: true }, { requestId });
  } catch (err) {
    return respostaDoErro(err, rota);
  }
}
