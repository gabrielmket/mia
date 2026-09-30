/**
 * FORK MIA — dinheiro nos cartões e no histórico de compras.
 *
 * Tudo aqui está na RÉGUA DO NEGÓCIO: `crm_leads.value_cents` é o valor × 100
 * em QUALQUER moeda (ver `formatValorDoNegocio` em lib/money.ts). O pedido da
 * loja (`orders.total_cents`) está na régua da MOEDA (unidades menores): em
 * guarani ou iene os dois divergem cem vezes. `pedidoNaReguaDoNegocio` é a ponte,
 * aplicada na leitura, para a soma de "negócios ganhos + pedidos" não misturar
 * réguas.
 */
import { formatValorDoNegocio, MOEDA_PADRAO } from "@/lib/money";

function casasDaMoeda(moeda: string): number {
  try {
    return (
      new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** `orders.total_cents` (unidades menores) → régua do negócio (× 100). */
export function pedidoNaReguaDoNegocio(totalCents: number, moeda: string): number {
  return Math.round((totalCents ?? 0) * 10 ** (2 - casasDaMoeda(moeda)));
}

/** "R$ 587 mil", "R$ 1,2 mi" — o valor que cabe num selo. Fora do real, o formato cheio. */
export function valorCurto(cents: number, moeda: string | null | undefined): string {
  const m = moeda ?? MOEDA_PADRAO;
  const valor = (cents ?? 0) / 100;
  if (m === "BRL") {
    if (valor >= 1_000_000) {
      return `R$ ${(valor / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
    }
    if (valor >= 1_000) return `R$ ${Math.round(valor / 1_000).toLocaleString("pt-BR")} mil`;
  }
  return formatValorDoNegocio(cents, m, { semCentavos: true });
}

/** O valor inteiro, sem centavos, como o card e o dossiê do funil sempre mostraram. */
export function valorCheio(cents: number, moeda: string | null | undefined): string {
  return formatValorDoNegocio(cents, moeda ?? MOEDA_PADRAO, { semCentavos: true });
}
