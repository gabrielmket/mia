/**
 * FORK MIA — A CONTA do custo pelo catálogo, quando o modelo não está na tabela
 * fixa de `pricing.ts`.
 *
 * ── De onde veio ───────────────────────────────────────────────────────────
 *
 * `pricing.ts` lista poucos modelos e devolve `null` para qualquer outro. O
 * catálogo que a tela de IA oferece (`ai_models`, migration 0104) tem muitos
 * mais, e o PADRÃO de OpenAI — `gpt-5.6-terra` — é um deles. Medido na
 * instalação da plataforma em 15/09/2026, com o agente rodando nesse modelo:
 * toda linha de `llm_calls` com `cost_cents` nulo, "Custo AI US$ 0,00" no
 * painel, e o teto mensal desarmado (`fn_gasto_de_ia_do_mes` soma
 * `coalesce(cost_cents, 0)`). O fork passou a ler o preço do catálogo aqui.
 *
 * ── O que mudou na .83 (upstream v1.85, #3013) ─────────────────────────────
 *
 * O upstream fez a mesma coisa, mais completa: `pricing-do-catalogo.ts` acha a
 * linha de preço por id exato, sem prefixo `provider/` e sem sufixo de data,
 * desempata pelo provedor da chamada, guarda em memória e AVISA no log quando
 * não há preço. A leitura do fork (`tarifaDoCatalogo`, só id exato, sem aviso)
 * saiu: a linha de preço agora é a dele (`precoDaInstalacao`).
 *
 * Fica aqui só o que é nosso, a CONTA:
 *
 * `ai_pricing`/`ai_models` têm entrada e saída, não têm cache. O upstream cobra
 * o token lido do cache a preço de entrada cheio. A MIA cobra a 10% da entrada
 * (o desconto que a OpenAI pratica na família do catálogo, e o mesmo fator que
 * `pricing.ts` usa nos Claude), e o token ESCRITO no cache a preço de entrada —
 * a OpenAI não cobra a escrita à parte. Aproximação declarada e conferível: o
 * cron `gasto-openai` grava o que a OpenAI COBROU (`platform_openai_spend`) ao
 * lado do que o sistema mediu, e a diferença é a margem desta conta. Cobrar o
 * cache cheio faria o saldo do provedor (`lib/ai/custo/saldo.ts`) cair mais
 * rápido no painel do que na fatura.
 */
import type { PrecoDaInstalacao } from './pricing-do-catalogo';

/** USD por MILHÃO de tokens, como o resto do motor conta. */
export interface TarifaDoCatalogo {
  input: number;
  output: number;
}

/** A linha de preço do upstream (centavos por milhão) na unidade desta conta. */
export function tarifaDoPrecoDaInstalacao(preco: PrecoDaInstalacao): TarifaDoCatalogo {
  return {
    input: preco.entradaCentsPorMilhao / 100,
    output: preco.saidaCentsPorMilhao / 100,
  };
}

export interface TokensDaChamada {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Custo em CENTS (fracionário, como `pricing.ts`) pela tarifa do catálogo. */
export function custoPelaTarifa(tarifa: TarifaDoCatalogo, uso: TokensDaChamada): number {
  // `inputTokens` é o TOTAL do usage do SDK e já inclui o que veio do cache.
  const entradaNova = Math.max(0, uso.inputTokens - uso.cacheReadTokens);
  const usd =
    (entradaNova * tarifa.input + uso.cacheReadTokens * tarifa.input * 0.1 + uso.outputTokens * tarifa.output) /
    1_000_000;
  return usd * 100;
}
