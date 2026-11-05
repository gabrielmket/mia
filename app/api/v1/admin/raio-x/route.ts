/**
 * FORK MIA (.101) · GET e POST /api/v1/admin/raio-x — Admin › Raio-X do
 * atendimento (docs/fork/raio-x-do-atendimento.md). GET lista; POST cadastra e
 * devolve o link de conexão (48 h) e a mensagem pronta para mandar ao dono. Só
 * quem administra a plataforma, com a verificação em duas etapas.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { acaoCriar, fraseDaRecusa, statusDaRecusa } from "@/lib/raio-x/acoes";
import { listarRaioX } from "@/lib/raio-x/banco";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  return ok({ raio_x: await listarRaioX(createAdminClient()) }, { requestId });
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
  const r = await acaoCriar(createAdminClient(), await req.json().catch(() => null), ator, "tela");
  if (!r.ok) {
    return fail("validation_failed", fraseDaRecusa(r), statusDaRecusa(r), {
      requestId,
      ...(r.motivo === "invalido" ? { details: { campos: r.campos } } : {}),
    });
  }
  void audit({
    action: "raio_x.criado",
    actorUserId: ator,
    actingAsPlatformAdmin: true,
    resourceType: "mia_raio_x",
    resourceId: r.id,
    requestId,
    metadata: { via: "tela" },
  });
  return ok({ id: r.id, link: r.link, expira_em: r.expiraEm, mensagem: r.mensagem }, { requestId, status: 201 });
}
