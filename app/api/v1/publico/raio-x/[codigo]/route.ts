/**
 * FORK MIA (.101) · GET /api/v1/publico/raio-x/[codigo] — o andamento que a
 * página pública de conexão consulta de tempos em tempos (a etapa, o percentual
 * da leitura). Quem chama é o dono, sem conta: a identidade é o código do link.
 * Código ruim, inexistente ou de raio-X encerrado responde igual (404). Teto por
 * IP. Nada de custo, relatório ou dado de cliente sai daqui.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { lerNumerosDoRaioX, raioXPeloCodigo } from "@/lib/raio-x/banco";
import { LIMITE_DO_ANDAMENTO, ROTULO_DO_LIMITE_DO_ANDAMENTO, situacaoPublica } from "@/lib/raio-x/publico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ codigo: string }> }): Promise<Response> {
  const requestId = randomUUID();
  // FORK MIA (.103): a cerca do andamento, que a página repete a cada 5 s.
  if (await authRateLimited(ROTULO_DO_LIMITE_DO_ANDAMENTO, null, LIMITE_DO_ANDAMENTO)) {
    return fail("rate_limited", "Muitas consultas seguidas. Aguarde alguns minutos.", 429, { requestId, headers: { "Retry-After": "600" } });
  }
  const { codigo } = await params;
  const admin = createAdminClient();
  const r = await raioXPeloCodigo(admin, codigo);
  if (!r) return fail("not_found", "Link inválido ou encerrado.", 404, { requestId });
  // FORK MIA (.102): no cliente ativo, a página diz os números da conta.
  const numeros = r.fonte === "conversas_da_mia" ? (await lerNumerosDoRaioX(admin, r.id)).map((n) => n.rotulo) : [];
  const s = situacaoPublica(r, new Date(), numeros);
  // O termo só vai na carga da página; aqui vai o andamento.
  return ok({ ...s, termo: null }, { requestId, headers: { "Cache-Control": "no-store" } });
}
