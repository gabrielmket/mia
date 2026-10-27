/**
 * FORK MIA (.96) · O QUE AS ROTAS DA ÁREA DE COBRANÇA TÊM EM COMUM
 * (`app/api/v1/cobranca/area/**`).
 *
 * Só o ADMINISTRADOR da empresa (decisão 11: são dados financeiros e fiscais da
 * empresa). A empresa parada NÃO entra (quem espera o primeiro pagamento usa o
 * passo do início; quem atrasou, o hub de suspensão). A organização vem da
 * sessão, nunca do corpo. Com a cobrança desligada, 404. A guarda do
 * acompanhamento (`requireSupportWrite`) fica na própria rota, antes desta: é
 * lá que a cerca `suporte-cobertura-de-efeitos` a procura.
 */
import { randomUUID } from "node:crypto";

import type { NextResponse } from "next/server";

import type { ApiError } from "@/lib/api/wrappers";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import type { ActiveOrg, AuthUser } from "@/lib/auth/types";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

export { corpoJson } from "@/lib/pagamento-inicial/resposta";

export interface AcessoAArea {
  requestId: string;
  user: AuthUser;
  org: ActiveOrg;
  admin: ReturnType<typeof createAdminClient>;
}

export async function acessoDaArea(): Promise<AcessoAArea | NextResponse<ApiError> | Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "area_de_cobranca" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  if (!(await moduloLigado(admin, "cobranca"))) return fail("not_found", "Not found", 404, { requestId });
  return { requestId, user: authz.user, org: authz.org, admin };
}

/** A resposta de um resultado do serviço: o corpo, ou a recusa com o código. */
export function responderDaArea(
  r: ({ ok: true } & Record<string, unknown>) | { ok: false; status: number; code: string; message: string; details?: unknown },
  requestId: string,
): Response {
  if (r.ok) {
    const { ok: _ok, ...corpo } = r;
    return ok(corpo, { requestId });
  }
  return fail(r.code, r.message, r.status, { requestId, ...(r.details === undefined ? {} : { details: r.details }) });
}
