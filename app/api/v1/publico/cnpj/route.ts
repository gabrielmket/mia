/**
 * FORK MIA (.96) · GET /api/v1/publico/cnpj?cnpj=...: o "Preencher pelo CNPJ"
 * do cadastro e do passo do pagamento (protótipo "Pagamento no início", tela 1).
 *
 * PÚBLICA porque o cadastro é anterior à conta, e SÓ DE LEITURA: nenhum efeito.
 * Usa a consulta da Receita que o sistema já tem (o cliente da BrasilAPI do
 * upstream, `lib/dados-fiscais/consultas.ts`) e devolve só o que a nota precisa:
 * a razão social, o nome fantasia e o endereço (nunca o quadro de sócios).
 * Teto por IP (o limitador da autenticação), para não virar consulta de graça.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { consultarCnpjParaANota } from "@/lib/dados-fiscais/consultas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (await authRateLimited("consulta_fiscal", null, { ip: 30, windowSec: 600 })) {
    return fail("rate_limited", "Muitas consultas seguidas. Aguarde alguns minutos.", 429, { requestId, headers: { "Retry-After": "600" } });
  }
  const r = await consultarCnpjParaANota(req.nextUrl.searchParams.get("cnpj") ?? "");
  if (!r.ok) {
    const status = r.motivo === "cnpj_invalido" ? 422 : r.motivo === "nao_encontrado" ? 404 : 502;
    const mensagem =
      r.motivo === "cnpj_invalido"
        ? "Informe os 14 números do CNPJ."
        : r.motivo === "nao_encontrado"
          ? "A Receita não encontrou este CNPJ."
          : "A consulta à Receita não respondeu agora. Preencha à mão.";
    return fail(r.motivo, mensagem, status, { requestId });
  }
  return ok(r, { requestId, headers: { "Cache-Control": "no-store" } });
}
