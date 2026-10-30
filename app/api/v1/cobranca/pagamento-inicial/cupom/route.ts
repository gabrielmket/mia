/**
 * FORK MIA (.98) · POST e DELETE /api/v1/cobranca/pagamento-inicial/cupom: "Tenho
 * um cupom" e "Tirar o cupom" no passo do pagamento, antes de pagar (protótipo
 * "Cupons e parceiros", tela 1). Depois de pago, só a Time troca, na ficha da
 * empresa. A organização vem da sessão, nunca do corpo; só o administrador.
 */
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { aplicarCupomNoPasso, tirarCupomNoPasso } from "@/lib/cupons/no-passo";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { acessoDeEscrita, corpoJson, responder } from "@/lib/pagamento-inicial/rota";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({ codigo: z.string().trim().max(40) });

export async function POST(req: Request) {
  // A guarda de efeito do acompanhamento, antes de tudo (cerca suporte-cobertura-de-efeitos).
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const acesso = await acessoDeEscrita({ permiteOrgSuspensa: true });
  if (acesso instanceof Response) return acesso;
  const corpo = corpoSchema.safeParse(await corpoJson(req));
  if (!corpo.success) return fail("validation_failed", "Digite o código do cupom.", 400, { requestId: acesso.requestId });
  const r = await aplicarCupomNoPasso(acesso.admin, {
    orgId: acesso.org.orgId,
    userId: acesso.user.id,
    codigo: corpo.data.codigo,
    requestId: acesso.requestId,
  });
  return responder(r, acesso.requestId);
}

export async function DELETE() {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const acesso = await acessoDeEscrita({ permiteOrgSuspensa: true });
  if (acesso instanceof Response) return acesso;
  const r = await tirarCupomNoPasso(acesso.admin, { orgId: acesso.org.orgId, userId: acesso.user.id, requestId: acesso.requestId });
  return responder(r, acesso.requestId);
}
