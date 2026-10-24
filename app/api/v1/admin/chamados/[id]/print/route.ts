/**
 * FORK MIA (.88) — GET /api/v1/admin/chamados/:id/print: o print do chamado para
 * a Time, por link assinado de 60 segundos.
 */
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { linkDoPrint } from "@/lib/assistente/print";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

async function exigirPlataforma(requestId: string) {
  try {
    return { ok: true as const, ctx: await requirePlatformAdmin() };
  } catch (err) {
    return { ok: false as const, resposta: falhaDaEscritaDePlatformAdmin(err, requestId) };
  }
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const acesso = await exigirPlataforma(requestId);
  if (!acesso.ok) return acesso.resposta;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return fail("not_found", "Chamado não encontrado.", 404, { requestId });

  const admin = createAdminClient();
  const { data } = await admin.from("mia_chamados").select("organization_id, print_path").eq("id", id).maybeSingle();
  const linha = data as { organization_id?: string; print_path?: string | null } | null;
  if (!linha?.print_path) return fail("not_found", "Este chamado não tem print.", 404, { requestId });
  if (!linha.organization_id || !linha.print_path.startsWith(`${linha.organization_id}/`)) {
    return fail("internal_error", "Erro ao abrir o print.", 500, { requestId });
  }
  const link = await linkDoPrint(admin, linha.print_path);
  if (!link) return fail("internal_error", "Erro ao abrir o print.", 500, { requestId });
  const resposta = NextResponse.redirect(link, 302);
  resposta.headers.set("X-Request-Id", requestId);
  resposta.headers.set("Cache-Control", "private, no-store");
  return resposta;
}
