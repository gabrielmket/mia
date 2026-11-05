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

// ─── FORK MIA (.102) · a estimativa do raio-X do cliente ativo ──────────────

/**
 * O modelo da estimativa: o preferido da análise (`MODELO_PREFERIDO` em
 * `analise.ts`, conferido no teste). Mora aqui porque este módulo é puro e a
 * tela do "Novo raio-X" usa a estimativa.
 */
export const MODELO_DA_ESTIMATIVA = "gpt-6-luna";
/** Por conversa, do lado conservador: o teto de texto (3.500 caracteres), a parte do pedido do sistema no lote e os fatos. */
export const TOKENS_DE_ENTRADA_POR_CONVERSA = 1_100;
/** A saída cheia por conversa (450) mais a parte da folga do lote. */
export const TOKENS_DE_SAIDA_POR_CONVERSA = 500;
/** Um minuto por áudio: o mesmo piso que o teto usa antes de cada transcrição. */
export const SEGUNDOS_POR_AUDIO_NA_ESTIMATIVA = 60;

export interface EstimativaDoRaioX {
  conversas: number;
  audios: number;
  analiseCentavos: number;
  audiosCentavos: number;
  totalCentavos: number;
}

/**
 * Quanto o raio-X deve custar, em centavos de real, ANTES de começar (a tela
 * do "Novo raio-X" e o MCP). Conservadora como o teto: cada conversa com o
 * texto no limite e a saída cheia, cada áudio com um minuto. O custo de
 * verdade é medido e gravado em `mia_raio_x_gastos`.
 */
export function estimativaDoRaioX(conversas: number, audios: number, cotacao: number, modelo: string = MODELO_DA_ESTIMATIVA): EstimativaDoRaioX {
  const porConversa = estimativaDaChamadaUsdCentavos(modelo, TOKENS_DE_ENTRADA_POR_CONVERSA, TOKENS_DE_SAIDA_POR_CONVERSA) ?? 0;
  const analiseCentavos = Math.ceil(centavosEmReais(porConversa * Math.max(0, conversas), cotacao));
  const audiosCentavos = Math.ceil(centavosEmReais(custoDoAudioUsdCentavos(SEGUNDOS_POR_AUDIO_NA_ESTIMATIVA) * Math.max(0, audios), cotacao));
  return { conversas, audios, analiseCentavos, audiosCentavos, totalCentavos: analiseCentavos + audiosCentavos };
}

/** R$ 21,40 — para o MCP e para a mensagem; a tela formata pelo idioma. */
export function reaisParaLer(centavos: number): string {
  return `R$ ${(Math.round(centavos) / 100).toFixed(2).replace(".", ",")}`;
}
