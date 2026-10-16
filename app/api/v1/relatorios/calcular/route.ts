/**
 * FORK MIA (item 9) — POST /api/v1/relatorios/calcular
 *
 * A prévia do editor e cada relatório do painel: a configuração vira UMA
 * pergunta ao motor (`fn_mia_relatorio`, `security invoker`) pela SESSÃO — o
 * atendente vê os números do que já vê no CRM. Volta a resposta do motor, o
 * nome de quem aparece como grupo (responsável, profissional) e a configuração
 * depois das regras automáticas (o funil, o motivo de perda). Só lê.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok } from "@/lib/api/wrappers";
import { PERIODOS_DO_MONTADOR } from "@/lib/relatorios/catalogo";
import { configDoRelatorioSchema, normalizarConfig, type ConfigDoRelatorio } from "@/lib/relatorios/config";
import { contextoDaRota, lerCorpo, respostaDaRecusa } from "@/lib/relatorios/rota";
import { calcularRelatorio } from "@/lib/relatorios/servidor";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    config: configDoRelatorioSchema,
    /** O período do painel, que troca o do relatório (quem não marcou "período próprio"). */
    periodo: z.enum(PERIODOS_DO_MONTADOR).nullish(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const r = await contextoDaRota(requestId);
  if (!r.ok) return r.response;
  const { ctx } = r;
  const corpo = await lerCorpo(req, schema, ctx.t, requestId);
  if (!corpo.ok) return corpo.response;
  const config = corpo.dados.config as ConfigDoRelatorio;
  try {
    const { avisos } = normalizarConfig(config, { valores: ctx.valores, funilPadrao: ctx.funilPadrao });
    const calculado = await calcularRelatorio(ctx.db, ctx.admin, {
      organizationId: ctx.quem.organizationId,
      config,
      valores: ctx.valores,
      funilPadrao: ctx.funilPadrao,
      periodo: corpo.dados.periodo ?? null,
    });
    return ok({ ...calculado, avisos }, { requestId });
  } catch (e) {
    return respostaDaRecusa(e, ctx.t, requestId);
  }
}
