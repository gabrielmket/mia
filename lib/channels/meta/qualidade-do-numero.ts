import type { QualidadeDoNumero } from "@/lib/broadcast/plano";
import { graphBaseUrl } from "@/lib/channels/meta/graph-base";

/**
 * A nota de qualidade do número, perguntada à Meta.
 *
 * Lida da Graph API e não de uma coluna nossa, de propósito: o webhook
 * `phone_number_quality_update` existe e avisa quando MUDA, mas uma instalação
 * que perdeu um evento (webhook fora do ar, número conectado antes da
 * assinatura) ficaria com um valor velho gravado — e valor velho de qualidade é
 * pior que nenhum, porque a trava passaria a proteger com base em ontem.
 *
 * O custo é uma chamada por RODADA do motor, não por mensagem.
 *
 * ⚠️ Falha de leitura devolve `UNKNOWN`, e `UNKNOWN` PASSA na trava. É decisão:
 * a Graph API fora do ar pararia todo disparo de todo cliente, e a trava existe
 * para o caso grave (vermelho), não para transformar indisponibilidade de
 * terceiro em parada de produto. O `deveParar` só barra em `RED`.
 */
export async function qualidadeDoNumero(input: {
  phoneNumberId: string;
  token: string;
  graphVersion: string;
}): Promise<QualidadeDoNumero> {
  const url = `${graphBaseUrl(input.graphVersion)}/${input.phoneNumberId}?fields=quality_rating`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${input.token}` } });
    if (!res.ok) return "UNKNOWN";
    const corpo = (await res.json()) as { quality_rating?: string };
    const nota = (corpo.quality_rating ?? "").toUpperCase();
    if (nota === "GREEN" || nota === "YELLOW" || nota === "RED") return nota;
    return "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}
