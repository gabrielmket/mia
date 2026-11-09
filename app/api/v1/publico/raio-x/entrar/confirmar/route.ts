/**
 * FORK MIA (.107) · POST /api/v1/publico/raio-x/entrar/confirmar — o código de
 * 6 números do e-mail. Certo: grava o cookie da área (HttpOnly, Secure,
 * SameSite=Lax, assinado com o segredo do servidor, 30 dias) e manda para
 * `/raio-x/minha-area`. Errado, vencido, esgotado ou e-mail sem conta: a MESMA
 * resposta (depois de 5 tentativas, só um código novo). Teto por IP e por
 * e-mail; só a própria página chama (o `Origin` é conferido).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { ehEmailValido, limparEmail } from "@/lib/raio-x/aceite";
import {
  assinarSessao,
  LIMITE_DA_CONFIRMACAO,
  NOME_DO_COOKIE,
  normalizarCodigoDeAcesso,
  opcoesDoCookie,
  ROTULO_DO_LIMITE_DA_CONFIRMACAO,
  veioDoProprioApp,
} from "@/lib/raio-x/acesso";
import { conferirCodigoDeAcesso } from "@/lib/raio-x/contas";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const RECUSA = "Código errado ou vencido. Confira o e-mail mais recente; depois de 5 tentativas, peça um código novo.";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!veioDoProprioApp(req.headers)) return fail("forbidden", "Pedido de fora da página do Raio-X.", 403, { requestId });
  const corpo = ((await req.json().catch(() => null)) ?? {}) as { email?: unknown; codigo?: unknown };
  const email = limparEmail(corpo.email);
  const codigo = normalizarCodigoDeAcesso(corpo.codigo);
  if (!ehEmailValido(email) || !codigo) return fail("validation_failed", RECUSA, 400, { requestId });
  if (await authRateLimited(ROTULO_DO_LIMITE_DA_CONFIRMACAO, email, LIMITE_DA_CONFIRMACAO)) {
    return fail("rate_limited", "Muitas tentativas seguidas. Aguarde alguns minutos.", 429, { requestId, headers: { "Retry-After": "600" } });
  }
  const r = await conferirCodigoDeAcesso(createAdminClient(), email, codigo);
  if (!r.ok) return fail("validation_failed", RECUSA, 400, { requestId });
  void audit({
    action: "raio_x.entrou_na_area",
    actorUserId: null,
    actingAsPlatformAdmin: false,
    resourceType: "mia_raio_x_contas",
    resourceId: r.conta.id,
    requestId,
    metadata: {},
  });
  const sessao = assinarSessao(r.conta.id);
  const resposta = ok({ destino: "/raio-x/minha-area" }, { requestId, headers: { "Cache-Control": "no-store" } });
  resposta.cookies.set(NOME_DO_COOKIE, sessao.valor, opcoesDoCookie(sessao.expiraEm));
  return resposta;
}
