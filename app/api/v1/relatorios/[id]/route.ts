/**
 * FORK MIA (item 9) — GET/PATCH/DELETE /api/v1/relatorios/[id]
 *
 * Ler, alterar (nome, configuração, compartilhar) e apagar um relatório salvo.
 * Quem criou e o administrador mexem no compartilhado; os outros copiam (a RLS
 * da 9040 dá zero linhas, e a resposta diz "copie para mexer"). Compartilhar é
 * de gestor e administrador.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { podeCompartilhar, podeEditar } from "@/lib/relatorios/acesso";
import { configDoRelatorioSchema, type ConfigDoRelatorio } from "@/lib/relatorios/config";
import { contextoDaRota, lerCorpo, respostaDaRecusa } from "@/lib/relatorios/rota";
import { alterarRelatorio, apagarRelatorio, lerRelatorio } from "@/lib/relatorios/servidor";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const alterarSchema = z
  .object({
    nome: z.string().trim().min(1).max(80).optional(),
    config: configDoRelatorioSchema.optional(),
    compartilhado: z.boolean().optional(),
  })
  .strict();

type Rota = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, rota: Rota): Promise<Response> {
  const requestId = randomUUID();
  const r = await contextoDaRota(requestId);
  if (!r.ok) return r.response;
  const { ctx } = r;
  const { id } = await rota.params;
  if (!UUID.test(id)) return fail("not_found", ctx.t("Relatório não encontrado."), 404, { requestId });
  try {
    const relatorio = await lerRelatorio(ctx.db, ctx.quem.organizationId, id);
    if (!relatorio) return fail("not_found", ctx.t("Relatório não encontrado."), 404, { requestId });
    return ok(
      { relatorio: { ...relatorio, podeEditar: podeEditar(relatorio, { userId: ctx.quem.userId ?? "", role: ctx.role }) } },
      { requestId },
    );
  } catch (e) {
    return respostaDaRecusa(e, ctx.t, requestId);
  }
}

export async function PATCH(req: NextRequest, rota: Rota): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const r = await contextoDaRota(requestId);
  if (!r.ok) return r.response;
  const { ctx } = r;
  const { id } = await rota.params;
  if (!UUID.test(id)) return fail("not_found", ctx.t("Relatório não encontrado."), 404, { requestId });
  const corpo = await lerCorpo(req, alterarSchema, ctx.t, requestId);
  if (!corpo.ok) return corpo.response;
  const d = corpo.dados;
  if (d.compartilhado === true && !podeCompartilhar(ctx.role)) {
    return fail("forbidden", ctx.t("Só gestor e administrador compartilham com a equipe."), 403, { requestId });
  }
  try {
    const relatorio = await alterarRelatorio(ctx.db, ctx.quem, id, {
      nome: d.nome,
      config: d.config as ConfigDoRelatorio | undefined,
      compartilhado: d.compartilhado,
    });
    return ok({ relatorio }, { requestId });
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
  const { id } = await rota.params;
  if (!UUID.test(id)) return fail("not_found", ctx.t("Relatório não encontrado."), 404, { requestId });
  try {
    await apagarRelatorio(ctx.db, ctx.quem, id);
    return ok({ apagado: true }, { requestId });
  } catch (e) {
    return respostaDaRecusa(e, ctx.t, requestId);
  }
}
