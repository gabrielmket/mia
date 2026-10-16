/**
 * FORK MIA (9031) — POST /api/v1/paineis/links/[id]
 *
 * Revoga ou renova um link do dono, pelo corpo `{ "acao": "revogar" }` ou
 * `{ "acao": "renovar", "validade_dias": 90 }`.
 *
 *  - revogar: na hora, quem abrir o endereço vê "não está disponível".
 *    Revogar de novo responde o link como está. Audita `paineis.link_revogado`.
 *  - renovar: estende o link VENCIDO, no MESMO endereço (o dono não troca o
 *    favorito). Revogado não volta: a resposta diz para criar outro.
 *    Audita `paineis.link_renovado`.
 *
 * Gestor e administrador, fora do acompanhamento só-leitura do suporte. A
 * organização é a da sessão: link de outra empresa responde 404.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { LinkRecusado, renovarLink, revogarLink, type ValidadeEmDias } from "@/lib/paineis/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const pedidoSchema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("revogar") }).strict(),
  z
    .object({
      acao: z.literal("renovar"),
      validade_dias: z.union([z.literal(30), z.literal(90), z.literal(365)]).optional(),
    })
    .strict(),
]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("manager", { requestId, resource: "paineis" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", t("Link não encontrado."), 404, { requestId });
  }
  if (!isServiceRoleConfigured()) {
    return fail("unavailable", t("O link para o dono não está disponível nesta instalação."), 503, { requestId });
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("validation_failed", t("Corpo inválido."), 422, { requestId });
  }
  const lido = pedidoSchema.safeParse(corpo);
  if (!lido.success) {
    return fail("validation_failed", t("Ação inválida."), 422, { requestId });
  }

  const contexto = { organizationId: authz.org.orgId, actorUserId: authz.user.id, requestId, via: "tela" as const };
  try {
    if (lido.data.acao === "revogar") {
      const r = await revogarLink(createAdminClient(), contexto, id);
      return ok({ link: r.link, ja_estava: r.jaEstava }, { requestId });
    }
    const link = await renovarLink(
      createAdminClient(),
      contexto,
      id,
      (lido.data.validade_dias ?? 90) as ValidadeEmDias,
    );
    return ok({ link }, { requestId });
  } catch (e) {
    if (e instanceof LinkRecusado) {
      if (e.motivo === "nao_encontrado") return fail("not_found", t("Link não encontrado."), 404, { requestId });
      return fail("state_conflict", t(e.message), 409, { requestId });
    }
    throw e;
  }
}
