/**
 * FORK MIA (.89) — GET /api/v1/webhooks/email-marketing/clique/[token]: o link
 * de passagem MEDIDO de cada botão de campanha.
 *
 * Grava o clique (marcando o robô de segurança: todos os links no primeiro
 * minuto depois de entregue, ou agente de robô conhecido) e leva ao destino
 * CONGELADO na confirmação da campanha (`mia_email_links`). O destino nunca vem
 * da URL: um token adulterado não vira redirecionamento aberto.
 */
import type { NextRequest } from "next/server";

import { authRateLimited } from "@/lib/auth/rate-limit";
import { registrarClique } from "@/lib/email-marketing/resultados";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function indisponivel(): Response {
  const html =
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Link indisponível</title></head>' +
    '<body style="font:16px/1.5 system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 24px;text-align:center;color:#1f2937"><p>Este link não está disponível.</p></body></html>';
  return new Response(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  if (await authRateLimited("email_marketing_clique", null, { ip: 300, windowSec: 60 })) {
    return new Response(null, { status: 429 });
  }
  const { token } = await ctx.params;
  try {
    const destino = await registrarClique(
      createAdminClient(),
      token,
      req.headers.get("user-agent"),
    );
    if (!destino) return indisponivel();
    return new Response(null, {
      status: 302,
      headers: { Location: destino, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (err) {
    logger.error("[email-marketing] clique não registrado", {
      error: err instanceof Error ? err.message : String(err),
    });
    return indisponivel();
  }
}
