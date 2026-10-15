/**
 * FORK MIA (9023) — POST /api/v1/team/invites/[id]/link-curto
 *
 * "Copiar link do convite", na lista de convites da aba Membros: GERA um link
 * curto novo (`/c/<código>`) para um convite pendente e o devolve para a tela
 * copiar. O código cru não fica guardado (só o hash, `lib/team/link-curto.ts`),
 * então não há como "mostrar o link de novo": cada pedido gera outro, e o
 * anterior deste convite, inclusive o que foi no e-mail, deixa de valer.
 *
 * A mesma permissão de reenviar e revogar (admin da empresa, fora do
 * acompanhamento só-leitura do suporte). Não manda e-mail e não muda o prazo:
 * convite vencido é recusado com a saída (Reenviar renova). Funciona na empresa
 * de demonstração, como o próprio convite (9020).
 *
 * Audita `member.invite_link_created` (quem, qual convite), sem o código.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { trocarLinkCurto } from "@/lib/team/link-curto";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user: authUser, org: activeOrg } = authz;

  if (!z.string().uuid().safeParse(id).success) {
    return fail("invalid_request", t("Convite inválido."), 400, { requestId });
  }
  // Sem o service-role não há linha de convite, e sem linha não há onde guardar o código.
  if (!isServiceRoleConfigured()) {
    return fail("unavailable", t("O link curto do convite não está disponível nesta instalação."), 503, {
      requestId,
    });
  }

  const resultado = await trocarLinkCurto(createAdminClient(), {
    organizationId: activeOrg.orgId,
    conviteId: id,
    actorUserId: authUser.id,
    requestId,
    via: "tela",
  });

  if (resultado.ok) {
    return ok({ id, link_curto: resultado.link_curto, expires_at: resultado.expira_em }, { requestId });
  }
  switch (resultado.motivo) {
    case "nao_encontrado":
      return fail("not_found", t("Convite não encontrado."), 404, { requestId });
    case "aceito":
      return fail("state_conflict", t("Este convite já foi aceito."), 409, { requestId });
    case "revogado":
      return fail("state_conflict", t("Este convite foi revogado. Envie um novo."), 409, { requestId });
    case "expirado":
      return fail(
        "state_conflict",
        t("Este convite venceu. Use Reenviar para renovar o prazo, e o e-mail novo já leva um link novo."),
        409,
        { requestId },
      );
    case "mudou":
      return fail("state_conflict", t("O convite mudou. Atualize e tente de novo."), 409, { requestId });
  }
}
