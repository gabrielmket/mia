/**
 * FORK MIA (item 9) — PATCH/DELETE /api/v1/relatorios/paineis/[id]/itens/[itemId]
 *
 * O tamanho (P, M, G), o período próprio e a posição de um relatório no
 * painel (reordenar grava UM item: a posição é fracionária), e tirar do
 * painel. Quem criou o painel e o administrador (no compartilhado) mexem.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { TAMANHOS } from "@/lib/relatorios/catalogo";
import { contextoDaRota, lerCorpo, respostaDaRecusa } from "@/lib/relatorios/rota";
import { alterarItem, removerDoPainel } from "@/lib/relatorios/servidor";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z
  .object({
    tamanho: z.enum(TAMANHOS).optional(),
    periodo_proprio: z.boolean().optional(),
    posicao: z.number().finite().optional(),
  })
  .strict();

type Rota = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(req: NextRequest, rota: Rota): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const r = await contextoDaRota(requestId);
  if (!r.ok) return r.response;
  const { ctx } = r;
  const { id, itemId } = await rota.params;
  if (!UUID.test(id) || !UUID.test(itemId)) return fail("not_found", ctx.t("Painel não encontrado."), 404, { requestId });
  const corpo = await lerCorpo(req, schema, ctx.t, requestId);
  if (!corpo.ok) return corpo.response;
  try {
    await alterarItem(ctx.db, ctx.quem, id, itemId, {
      tamanho: corpo.dados.tamanho,
      periodoProprio: corpo.dados.periodo_proprio,
      posicao: corpo.dados.posicao,
    });
    return ok({ alterado: true }, { requestId });
  } catch (e) {
    return respostaDaRecusa(e, ctx.t, requestId);
  }
}

export async function DELETE(_req: NextRequest, rota: Rota): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const r = await contextoDaRota(requestId);
  if (!r.ok) return r.response;
  const { ctx } = r;
  const { id, itemId } = await rota.params;
  if (!UUID.test(id) || !UUID.test(itemId)) return fail("not_found", ctx.t("Painel não encontrado."), 404, { requestId });
  try {
    await removerDoPainel(ctx.db, ctx.quem, id, itemId);
    return ok({ removido: true }, { requestId });
  } catch (e) {
    return respostaDaRecusa(e, ctx.t, requestId);
  }
}
