/**
 * FORK MIA (.89) — POST /api/v1/email-marketing/campanhas/[id]/acoes: o que
 * fazer com QUEM CLICOU (sem o robô).
 *
 *   segmento  um segmento salvo "clicou nesta campanha", para a próxima
 *   tarefa    uma para o responsável de cada contato (sem responsável: quem pediu)
 *   negocio   um na etapa escolhida, pulando quem já tem negócio aberto no funil
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { lerCampanha } from "@/lib/email-marketing/campanhas";
import { recorteSchema } from "@/lib/email-marketing/recorte";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { negociosParaQuemClicou, tarefasParaQuemClicou } from "@/lib/email-marketing/resultados";
import { corpoJson, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";
import { garantirSegmento } from "@/lib/email-marketing/segmentos-e-modelos";

export const dynamic = "force-dynamic";

const pedidoSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("segmento"), nome: z.string().trim().min(1).max(120) }).strict(),
  z
    .object({
      tipo: z.literal("tarefa"),
      titulo: z.string().trim().min(1).max(200),
      vence_em_dias: z.number().int().min(0).max(60).default(1),
      para: z.union([z.literal("responsavel"), z.string().uuid()]).default("responsavel"),
    })
    .strict(),
  z
    .object({
      tipo: z.literal("negocio"),
      pipeline_id: z.string().uuid(),
      stage_id: z.string().uuid(),
    })
    .strict(),
]);

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
    const parsed = pedidoSchema.safeParse(await corpoJson(req));
    if (!parsed.success)
      throw new RecusaDaCampanha(
        "validation_failed",
        parsed.error.issues[0]?.message ?? "Ação inválida.",
        422,
      );
    const campanha = await lerCampanha(porta.admin, porta.org.orgId, id);
    if (!campanha)
      return fail("not_found", "Campanha não encontrada.", 404, { requestId: porta.requestId });
    const p = parsed.data;
    let resultado: Record<string, unknown>;
    if (p.tipo === "segmento") {
      resultado = await garantirSegmento(
        porta.admin,
        porta.org.orgId,
        {
          nome: p.nome,
          recorte: recorteSchema.parse({
            campanha_anterior: { campanha_id: id, comportamento: "clicou" },
          }),
          base_legal: campanha.base_legal,
          lia_ref: campanha.lia_ref,
        },
        porta.user.id,
      );
    } else if (p.tipo === "tarefa") {
      if (p.para !== "responsavel") {
        const { data } = await porta.admin
          .from("user_organizations")
          .select("user_id")
          .eq("organization_id", porta.org.orgId)
          .eq("user_id", p.para)
          .is("revoked_at", null)
          .maybeSingle();
        if (!data)
          throw new RecusaDaCampanha(
            "pessoa_desconhecida",
            "Essa pessoa não é da equipe desta empresa.",
            404,
          );
      }
      resultado = {
        ...(await tarefasParaQuemClicou(porta.admin, {
          organizationId: porta.org.orgId,
          campanhaId: id,
          campanhaNome: campanha.nome,
          titulo: p.titulo,
          venceEmDias: p.vence_em_dias,
          paraQuem: p.para === "responsavel" ? "responsavel" : { usuario_id: p.para },
          autorId: porta.user.id,
          requestId: porta.requestId,
        })),
      };
    } else {
      const { data: funil } = await porta.admin
        .from("crm_pipelines")
        .select("id")
        .eq("organization_id", porta.org.orgId)
        .eq("id", p.pipeline_id)
        .maybeSingle();
      if (!funil)
        throw new RecusaDaCampanha(
          "funil_desconhecido",
          "Funil não encontrado nesta empresa.",
          404,
        );
      resultado = {
        ...(await negociosParaQuemClicou(porta.admin, {
          organizationId: porta.org.orgId,
          campanhaId: id,
          campanhaNome: campanha.nome,
          pipelineId: p.pipeline_id,
          stageId: p.stage_id,
          autorId: porta.user.id,
        })),
      };
    }
    void audit({
      action: "email_marketing.acao_sobre_cliques",
      actorUserId: porta.user.id,
      organizationId: porta.org.orgId,
      resourceType: "mia_email_campanhas",
      resourceId: id,
      requestId: porta.requestId,
      metadata: { tipo: p.tipo, ...resultado },
    });
    return ok({ tipo: p.tipo, ...resultado }, { requestId: porta.requestId });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
