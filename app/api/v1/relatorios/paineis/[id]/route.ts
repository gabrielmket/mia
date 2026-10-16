/**
 * FORK MIA (item 9) — GET/PATCH/DELETE /api/v1/relatorios/paineis/[id]
 *
 * Um painel do usuário: ler (com os itens e os relatórios que a pessoa vê),
 * mudar o nome, o período do painel ou compartilhar, e apagar. Quem criou e o
 * administrador mexem no compartilhado; compartilhar é de gestor e
 * administrador.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { podeCompartilhar, podeEditar } from "@/lib/relatorios/acesso";
import { PERIODOS_DO_PAINEL } from "@/lib/relatorios/catalogo";
import { contextoDaRota, lerCorpo, respostaDaRecusa } from "@/lib/relatorios/rota";
import { alterarPainel, apagarPainel, lerPainel } from "@/lib/relatorios/servidor";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const alterarSchema = z
  .object({
    nome: z.string().trim().min(1).max(80).optional(),
    periodo: z.enum(PERIODOS_DO_PAINEL).optional(),
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
  if (!UUID.test(id)) return fail("not_found", ctx.t("Painel não encontrado."), 404, { requestId });
  try {
    const painel = await lerPainel(ctx.db, ctx.quem.organizationId, id);
    if (!painel) return fail("not_found", ctx.t("Painel não encontrado."), 404, { requestId });
    return ok({ painel: { ...painel, podeEditar: podeEditar(painel, { userId: ctx.quem.userId ?? "", role: ctx.role }) } }, { requestId });
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
  if (!UUID.test(id)) return fail("not_found", ctx.t("Painel não encontrado."), 404, { requestId });
  const corpo = await lerCorpo(req, alterarSchema, ctx.t, requestId);
  if (!corpo.ok) return corpo.response;
  if (corpo.dados.compartilhado === true && !podeCompartilhar(ctx.role)) {
    return fail("forbidden", ctx.t("Só gestor e administrador compartilham com a equipe."), 403, { requestId });
  }
  try {
    const painel = await alterarPainel(ctx.db, ctx.quem, id, corpo.dados);
    return ok({ painel }, { requestId });
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
  if (!UUID.test(id)) return fail("not_found", ctx.t("Painel não encontrado."), 404, { requestId });
  try {
    await apagarPainel(ctx.db, ctx.quem, id);
    return ok({ apagado: true }, { requestId });
  } catch (e) {
    return respostaDaRecusa(e, ctx.t, requestId);
  }
}
