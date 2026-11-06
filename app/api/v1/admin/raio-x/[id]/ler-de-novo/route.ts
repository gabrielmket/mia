/**
 * FORK MIA (.105) · POST /api/v1/admin/raio-x/[id]/ler-de-novo — "Ler de novo":
 * o raio-X pronto cujo WhatsApp segue conectado volta a ler (o rascunho deste
 * período sai). O mesmo caminho do MCP (`plataforma_reler_raio_x`), por
 * `acaoLerDeNovo`, que confere se pode.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { acaoLerDeNovo, fraseDaRecusa, statusDaRecusa } from "@/lib/raio-x/acoes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

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
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return fail("not_found", "Raio-X não encontrado", 404, { requestId });
  const r = await acaoLerDeNovo(createAdminClient(), id);
  if (!r.ok) return fail("conflict", fraseDaRecusa(r), statusDaRecusa(r), { requestId });
  void audit({
    action: "raio_x.relido",
    actorUserId: ator,
    actingAsPlatformAdmin: true,
    resourceType: "mia_raio_x",
    resourceId: id,
    requestId,
    metadata: { rascunhos_descartados: r.descartados, via: "tela" },
  });
  return ok({ relendo: true, rascunhos_descartados: r.descartados }, { requestId });
}
