/**
 * Adapter fino que pluga `aplicaGatilhoDeLead` no dispatcher do `event_log`.
 * A decisão fica em `gatilho-lead.ts`; aqui só a ligação com o client real.
 */
import type { EventHandler, HandlerResult } from "@/lib/event-log/dispatcher";
import { logger } from "@/lib/logger";
import { MOTIVO_LEGIVEL } from "@/lib/followup/numero-do-gatilho";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseFollowupGateDb } from "@/lib/followup/agent-followup-gate";
import {
  EVENTO_DE_LEAD_CRIADO,
  aplicaGatilhoDeLead,
  createSupabaseGatilhoLeadDb,
} from "@/lib/followup/gatilho-lead";

export const FOLLOWUP_GATILHO_LEAD_HANDLER_KEY = "followup-gatilho-lead.v1";

export const followupGatilhoLeadHandler: EventHandler = {
  key: FOLLOWUP_GATILHO_LEAD_HANDLER_KEY,
  naOrgParada: "pula",
  events: [EVENTO_DE_LEAD_CRIADO],
  async handle(row): Promise<HandlerResult> {
    try {
      const admin = createAdminClient();
      const summary = await aplicaGatilhoDeLead(
        {
          db: createSupabaseGatilhoLeadDb(admin),
          gateDb: createSupabaseFollowupGateDb(admin),
          clock: () => new Date(),
        },
        row,
      );
      // FORK MIA — número escolhido no gatilho que não pôde sair. O lead não foi
      // inscrito por ele nem por outro; o log leva o motivo por fluxo, e o
      // `detail` (gravado em `event_log.last_error` quando o evento é `skipped`)
      // leva a contagem com os motivos.
      const numeros = summary.numero_indisponivel ?? [];
      for (const n of numeros) {
        logger.warn("followup_gatilho_lead_numero_indisponivel", {
          organization_id: row.organization_id,
          event_id: row.id,
          pointer_id: n.pointer_id,
          channel_session_id: n.channel_session_id,
          motivo: n.motivo,
          explicacao: MOTIVO_LEGIVEL[n.motivo],
        });
      }
      return {
        consumer_key: FOLLOWUP_GATILHO_LEAD_HANDLER_KEY,
        status: summary.matched && summary.enrolled > 0 ? "ok" : "skipped",
        detail:
          `armados=${summary.pointers_armados} enrolled=${summary.enrolled} ` +
          `origem_obsoleta=${summary.skipped_stale_origin ?? 0} ja_vivo=${summary.skipped_existing} gate=${summary.pointers_barrados_pelo_gate} ` +
          `sem_contato=${summary.sem_contato} planilha=${summary.vindos_de_planilha}` +
          (numeros.length > 0
            ? ` numero_indisponivel=${numeros.length} (${numeros.map((n) => n.motivo).join(",")})`
            : ""),
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { consumer_key: FOLLOWUP_GATILHO_LEAD_HANDLER_KEY, status: "error", detail };
    }
  },
};
