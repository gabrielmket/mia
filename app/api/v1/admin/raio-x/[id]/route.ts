/**
 * FORK MIA (.101) · GET e PATCH /api/v1/admin/raio-x/[id] — o detalhe do raio-X
 * (andamento, aceite, relatórios, links do dono, custo) e o que se muda depois de
 * criado: ligar a empresa da MIA (quando ela vira cliente) e o teto de custo.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { acaoAlterar, acaoVer, fraseDaRecusa, statusDaRecusa } from "@/lib/raio-x/acoes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Contexto) {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return fail("not_found", "Raio-X não encontrado", 404, { requestId });
  const detalhe = await acaoVer(createAdminClient(), id);
  if (!detalhe) return fail("not_found", "Raio-X não encontrado", 404, { requestId });
  return ok(detalhe, { requestId });
}

export async function PATCH(req: NextRequest, { params }: Contexto) {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  let ator: string;
  try {
    ator = (await requirePlatformAdminEscrita()).user.id;
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return fail("not_found", "Raio-X não encontrado", 404, { requestId });
  const r = await acaoAlterar(createAdminClient(), id, await req.json().catch(() => null));
  if (!r.ok) return fail("validation_failed", fraseDaRecusa(r), statusDaRecusa(r), { requestId });
  if (r.mudou.length > 0) {
    void audit({
      action: "raio_x.alterado",
      actorUserId: ator,
      actingAsPlatformAdmin: true,
      resourceType: "mia_raio_x",
      resourceId: id,
      requestId,
      metadata: { campos: r.mudou },
    });
  }
  return ok({ mudou: r.mudou }, { requestId });
}
