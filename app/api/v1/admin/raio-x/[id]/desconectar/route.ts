/**
 * FORK MIA (.101) · POST /api/v1/admin/raio-x/[id]/desconectar — "Desconectar
 * agora": a conexão cai agora (logout no aparelho e a sessão apagada no leitor,
 * com o acervo); as conversas apagam no prazo de 30 dias; o relatório fica.
 * Com a leitura no meio, o que já foi lido vira relatório.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { acaoDesconectar, fraseDaRecusa, statusDaRecusa } from "@/lib/raio-x/acoes";
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
  const r = await acaoDesconectar(createAdminClient(), id);
  if (!r.ok) return fail("conflict", fraseDaRecusa(r), statusDaRecusa(r), { requestId });
  void audit({
    action: "raio_x.desconectado",
    actorUserId: ator,
    actingAsPlatformAdmin: true,
    resourceType: "mia_raio_x",
    resourceId: id,
    requestId,
    metadata: { motivo: "pedido_da_time", falha_no_leitor: r.falhaNoLeitor, apagar_conversas_em: r.apagarConversasEm, via: "tela" },
  });
  return ok({ desconectou: r.desconectou, falha_no_leitor: r.falhaNoLeitor, apagar_conversas_em: r.apagarConversasEm }, { requestId });
}
