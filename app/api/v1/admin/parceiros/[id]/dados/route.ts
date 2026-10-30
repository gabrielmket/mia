/**
 * FORK MIA (.98) · GET /api/v1/admin/parceiros/[id]/dados: a cópia dos dados do
 * parceiro (LGPD, o acesso do titular): o cadastro, os cupons, as empresas que
 * vieram por ele, as comissões e os repasses, em JSON para baixar. Traz o
 * documento e o Pix, então pede a verificação em duas etapas e fica na auditoria.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { exportarDadosDoParceiro } from "@/lib/lgpd/export-collector";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
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
  const dados = await exportarDadosDoParceiro(admin, id);
  if (!dados) return fail("not_found", "Parceiro não encontrado.", 404, { requestId });
  void audit({
    action: "parceiro.exportado",
    actorUserId: ator,
    actingAsPlatformAdmin: true,
    resourceType: "mia_parceiros",
    resourceId: id,
    requestId,
  });
  return new Response(JSON.stringify(dados, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="parceiro-${id}.json"`,
      "cache-control": "no-store",
    },
  });
}
