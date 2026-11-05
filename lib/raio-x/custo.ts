/**
 * FORK MIA (.101) · O CUSTO DE UM RAIO-X E O TETO. PURO.
 *
 * O custo é gasto da PLATAFORMA (a Time paga, com a credencial de IA da
 * instalação), não de uma empresa: o raio-X nem precisa ser de cliente da MIA.
 * Cada chamada vira uma linha em `mia_raio_x_gastos` (propósito `raio_x_analise`
 * ou `raio_x_transcricao`), em dólar (o que o provedor cobra) e em real (pela
 * cotação do dia, `platform_fx_rates`). A soma em real é o que o teto confere.
 *
 * ── O teto (padrão R$ 40, editável no cadastro) ───────────────────────────
 *
 * Conferido ANTES de cada chamada, com uma folga para a própria chamada: se o
 * gasto até aqui mais a estimativa da próxima passa do teto, a análise para.
 * As conversas que ficaram de fora são marcadas e o relatório diz quantas
 * (`parcial`). Nunca se gasta passando do teto por mais que uma chamada: a
 * estimativa por chamada é conservadora (o lote inteiro com saída cheia).
 */
import { precoDoModelo } from "@/lib/agent-engine/edge/llm/pricing";

/** Cotação de reserva quando a tabela do dia está vazia (instalação nova, cron fora). */
export const COTACAO_DE_RESERVA = 6;

/** whisper-1 e compatíveis: US$ 0,006 por minuto (tabela pública da OpenAI). */
export const USD_POR_MINUTO_DE_AUDIO = 0.006;

/** Bytes por segundo de uma nota de voz (Opus ~16 kbit/s), para estimar sem a duração. */
const BYTES_POR_SEGUNDO_DE_VOZ = 2_000;

export function centavosEmReais(usdCentavos: number, cotacao: number): number {
  return usdCentavos * cotacao;
}

/** Custo em centavos de dólar de N segundos de áudio. */
export function custoDoAudioUsdCentavos(segundos: number): number {
  return (Math.max(1, segundos) / 60) * USD_POR_MINUTO_DE_AUDIO * 100;
}

/** A duração do áudio: a que o aparelho informa ou, sem ela, a estimada pelo tamanho. */
export function segundosDoAudio(segundosInformados: number | null | undefined, bytes: number): number {
  if (typeof segundosInformados === "number" && Number.isFinite(segundosInformados) && segundosInformados > 0) {
    return Math.round(segundosInformados);
  }
  return Math.max(1, Math.round(bytes / BYTES_POR_SEGUNDO_DE_VOZ));
}

/**
 * A estimativa CONSERVADORA de uma chamada de análise, em centavos de dólar:
 * a entrada inteira mais a saída no teto. `null` = o modelo não tem preço
 * (aí o teto não protege, e quem chama recusa usar o modelo).
 */
export function estimativaDaChamadaUsdCentavos(modelo: string, tokensDeEntrada: number, tetoDeSaida: number): number | null {
  const preco = precoDoModelo(modelo);
  if (!preco) return null;
  return ((tokensDeEntrada * preco.input + tetoDeSaida * preco.output) / 1_000_000) * 100;
}

/** Quatro caracteres por token: a régua de bolso para português. */
export function tokensEstimados(texto: string): number {
  return Math.ceil(texto.length / 4);
}

export interface DecisaoDoTeto {
  pode: boolean;
  /** Quanto ainda cabe, em centavos de real. */
  sobra: number;
}

/** Cabe mais uma chamada de `estimativaCentavos` (em real) sem passar do teto? */
export function cabeNoTeto(gastoCentavos: number, estimativaCentavos: number, tetoCentavos: number): DecisaoDoTeto {
  const sobra = tetoCentavos - gastoCentavos;
  return { pode: gastoCentavos + estimativaCentavos <= tetoCentavos, sobra: Math.max(0, sobra) };
}

/** R$ 21,40 — para o MCP e para a mensagem; a tela formata pelo idioma. */
export function reaisParaLer(centavos: number): string {
  return `R$ ${(Math.round(centavos) / 100).toFixed(2).replace(".", ",")}`;
}
