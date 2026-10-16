import { type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { enrichCompanyHandler } from "@/lib/crm-b2b/companies-handler";
import {
  ctxFromAuthz,
  fail,
  handleRouteError,
  ok,
  requestIdOf,
  seModuloB2bDesligado,
} from "@/lib/crm-b2b/route-helpers";
import { createClient } from "@/lib/supabase/server";
import { receitaTravada } from "@/lib/empresas/receita";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/v1/companies/:id/enrich — reprocessa BrasilAPI (manager+). */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const requestId = requestIdOf(req);
  const desligado = await seModuloB2bDesligado(requestId);
  if (desligado) return desligado;
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const authz = await requireRole("manager", { requestId, resource: "companies" });
  if (!authz.ok) return authz.response;
  const { id } = await params;

  try {
    const supabase = await createClient();
    // FORK MIA (.79, empresa única): empresa de DEMONSTRAÇÃO não consulta a
    // Receita (nada sai de lá, migration 9010; protótipo aprovado em 15/10/2026).
    if (await receitaTravada(supabase, authz.org.orgId)) {
      return fail("organizacao_de_demonstracao", "Esta é a empresa de demonstração: a consulta à Receita fica desligada.", 403, { requestId });
    }
    const data = await enrichCompanyHandler(
      supabase,
      ctxFromAuthz(authz, requestId),
      authz.user.id,
      id,
    );
    return ok(data, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
