/**
 * FORK MIA (.96) · GET /api/v1/pagamento-inicial: o passo "Pagamento" do início
 * da empresa da sessão (docs/fork/pagamento-no-inicio.md). Só lê. Todo membro
 * vê se a empresa espera o primeiro pagamento; os dados fiscais e os botões só
 * vão a quem administra. A empresa parada também lê (é ela quem paga).
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { lerPassoDoPagamento } from "@/lib/pagamento-inicial/servico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "mia_pagamento_inicial", permiteOrgSuspensa: true });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  if (!(await moduloLigado(admin, "cobranca"))) return fail("not_found", "Not found", 404, { requestId });
  try {
    const passo = await lerPassoDoPagamento(admin, authz.org.orgId, { podePagar: roleAtLeast(authz.org.role, "admin") });
    return ok({ passo }, { requestId });
  } catch {
    return fail("internal_error", "Não foi possível ler o pagamento.", 500, { requestId });
  }
}
