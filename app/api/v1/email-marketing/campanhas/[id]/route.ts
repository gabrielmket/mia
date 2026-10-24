/**
 * FORK MIA (.89) — /api/v1/email-marketing/campanhas/[id]
 *
 * GET   a campanha, o andamento e os testes enviados.
 * PATCH o rascunho: nome, remetente, assunto, pré-cabeçalho, blocos, textos
 *       reserva, recorte, base legal, ritmo. Mudar o CONTEÚDO soma uma versão,
 *       e o envio pede um teste novo. Agendada ou enviada, o conteúdo fica
 *       congelado (409).
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { blocosSchema, reservasSchema } from "@/lib/email-marketing/blocos";
import { andamentoDaCampanha, editarRascunho, lerCampanha } from "@/lib/email-marketing/campanhas";
import { recorteSchema } from "@/lib/email-marketing/recorte";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { corpoJson, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

const editarSchema = z
  .object({
    nome: z.string().trim().min(1).max(120).optional(),
    remetente_id: z.string().uuid().nullable().optional(),
    assunto: z.string().max(200).optional(),
    pre_cabecalho: z.string().max(200).optional(),
    blocos: blocosSchema.optional(),
    reservas: reservasSchema.optional(),
    recorte: recorteSchema.optional(),
    segmento_id: z.string().uuid().nullable().optional(),
    base_legal: z.enum(["consent", "legitimate_interest"]).optional(),
    lia_ref: z.string().trim().max(120).nullable().optional(),
    ritmo_por_hora: z.number().int().min(50).max(5000).nullable().optional(),
    so_dias_uteis: z.boolean().nullable().optional(),
  })
  .strict();

const ID = z.string().uuid();

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const porta = await portaDoEmail("manager", { escreve: false });
  if (!porta.ok) return porta.response;
  const { id } = await ctx.params;
  if (!ID.safeParse(id).success)
    return fail("validation_failed", "Campanha inválida.", 422, { requestId: porta.requestId });
  try {
    const campanha = await lerCampanha(porta.admin, porta.org.orgId, id);
    if (!campanha)
      return fail("not_found", "Campanha não encontrada.", 404, { requestId: porta.requestId });
    const [andamento, testes] = await Promise.all([
      campanha.status === "rascunho"
        ? Promise.resolve(null)
        : andamentoDaCampanha(porta.admin, porta.org.orgId, id),
      porta.admin
        .from("mia_email_testes")
        .select("id, versao, para, enviado_em, resultado")
        .eq("organization_id", porta.org.orgId)
        .eq("campanha_id", id)
        .order("enviado_em", { ascending: false })
        .limit(20),
    ]);
    return ok({ campanha, andamento, testes: testes.data ?? [] }, { requestId: porta.requestId });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;
  const porta = await portaDoEmail("manager", { escreve: true });
  if (!porta.ok) return porta.response;
  const { id } = await ctx.params;
  if (!ID.safeParse(id).success)
    return fail("validation_failed", "Campanha inválida.", 422, { requestId: porta.requestId });
  try {
    const parsed = editarSchema.safeParse(await corpoJson(req));
    if (!parsed.success)
      throw new RecusaDaCampanha(
        "validation_failed",
        parsed.error.issues[0]?.message ?? "Campanha inválida.",
        422,
      );
    if (parsed.data.remetente_id) {
      const { data } = await porta.admin
        .from("mia_email_remetentes")
        .select("id")
        .eq("organization_id", porta.org.orgId)
        .eq("id", parsed.data.remetente_id)
        .is("arquivado_em", null)
        .maybeSingle();
      if (!data)
        throw new RecusaDaCampanha(
          "remetente_desconhecido",
          "Remetente não encontrado nesta empresa.",
          404,
        );
    }
    const antes = await lerCampanha(porta.admin, porta.org.orgId, id);
    const campanha = await editarRascunho(porta.admin, porta.org.orgId, id, parsed.data);
    if (antes && campanha.versao !== antes.versao) {
      void audit({
        action: "email_marketing.campanha_editada",
        actorUserId: porta.user.id,
        organizationId: porta.org.orgId,
        resourceType: "mia_email_campanhas",
        resourceId: id,
        requestId: porta.requestId,
        metadata: { versao: campanha.versao, campos: Object.keys(parsed.data) },
      });
    }
    return ok({ campanha }, { requestId: porta.requestId });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
