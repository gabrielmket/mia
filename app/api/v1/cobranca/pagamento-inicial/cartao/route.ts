/**
 * FORK MIA (.96) · POST /api/v1/cobranca/pagamento-inicial/cartao: o cartão digitado na
 * tela, pelo checkout transparente do Asaas (decisão 2a do protótipo
 * "Pagamento no início").
 *   - entrada paga (e o bloqueio no fim do teste): paga a cobrança em aberto e
 *     deixa o cartão para as próximas mensalidades;
 *   - plano com teste (decisão 12 revista): só CADASTRA o cartão na assinatura,
 *     sem cobrar; o Asaas debita sozinho no fim do teste.
 *
 * O número e o código de segurança passam por aqui SÓ para chegar ao Asaas:
 * não são gravados, não vão a log, ao Sentry nem à resposta. O corpo é lido sem
 * deixar o erro do parse escapar (a mensagem dele citaria o texto), a recusa da
 * conferência diz só o campo, e a do Asaas, só o código. A prova é
 * `tests/unit/cartao-fora-dos-registros.test.ts` e
 * `tests/unit/pagamento-inicial-cartao-rota.test.ts`.
 */
import { fail } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { conferirCartao, FRASE_DO_CARTAO } from "@/lib/asaas-mia/cartao-regras";
import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { acessoDeEscrita, corpoJson, responder } from "@/lib/pagamento-inicial/rota";
import { cadastrarCartaoNoTeste, pagarComCartaoNoPasso, situacaoDoPassoNoInicio } from "@/lib/pagamento-inicial/servico";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // A guarda de efeito do acompanhamento, antes de tudo (cerca suporte-cobertura-de-efeitos).
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const acesso = await acessoDeEscrita({ permiteOrgSuspensa: true });
  if (acesso instanceof Response) return acesso;
  const conferido = conferirCartao(await corpoJson(req), new Date());
  if (!conferido.ok) {
    return fail("cartao_invalido", FRASE_DO_CARTAO[conferido.motivo], 422, {
      requestId: acesso.requestId,
      details: { campo: conferido.motivo },
    });
  }
  const p = {
    orgId: acesso.org.orgId,
    userId: acesso.user.id,
    cartao: conferido.cartao,
    ipRemoto: ipDoCliente(req.headers),
    requestId: acesso.requestId,
  };
  const { modo } = await situacaoDoPassoNoInicio(acesso.admin, acesso.org.orgId);
  const r = modo === "teste" ? await cadastrarCartaoNoTeste(acesso.admin, p) : await pagarComCartaoNoPasso(acesso.admin, p);
  return responder(r, acesso.requestId);
}
