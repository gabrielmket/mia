/**
 * FORK MIA (.98) · PUT /api/v1/admin/parceiros/[id]: mudar um parceiro, inclusive
 * o documento (desde que não seja de outro). Mudar a comissão vale só para os
 * clientes novos. Escrita com a verificação em duas etapas.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { garantirParceiro } from "@/lib/parceiros/banco";
import { createAdminClient } from "@/lib/supabase/admin";

import { respostaDoParceiro } from "../_resposta";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const r = await garantirParceiro(admin, await req.json().catch(() => null), { ator, id });
  if (r.ok && r.mudou) {
    void audit({
      action: "parceiro.alterado",
      actorUserId: ator,
      actingAsPlatformAdmin: true,
      resourceType: "mia_parceiros",
      resourceId: r.parceiro.id,
      requestId,
      metadata: { comissao_pct: r.parceiro.comissao_pct, comissao_meses: r.parceiro.comissao_meses, comissao_setup_pct: r.parceiro.comissao_setup_pct },
    });
  }
  return respostaDoParceiro(r, requestId);
}
