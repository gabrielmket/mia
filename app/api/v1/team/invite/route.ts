import type { EmailDeliveryError } from "@/lib/email/roteador";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { issueInvite } from "@/lib/auth/issue-invite";
import { emitirConvite } from "@/lib/team/convites";
import { isServiceRoleConfigured } from "@/lib/audit";
/**
 * POST /api/v1/team/invite — bulk-invite up to 20 emails.
 *
 * O que viaja no e-mail é um token HMAC stateless (`lib/auth/invite-token.ts`).
 * Quando o service-role está configurado, cada convite também vira uma linha em
 * `team_invites` (migration 0238) — é o que a tela de Equipe lista e o que
 * torna a revogação possível. Reconvidar um e-mail com convite pendente RENOVA
 * a linha. Sem service-role, degrada para só-token (nada some, só não persiste).
 *
 * Se o e-mail já tem membership ATIVA na org, pula com `already_member`.
 *
 * Membership row is created at /accept-invite time (Server Action) — that's
 * also when audit emits `member.accepted`. Here we audit `member.invited`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { ApiError } from "@/lib/api/types";

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteMemberSchema, validateRequest } from "@/lib/schemas";
// FORK MIA (9020): o convite que o banco não gravou tem nome, motivo e registro.
import { logger } from "@/lib/logger";
import { ConviteNaoGravadoError, MOTIVO_CONVITE_NAO_GRAVADO } from "@/lib/team/convite-nao-gravado";

export const dynamic = "force-dynamic";

interface SentItem {
  email: string;
  invite_id: string;
  expires_at: string;
  email_dispatched: boolean;
  /** Por que não saiu, quando não saiu. Vocabulário de `lib/email/roteador.ts`. */
  email_error?: EmailDeliveryError;
  accept_url: string;
}
interface FailedItem {
  email: string;
  reason: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  let input;
  try {
    input = await validateRequest(inviteMemberSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const sent: SentItem[] = [];
  const failed: FailedItem[] = [];

  const admin = isServiceRoleConfigured() ? createAdminClient() : null;
  const inviterName = authUser.full_name ?? authUser.email ?? "Um colega";
  // Emails com membership ATIVA na org — para pular o reconvite de quem já é membro.
  // O schema `auth` NÃO é acessível via PostgREST (erro "Invalid schema: auth"), então
  // resolvemos email↔usuário pela GoTrue admin API (getUserById) — mesmo padrão de
  // app/api/v1/team/route.ts. N pequeno (poucos membros por org no perfil BPO).
  const memberEmails = new Set<string>();
  if (admin) {
    const { data: members } = await admin
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", activeOrg.orgId)
      .is("revoked_at", null);
    for (const m of members ?? []) {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id as string);
      const memberEmail = u?.user?.email?.trim().toLowerCase();
      if (memberEmail) memberEmails.add(memberEmail);
    }
  }

  for (const inv of input.invitations) {
    const email = inv.email.trim().toLowerCase();

    // já é membro ativo → pula (não reenvia convite)
    if (memberEmails.has(email)) {
      failed.push({ email, reason: "already_member" });
      continue;
    }

    if (admin) {
      // FORK MIA (9020): convite que o banco não gravou vira um item de `failed`
      // com motivo, e o lote segue. Antes o erro cru subia e a rota respondia
      // "Erro interno" para o lote inteiro, inclusive para os convites que já
      // tinham saído. Nesse ponto nada saiu nem foi auditado para ESTE e-mail
      // (`emitirConvite` grava a linha antes do e-mail). Qualquer outro erro
      // continua subindo.
      let emitido;
      try {
        emitido = await emitirConvite(admin, {
          email,
          role: inv.role,
          interfaceSettings: inv.interface_settings,
          organizationId: activeOrg.orgId,
          orgName: activeOrg.name,
          inviterId: authUser.id,
          inviterName,
          requestId,
        });
      } catch (err) {
        if (!(err instanceof ConviteNaoGravadoError)) throw err;
        // Sem o e-mail do convidado: registro de servidor não leva dado pessoal.
        logger.error("[team.invite] o convite não foi gravado", {
          request_id: requestId,
          organization_id: activeOrg.orgId,
          codigo: err.codigoDoBanco,
        });
        failed.push({ email, reason: MOTIVO_CONVITE_NAO_GRAVADO });
        continue;
      }
      const { convite, accept_url, email_dispatched, email_error } = emitido;
      sent.push({
        email,
        invite_id: convite.id,
        expires_at: convite.expires_at,
        email_dispatched,
        email_error,
        accept_url,
      });
    } else {
      sent.push(
        await issueInvite({
          email,
          role: inv.role,
          interfaceSettings: inv.interface_settings,
          organizationId: activeOrg.orgId,
          orgName: activeOrg.name,
          inviterId: authUser.id,
          inviterName,
          requestId,
        }),
      );
    }
  }

  return ok({ sent, failed }, { status: 201, requestId });
}
