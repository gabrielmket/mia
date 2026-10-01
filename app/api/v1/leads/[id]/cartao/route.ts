/**
 * FORK MIA — GET /api/v1/leads/[id]/cartao
 *
 * O CARTÃO ABERTO numa ida ao servidor: dias por etapa, resumo da IA, origem e
 * conversões enviadas, pessoas envolvidas, outros negócios da pessoa, empresa,
 * histórico de compras e agenda do negócio. Montagem em
 * `lib/cartoes/cartao-aberto-servidor.ts`; o formato em `cartao-aberto.ts`.
 *
 * Só leitura (viewer+). O negócio é resolvido pela RLS do usuário E pela
 * organização ativa do cookie — nunca pelo corpo. A leitura das conversões usa o
 * cliente de serviço (a tabela é livro-razão sem policy de sessão), filtrada pela
 * organização do cookie e pelo negócio que a RLS já provou ser dela.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { isServiceRoleConfigured } from "@/lib/audit";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { montarCartaoAberto } from "@/lib/cartoes/cartao-aberto-servidor";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;

  const supabase = await createClient();
  const admin = isServiceRoleConfigured() ? createAdminClient() : null;
  try {
    const cartao = await montarCartaoAberto(supabase, admin, authz.org.orgId, id);
    if (!cartao) return fail("not_found", t("Negócio não encontrado."), 404, { requestId });
    return ok(cartao, { requestId });
  } catch (err) {
    return fail("internal_error", err instanceof Error ? err.message : String(err), 500, { requestId });
  }
}
