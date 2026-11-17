/**
 * FORK MIA · coexistência (S2): o consumidor de `coexistencia.lote_requested`.
 *
 * A rota do webhook guarda o lote do histórico e pede; este handler grava
 * (`gravar-lote.ts`). Registrado em `lib/channels/consumidores.ts`, o ponto por
 * onde os consumidores dos canais entram sem nomear provedor fora de
 * `lib/channels/`.
 *
 * `naOrgParada: "roda"`: é ENTRADA (a conversa que a empresa já teve), escrita
 * interna, sem custo e sem nada que saia para fora. A empresa parada continua
 * recebendo o que é dela, como recebe as mensagens ao vivo.
 *
 * Desfechos: `retry` (com hora) para a mídia que chegou antes da mensagem;
 * `error` para a falha que vale tentar de novo (o `event_log` refaz com
 * recuo); `skipped` quando o lote desistiu na 3ª falha (o pedido conta a
 * falha, e não é caso para o aviso de evento morto).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

import { gravarLoteDoHistorico } from "./gravar-lote";
import { EVENTO_DO_LOTE } from "./receber";

export const CONSUMIDOR_DO_LOTE = "coexistencia.lote_do_historico";

const resultado = (status: HandlerResult["status"], detail?: string, retryAt?: number): HandlerResult => ({
  consumer_key: CONSUMIDOR_DO_LOTE,
  status,
  ...(detail ? { detail } : {}),
  ...(retryAt !== undefined ? { retry_at: new Date(retryAt).toISOString() } : {}),
});

export async function tratarLoteDoHistorico(
  row: EventRow,
  deps: { admin?: SupabaseClient; agora?: () => number } = {},
): Promise<HandlerResult> {
  const loteId = typeof row.payload?.lote_id === "string" ? row.payload.lote_id : null;
  if (!loteId) return resultado("skipped", "sem_lote_id");
  const admin = deps.admin ?? createAdminClient();
  const r = await gravarLoteDoHistorico(admin, loteId, { agora: deps.agora });
  switch (r.status) {
    case "gravado":
      return resultado("ok", `mensagens=${r.contagem.mensagens} existentes=${r.contagem.existentes}`);
    case "ja_gravado":
      return resultado("ok", "ja_gravado");
    case "sumiu":
      return resultado("skipped", "lote_sumiu");
    case "esperar":
      return resultado("retry", "midia_espera_a_mensagem", r.ate);
    case "desistiu":
      logger.error("[meta.coexistencia] lote do histórico desistiu", { lote_id: loteId, erro: r.erro });
      return resultado("skipped", `desistiu:${r.erro}`);
    case "tentar_de_novo":
      return resultado("error", r.erro);
  }
}

export const loteDoHistoricoHandler: EventHandler = {
  key: CONSUMIDOR_DO_LOTE,
  naOrgParada: "roda",
  events: [EVENTO_DO_LOTE],
  handle: (row) => tratarLoteDoHistorico(row),
};
