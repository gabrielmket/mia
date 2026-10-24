/**
 * FORK MIA (.89) — POST /api/v1/email-marketing/campanhas/[id]/conferencia: o
 * que a tela "Enviar" mostra ANTES de confirmar: quantos recebem (e os dez
 * motivos de quem fica de fora), a conferência do conteúdo, o plano dia a dia
 * (ritmo, janela, dias úteis, teto do aquecimento), o custo, o saldo e as
 * TRAVAS. Só leitura: nada sai daqui.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { conferirCampanha, lerCampanha } from "@/lib/email-marketing/campanhas";
import { RecusaDaCampanha } from "@/lib/email-marketing/recusa";
import { corpoJson, portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

const pedidoSchema = z
  .object({
    quando: z.union([z.literal("agora"), z.string().datetime({ offset: true })]).default("agora"),
    ritmo_por_hora: z.number().int().min(50).max(5000).nullable().optional(),
    so_dias_uteis: z.boolean().nullable().optional(),
  })
  .strict();

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const porta = await portaDoEmail("manager", { escreve: false });
  if (!porta.ok) return porta.response;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success)
    return fail("validation_failed", "Campanha inválida.", 422, { requestId: porta.requestId });
  try {
    const parsed = pedidoSchema.safeParse(await corpoJson(req));
    if (!parsed.success) throw new RecusaDaCampanha("validation_failed", "Pedido inválido.", 422);
    const campanha = await lerCampanha(porta.admin, porta.org.orgId, id);
    if (!campanha)
      return fail("not_found", "Campanha não encontrada.", 404, { requestId: porta.requestId });
    const conf = await conferirCampanha(porta.admin, porta.org.orgId, campanha, {
      quando: parsed.data.quando,
      ritmoPorHora: parsed.data.ritmo_por_hora,
      soDiasUteis: parsed.data.so_dias_uteis,
    });
    const { publicoMontado: _p, ctx: _c, elegiveis: _e, empresas: _m, ...resposta } = conf;
    return ok(resposta, { requestId: porta.requestId });
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
