/**
 * FORK MIA (.96) · O QUE AS ROTAS DO PASSO "PAGAMENTO" TÊM EM COMUM
 * (`app/api/v1/pagamento-inicial/**`).
 *
 * A empresa que espera o primeiro pagamento está SUSPENSA (o gatilho da entrada
 * paga do upstream): as rotas daqui aceitam a empresa parada
 * (`permiteOrgSuspensa`), como as da cobrança do upstream, e só o
 * ADMINISTRADOR paga, troca o plano e corrige os dados. A organização vem da
 * sessão, nunca do corpo. Com a cobrança desligada, 404.
 */
import { randomUUID } from "node:crypto";

import type { NextResponse } from "next/server";

import type { ApiError } from "@/lib/api/wrappers";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import type { ActiveOrg, AuthUser } from "@/lib/auth/types";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

export { corpoJson, responder } from "./resposta";

export interface AcessoAoPasso {
  requestId: string;
  user: AuthUser;
  org: ActiveOrg;
  admin: ReturnType<typeof createAdminClient>;
}

/**
 * A guarda de toda rota que ESCREVE: papel admin e cobrança ligada. A guarda do
 * acompanhamento (`requireSupportWrite`) fica na própria rota, antes desta: é lá
 * que a cerca `suporte-cobertura-de-efeitos` a procura.
 */
export async function acessoDeEscrita(): Promise<AcessoAoPasso | NextResponse<ApiError> | Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "mia_pagamento_inicial", permiteOrgSuspensa: true });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  if (!(await moduloLigado(admin, "cobranca"))) return fail("not_found", "Not found", 404, { requestId });
  return { requestId, user: authz.user, org: authz.org, admin };
}

