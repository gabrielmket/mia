/**
 * FORK MIA (item 9) — POST /api/v1/relatorios/lista
 *
 * "O que está por trás do número" (protótipo, tela 4): os registros de um
 * grupo, de uma célula, de "Outros" ou de uma etapa do funil, com o MESMO
 * pedido do gráfico e a mesma conta no topo (`fn_mia_relatorio_lista`, 9041),
 * pela SESSÃO (a RLS de quem pergunta). Página de 50; o nome de quem é da
 * equipe vem junto. Só lê.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { PAGINA_DA_LISTA } from "@/lib/relatorios/catalogo";
import type { ConfigDoRelatorio } from "@/lib/relatorios/config";
import { contextoDaRota, lerCorpo, respostaDaRecusa } from "@/lib/relatorios/rota";
import { pedidoDaListaSchema } from "@/lib/relatorios/schemas";
import { listaPorTras } from "@/lib/relatorios/servidor";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const r = await contextoDaRota(requestId);
  if (!r.ok) return r.response;
  const { ctx } = r;
  const corpo = await lerCorpo(req, pedidoDaListaSchema, ctx.t, requestId);
  if (!corpo.ok) return corpo.response;
  const d = corpo.dados;
  try {
    const resultado = await listaPorTras(ctx.db, ctx.admin, {
      organizationId: ctx.quem.organizationId,
      config: d.config as ConfigDoRelatorio,
      valores: ctx.valores,
      funilPadrao: ctx.funilPadrao,
      periodo: d.periodo ?? null,
      chave1: d.chave1 ?? null,
      chave2: d.chave2 ?? null,
      dobrados1: d.dobrados1 ?? null,
      dobrados2: d.dobrados2 ?? null,
      funil: d.funil ?? false,
      deslocamento: d.deslocamento ?? 0,
      limite: d.limite ?? PAGINA_DA_LISTA,
    });
    return ok(resultado, { requestId });
  } catch (e) {
    return respostaDaRecusa(e, ctx.t, requestId);
  }
}
