/**
 * FORK MIA (.98) · GET e PUT /api/v1/admin/cobranca/comissao: a alíquota do
 * Simples (um campo só, para todo o sistema) e os dias do calendário do repasse.
 * Admin › Cobrança › Conexão. Mudar a alíquota vale para os pagamentos seguintes
 * (cada comissão grava a dela). Escrita de dono da instalação, com a verificação
 * em duas etapas (`requirePlatformAdminEscrita`).
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { gravarConfiguracaoDaComissao, lerConfiguracaoDaComissao } from "@/lib/parceiros/configuracao";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  return ok({ configuracao: await lerConfiguracaoDaComissao(createAdminClient()) }, { requestId });
}

export async function PUT(req: Request) {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  let ator: string;
  try {
    ator = (await requirePlatformAdminEscrita()).user.id;
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const corpo = await req.json().catch(() => null);
  const r = await gravarConfiguracaoDaComissao(createAdminClient(), corpo, ator);
  if (!r.ok) {
    if (r.motivo === "ordem_dos_dias") return fail("validation_failed", "Os dias precisam estar em ordem: fechamento, nota e Pix.", 400, { requestId });
    if (r.motivo === "invalida") return fail("validation_failed", "Confira a alíquota (de 0 a 100%) e os dias (de 1 a 28).", 400, { requestId });
    return fail("internal_error", "Não foi possível salvar. Tente de novo.", 500, { requestId });
  }
  void audit({
    action: "parceiros.configuracao_gravada",
    actorUserId: ator,
    actingAsPlatformAdmin: true,
    resourceType: "platform_config",
    requestId,
    metadata: { ...r.config },
  });
  return ok({ configuracao: r.config }, { requestId });
}
