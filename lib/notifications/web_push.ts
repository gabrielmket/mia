import webpush from "web-push";

import { roleAtLeast, type Role } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { vapidPronto, vapidPublica, vapidSubject } from "./vapid";
import { ehServicoDePushConhecido } from "./servicos-de-push";
import type { PushPayload } from "./push_payload";
import { lerTelaBloqueada, redigirParaATelaBloqueada } from "./tela-bloqueada";

type Admin = ReturnType<typeof createAdminClient>;

export type PushSubRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type Inscricao = PushSubRow & { user_id: string };

const NADA = { sent: 0, gone: 0 } as const;

/**
 * Quem tem vínculo ativo na organização — e, com `papelMinimo`, o papel que o
 * alcança. `null` quando a leitura falha: ninguém recebe.
 */
async function membrosAtivos(
  admin: Admin,
  organizationId: string,
  papelMinimo?: Role,
): Promise<Set<string> | null> {
  const { data, error } = await admin
    .from("user_organizations")
    .select("user_id, role")
    .eq("organization_id", organizationId)
    .is("revoked_at", null);
  if (error) {
    logger.warn("push_membros_ativos_falhou", { detail: error.message });
    return null;
  }
  const membros = (data ?? []) as Array<{ user_id: string; role: string | null }>;
  return new Set(
    membros.filter((m) => !papelMinimo || roleAtLeast(m.role, papelMinimo)).map((m) => m.user_id),
  );
}

/**
 * O FUNIL: todo push do produto sai daqui, e só daqui (vigiado por
 * `tests/unit/push-sai-so-pelo-funil.test.ts`). Só sai para inscrições de quem
 * tem vínculo ativo na organização (e o papel mínimo, quando pedido), e só para
 * serviço de push conhecido (`servicos-de-push.ts`). A regra de host mora no
 * envio, não só na rota de inscrição: vale para toda linha gravada, qualquer
 * que seja a origem. O conteúdo segue a opção da empresa sobre o que aparece
 * com a tela bloqueada (`./tela-bloqueada.ts`). Inscrição morta (404/410) é
 * apagada.
 */
async function enviarAsInscricoes(
  admin: Admin,
  // FORK MIA (.86): `null` é o aviso da INSTALAÇÃO aos administradores da
  // plataforma (`enviarPushAsInscricoesDaPlataforma`, abaixo): não há vínculo de
  // organização a conferir nem opção de empresa para a tela bloqueada.
  organizationId: string | null,
  inscricoes: Inscricao[],
  payload: PushPayload,
  papelMinimo?: Role,
): Promise<{ sent: number; gone: number }> {
  const conhecidas = inscricoes.filter((i) => ehServicoDePushConhecido(i.endpoint));
  if (conhecidas.length === 0) return NADA;
  let rows = conhecidas;
  if (organizationId !== null) {
    const membros = await membrosAtivos(admin, organizationId, papelMinimo);
    if (!membros) return NADA;
    rows = conhecidas.filter((i) => membros.has(i.user_id));
  }
  if (rows.length === 0) return NADA;

  // FORK MIA (.86): o aviso da instalação não carrega dado de cliente, e sai
  // inteiro — pela MESMA redação campo a campo, no modo que mostra tudo.
  const { modo, idioma } =
    organizationId === null
      ? { modo: "nome_e_previa" as const, idioma: "pt-BR" as const }
      : await lerTelaBloqueada(admin, organizationId);
  const body = JSON.stringify(redigirParaATelaBloqueada(payload, modo, idioma));

  webpush.setVapidDetails(await vapidSubject(), vapidPublica()!, env.VAPID_PRIVATE_KEY.trim());

  let sent = 0;
  let gone = 0;

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          body,
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          gone += 1;
          const apagar = admin.from("push_subscriptions").delete().eq("id", row.id);
          // FORK MIA (.86): a inscrição do administrador da plataforma pode ser de qualquer organização.
          await (organizationId === null ? apagar : apagar.eq("organization_id", organizationId));
          return;
        }
        logger.warn("web_push_send_failed", { status: status ?? 0 });
      }
    }),
  );

  return { sent, gone };
}

export type DestinoDoPush = { soUsuario?: string; papelMinimo?: Role };

/**
 * FORK MIA (.62, revisto na .86) — o push aos ADMINISTRADORES DA PLATAFORMA
 * (`./push-da-plataforma.ts`): o aviso da instalação (o backup parou) não é de
 * organização nenhuma. As inscrições chegam prontas (as dos administradores), e
 * o envio passa por este funil, como todo push (`push-sai-so-pelo-funil`).
 */
export async function enviarPushAsInscricoesDaPlataforma(
  inscricoes: ReadonlyArray<PushSubRow & { user_id: string }>,
  payload: PushPayload,
  admin: Admin = createAdminClient(),
): Promise<{ sent: number; gone: number }> {
  if (!vapidPronto()) return NADA;
  return enviarAsInscricoes(admin, null, [...inscricoes], payload);
}

/** Push às inscrições da organização — ou só às de `soUsuario`, e só a quem alcança `papelMinimo`. */
export async function enviarPushDaOrg(
  organizationId: string,
  payload: PushPayload,
  quem: DestinoDoPush = {},
  admin: Admin = createAdminClient(),
): Promise<{ sent: number; gone: number }> {
  if (!vapidPronto()) return NADA;

  let query = admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .eq("organization_id", organizationId);
  if (quem.soUsuario) query = query.eq("user_id", quem.soUsuario);
  const { data, error } = await query;
  if (error) {
    logger.warn("push_subscriptions_list_failed", { detail: error.message });
    return NADA;
  }
  return enviarAsInscricoes(admin, organizationId, (data ?? []) as Inscricao[], payload, quem.papelMinimo);
}

export async function enviarPushAoUsuario(
  organizationId: string,
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; gone: number }> {
  return enviarPushDaOrg(organizationId, payload, { soUsuario: userId });
}

/**
 * Push de mensagem recebida: só às inscrições de quem PODE VER a conversa.
 *
 * Quem decide é `fn_can_view_conversation` (a RLS de `conversations`), avaliada
 * para cada inscrito por `fn_push_inscricoes_que_veem_a_conversa` — a regra não
 * é repetida aqui. Falha na leitura não envia a ninguém.
 *
 * `soUsuarios` é a lista de quem DEVE ser avisado (`./destinatarios-da-mensagem.ts`);
 * ela só estreita o conjunto, nunca alarga além de quem pode ver.
 */
export async function enviarPushAQuemVeAConversa(
  organizationId: string,
  conversationId: string,
  payload: PushPayload,
  soUsuarios?: ReadonlyArray<string>,
  admin: Admin = createAdminClient(),
): Promise<{ sent: number; gone: number }> {
  if (!vapidPronto() || soUsuarios?.length === 0) return NADA;
  const { data, error } = await admin.rpc("fn_push_inscricoes_que_veem_a_conversa", {
    p_org: organizationId,
    p_conversation: conversationId,
  });
  if (error) {
    logger.warn("push_subscriptions_visible_list_failed", { detail: error.message });
    return NADA;
  }
  // O admin client não é tipado pelo schema: a forma vem de `lib/database.types.ts`.
  const visiveis: Inscricao[] = data ?? [];
  const linhas = visiveis.filter((l) => !soUsuarios || soUsuarios.includes(l.user_id));
  return enviarAsInscricoes(admin, organizationId, linhas, payload);
}
