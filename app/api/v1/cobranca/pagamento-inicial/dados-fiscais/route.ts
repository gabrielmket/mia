/**
 * FORK MIA (.96) · POST /api/v1/cobranca/pagamento-inicial/dados-fiscais: o "Corrigir"
 * do passo do pagamento. Antes do primeiro pagamento, os dados fiscais mudam
 * inteiros (inclusive o CPF ou CNPJ de quem errou um número no cadastro); o
 * cliente do Asaas recebe na hora, se já existe.
 */
import { fail } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { acessoDeEscrita, corpoJson, responder } from "@/lib/pagamento-inicial/rota";
import { corrigirDadosFiscais } from "@/lib/pagamento-inicial/servico";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // A guarda de efeito do acompanhamento, antes de tudo (cerca suporte-cobertura-de-efeitos).
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const acesso = await acessoDeEscrita({ permiteOrgSuspensa: true });
  if (acesso instanceof Response) return acesso;
  const corpo = await corpoJson(req);
  if (corpo === null || typeof corpo !== "object") {
    return fail("validation_failed", "Confira os dados da empresa.", 400, { requestId: acesso.requestId });
  }
  const r = await corrigirDadosFiscais(acesso.admin, {
    orgId: acesso.org.orgId,
    userId: acesso.user.id,
    entrada: corpo,
    requestId: acesso.requestId,
  });
  return responder(r, acesso.requestId);
}
