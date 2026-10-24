/**
 * FORK MIA (.88) — o valor em dinheiro como o assistente escreve, na moeda da
 * empresa e no idioma de quem lê. Puro.
 */
export function formatarDinheiro(centavos: number | null | undefined, moeda: string | null | undefined, idioma: string): string {
  const valor = (centavos ?? 0) / 100;
  try {
    return new Intl.NumberFormat(idioma || "pt-BR", {
      style: "currency",
      currency: (moeda || "BRL").toUpperCase(),
      maximumFractionDigits: valor >= 1000 ? 0 : 2,
    }).format(valor);
  } catch {
    return `${(moeda || "BRL").toUpperCase()} ${valor.toFixed(2)}`;
  }
}
