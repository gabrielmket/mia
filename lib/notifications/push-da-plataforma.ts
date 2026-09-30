/**
 * FORK MIA (.62) — push para os ADMINISTRADORES DA PLATAFORMA.
 *
 * O push do produto é por organização (`enviarPushDaOrg`) ou por pessoa dentro
 * de uma organização (`enviarPushAoUsuario`): ele existe para quem atende. Um
 * aviso da INSTALAÇÃO — o backup do banco parou — não é de organização nenhuma,
 * e tem de chegar a quem opera a plataforma (`platform_admins` sem
 * `revoked_at`), em qualquer aparelho em que essa pessoa tenha ligado o push,
 * seja qual for a organização ativa na hora em que ligou.
 *
 * Reaproveita o envio de `web_push.ts` (a limpeza de assinatura expirada e o
 * log de falha são os mesmos), só trocando QUEM recebe.
 *
 * Nunca lança: o aviso já está registrado (o incidente) quando isto roda, e o
 * push é a campainha, não o registro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import type { PushPayload } from "./push_payload";
import { vapidPronto } from "./vapid";
import { enviarPushDaOrg, type PushSubRow } from "./web_push";

export async function enviarPushAosAdminsDaPlataforma(
  admin: SupabaseClient,
  payload: PushPayload,
): Promise<{ admins: number; sent: number; gone: number }> {
  try {
    if (!vapidPronto()) return { admins: 0, sent: 0, gone: 0 };

    const { data: admins, error: erroAdmins } = await admin
      .from("platform_admins")
      .select("user_id")
      .is("revoked_at", null);
    if (erroAdmins) {
      logger.warn("[push-da-plataforma] não li os administradores", { detail: erroAdmins.message });
      return { admins: 0, sent: 0, gone: 0 };
    }
    const ids = ((admins ?? []) as Array<{ user_id: string }>).map((a) => a.user_id);
    if (ids.length === 0) return { admins: 0, sent: 0, gone: 0 };

    const { data: assinaturas, error } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", ids);
    if (error) {
      logger.warn("[push-da-plataforma] não li as assinaturas", { detail: error.message });
      return { admins: ids.length, sent: 0, gone: 0 };
    }

    // O envio de `web_push.ts` lê as assinaturas "da organização"; aqui a lista
    // já vem pronta (as dos administradores), e a remoção da expirada continua
    // indo ao banco de verdade.
    const r = await enviarPushDaOrg("plataforma", payload, {
      from: (tabela: string) => ({
        select: () => ({
          eq: async () => ({ data: (assinaturas ?? []) as PushSubRow[], error: null }),
        }),
        delete: () => ({
          eq: async (coluna: string, valor: string) => {
            const { error: erro } = await admin.from(tabela).delete().eq(coluna, valor);
            return { error: erro };
          },
        }),
      }),
    });
    return { admins: ids.length, ...r };
  } catch (err) {
    logger.warn("[push-da-plataforma] falhou", { detail: err instanceof Error ? err.message : "erro" });
    return { admins: 0, sent: 0, gone: 0 };
  }
}
