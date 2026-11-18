import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/leads/[id]/win
 *
 * Closes a lead as won by moving it to the pipeline's `is_won=true` stage.
 * The DB trigger `fn_crm_lead_close_on_stage` sets status='won' + closed_at (P-02).
 * Idempotent: already-won leads return 200 with the current row.
 *
 * A regra vive em `lib/leads/encerramento.ts`, compartilhada com a capacidade de
 * encerramento da IA (IA 360 · wave 2). Duas implementações fariam a IA e o
 * humano fecharem negócio por critérios diferentes.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { encerraDemanda } from "@/lib/leads/encerramento";
import { IDIOMA_PADRAO } from "@/lib/i18n/idiomas";
// FORK MIA (.109): "Pedir o produto ao marcar como ganho" (docs/fork/produto-no-negocio.md).
import { recusaDoProdutoNoGanho } from "@/lib/produto-no-negocio/servidor";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;

  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "crm_leads",
    role: "agent",
    scope: "mcp:write",
  });
  if (!authz.ok) return authz.response;
  const teto = await tetoDeEscritaDoToken(authz, "leads_win", requestId);
  if (teto) return teto;
  const { supabase, organizationId, actor, idioma } = authz;

  // O MOTIVO DE GANHO (issue #1536): corpo opcional. Body vazio/ausente é o
  // contrato antigo — ganhar sem motivo continua valendo, salvo quando o funil
  // liga `settings.won_reason_required` (aí a recusa vem de `encerraDemanda`).
  const corpo = await req.json().catch(() => ({}));
  const wonReason =
    typeof (corpo as { won_reason?: unknown }).won_reason === "string"
      ? ((corpo as { won_reason: string }).won_reason as string)
      : null;

  // FORK MIA (.109): com a opção ligada no funil, o botão Ganhar recusa o negócio
  // sem item (nem do bloco, nem da proposta). A IA e as automações fecham por
  // `encerraDemanda` direto e não passam por aqui.
  const semProduto = await recusaDoProdutoNoGanho(supabase, {
    organizationId,
    leadId,
    idioma: idioma ?? IDIOMA_PADRAO,
  });
  if (semProduto) return fail(semProduto.codigo, semProduto.mensagem, 422, { requestId });

  try {
    const { lead } = await encerraDemanda(
      supabase,
      {
        organization_id: organizationId,
        actor,
        requestId,
        idioma,
      },
      { leadId, desfecho: "won", motivo: wonReason },
    );
    return ok(lead, { requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }
}
