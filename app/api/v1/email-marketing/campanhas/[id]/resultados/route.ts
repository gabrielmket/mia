/**
 * FORK MIA (.89) — GET /api/v1/email-marketing/campanhas/[id]/resultados:
 * enviados, entregues, aberturas (SEMPRE estimativa, só de quem consentiu com o
 * aviso de medição), cliques únicos por link sem o robô, descadastros,
 * rejeições, reclamações, o custo cobrado, a saúde e quem clicou.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { lerCampanha } from "@/lib/email-marketing/campanhas";
import { mascararEmail } from "@/lib/email-marketing/endereco";
import { quemClicou, resultadosDaCampanha } from "@/lib/email-marketing/resultados";
import { portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const porta = await portaDoEmail("manager", { escreve: false });
  if (!porta.ok) return porta.response;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success)
    return fail("validation_failed", "Campanha inválida.", 422, { requestId: porta.requestId });
  try {
    const campanha = await lerCampanha(porta.admin, porta.org.orgId, id);
    if (!campanha)
      return fail("not_found", "Campanha não encontrada.", 404, { requestId: porta.requestId });
    const [numeros, clicaram] = await Promise.all([
      resultadosDaCampanha(porta.admin, porta.org.orgId, id),
      quemClicou(porta.admin, porta.org.orgId, id, 200),
    ]);
    // Quem tem negócio aberto (a tela mostra ao lado de quem clicou).
    const ids = clicaram.map((c) => c.contactId);
    const abertos = new Set<string>();
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await porta.admin
        .from("crm_leads")
        .select("contact_id")
        .eq("organization_id", porta.org.orgId)
        .eq("status", "open")
        .in("contact_id", ids.slice(i, i + 150));
      for (const l of (data ?? []) as Array<{ contact_id: string }>) abertos.add(l.contact_id);
    }
    return ok(
      {
        campanha: {
          id: campanha.id,
          nome: campanha.nome,
          status: campanha.status,
          base_legal: campanha.base_legal,
          motivo_da_pausa: campanha.motivo_da_pausa,
          total_previsto: campanha.total_previsto,
          plano: campanha.plano,
        },
        numeros,
        quem_clicou: clicaram.map((c) => ({
          contato_id: c.contactId,
          nome: c.nome,
          email: c.email ? mascararEmail(c.email) : null,
          link_id: c.link,
          responsavel_id: c.responsavelId,
          tem_negocio_aberto: abertos.has(c.contactId),
        })),
      },
      { requestId: porta.requestId },
    );
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
