/**
 * FORK MIA (.89) — GET /api/v1/webhooks/email-marketing/abertura/[token]: o
 * pixel de abertura. Só existe no e-mail de quem consentiu com o aviso de
 * medição (nunca no interesse legítimo), e a abertura é sempre ESTIMATIVA.
 *
 * Responde SEMPRE o gif, com token bom ou ruim: um pixel que responde erro
 * quebra a imagem em alguns programas de e-mail e diz a quem forja que algo é
 * dinâmico. O efeito só se vê no banco.
 */
import type { NextRequest } from "next/server";

import { registrarAbertura } from "@/lib/email-marketing/resultados";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7", "base64");

function pixel(): Response {
  return new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  try {
    await registrarAbertura(createAdminClient(), token, req.headers.get("user-agent"));
  } catch (err) {
    logger.error("[email-marketing] abertura não registrada", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return pixel();
}
