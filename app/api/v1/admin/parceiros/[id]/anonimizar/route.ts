/**
 * FORK MIA (.98) · POST /api/v1/admin/parceiros/[id]/anonimizar: o pedido do
 * titular (LGPD). Apaga nome, documento, e-mail e Pix, pausa o parceiro e tira os
 * anexos dos repasses (o arquivo sai do armazenamento). Os valores ficam, como
 * registro financeiro. Definitivo: pede a confirmação na tela e a verificação em
 * duas etapas, e fica na auditoria.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { anonimizarParceiro } from "@/lib/parceiros/banco";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  let ator: string;
  try {
    ator = (await requirePlatformAdminEscrita()).user.id;
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const admin = createAdminClient();
  const { id } = await params;
  if (!(await moduloLigado(admin, "cobranca")) || !z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Parceiro não encontrado.", 404, { requestId });
  }
  const r = await anonimizarParceiro(admin, id, ator);
  if (!r.ok) {
    if (r.motivo === "nao_encontrado") return fail("not_found", "Parceiro não encontrado.", 404, { requestId });
    if (r.motivo === "arquivo_nao_saiu") return fail("internal_error", "Um anexo não saiu do armazenamento. Nada foi apagado: tente de novo.", 502, { requestId });
    return fail("internal_error", "Não foi possível anonimizar. Tente de novo.", 500, { requestId });
  }
  void audit({
    action: "parceiro.anonimizado",
    actorUserId: ator,
    actingAsPlatformAdmin: true,
    resourceType: "mia_parceiros",
    resourceId: id,
    requestId,
    metadata: { anexos_removidos: r.anexos },
  });
  return ok({ anonimizado: true, anexos_removidos: r.anexos }, { requestId });
}
