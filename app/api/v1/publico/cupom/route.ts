/**
 * FORK MIA (.98) · GET /api/v1/publico/cupom?codigo=...: o "Aplicar" do cupom na
 * página de preços e no cadastro. Pública e só de leitura, com teto por IP (quem
 * chega pelo link ainda não tem conta). Só o que o selo precisa
 * (`lib/cupons/publico.ts`): nunca comissão, documento ou Pix do parceiro.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { lerCupomPublico } from "@/lib/cupons/publico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (await authRateLimited("consulta_de_cupom", null, { ip: 30, windowSec: 600 })) {
    return fail("rate_limited", "Muitas consultas seguidas. Aguarde alguns minutos.", 429, { requestId, headers: { "Retry-After": "600" } });
  }
  const cupom = await lerCupomPublico(createAdminClient(), req.nextUrl.searchParams.get("codigo") ?? "");
  return ok({ cupom }, { requestId, headers: { "Cache-Control": "no-store" } });
}
