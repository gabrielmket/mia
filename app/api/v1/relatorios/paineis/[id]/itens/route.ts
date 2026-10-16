/**
 * FORK MIA (item 9) — POST /api/v1/relatorios/paineis/[id]/itens
 *
 * Põe um relatório (salvo ou pronto) no fim do painel ("Adicionar a um
 * painel"). Quem não edita o painel é recusado pelo banco; só entra o
 * relatório que a pessoa enxerga; o mesmo relatório não entra duas vezes.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { PAINEIS_PRONTOS } from "@/lib/paineis/catalogo";
import { TAMANHOS } from "@/lib/relatorios/catalogo";
import { contextoDaRota, lerCorpo, respostaDaRecusa } from "@/lib/relatorios/rota";
import { adicionarAoPainel } from "@/lib/relatorios/servidor";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z
  .object({
    relatorio_id: z.string().uuid().nullish(),
    pronto: z.enum(PAINEIS_PRONTOS).nullish(),
    tamanho: z.enum(TAMANHOS).optional(),
    periodo_proprio: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.relatorio_id) !== Boolean(v.pronto), { message: "um relatório salvo OU um pronto" });

export async function POST(req: NextRequest, rota: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const r = await contextoDaRota(requestId);
  if (!r.ok) return r.response;
  const { ctx } = r;
  const { id } = await rota.params;
  if (!UUID.test(id)) return fail("not_found", ctx.t("Painel não encontrado."), 404, { requestId });
  const corpo = await lerCorpo(req, schema, ctx.t, requestId);
  if (!corpo.ok) return corpo.response;
  const d = corpo.dados;
  try {
    const item = await adicionarAoPainel(ctx.db, ctx.quem, id, {
      relatorioId: d.relatorio_id ?? null,
      pronto: d.pronto ?? null,
      tamanho: d.tamanho,
      periodoProprio: d.periodo_proprio,
    });
    return ok({ item }, { requestId, status: 201 });
  } catch (e) {
    return respostaDaRecusa(e, ctx.t, requestId);
  }
}
