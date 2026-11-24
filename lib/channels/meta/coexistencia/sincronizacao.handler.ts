/**
 * FORK MIA · coexistência (S3): o consumidor de `coexistencia.sincronizacao_requested`.
 *
 * A conexão pelo app (`conectar.ts`) abre o ciclo e pede; este handler faz os
 * dois pedidos à Meta (`sincronizacao.ts`), cada um atrás da trava do banco.
 * Registrado em `lib/channels/consumidores.ts`.
 *
 * `naOrgParada: "roda"`: é ENTRADA (os contatos e a conversa que a empresa já
 * tem no app), sem custo e sem mensagem a ninguém. E o prazo da Meta é de 24
 * horas: segurar o pedido por causa da empresa parada queimaria a única chance.
 *
 * Desfechos: `ok` com o resultado de cada pedido; `error` quando o banco falhou
 * (o `event_log` refaz com recuo, e a trava garante que o que já saiu não sai
 * de novo); `skipped` sem `conexao_id`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

import { EVENTO_DA_SINCRONIZACAO, pedirSincronizacao, type DependenciasDoPedido } from "./sincronizacao";

export const CONSUMIDOR_DA_SINCRONIZACAO = "coexistencia.pedido_da_sincronizacao";

const resultado = (status: HandlerResult["status"], detail?: string): HandlerResult => ({
  consumer_key: CONSUMIDOR_DA_SINCRONIZACAO,
  status,
  ...(detail ? { detail } : {}),
});

export async function tratarPedidoDaSincronizacao(
  row: EventRow,
  deps: { admin?: SupabaseClient } & DependenciasDoPedido = {},
): Promise<HandlerResult> {
  const conexaoId = typeof row.payload?.conexao_id === "string" ? row.payload.conexao_id : null;
  const organizationId = typeof row.organization_id === "string" ? row.organization_id : null;
  if (!conexaoId || !organizationId) return resultado("skipped", "sem_conexao_id");
  const admin = deps.admin ?? createAdminClient();
  try {
    const r = await pedirSincronizacao(admin, { organizationId, conexaoId }, deps);
    return resultado("ok", `contatos=${r.contatos} historico=${r.historico}`);
  } catch (err) {
    return resultado("error", err instanceof Error ? err.message : String(err));
  }
}

export const pedidoDaSincronizacaoHandler: EventHandler = {
  key: CONSUMIDOR_DA_SINCRONIZACAO,
  naOrgParada: "roda",
  events: [EVENTO_DA_SINCRONIZACAO],
  handle: (row) => tratarPedidoDaSincronizacao(row),
};
