/**
 * FORK MIA (.96) · O QUE A ÁREA DE COBRANÇA LÊ NO ASAAS ALÉM DE
 * `lib/asaas-mia/cobrancas.ts`: a assinatura (a forma das próximas mensalidades
 * e o dia da próxima). Mesmo cliente HTTP (`apiDoAsaas`) e as mesmas regras: a
 * chave só no cabeçalho, o erro só com o `code`, a resposta lida por Zod.
 */
import { z } from "zod";

import { apiDoAsaas, type DependenciasDoAsaasDaMia } from "@/lib/asaas-mia/api";
import { bandeiraDoCartao, finalDoCartao } from "@/lib/asaas-mia/cobrancas";

export interface AssinaturaLidaNoAsaas {
  ref: string;
  /** CREDIT_CARD, PIX, BOLETO, UNDEFINED. */
  forma: string | null;
  /** AAAA-MM-DD. */
  proximaEm: string | null;
  ativa: boolean;
  /** O Asaas às vezes devolve o cartão da assinatura: só o final e a bandeira ficam. */
  cartaoFinal: string | null;
  cartaoBandeira: string | null;
}

const assinaturaDoAsaas = z.object({
  id: z.string().min(1),
  billingType: z.string().nullish(),
  nextDueDate: z.string().nullish(),
  status: z.string().nullish(),
  deleted: z.boolean().nullish(),
  creditCard: z.object({ creditCardNumber: z.string().nullish(), creditCardBrand: z.string().nullish() }).nullish(),
});

/** A assinatura no Asaas. LANÇA `ErroDoProvedor` (quem chama decide o que mostrar). */
export async function lerAssinaturaNoAsaas(assinaturaRef: string, deps: DependenciasDoAsaasDaMia = {}): Promise<AssinaturaLidaNoAsaas> {
  const api = apiDoAsaas(deps);
  const s = api.ler(assinaturaDoAsaas, await api.chamar("GET", `/subscriptions/${encodeURIComponent(assinaturaRef)}`));
  return {
    ref: s.id,
    forma: s.billingType ?? null,
    proximaEm: s.nextDueDate && /^\d{4}-\d{2}-\d{2}/.test(s.nextDueDate) ? s.nextDueDate.slice(0, 10) : null,
    ativa: s.deleted !== true && (s.status ?? "ACTIVE") === "ACTIVE",
    cartaoFinal: finalDoCartao(s.creditCard?.creditCardNumber),
    cartaoBandeira: bandeiraDoCartao(s.creditCard?.creditCardBrand),
  };
}
