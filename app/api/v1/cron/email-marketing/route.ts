/**
 * FORK MIA (.89) — GET/POST /api/v1/cron/email-marketing: o motor do disparo de
 * e-mail marketing (`lib/email-marketing/motor.ts`), a cada minuto.
 *
 * Manda no ritmo de cada campanha, dentro da janela e dos dias úteis da
 * empresa e do teto do aquecimento do domínio; pausa sozinho pela trava de
 * saúde, pela falta de saldo, pela empresa de demonstração ou pelo domínio que
 * deixou de estar verificado; cobra por lote o que a Amazon aceitou; e conclui
 * a campanha que acabou. Envio preso vira falha, nunca reenvio.
 *
 * Organização parada (suspensa, redigida, arquivada) não dispara: a régua do
 * upstream (`lib/organizacao/operante.ts`, `ehOperante`) filtra as campanhas no
 * motor, como no `broadcast-worker`.
 *
 * Sem as chaves da Amazon a rodada não faz nada (o módulo está desligado).
 * Rodada sem efeito não audita (`cron-audita-so-quando-ha-efeito`).
 *
 * Auth: o mesmo contrato dos demais crons (Bearer `INTERNAL_CRON_SECRET` |
 * `INTERNAL_SECRET`, fail-closed). No scheduler, `$SEGREDO_DO_CRON`.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { rodadaDoEmailMarketing } from "@/lib/email-marketing/motor";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handler(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("unauthorized", "cron secret ausente ou inválido", 401, { requestId });
  }
  try {
    const r = await rodadaDoEmailMarketing(createAdminClient(), { prazoMs: 45_000 });
    const comEfeito = r.campanhas.filter(
      (c) => c.enviados > 0 || c.pulados > 0 || c.falhas > 0 || c.parou || c.concluiu,
    );
    if (comEfeito.length > 0 || r.presos > 0) {
      void audit({
        action: "email_marketing.rodada",
        resourceType: "mia_email_campanhas",
        requestId,
        metadata: { campanhas: comEfeito, presos: r.presos },
      });
      logger.info("[email-marketing] rodada", {
        request_id: requestId,
        campanhas: comEfeito.length,
        presos: r.presos,
      });
    }
    return ok({ rodou: r.campanhas.length > 0, ...r }, { requestId });
  } catch (err) {
    logger.error("[email-marketing] a rodada falhou", {
      request_id: requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail("internal_error", "a rodada do e-mail marketing falhou", 500, { requestId });
  }
}

export const GET = handler;
export const POST = handler;
