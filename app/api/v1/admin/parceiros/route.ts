/**
 * FORK MIA (.98) · GET e POST /api/v1/admin/parceiros: Admin › Parceiros
 * (protótipo "Cupons e parceiros", tela 3). Os dados do parceiro só a Time vê.
 * POST cria, ou muda pelo documento. Mudar a comissão vale só para os clientes
 * novos (quem já pagou tem a dele fixada). Escrita com a verificação em duas
 * etapas; a auditoria nunca leva o documento nem o Pix.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { garantirParceiro } from "@/lib/parceiros/banco";
import { lerParceirosParaATela } from "@/lib/parceiros/leitura";
import { createAdminClient } from "@/lib/supabase/admin";

import { respostaDoParceiro } from "./_resposta";

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
  return ok({ parceiros: await lerParceirosParaATela(admin) }, { requestId });
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
  const r = await garantirParceiro(admin, await req.json().catch(() => null), { ator });
  if (r.ok && r.mudou) {
    void audit({
      action: r.criado ? "parceiro.criado" : "parceiro.alterado",
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
