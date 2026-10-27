/**
 * FORK MIA (.96) · POST /api/v1/pagamento-inicial/plano: "Trocar de plano" no
 * passo do pagamento, antes de pagar (decisão 7). Entre os planos visíveis às
 * empresas; a cobrança gerada é cancelada no Asaas e a próxima sai no plano novo.
 */
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { acessoDeEscrita, corpoJson, responder } from "@/lib/pagamento-inicial/rota";
import { trocarPlanoAntesDePagar } from "@/lib/pagamento-inicial/servico";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({ plano_id: z.string().uuid() });

export async function POST(req: Request) {
  // A guarda de efeito do acompanhamento, antes de tudo (cerca suporte-cobertura-de-efeitos).
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const acesso = await acessoDeEscrita();
  if (acesso instanceof Response) return acesso;
  const corpo = corpoSchema.safeParse(await corpoJson(req));
  if (!corpo.success) return fail("validation_failed", "Escolha um plano.", 400, { requestId: acesso.requestId });
  const r = await trocarPlanoAntesDePagar(acesso.admin, {
    orgId: acesso.org.orgId,
    userId: acesso.user.id,
    planoId: corpo.data.plano_id,
    requestId: acesso.requestId,
  });
  return responder(r, acesso.requestId);
}
