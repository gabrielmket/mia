/**
 * FORK MIA (.101) · GET /api/v1/publico/raio-x/[codigo]/qr — o QR do pareamento,
 * como imagem, para quem está no computador (a alternativa ao código de 8
 * letras). Só depois do aceite. A página pede de novo a cada 20 segundos, que é
 * quando o WhatsApp troca o QR. Teto por IP.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { leitorDoRaioX } from "@/lib/channels/raio-x/leitor";
import { fail } from "@/lib/api/wrappers";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { podeConectar, raioXPeloCodigo } from "@/lib/raio-x/banco";
import { LIMITE_DA_PAGINA, ROTULO_DO_LIMITE_DA_PAGINA } from "@/lib/raio-x/publico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ codigo: string }> }): Promise<Response> {
  const requestId = randomUUID();
  if (await authRateLimited(ROTULO_DO_LIMITE_DA_PAGINA, null, LIMITE_DA_PAGINA)) {
    return fail("rate_limited", "Muitas consultas seguidas. Aguarde alguns minutos.", 429, { requestId, headers: { "Retry-After": "600" } });
  }
  const { codigo } = await params;
  const r = await raioXPeloCodigo(createAdminClient(), codigo);
  if (!r) return fail("not_found", "Link inválido ou encerrado.", 404, { requestId });
  if (!podeConectar(r) || r.situacao !== "conectando" || !r.sessao) {
    return fail("conflict", "Leia e aceite a autorização antes de conectar.", 409, { requestId });
  }
  const leitor = leitorDoRaioX();
  if (!leitor) return fail("upstream_unavailable", "A conexão não está disponível agora.", 503, { requestId });
  try {
    await leitor.preparar(r.sessao);
    const png = await leitor.qr(r.sessao);
    if (!png) return fail("not_ready", "O QR ainda não está pronto.", 409, { requestId });
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch {
    return fail("upstream_unavailable", "A conexão não respondeu. Tente de novo.", 502, { requestId });
  }
}
