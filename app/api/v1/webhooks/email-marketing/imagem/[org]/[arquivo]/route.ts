/**
 * FORK MIA (.89) — GET /api/v1/webhooks/email-marketing/imagem/<empresa>/<uuid>.<ext>:
 * a IMAGEM de um bloco de campanha de e-mail, aberta pelo programa de e-mail de
 * quem recebe (e pelo proxy de imagem do Gmail), sem sessão e por anos.
 *
 * O bucket `email-marketing-imagens` é PRIVADO (9065): o único bucket público da
 * instalação é o `brand-logos` do upstream (`tests/invariants/marca-logo.test.ts`).
 * O cliente de e-mail só precisa de uma URL pública, e é esta: a rota lê do
 * bucket com o service_role e devolve os bytes com cache longo.
 *
 * O que não se adivinha é o uuid que o SERVIDOR sorteou no envio da imagem
 * (`POST /api/v1/email-marketing/imagens`, 122 bits). A forma do caminho é
 * conferida antes de ir ao storage (uuid da empresa, uuid do arquivo e uma das
 * três extensões), então nada de `..`, barra ou outro bucket passa. Arquivo que
 * não existe: 404 sem dizer mais nada. Só entra material de campanha nesse
 * bucket, nunca dado de contato.
 */
import type { NextRequest } from "next/server";

import { authRateLimited } from "@/lib/auth/rate-limit";
import { BUCKET_DAS_IMAGENS, TIPO_DA_EXTENSAO } from "@/lib/email-marketing/imagens";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ARQUIVO = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|gif)$/;

const naoAchou = () =>
  new Response("Imagem não encontrada.", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ org: string; arquivo: string }> },
): Promise<Response> {
  // Teto alto: o proxy de imagem de um provedor grande busca muitas de um IP só.
  if (await authRateLimited("email_marketing_imagem", null, { ip: 1200, windowSec: 60 })) {
    return new Response(null, { status: 429 });
  }
  const { org, arquivo } = await ctx.params;
  const forma = ARQUIVO.exec(arquivo);
  if (!UUID.test(org) || !forma) return naoAchou();
  const tipo = TIPO_DA_EXTENSAO[forma[2] as keyof typeof TIPO_DA_EXTENSAO];

  const { data, error } = await createAdminClient()
    .storage.from(BUCKET_DAS_IMAGENS)
    .download(`${org}/${arquivo}`);
  if (error || !data) return naoAchou();
  const corpo = await data.arrayBuffer();
  return new Response(corpo, {
    status: 200,
    headers: {
      "Content-Type": tipo,
      "Content-Length": String(corpo.byteLength),
      // O caminho nunca muda de conteúdo (cada envio sorteia um uuid novo).
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
