/**
 * FORK MIA (.101) · POST /api/v1/admin/raio-x/[id]/encerrar — encerrar: desconecta,
 * para a leitura e a análise e agenda a exclusão das conversas (30 dias, ou o
 * prazo do relatório se for antes). O relatório e o aceite ficam.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { acaoEncerrar, fraseDaRecusa, statusDaRecusa } from "@/lib/raio-x/acoes";
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
  const r = await acaoEncerrar(createAdminClient(), id, ator);
  if (!r.ok) return fail("conflict", fraseDaRecusa(r), statusDaRecusa(r), { requestId });
  if (!r.jaEstava) {
    void audit({
      action: "raio_x.encerrado",
      actorUserId: ator,
      actingAsPlatformAdmin: true,
      resourceType: "mia_raio_x",
      resourceId: id,
      requestId,
      metadata: { falha_no_leitor: r.falhaNoLeitor, apagar_conversas_em: r.apagarConversasEm, via: "tela" },
    });
  }
  return ok({ ja_estava: r.jaEstava, apagar_conversas_em: r.apagarConversasEm }, { requestId });
}
