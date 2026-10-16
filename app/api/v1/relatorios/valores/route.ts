/**
 * FORK MIA (item 9) — POST /api/v1/relatorios/valores
 *
 * O que dá para escolher num filtro do editor: os valores que existem no
 * período, com quantos registros cada um tem, contados pelo mesmo motor e pela
 * mesma RLS (o atendente vê os valores dos registros dele). O funil é a lista
 * dos funis da empresa. Só lê.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { DIMENSOES, type Dimensao } from "@/lib/paineis/catalogo";
import { filtrosDaFonte } from "@/lib/relatorios/catalogo";
import { configDoRelatorioSchema, type ConfigDoRelatorio } from "@/lib/relatorios/config";
import { contextoDaRota, lerCorpo, respostaDaRecusa } from "@/lib/relatorios/rota";
import { valoresDoFiltro } from "@/lib/relatorios/servidor";

export const dynamic = "force-dynamic";

const schema = z.object({ config: configDoRelatorioSchema, filtro: z.enum(DIMENSOES) }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const r = await contextoDaRota(requestId);
  if (!r.ok) return r.response;
  const { ctx } = r;
  const corpo = await lerCorpo(req, schema, ctx.t, requestId);
  if (!corpo.ok) return corpo.response;
  const config = corpo.dados.config as ConfigDoRelatorio;
  const filtro = corpo.dados.filtro as Dimensao;
  if (!filtrosDaFonte(config.fonte).includes(filtro)) {
    return fail("validation_failed", ctx.t("Esse filtro não existe nesta fonte."), 422, { requestId });
  }
  try {
    const valores = await valoresDoFiltro(ctx.db, ctx.admin, {
      organizationId: ctx.quem.organizationId,
      config,
      filtro,
      funilPadrao: ctx.funilPadrao,
    });
    return ok({ valores }, { requestId });
  } catch (e) {
    return respostaDaRecusa(e, ctx.t, requestId);
  }
}
