import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * FORK MIA — POST /api/v1/obrigacoes/[id]/pedir — "Marcar pedido" e "Pedir de novo".
 *
 * Sem pedido em aberto, registra o pedido de hoje com prazo de 7 dias para o
 * cliente entregar (é "renovação pedida" quando o documento já foi recebido
 * antes). Com pedido em aberto, registra a cobrança de hoje: a data do pedido
 * não muda, e o aviso de "documento não enviado" não rearma.
 *
 * Esta rota só REGISTRA que o pedido foi feito. Quem fala com o cliente é a
 * pessoa, na conversa, ou a automação que a empresa ligou.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { paraATela } from "@/lib/obrigacoes/leitura";
import { pedirObrigacao } from "@/lib/obrigacoes/operacoes";
import { prepararRota, registrarAto, respostaDoErro } from "@/lib/obrigacoes/rota";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const PORQUE = {
  pedido: "Marcou um documento como pedido",
  renovacao_pedida: "Pediu a renovação de um documento",
  pedido_de_novo: "Pediu um documento de novo",
} as const;

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
    const { item, modo } = await pedirObrigacao(rota.ctx, id);
    await registrarAto(rota, {
      acao: "obrigacao.pedida",
      item,
      porque: PORQUE[modo],
      metadata: { modo, pedido_em: item.pedido_em, prazo_em: item.prazo_em },
    });
    const [naTela] = await paraATela(rota.supabase, rota.orgId, [item]);
    return ok({ item: naTela, modo, hoje: rota.hoje }, { requestId });
  } catch (err) {
    return respostaDoErro(err, rota);
  }
}
