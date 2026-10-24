/**
 * FORK MIA (.89) — POST /api/v1/email-marketing/campanhas/[id]/confirmar: o
 * DISPARO de verdade, agora ou agendado. Só pela tela, pelo gestor do cliente
 * (o MCP de plataforma não chega aqui: ele cria rascunho e manda teste).
 *
 * Confere TUDO de novo no servidor, grava os destinatários (cada um com o
 * motivo de ficar de fora, quando fica), congela os links, o plano e o preço, e
 * registra a declaração da base legal em nome de quem confirmou. O saldo é
 * conferido agora e de novo quando o envio começa.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { confirmarCampanha } from "@/lib/email-marketing/campanhas";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { corpoJson, nomeDaPessoa, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

const pedidoSchema = z
  .object({
    quando: z.union([z.literal("agora"), z.string().datetime({ offset: true })]),
    ritmo_por_hora: z.number().int().min(50).max(5000).nullable().optional(),
    so_dias_uteis: z.boolean().nullable().optional(),
    confirmo_a_base_legal: z.literal(true, { message: "Marque a confirmação da base legal." }),
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
    const parsed = pedidoSchema.safeParse(await corpoJson(req));
    if (!parsed.success)
      throw new RecusaDaCampanha(
        "validation_failed",
        parsed.error.issues[0]?.message ?? "Pedido inválido.",
        422,
      );
    const r = await confirmarCampanha(porta.admin, {
      organizationId: porta.org.orgId,
      campanhaId: id,
      autorId: porta.user.id,
      autorNome: nomeDaPessoa(porta.user),
      quando: parsed.data.quando,
      ritmoPorHora: parsed.data.ritmo_por_hora,
      soDiasUteis: parsed.data.so_dias_uteis,
      confirmaBaseLegal: parsed.data.confirmo_a_base_legal,
    });
    void audit({
      action: "email_marketing.campanha_confirmada",
      actorUserId: porta.user.id,
      organizationId: porta.org.orgId,
      resourceType: "mia_email_campanhas",
      resourceId: id,
      requestId: porta.requestId,
      metadata: {
        quando: parsed.data.quando,
        total: r.conferencia.total,
        custo_cents: r.conferencia.custoCents,
        preco_cents: r.conferencia.precoCents,
        base_legal: r.campanha.base_legal,
        lia_ref: r.campanha.lia_ref,
        dias_de_envio: r.conferencia.plano.length,
      },
    });
    return ok(
      {
        campanha: r.campanha,
        plano: r.conferencia.plano,
        total: r.conferencia.total,
        custo_cents: r.conferencia.custoCents,
      },
      { requestId: porta.requestId },
    );
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
