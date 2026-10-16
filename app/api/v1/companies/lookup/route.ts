import { type NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { lookupCompanyCnpjHandler } from "@/lib/crm-b2b/companies-handler";
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

/**
 * GET /api/v1/companies/lookup?cnpj=...
 *
 * Consulta um CNPJ na BrasilAPI antes de criar — devolve os dados públicos
 * para a tela preencher e revisar. Não grava nada (leitura). Manager+, o
 * mesmo piso da criação e do reenriquecimento: cada clique sai para um
 * serviço de terceiro, e quem não pode criar não precisa consultar.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const requestId = requestIdOf(req);
  const desligado = await seModuloB2bDesligado(requestId);
  if (desligado) return desligado;
  const authz = await requireRole("manager", { requestId, resource: "companies" });
  if (!authz.ok) return authz.response;

  try {
    const cnpj = req.nextUrl.searchParams.get("cnpj") ?? "";
    const supabase = await createClient();
    // FORK MIA (.79, empresa única): empresa de DEMONSTRAÇÃO não consulta a
    // Receita (nada sai de lá, migration 9010; protótipo aprovado em 15/10/2026).
    if (await receitaTravada(supabase, authz.org.orgId)) {
      return fail("organizacao_de_demonstracao", "Esta é a empresa de demonstração: a consulta à Receita fica desligada.", 403, { requestId });
    }
    const data = await lookupCompanyCnpjHandler(supabase, ctxFromAuthz(authz, requestId), { cnpj });
    return ok(data, { requestId });
  } catch (e) {
    return handleRouteError(e, requestId);
  }
}
