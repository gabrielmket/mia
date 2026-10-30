/**
 * FORK MIA (.98) · GET e POST /api/v1/admin/cupons: Admin › Cupons (protótipo
 * "Cupons e parceiros", tela 2). POST cria ou muda pelo CÓDIGO: mudar um cupom já
 * usado vale para quem entrar daqui para a frente. Escrita com a verificação em
 * duas etapas. Com a cobrança desligada, 404: cupom e parceiro só existem com ela.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { garantirCupom, lerCupons } from "@/lib/cupons/banco";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const admin = createAdminClient();
  if (!(await moduloLigado(admin, "cobranca"))) return fail("not_found", "Not found", 404, { requestId });
  return ok({ cupons: await lerCupons(admin) }, { requestId });
}

export async function POST(req: Request) {
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
  if (!(await moduloLigado(admin, "cobranca"))) return fail("not_found", "Not found", 404, { requestId });
  const r = await garantirCupom(admin, await req.json().catch(() => null), ator);
  if (!r.ok) {
    if (r.motivo === "invalido") return fail("validation_failed", "Confira os campos do cupom.", 400, { requestId, details: { campos: r.campos } });
    if (r.motivo === "plano_inexistente") return fail("validation_failed", "Um dos planos não existe mais.", 400, { requestId });
    if (r.motivo === "parceiro_inexistente") return fail("validation_failed", "O parceiro não existe mais.", 400, { requestId });
    return fail("internal_error", "Não foi possível salvar o cupom. Tente de novo.", 500, { requestId });
  }
  if (r.mudou) {
    void audit({
      action: r.criado ? "cupom.criado" : "cupom.alterado",
      actorUserId: ator,
      actingAsPlatformAdmin: true,
      resourceType: "mia_cupons",
      resourceId: r.cupom.id,
      requestId,
      metadata: { codigo: r.cupom.codigo, beneficio: r.cupom.beneficio, valor: r.cupom.valor, meses: r.cupom.meses, parceiro_id: r.cupom.parceiro_id },
    });
  }
  return ok({ cupom: r.cupom, criado: r.criado, mudou: r.mudou }, { requestId });
}
