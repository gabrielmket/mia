/**
 * FORK MIA (.101) · POST /api/v1/admin/raio-x/[id]/link-de-conexao — "Gerar
 * outro link": o código muda (o anterior deixa de valer) e o link ganha mais 48
 * horas. Devolve o link e a mensagem pronta.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { acaoGerarOutroLink, fraseDaRecusa, statusDaRecusa } from "@/lib/raio-x/acoes";
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
  const r = await acaoGerarOutroLink(createAdminClient(), id);
  if (!r.ok) return fail("conflict", fraseDaRecusa(r), statusDaRecusa(r), { requestId });
  void audit({
    action: "raio_x.link_de_conexao_gerado",
    actorUserId: ator,
    actingAsPlatformAdmin: true,
    resourceType: "mia_raio_x",
    resourceId: id,
    requestId,
    metadata: { expira_em: r.expiraEm, via: "tela" },
  });
  return ok({ link: r.link, expira_em: r.expiraEm, mensagem: r.mensagem }, { requestId });
}
