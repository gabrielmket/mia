/**
 * FORK MIA (.101) · POST e DELETE /api/v1/admin/raio-x/[id]/link-do-dono — o
 * link do relatório para o dono (molde do link dos painéis, 9031): abre sem
 * login, vale 7, 30 ou 90 dias e pode ser desligado. Só de relatório REVISADO.
 * Sem custo, sem o bloco "o que a MIA resolveria" e sem as anotações da Time.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { acaoGerarLinkDoDono, acaoRevogarLinkDoDono, fraseDaRecusa, statusDaRecusa } from "@/lib/raio-x/acoes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

const gerarSchema = z.strictObject({
  relatorio_id: z.string().uuid().nullable().optional(),
  dias: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
});
const revogarSchema = z.strictObject({ link_id: z.string().uuid() });

export async function POST(req: NextRequest, { params }: Contexto) {
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
  const corpo = gerarSchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!corpo.success) return fail("validation_failed", "Pedido inválido", 400, { requestId });
  const r = await acaoGerarLinkDoDono(createAdminClient(), id, corpo.data.relatorio_id ?? null, corpo.data.dias, ator, "tela");
  if (!r.ok) return fail("conflict", fraseDaRecusa(r), statusDaRecusa(r), { requestId });
  void audit({
    action: "raio_x.link_do_dono_gerado",
    actorUserId: ator,
    actingAsPlatformAdmin: true,
    resourceType: "mia_raio_x_links",
    resourceId: r.link.id,
    requestId,
    metadata: { raio_x_id: id, relatorio_id: r.relatorioId, valido_ate: r.link.validoAte, via: "tela" },
  });
  return ok({ link: r.link }, { requestId, status: 201 });
}

export async function DELETE(req: NextRequest, { params }: Contexto) {
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
  const corpo = revogarSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", "Pedido inválido", 400, { requestId });
  const r = await acaoRevogarLinkDoDono(createAdminClient(), id, corpo.data.link_id, ator);
  if (!r.ok) return fail("conflict", fraseDaRecusa(r), statusDaRecusa(r), { requestId });
  void audit({
    action: "raio_x.link_do_dono_revogado",
    actorUserId: ator,
    actingAsPlatformAdmin: true,
    resourceType: "mia_raio_x_links",
    resourceId: r.link.id,
    requestId,
    metadata: { raio_x_id: id, via: "tela" },
  });
  return ok({ link: r.link }, { requestId });
}
