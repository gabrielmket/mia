import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * FORK MIA — POST /api/v1/obrigacoes/[id]/feita — "Marcar feita".
 *
 * A atividade recorrente foi feita: o ciclo vai para o histórico e o próximo
 * nasce sozinho, um período adiante da data do ciclo que terminou (e não de
 * hoje: o relatório do dia 5 feito no dia 8 continua vencendo todo dia 5).
 * Atividade que não se repete fica "feita" e sem próxima data.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { paraATela } from "@/lib/obrigacoes/leitura";
import { marcarFeita } from "@/lib/obrigacoes/operacoes";
import { prepararRota, registrarAto, respostaDoErro } from "@/lib/obrigacoes/rota";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const rota = await prepararRota("agent", requestId);
  if (!rota.ok) return rota.resposta;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", rota.t("Item não encontrado."), 404, { requestId });
  }

  try {
    const { item, proxima_em: proxima } = await marcarFeita(rota.ctx, id);
    await registrarAto(rota, {
      acao: "obrigacao.feita",
      item,
      porque: "Marcou uma atividade recorrente como feita",
      metadata: { feita_em: item.feita_em, proxima_em: proxima },
    });
    const [naTela] = await paraATela(rota.supabase, rota.orgId, [item]);
    return ok({ item: naTela, proxima_em: proxima, hoje: rota.hoje }, { requestId });
  } catch (err) {
    return respostaDoErro(err, rota);
  }
}
