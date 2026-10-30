/**
 * FORK MIA (.96) · POST /api/v1/cobranca/area/dados-fiscais: os dados fiscais pela área
 * de cobrança (Configurações › Plano e cobrança). Só o administrador. O CPF ou
 * CNPJ não muda por aqui (decisão 10): vale o gravado. O cliente do Asaas recebe
 * na hora, e a mudança vale para as próximas notas.
 */
import { fail } from "@/lib/api/wrappers";
import { acessoDaArea, corpoJson, responderDaArea } from "@/lib/area-de-cobranca/rota";
import { salvarDadosFiscaisDaArea } from "@/lib/area-de-cobranca/servico";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // A guarda de efeito do acompanhamento, antes de tudo (cerca suporte-cobertura-de-efeitos).
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const acesso = await acessoDaArea();
  if (acesso instanceof Response) return acesso;
  const corpo = await corpoJson(req);
  if (corpo === null || typeof corpo !== "object") {
    return fail("validation_failed", "Confira os dados fiscais.", 400, { requestId: acesso.requestId });
  }
  const r = await salvarDadosFiscaisDaArea(acesso.admin, {
    orgId: acesso.org.orgId,
    userId: acesso.user.id,
    entrada: corpo,
    requestId: acesso.requestId,
  });
  return responderDaArea(r, acesso.requestId);
}
