/**
 * GET/POST /api/v1/cron/ia-pendente · FORK MIA (.107).
 *
 * A IA responde a mensagem do cliente que chegou enquanto ela estava calada,
 * quando o silêncio acaba. O caso medido: a equipe manda "ola" pela tela (5 min
 * de silêncio), o cliente responde 21 s depois, o pedido de turno é descartado
 * pela elegibilidade (`conversa_silenciada`), o silêncio vence e ninguém pede o
 * turno de novo. O mesmo vale para o silêncio do atendimento pelo celular.
 *
 * Esta rota só autentica, chama a varredura e audita. A regra (quem entra, as
 * cercas de tempo, por que ela não acorda conversa antiga em massa) mora em
 * `lib/escalacao/mensagem-pendente.ts` (`varrerFimDoSilencio`), e cada pedido
 * passa por `pedirTurnoDaMensagemPendente`, a MESMA função da devolução.
 *
 * A cada minuto: o silêncio da tela é de 5 min, e um minuto de atraso sobre o
 * fim dele é o que o cliente espera a mais. Barata quando não há nada: uma
 * leitura pelo índice parcial de `bot_silenced_until`.
 *
 * Auth: o mesmo contrato dos demais crons (`autorizaCron`, fail-closed).
 * Audita SÓ quando pediu turno ou falhou (`tests/unit/cron-audita-so-quando-ha-efeito.test.ts`).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { varrerFimDoSilencio, type ResultadoDoFimDoSilencio } from "@/lib/escalacao/mensagem-pendente";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  let resultado: ResultadoDoFimDoSilencio;
  try {
    resultado = await varrerFimDoSilencio(createAdminClient(), { requestId });
  } catch (err) {
    logger.error("[ia-pendente] varredura falhou", {
      error: err instanceof Error ? err.message : String(err),
      requestId,
    });
    return fail("internal_error", "Failed to scan conversations.", 500, { requestId });
  }

  if (resultado.pedidas > 0 || resultado.falhas > 0) {
    void audit({
      action: "conversation.pending_reply_requested_run",
      organizationId: null,
      bypassedRls: true,
      metadata: { ...resultado },
      requestId,
    });
  }

  return ok(resultado, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
