/**
 * FORK MIA (.88) — POST /api/v1/assistente/pedir: o botão "Pedir à pessoa".
 *
 * Quem não tem permissão para algo pede a quem tem, e o pedido chega como aviso
 * na Central dela (regra "Pergunta fora da permissão" do protótipo). O destino
 * tem de ser alguém da MESMA empresa, ativo, que não seja quem pede; a empresa
 * vem da sessão, nunca do corpo. O aviso não leva dado de contato: leva o
 * pedido, nas palavras de quem pediu, e a tela em que ela estava.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { avisarNoSino } from "@/lib/assistente/avisos";
import { rotuloDaTela } from "@/lib/assistente/telas";
import { caminhoDaTela } from "@/lib/assistente/tipos";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const pedidoSchema = z
  .object({
    para_user_id: z.string().uuid(),
    pedido: z.string().trim().min(3).max(300),
    tela: z.string().max(400).nullish(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "mia_assistente" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const parsed = pedidoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Pedido inválido."), 422, { requestId, details: parsed.error.flatten() });
  }
  if (parsed.data.para_user_id === authz.user.id) {
    return fail("validation_failed", t("Escolha outra pessoa da equipe."), 422, { requestId });
  }
  const rajada = await checkRateLimit(`assistente-pedir:${authz.user.id}`, 5, 600);
  if (!rajada.allowed) {
    return fail("rate_limited", t("Muitos pedidos seguidos. Tente daqui a pouco."), 429, { requestId });
  }

  const admin = createAdminClient();
  const { data: vinculo } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("user_id", parsed.data.para_user_id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!vinculo) return fail("not_found", t("Essa pessoa não está na equipe."), 404, { requestId });

  const quem = (authz.user.full_name ?? "").trim() || t("Alguém da equipe");
  const caminho = caminhoDaTela(parsed.data.tela);
  const onde = caminho ? (rotuloDaTela(caminho) ?? caminho) : null;
  const gravado = await avisarNoSino(admin, {
    organizationId: orgId,
    paraUserId: parsed.data.para_user_id,
    titulo: `${quem} ${t("pediu pelo assistente")}: ${parsed.data.pedido}`,
    corpo: onde ? `${t("Na tela")}: ${onde}` : null,
    refKind: null,
    refId: null,
    severidade: "info",
  });
  if (!gravado) return fail("unavailable", t("Não deu para mandar o pedido agora."), 503, { requestId });

  void audit({
    action: "assistente.pedido_enviado",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "user_organizations",
    resourceId: parsed.data.para_user_id,
    requestId,
    metadata: { tela: caminho },
  });
  return ok({ enviado: true }, { requestId });
}
