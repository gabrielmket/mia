/**
 * FORK MIA (.106) · POST /api/v1/publico/raio-x/sair — sai da área do Raio-X:
 * apaga o cookie da sessão. Formulário: 303 para `/raio-x/entrar`; `fetch`: 200.
 * Só a própria página chama (o `Origin` é conferido).
 */
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { NOME_DO_COOKIE, opcoesDoCookieApagado, veioDoProprioApp } from "@/lib/raio-x/acesso";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!veioDoProprioApp(req.headers)) return fail("forbidden", "Pedido de fora da página do Raio-X.", 403, { requestId });
  const formulario = (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
  const base = (env.NEXT_PUBLIC_APP_URL ?? "http://localhost").replace(/\/+$/, "");
  const resposta = formulario ? NextResponse.redirect(`${base}/raio-x/entrar`, 303) : ok({ saiu: true }, { requestId });
  resposta.cookies.set(NOME_DO_COOKIE, "", opcoesDoCookieApagado());
  return resposta;
}
