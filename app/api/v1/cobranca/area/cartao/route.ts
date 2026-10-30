/**
 * FORK MIA (.96) · POST /api/v1/cobranca/area/cartao: "Trocar o cartão" na área de
 * cobrança. O cartão novo vai para a assinatura do Asaas pelo checkout
 * transparente, SEM cobrar nada na hora; as próximas mensalidades caem nele.
 *
 * O número e o código de segurança passam por aqui SÓ para chegar ao Asaas: não
 * são gravados, não vão a log, ao Sentry nem à resposta. O corpo é lido sem
 * deixar o erro do parse escapar (a mensagem dele citaria o texto), a recusa da
 * conferência diz só o campo, e a do Asaas, só o código. A prova é
 * `tests/unit/area-de-cobranca-cartao-fora-dos-registros.test.ts`.
 */
import { fail } from "@/lib/api/wrappers";
import { conferirCartao, FRASE_DO_CARTAO } from "@/lib/asaas-mia/cartao-regras";
import { acessoDaArea, corpoJson, responderDaArea } from "@/lib/area-de-cobranca/rota";
import { trocarCartaoDaArea } from "@/lib/area-de-cobranca/servico";
import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // A guarda de efeito do acompanhamento, antes de tudo (cerca suporte-cobertura-de-efeitos).
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const acesso = await acessoDaArea();
  if (acesso instanceof Response) return acesso;
  const conferido = conferirCartao(await corpoJson(req), new Date());
  if (!conferido.ok) {
    return fail("cartao_invalido", FRASE_DO_CARTAO[conferido.motivo], 422, {
      requestId: acesso.requestId,
      details: { campo: conferido.motivo },
    });
  }
  const r = await trocarCartaoDaArea(acesso.admin, {
    orgId: acesso.org.orgId,
    userId: acesso.user.id,
    cartao: conferido.cartao,
    ipRemoto: ipDoCliente(req.headers),
    requestId: acesso.requestId,
  });
  return responderDaArea(r, acesso.requestId);
}
