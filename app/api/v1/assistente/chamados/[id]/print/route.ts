/**
 * FORK MIA (.88) — GET /api/v1/assistente/chamados/:id/print: o print do chamado,
 * por link assinado de 60 segundos (redirect 302).
 *
 * Quem pode ver o chamado decide a RLS da 9050, pela SESSÃO (quem abriu e o
 * administrador da empresa). Só depois de a sessão achar o chamado o cliente de
 * serviço assina o link, e a chave tem de estar na pasta da empresa.
 */
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { linkDoPrint } from "@/lib/assistente/print";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "mia_chamados" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", t("Chamado não encontrado."), 404, { requestId });
  }

  const db = await createClient();
  const { data } = await db
    .from("mia_chamados")
    .select("print_path")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  const caminho = (data as { print_path?: string | null } | null)?.print_path ?? null;
  if (!caminho) return fail("not_found", t("Este chamado não tem print."), 404, { requestId });
  if (!caminho.startsWith(`${authz.org.orgId}/`)) {
    return fail("internal_error", t("Erro ao abrir o print."), 500, { requestId });
  }

  const link = await linkDoPrint(createAdminClient(), caminho);
  if (!link) return fail("internal_error", t("Erro ao abrir o print."), 500, { requestId });
  const resposta = NextResponse.redirect(link, 302);
  resposta.headers.set("X-Request-Id", requestId);
  resposta.headers.set("Cache-Control", "private, no-store");
  return resposta;
}
