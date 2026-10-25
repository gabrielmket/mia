/**
 * FORK MIA (.90) — GET /api/v1/publico/planos: os planos à venda, para a página
 * de preços (`/precos`) e para o site da iamia.
 *
 * PÚBLICA e SÓ DE LEITURA: nenhuma sessão, nenhum corpo, nenhum efeito. A régua
 * do que sai mora em `lib/planos-mia/publico.ts`: só os planos oferecidos (o
 * escondido não aparece), nunca o teto de IA em dólar ("cerca de N conversas"
 * no lugar), nada de assinante. Com a cobrança desligada, `disponivel: false` e
 * lista vazia. Leitura que falha: 503, nunca uma lista vazia por engano.
 *
 * `cadastro` de cada plano vem ABSOLUTO aqui (o endereço do sistema), para o
 * site, que mora em outro domínio, poder usar o link como está. Cache curto e
 * CORS aberto: é dado de vitrine, o mesmo para qualquer visitante.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { lerPlanosPublicos } from "@/lib/planos-mia/publico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const CABECALHOS = {
  "Cache-Control": "public, max-age=60, s-maxage=300",
  "Access-Control-Allow-Origin": "*",
};

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  try {
    const lidos = await lerPlanosPublicos(createAdminClient());
    const base = (env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
    return ok(
      { ...lidos, planos: lidos.planos.map((p) => ({ ...p, cadastro: `${base}${p.cadastro}` })) },
      { requestId, headers: CABECALHOS },
    );
  } catch (erro) {
    logger.warn("[publico/planos] leitura falhou", {
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return fail(
      "indisponivel",
      "Os planos não puderam ser lidos agora. Tente de novo em instantes.",
      503,
      { requestId },
    );
  }
}
