/**
 * FORK MIA (.88) — o aviso no SINO de uma pessoa, pelo assistente da MIA.
 *
 * Três momentos: o "Pedir à pessoa" (alguém sem permissão pede a quem pode), a
 * resposta da Time a um chamado e o resumo da manhã. Os três são avisos da
 * Central para UMA pessoa (`agent_inbox_items.para_user_id`, 0689), `kind`
 * `other`, que é como o fork pendura aviso próprio sem reconstruir a constraint
 * do upstream (docs/FORK-MIA.md, regra 3). O botão sai de
 * `REFERENCIAS_DE_AVISO` (`mia_chamado`, `mia_assistente_resumo`).
 *
 * O aviso `other` não vai ao celular sozinho (`sons-da-org.ts`): quando o
 * momento pede, o push sai pela porta única (`enviarPushAoUsuario`).
 *
 * Servidor: grava com o cliente de serviço e a organização de fonte confiável
 * (a sessão de quem pediu, o token de plataforma, o cron). Nunca lança.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { truncar } from "@/lib/notifications/push_payload";
import { enviarPushAoUsuario } from "@/lib/notifications/web_push";

export async function avisarNoSino(
  admin: SupabaseClient,
  aviso: {
    organizationId: string;
    paraUserId: string;
    titulo: string;
    corpo: string | null;
    refKind: "mia_chamado" | "mia_assistente_resumo" | null;
    refId: string | null;
    severidade?: "info" | "warn";
    /** Também no celular, pela porta única do push. */
    push?: { titulo: string; href: string; tag: string };
  },
): Promise<boolean> {
  try {
    const { error } = await admin.from("agent_inbox_items").insert({
      organization_id: aviso.organizationId,
      para_user_id: aviso.paraUserId,
      kind: "other",
      severity: aviso.severidade ?? "info",
      title: aviso.titulo.slice(0, 200),
      body: aviso.corpo ? aviso.corpo.slice(0, 1000) : null,
      ref_kind: aviso.refKind,
      ref_id: aviso.refId,
    });
    if (error) {
      logger.warn("[assistente] o aviso da Central não foi gravado", {
        organizationId: aviso.organizationId,
        erro: error.message,
      });
      return false;
    }
    if (aviso.push) {
      await enviarPushAoUsuario(aviso.organizationId, aviso.paraUserId, {
        title: aviso.push.titulo,
        body: truncar(aviso.titulo),
        tag: aviso.push.tag,
        href: aviso.push.href,
      }).catch(() => undefined);
    }
    return true;
  } catch (erro) {
    logger.warn("[assistente] o aviso da Central falhou", {
      organizationId: aviso.organizationId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return false;
  }
}
