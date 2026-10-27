/**
 * FORK MIA (.96) · POST /api/v1/pagamento-inicial/gerar: a escolha do Pix ou do
 * boleto no passo "Pagamento" do início.
 *   - entrada paga: gera a cobrança (o Pix com QR, ou o boleto com a linha
 *     digitável e o PDF). Sair do boleto já gerado cancela o boleto no Asaas;
 *   - plano com teste (decisão 12 revista): só o Pix fica escolhido para depois
 *     do teste; nada é cobrado hoje (o Pix sai 3 dias antes do fim).
 * As regras moram em lib/pagamento-inicial/servico.ts.
 */
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { acessoDeEscrita, corpoJson, responder } from "@/lib/pagamento-inicial/rota";
import { escolherPixNoTeste, gerarCobranca, situacaoDoPassoNoInicio } from "@/lib/pagamento-inicial/servico";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({ forma: z.enum(["pix", "boleto"]) });

export async function POST(req: Request) {
  // A guarda de efeito do acompanhamento, antes de tudo (cerca suporte-cobertura-de-efeitos).
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const acesso = await acessoDeEscrita();
  if (acesso instanceof Response) return acesso;
  const corpo = corpoSchema.safeParse(await corpoJson(req));
  if (!corpo.success) return fail("validation_failed", "Escolha Pix ou boleto.", 400, { requestId: acesso.requestId });
  const { modo } = await situacaoDoPassoNoInicio(acesso.admin, acesso.org.orgId);
  if (modo === "teste") {
    if (corpo.data.forma !== "pix") {
      return fail("sem_boleto", "A primeira mensalidade depois do teste é por Pix ou cartão.", 422, { requestId: acesso.requestId });
    }
    return responder(
      await escolherPixNoTeste(acesso.admin, { orgId: acesso.org.orgId, userId: acesso.user.id, requestId: acesso.requestId }),
      acesso.requestId,
    );
  }
  const r = await gerarCobranca(acesso.admin, {
    orgId: acesso.org.orgId,
    userId: acesso.user.id,
    forma: corpo.data.forma,
    requestId: acesso.requestId,
  });
  return responder(r, acesso.requestId);
}
