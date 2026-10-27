/**
 * FORK MIA (.96) · GET /api/v1/publico/cep?cep=...: o "Buscar" do CEP no
 * cadastro e no passo do pagamento. Pública e só de leitura, com teto por IP;
 * a busca mora em `lib/dados-fiscais/consultas.ts`.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { consultarCep } from "@/lib/dados-fiscais/consultas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (await authRateLimited("consulta_fiscal", null, { ip: 30, windowSec: 600 })) {
    return fail("rate_limited", "Muitas consultas seguidas. Aguarde alguns minutos.", 429, { requestId, headers: { "Retry-After": "600" } });
  }
  const r = await consultarCep(req.nextUrl.searchParams.get("cep") ?? "");
  if (!r.ok) {
    const status = r.motivo === "cep_invalido" ? 422 : r.motivo === "nao_encontrado" ? 404 : 502;
    const mensagem =
      r.motivo === "cep_invalido"
        ? "Digite os 8 números do CEP."
        : r.motivo === "nao_encontrado"
          ? "CEP não encontrado. Preencha o endereço à mão."
          : "A busca do CEP não respondeu agora. Preencha à mão.";
    return fail(r.motivo, mensagem, status, { requestId });
  }
  return ok(r, { requestId, headers: { "Cache-Control": "no-store" } });
}
