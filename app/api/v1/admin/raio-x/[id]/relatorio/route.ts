/**
 * FORK MIA (.101) · POST /api/v1/admin/raio-x/[id]/relatorio — "Marcar como
 * revisado" (decisão 10): o rascunho vira revisado, com quem revisou, quando e
 * as anotações da Time (que o dono não vê). Só o revisado gera link do dono.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { acaoRevisar, fraseDaRecusa, statusDaRecusa } from "@/lib/raio-x/acoes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({
  relatorio_id: z.string().uuid().nullable().optional(),
  notas: z.string().max(4000).nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const corpo = corpoSchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!corpo.success) return fail("validation_failed", "Pedido inválido", 400, { requestId });
  const r = await acaoRevisar(createAdminClient(), id, corpo.data.relatorio_id ?? null, ator, corpo.data.notas ?? null);
  if (!r.ok) return fail("conflict", fraseDaRecusa(r), statusDaRecusa(r), { requestId });
  if (!r.jaEstava) {
    void audit({
      action: "raio_x.relatorio_revisado",
      actorUserId: ator,
      actingAsPlatformAdmin: true,
      resourceType: "mia_raio_x",
      resourceId: id,
      requestId,
      metadata: { relatorio_id: r.relatorioId, via: "tela" },
    });
  }
  return ok({ relatorio_id: r.relatorioId, ja_estava: r.jaEstava }, { requestId });
}
