/**
 * FORK MIA (.89) — GET /api/v1/email-marketing/modelos: os modelos de
 * campanha da empresa (o ponto de partida de um rascunho em blocos). Gestor.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { portaDoEmail, respostaDoErro } from "@/lib/email-marketing/rota";
import { CATALOGO_DE_MODELOS, listarModelos } from "@/lib/email-marketing/segmentos-e-modelos";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  const porta = await portaDoEmail("manager", { escreve: false });
  if (!porta.ok) return porta.response;
  try {
    return ok(
      {
        modelos: await listarModelos(porta.admin, porta.org.orgId),
        catalogo: CATALOGO_DE_MODELOS.map((m) => ({
          chave: m.chave,
          nome: m.nome,
          segmento: m.segmento,
        })),
      },
      { requestId: porta.requestId },
    );
  } catch (err) {
    return respostaDoErro(err, porta.requestId);
  }
}
