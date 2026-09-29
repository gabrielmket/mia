/**
 * FORK MIA — a trava do módulo vendável pelo `resource` do `requireRole`.
 *
 * ── Por que aqui, e não em cada rota ──────────────────────────────────────
 *
 * Desde a .58 o caminho por QR do Broadcast são as Campanhas do upstream, e
 * elas ficam atrás do módulo `disparador` (docs/fork/broadcast-unificado.md).
 * São nove arquivos de rota do upstream; pôr a conferência em cada um seria
 * nove pontos de conflito a cada fusão, numa pasta que ele ainda muda toda
 * semana. Todas já chamam `requireRole(..., { resource })` com um nome estável
 * — é por ele que a trava as reconhece, com UMA chamada no `requireRole`.
 *
 * A fragilidade disso (o upstream renomear o `resource` e a trava sumir em
 * silêncio) é vigiada: `tests/unit/broadcast-unificado.test.ts` reprova quando
 * uma rota das pastas protegidas passa um recurso que este arquivo não conhece.
 *
 * ── Por que a leitura que falha RECUSA ────────────────────────────────────
 *
 * Mesmo contrato do `moduloLiberado`: liberar quando o banco não responde abriria
 * o módulo para todo mundo exatamente no minuto em que o banco oscila.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";

import { fail, type ApiError } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { moduloExigidoPeloRecurso } from "@/lib/broadcast/canais-do-disparo";
import { moduloLiberado } from "@/lib/modulos/liberacao";

export interface PedidoDeRecurso {
  db: SupabaseClient;
  organizationId: string;
  userId: string;
  resource: string | undefined;
  requestId?: string;
  t: (texto: string) => string;
}

/** A resposta de recusa, ou `null` para seguir. Recurso sem módulo nem consulta o banco. */
export async function recusaPorModulo(
  pedido: PedidoDeRecurso,
): Promise<NextResponse<ApiError> | null> {
  const modulo = moduloExigidoPeloRecurso(pedido.resource);
  if (!modulo) return null;
  if (await moduloLiberado(pedido.db, pedido.organizationId, modulo)) return null;

  // Recusa por módulo é autorização negada, e aparece onde as outras aparecem
  // (auditoria `authz.denied`), com o motivo que a distingue da falta de papel.
  void audit({
    action: "authz.denied",
    actorUserId: pedido.userId,
    organizationId: pedido.organizationId,
    resourceType: pedido.resource ?? null,
    requestId: pedido.requestId,
    metadata: { reason: "modulo_nao_contratado", modulo },
  });
  return fail(
    "forbidden",
    pedido.t("O Broadcast não está contratado para esta empresa."),
    403,
    { requestId: pedido.requestId },
  );
}
