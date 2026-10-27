/**
 * FORK MIA (.96) · POST /api/v1/cobranca/pagamento-inicial/conferir: a conferência da
 * tela, ao abrir e a cada poucos segundos com ela aberta. Lê a cobrança direto
 * no Asaas, no máximo uma vez a cada poucos segundos por empresa; paga, roda a
 * releitura do upstream, que libera a conta. Quem não administra só lê.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { conferirPagamento } from "@/lib/pagamento-inicial/servico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST() {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "mia_pagamento_inicial", permiteOrgSuspensa: true });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  if (!(await moduloLigado(admin, "cobranca"))) return fail("not_found", "Not found", 404, { requestId });
  const passo = await conferirPagamento(admin, authz.org.orgId, { podePagar: roleAtLeast(authz.org.role, "admin") });
  return ok({ passo }, { requestId });
}
