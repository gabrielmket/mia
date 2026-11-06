/**
 * FORK MIA (.106) · POST /api/v1/publico/raio-x/entrar — "Mandar o código"
 * (protótipo de 06/11/2026, tela 5). A pessoa digita o e-mail do cadastro e
 * recebe um código de 6 números, que vale 15 minutos (`lib/raio-x/acesso.ts`).
 *
 * A resposta é a MESMA exista ou não a conta: ninguém descobre quem tem
 * cadastro por aqui. O e-mail sai sem a rota esperar por ele (a demora do envio
 * também não pode dizer nada). Teto por IP e por e-mail; só a própria página do
 * sistema chama (o `Origin` é conferido).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { logger } from "@/lib/logger";
import { ehEmailValido, limparEmail } from "@/lib/raio-x/aceite";
import { LIMITE_DO_PEDIDO, ROTULO_DO_LIMITE_DO_PEDIDO, veioDoProprioApp } from "@/lib/raio-x/acesso";
import { criarCodigoDeAcesso } from "@/lib/raio-x/contas";
import { emailDoCodigo, enviarEmailDoRaioX } from "@/lib/raio-x/emails";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const RESPOSTA = "Se esse e-mail tem um Raio-X, o código chegou. Ele vale por 15 minutos.";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!veioDoProprioApp(req.headers)) return fail("forbidden", "Pedido de fora da página do Raio-X.", 403, { requestId });
  const corpo = ((await req.json().catch(() => null)) ?? {}) as { email?: unknown };
  const email = limparEmail(corpo.email);
  if (!ehEmailValido(email)) return fail("validation_failed", "Confira o e-mail.", 400, { requestId, details: { campos: ["email"] } });
  if (await authRateLimited(ROTULO_DO_LIMITE_DO_PEDIDO, email, LIMITE_DO_PEDIDO)) {
    return fail("rate_limited", "Muitos códigos pedidos seguidos. Aguarde alguns minutos.", 429, { requestId, headers: { "Retry-After": "600" } });
  }
  try {
    const criado = await criarCodigoDeAcesso(createAdminClient(), email);
    if (criado) {
      void enviarEmailDoRaioX(criado.conta.email, (marca) => emailDoCodigo({ codigo: criado.codigo }, marca), "codigo");
    }
  } catch (erro) {
    // A falha também responde igual: o código não chegou, e a pessoa pede outro.
    logger.warn("[raio-x] o código de acesso não foi criado", { requestId, detail: erro instanceof Error ? erro.message : "erro" });
  }
  return ok({ enviado: true, mensagem: RESPOSTA }, { requestId, headers: { "Cache-Control": "no-store" } });
}
