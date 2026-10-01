/**
 * FORK MIA — GET /api/v1/contacts/[id]/ficha — a FICHA CONECTADA do contato.
 *
 * Empresa (com cargo, papel e principal), negócios (os dele e aqueles em que está
 * envolvido), conversas, resumo e memória da IA, agenda e histórico de compras
 * (dele, e a soma da empresa). Montagem em `lib/cartoes/fichas-servidor.ts`.
 * Só leitura (viewer+); organização do cookie, nunca do corpo.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { montarFichaDoContato } from "@/lib/cartoes/fichas-servidor";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  const supabase = await createClient();
  try {
    const ficha = await montarFichaDoContato(supabase, authz.org.orgId, id);
    if (!ficha) return fail("not_found", t("Contato não encontrado."), 404, { requestId });
    return ok(ficha, { requestId });
  } catch (err) {
    return fail("internal_error", err instanceof Error ? err.message : String(err), 500, { requestId });
  }
}
