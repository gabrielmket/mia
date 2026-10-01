/**
 * FORK MIA — OBRIGAÇÕES · a recusa, na porta, da regra que nunca dispararia.
 *
 * Três dos cinco gatilhos de obrigação precisam de um X (dias). Sem ele a
 * varredura não sabe em que dia agir: a regra seria salva, a tela diria "criada"
 * e nada aconteceria. Mesma recusa dos gatilhos de data e de tempo do upstream
 * (`lib/schemas/webhooks.ts`), onde este refinamento entra por uma linha.
 */
import type { z } from "zod";

import { configDoGatilhoDeObrigacao, ehGatilhoDeObrigacao, gatilhoPedeDias } from "./gatilhos";

export function exigirConfigDoGatilhoDeObrigacao(
  regra: { trigger_event?: string; trigger_config?: Record<string, unknown> },
  ctx: z.RefinementCtx,
): void {
  const evento = regra.trigger_event;
  if (!evento || !ehGatilhoDeObrigacao(evento)) return;
  if (configDoGatilhoDeObrigacao(evento, regra.trigger_config)) return;
  ctx.addIssue({
    code: "custom",
    path: ["trigger_config"],
    message: gatilhoPedeDias(evento)
      ? "Diga com quantos dias a regra dispara (de 1 a 3650)."
      : "A configuração do gatilho de obrigação não foi aceita.",
  });
}
