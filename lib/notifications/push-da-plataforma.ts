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
 * ── Por que o envio é daqui, e não de `web_push.ts` (.86) ─────────────────
 *
 * Até a .85 isto reaproveitava `enviarPushDaOrg` com uma lista pronta. A v1.87
 * do upstream fez o push seguir o VÍNCULO de quem recebe (só membro ativo da
 * organização, com o papel mínimo) e a opção da empresa para a tela bloqueada.
 * Um aviso da plataforma não tem organização, então passar por ali calaria o
 * aviso para todo mundo. O envio continua com as MESMAS peças do upstream: o
 * VAPID (`./vapid.ts`), a lista de serviços de push conhecidos
 * (`./servicos-de-push.ts`) e a montagem campo a campo da tela bloqueada
 * (`redigirParaATelaBloqueada`, no modo que mostra tudo: o aviso da instalação
 * não carrega dado de cliente). A assinatura expirada (404/410) é apagada.
 *
 * Nunca lança: o aviso já está registrado (o incidente) quando isto roda, e o
 * push é a campainha, não o registro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

import type { PushPayload } from "./push_payload";
import { ehServicoDePushConhecido } from "./servicos-de-push";
import { redigirParaATelaBloqueada } from "./tela-bloqueada";
import { vapidPronto, vapidPublica, vapidSubject } from "./vapid";

type Assinatura = { id: string; endpoint: string; p256dh: string; auth: string };

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
    const linhas = ((assinaturas ?? []) as Assinatura[]).filter((a) => ehServicoDePushConhecido(a.endpoint));
    if (linhas.length === 0) return { admins: ids.length, sent: 0, gone: 0 };

    const corpo = JSON.stringify(redigirParaATelaBloqueada(payload, "nome_e_previa", "pt-BR"));
    webpush.setVapidDetails(await vapidSubject(), vapidPublica()!, env.VAPID_PRIVATE_KEY.trim());

    let sent = 0;
    let gone = 0;
    await Promise.all(
      linhas.map(async (linha) => {
        try {
          await webpush.sendNotification(
            { endpoint: linha.endpoint, keys: { p256dh: linha.p256dh, auth: linha.auth } },
            corpo,
          );
          sent += 1;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            gone += 1;
            await admin.from("push_subscriptions").delete().eq("id", linha.id);
            return;
          }
          logger.warn("[push-da-plataforma] envio falhou", { status: status ?? 0 });
        }
      }),
    );
    return { admins: ids.length, sent, gone };
  } catch (err) {
    logger.warn("[push-da-plataforma] falhou", { detail: err instanceof Error ? err.message : "erro" });
    return { admins: 0, sent: 0, gone: 0 };
  }
}
