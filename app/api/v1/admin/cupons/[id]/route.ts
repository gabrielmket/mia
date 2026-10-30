/**
 * FORK MIA (.98) · PATCH /api/v1/admin/cupons/[id]: pausar ou ativar. Cupom não se
 * apaga (decisão do protótipo): quem entrou com ele continua com o desconto
 * combinado e o parceiro com a comissão. Escrita com a verificação em duas etapas.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { mudarSituacaoDoCupom } from "@/lib/cupons/banco";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

const corpoSchema = z.strictObject({ ativo: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    return fail("not_found", "Cupom não encontrado", 404, { requestId });
  }
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", "Pedido inválido", 400, { requestId });
  const cupom = await mudarSituacaoDoCupom(admin, id, corpo.data.ativo, ator);
  if (!cupom) return fail("not_found", "Cupom não encontrado", 404, { requestId });
  void audit({
    action: corpo.data.ativo ? "cupom.ativado" : "cupom.pausado",
    actorUserId: ator,
    actingAsPlatformAdmin: true,
    resourceType: "mia_cupons",
    resourceId: cupom.id,
    requestId,
    metadata: { codigo: cupom.codigo },
  });
  return ok({ cupom }, { requestId });
}
