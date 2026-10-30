/**
 * FORK MIA (.98) · POST /api/v1/admin/repasses/[id]/pago: a Time fez o Pix por fora
 * e marca como pago (a data e quem marcou). Sem a nota ou o recibo anexado, recusa
 * (o banco também recusa, CHECK da 9132). O sistema nunca manda dinheiro (decisão
 * 3). Escrita com a verificação em duas etapas.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { marcarRepassePago } from "@/lib/parceiros/repasses";
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
    return fail("not_found", "Repasse não encontrado.", 404, { requestId });
  }
  const r = await marcarRepassePago(admin, { repasseId: id, ator });
  if (!r.ok) {
    if (r.motivo === "nao_encontrado") return fail("not_found", "Repasse não encontrado.", 404, { requestId });
    if (r.motivo === "sem_anexo") return fail("conflict", "Anexe a nota ou o recibo antes de marcar como pago.", 409, { requestId });
    return fail("internal_error", "Não foi possível marcar como pago. Tente de novo.", 500, { requestId });
  }
  if (!r.jaEstava) {
    void audit({
      action: "repasse.marcado_pago",
      actorUserId: ator,
      actingAsPlatformAdmin: true,
      resourceType: "mia_repasses",
      resourceId: id,
      requestId,
      metadata: { total_cents: r.repasse.total_cents, competencia: r.repasse.competencia, parceiro_id: r.repasse.parceiro_id },
    });
  }
  return ok({ repasse: r.repasse, ja_estava: r.jaEstava }, { requestId });
}
