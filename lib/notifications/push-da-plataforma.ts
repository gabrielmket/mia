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
 * Desde a v1.87 o push do upstream segue o VÍNCULO de quem recebe (membro ativo
 * da organização) e a opção da empresa para a tela bloqueada; passar por
 * `enviarPushDaOrg` calaria o aviso da instalação. Por isso ele sai pela porta
 * própria do MESMO funil (`enviarPushAsInscricoesDaPlataforma`, em
 * `./web_push.ts`), que guarda o VAPID, os serviços de push conhecidos, a
 * redação campo a campo e a limpeza da inscrição expirada (.86).
 *
 * Nunca lança: o aviso já está registrado (o incidente) quando isto roda, e o
 * push é a campainha, não o registro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import type { PushPayload } from "./push_payload";
import { vapidPronto } from "./vapid";
import { enviarPushAsInscricoesDaPlataforma, type PushSubRow } from "./web_push";

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
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", ids);
    if (error) {
      logger.warn("[push-da-plataforma] não li as assinaturas", { detail: error.message });
      return { admins: ids.length, sent: 0, gone: 0 };
    }

    const r = await enviarPushAsInscricoesDaPlataforma(
      (assinaturas ?? []) as Array<PushSubRow & { user_id: string }>,
      payload,
      admin as unknown as Parameters<typeof enviarPushAsInscricoesDaPlataforma>[2],
    );
    return { admins: ids.length, ...r };
  } catch (err) {
    logger.warn("[push-da-plataforma] falhou", { detail: err instanceof Error ? err.message : "erro" });
    return { admins: 0, sent: 0, gone: 0 };
  }
}
