/**
 * FORK MIA (.98) · POST /api/v1/cobranca/pagamento-inicial/setup: "Quero que a
 * Time implante para mim" no passo do pagamento (decisão 10 do protótipo "Cupons
 * e parceiros"). `pedir` gera a cobrança avulsa; `desistir` a cancela antes de
 * pagar; `conferir` relê no Asaas se foi paga. A organização vem da sessão.
 */
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { escolherSetupNoPasso } from "@/lib/cupons/no-passo";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { acessoDeEscrita, corpoJson, responder } from "@/lib/pagamento-inicial/rota";
import { lerPassoDoPagamento } from "@/lib/pagamento-inicial/servico";
import { conferirSetup } from "@/lib/setup-de-implantacao/servico";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({ acao: z.enum(["pedir", "desistir", "conferir"]) });

export async function POST(req: Request) {
  // A guarda de efeito do acompanhamento, antes de tudo (cerca suporte-cobertura-de-efeitos).
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const acesso = await acessoDeEscrita({ permiteOrgSuspensa: true });
  if (acesso instanceof Response) return acesso;
  const corpo = corpoSchema.safeParse(await corpoJson(req));
  if (!corpo.success) return fail("validation_failed", "Pedido inválido.", 400, { requestId: acesso.requestId });
  if (corpo.data.acao === "conferir") {
    await conferirSetup(acesso.admin, acesso.org.orgId);
    return responder({ ok: true, passo: await lerPassoDoPagamento(acesso.admin, acesso.org.orgId, { podePagar: true }) }, acesso.requestId);
  }
  const r = await escolherSetupNoPasso(acesso.admin, {
    orgId: acesso.org.orgId,
    userId: acesso.user.id,
    quero: corpo.data.acao === "pedir",
    requestId: acesso.requestId,
  });
  return responder(r, acesso.requestId);
}
