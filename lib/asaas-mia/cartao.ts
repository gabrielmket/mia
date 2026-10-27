/**
 * FORK MIA (.96) · O CARTÃO PELO CHECKOUT TRANSPARENTE DO ASAAS (decisão 2a do
 * protótipo "Pagamento no início", aprovado em 27/10/2026).
 *
 * O número e o código de segurança chegam ao servidor da MIA SÓ para seguir ao
 * Asaas, na mesma requisição, e somem com ela:
 *   - nada é gravado: do cartão, o banco recebe só o final de 4 números e a
 *     bandeira QUE O ASAAS DEVOLVE depois de cobrar;
 *   - nada aparece em log, no Sentry nem em erro devolvido: o corpo da chamada
 *     nunca é registrado (`./api.ts`), o erro do Asaas vira só o `code` (e um
 *     `code` com cara de número de cartão vira "recusado"), e nenhuma função
 *     daqui lança com o cartão na mensagem;
 *   - o pagamento NUNCA é repetido sozinho (um POST que caiu na rede pode ter
 *     cobrado): quem chama relê a cobrança antes de tentar de novo;
 *   - o token que o Asaas devolve (quando a tokenização está ligada na conta) é
 *     usado na hora para as próximas mensalidades caírem no mesmo cartão, e
 *     descartado.
 * A prova é `tests/unit/cartao-fora-dos-registros.test.ts`.
 */
import { z } from "zod";

import { ErroDoProvedor } from "@/lib/cobranca/provedores/contrato";

import { apiDoAsaas, type DependenciasDoAsaasDaMia } from "./api";
import type { CartaoDigitado } from "./cartao-regras";
import { bandeiraDoCartao, finalDoCartao, STATUS_PAGOS } from "./cobrancas";

/** Quem é o titular, para o Asaas (o antifraude dele pede). Vem dos dados fiscais e do e-mail do admin. */
export interface TitularDoCartao {
  nome: string;
  email: string;
  documento: string;
  cep: string;
  numeroDoEndereco: string;
  complemento: string | null;
  /** Nacional, sem o 55. */
  telefone: string;
}

export type ResultadoDoCartao =
  | { tipo: "pago" | "em_analise" | "pendente"; final: string | null; bandeira: string | null; token: string | null }
  | { tipo: "recusado"; codigo: string }
  | { tipo: "falhou"; codigo: string; transitorio: boolean };

const respostaDoPagamento = z.object({
  id: z.string().min(1),
  status: z.string(),
  creditCard: z
    .object({
      creditCardNumber: z.string().nullish(),
      creditCardBrand: z.string().nullish(),
      creditCardToken: z.string().nullish(),
    })
    .nullish(),
});

/** O `code` do erro, e nunca algo com cara de número de cartão. */
export function codigoSeguroDoCartao(e: unknown): string {
  if (!(e instanceof ErroDoProvedor)) return "fora_do_asaas";
  return /\d{6,}/.test(e.codigo) ? "recusado" : e.codigo;
}

function corpoDoCartao(cartao: CartaoDigitado, titular: TitularDoCartao) {
  return {
    creditCard: {
      holderName: cartao.nome,
      number: cartao.numero,
      expiryMonth: cartao.mes,
      expiryYear: cartao.ano,
      ccv: cartao.cvv,
    },
    creditCardHolderInfo: {
      name: titular.nome,
      email: titular.email,
      cpfCnpj: titular.documento,
      postalCode: titular.cep,
      addressNumber: titular.numeroDoEndereco,
      ...(titular.complemento ? { addressComplement: titular.complemento } : {}),
      phone: titular.telefone,
      mobilePhone: titular.telefone,
    },
  };
}

/**
 * Paga UMA cobrança em aberto com o cartão digitado (POST
 * `/payments/{id}/payWithCreditCard`). Nunca lança: o resultado diz pago, em
 * análise, recusado ou falhou. Recusa do Asaas (400) é "recusado", com o código
 * dele; rede e 5xx são "falhou" (transitório) e quem chama relê antes de repetir.
 */
export async function pagarComCartao(
  p: { pagamentoRef: string; cartao: CartaoDigitado; titular: TitularDoCartao },
  deps: DependenciasDoAsaasDaMia = {},
): Promise<ResultadoDoCartao> {
  const api = apiDoAsaas(deps);
  try {
    const r = api.ler(
      respostaDoPagamento,
      await api.chamar(
        "POST",
        `/payments/${encodeURIComponent(p.pagamentoRef)}/payWithCreditCard`,
        corpoDoCartao(p.cartao, p.titular),
        { repetir: false },
      ),
    );
    const final = finalDoCartao(r.creditCard?.creditCardNumber);
    const bandeira = bandeiraDoCartao(r.creditCard?.creditCardBrand);
    const token = r.creditCard?.creditCardToken ?? null;
    if (STATUS_PAGOS.has(r.status)) return { tipo: "pago", final, bandeira, token };
    if (r.status === "AWAITING_RISK_ANALYSIS") return { tipo: "em_analise", final, bandeira, token };
    return { tipo: "pendente", final, bandeira, token };
  } catch (e) {
    const codigo = codigoSeguroDoCartao(e);
    if (e instanceof ErroDoProvedor && !e.transitorio && e.status !== null && e.status >= 400 && e.status < 500 && !e.credencialInvalida) {
      return { tipo: "recusado", codigo };
    }
    return { tipo: "falhou", codigo, transitorio: e instanceof ErroDoProvedor ? e.transitorio : true };
  }
}

/**
 * As próximas mensalidades no cartão: grava o cartão na assinatura SEM cobrar
 * (POST `/subscriptions/{id}/updateCreditCard`, a referência da API; o anúncio
 * de abril de 2025 o chamou de PUT `/subscriptions/{id}/creditCard`, e o 404 do
 * primeiro tenta o segundo) e passa a forma da assinatura para cartão. Com o
 * token, o cartão não viaja de novo. `ipRemoto` é o de quem digitou (o Asaas
 * pede o do pagador, nunca o do servidor). Nunca lança: `true` = ficou.
 */
export async function cartaoNaAssinatura(
  p: {
    assinaturaRef: string;
    cartao: CartaoDigitado | null;
    token: string | null;
    titular: TitularDoCartao;
    ipRemoto: string | null;
  },
  deps: DependenciasDoAsaasDaMia = {},
): Promise<{ ok: true } | { ok: false; codigo: string }> {
  if (p.token === null && p.cartao === null) return { ok: false, codigo: "sem_cartao" };
  const api = apiDoAsaas(deps);
  const sub = encodeURIComponent(p.assinaturaRef);
  const corpo: Record<string, unknown> = {
    ...(p.token !== null ? { creditCardToken: p.token } : corpoDoCartao(p.cartao as CartaoDigitado, p.titular)),
    ...(p.ipRemoto ? { remoteIp: p.ipRemoto } : {}),
  };
  try {
    try {
      await api.chamar("POST", `/subscriptions/${sub}/updateCreditCard`, corpo, { repetir: false });
    } catch (e) {
      if (!(e instanceof ErroDoProvedor && e.status === 404)) throw e;
      await api.chamar("PUT", `/subscriptions/${sub}/creditCard`, corpo, { repetir: false });
    }
    await api.chamar("PUT", `/subscriptions/${sub}`, { billingType: "CREDIT_CARD", updatePendingPayments: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, codigo: codigoSeguroDoCartao(e) };
  }
}
