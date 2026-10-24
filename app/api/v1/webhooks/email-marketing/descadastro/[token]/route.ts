/**
 * FORK MIA (.89) — /api/v1/webhooks/email-marketing/descadastro/[token]: o
 * DESCADASTRO DE UM CLIQUE (RFC 8058), o endereço do cabeçalho
 * `List-Unsubscribe` de todo e-mail de campanha.
 *
 * POST  é o botão "Cancelar inscrição" do Gmail e da Apple: o provedor manda
 *       `List-Unsubscribe=One-Click` e a pessoa não vê página nenhuma. Vale na
 *       hora, antes do próximo envio. Idempotente.
 * GET   NUNCA descadastra: filtro de segurança e pré-visualização abrem links
 *       sozinhos. Leva à página de preferências, com "sair" já escolhido.
 *
 * Token inválido no POST responde 200 sem efeito (o provedor não precisa saber
 * se o token era bom); no GET, a página diz "link indisponível".
 */
import type { NextRequest } from "next/server";

import { authRateLimited } from "@/lib/auth/rate-limit";
import { env } from "@/lib/env";
import { descadastrar, resolverQuemRecebe } from "@/lib/email-marketing/preferencias";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  if (await authRateLimited("email_marketing_descadastro", null, { ip: 120, windowSec: 60 })) {
    return new Response(null, { status: 429 });
  }
  const { token } = await ctx.params;
  try {
    const admin = createAdminClient();
    const quem = await resolverQuemRecebe(admin, token);
    if (quem && !quem.teste) await descadastrar(admin, quem, { porta: "um_clique" });
  } catch (err) {
    logger.error("[email-marketing] descadastro de um clique falhou", {
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 200 });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  const destino = `${env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/preferencias/${encodeURIComponent(token)}?sair=1`;
  return Response.redirect(destino, 303);
}
