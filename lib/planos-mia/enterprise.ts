/**
 * FORK MIA (MIA-242) · O CARTÃO "ENTERPRISE" DA PÁGINA DE PREÇOS.
 *
 * Um cartão fixo depois dos planos do banco, para quem passa do plano mais alto.
 * NÃO é plano: não tem linha em `cobranca_planos`, não aparece na rota pública
 * `/api/v1/publico/planos` e não tem preço. Só existe quando a lista existe
 * (cobrança ligada e algum plano oferecido): sem plano, não há "mais alto" de
 * quem passar.
 *
 * Os limites da frase ("passa de 800 conversas, 3 números ou 15 pessoas") são
 * LIDOS do plano oferecido mais caro, nunca escritos aqui: mudou o plano no
 * painel ou pelo MCP, a frase muda junto. Se ele tiver algum limite "sem
 * limite", a frase com números não faz sentido e sai a genérica.
 *
 * O botão "Falar com o comercial" abre o `wa.me` do número que a instalação
 * declara em `MIA_WHATSAPP_DO_COMERCIAL` (ambiente ou `platform_config`, pelo
 * `valorDaInstalacao`). O número não mora no código: o repositório é público e
 * é de várias instalações, e a do revendedor não pode mandar o cliente dele
 * para o comercial da Time. Sem o número, o botão cai no e-mail de suporte;
 * sem nenhum dos dois, o cartão fica sem botão. Puro, sem banco.
 */
import type { PlanoPublico } from "@/lib/planos-mia/publico";

/** A chave da instalação com o WhatsApp do comercial (só dígitos, com DDI). */
export const VARIAVEL_DO_WHATSAPP_DO_COMERCIAL = "MIA_WHATSAPP_DO_COMERCIAL";

export interface LimitesDoEnterprise {
  conversas: number;
  numeros: number;
  pessoas: number;
}

export interface CartaoEnterprise {
  /** `null` = o plano mais alto tem algum "sem limite": a frase sai genérica. */
  limites: LimitesDoEnterprise | null;
  /** Para onde o botão leva; `null` = sem botão. */
  contato: { tipo: "whatsapp" | "email"; href: string } | null;
}

/**
 * O link `wa.me` do número declarado, ou `null` quando ele não está lá ou não
 * parece um telefone com DDI (10 a 15 dígitos, a régua do E.164).
 */
export function linkDoWhatsAppDoComercial(bruto: string | null | undefined): string | null {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 15) return null;
  return `https://wa.me/${digitos}`;
}

/** Os limites do plano oferecido mais caro, ou `null` se algum for "sem limite". */
export function limitesDoPlanoMaisAlto(
  planos: ReadonlyArray<Pick<PlanoPublico, "preco_cents" | "numeros" | "pessoas" | "conversas_estimadas">>,
): LimitesDoEnterprise | null {
  if (planos.length === 0) return null;
  // A lista já vem do mais barato ao mais caro; o `reduce` não depende disso.
  const alto = planos.reduce((a, b) => (b.preco_cents >= a.preco_cents ? b : a));
  if (alto.numeros === null || alto.pessoas === null || alto.conversas_estimadas === null) return null;
  return { conversas: alto.conversas_estimadas, numeros: alto.numeros, pessoas: alto.pessoas };
}

/** O cartão, ou `null` quando não há plano oferecido (o cartão some com a lista). */
export function cartaoEnterprise(
  planos: ReadonlyArray<Pick<PlanoPublico, "preco_cents" | "numeros" | "pessoas" | "conversas_estimadas">>,
  whatsappDoComercial: string | null | undefined,
  emailDeSuporte: string | null | undefined,
): CartaoEnterprise | null {
  if (planos.length === 0) return null;
  const wa = linkDoWhatsAppDoComercial(whatsappDoComercial);
  const email = (emailDeSuporte ?? "").trim();
  return {
    limites: limitesDoPlanoMaisAlto(planos),
    contato: wa
      ? { tipo: "whatsapp", href: wa }
      : email
        ? { tipo: "email", href: `mailto:${email}` }
        : null,
  };
}
