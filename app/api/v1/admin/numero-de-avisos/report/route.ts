/**
 * PUT /api/v1/admin/numero-de-avisos/report — o grupo que recebe o que é NOSSO.
 *
 * Irmã das outras duas rotas desta pasta, e a diferença entre elas é o
 * destinatário: o número é da plataforma, o grupo de `/grupo` é de um CLIENTE, e
 * este é o grupo INTERNO — crédito de IA acabando, número caído, resumo do dia.
 *
 * Mora junto porque é a mesma tarefa na cabeça de quem opera: o mesmo número,
 * a mesma lista de grupos, escolhida na mesma tela.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { pareceGrupo } from "@/lib/avisos/destino-do-aviso";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({
  /** `null` desliga o report — nada é enviado ao grupo interno. */
  grupo: z
    .object({
      id: z.string().min(6).max(120).refine(pareceGrupo, {
        message: "O identificador precisa ser de um grupo (termina em @g.us).",
      }),
      nome: z.string().trim().min(1).max(200),
    })
    .nullable(),
  /**
   * Abaixo disto, avisa. Teto alto de propósito: quem recarrega mil dólares por
   * vez quer ser avisado em cem, não em vinte.
   */
  limite_saldo_usd: z.coerce.number().min(0).max(100_000).optional(),
  resumo_diario: z.boolean().optional(),
});

export async function PUT(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  let ctx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    ctx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, {
      requestId,
    });
  }

  const admin = createAdminClient();
  const linha: Record<string, unknown> = {
    id: 1,
    grupo_id: parsed.data.grupo?.id ?? null,
    grupo_nome: parsed.data.grupo?.nome ?? null,
    updated_at: new Date().toISOString(),
    updated_by: ctx.user.id,
  };
  // Só grava o que veio: não mandar o limite não pode zerá-lo. O upsert escreve
  // a linha inteira, e um campo ausente viraria o default — o operador que só
  // trocou de grupo perderia o limite que tinha escolhido.
  if (parsed.data.limite_saldo_usd !== undefined) {
    linha.limite_saldo_usd = parsed.data.limite_saldo_usd;
  }
  if (parsed.data.resumo_diario !== undefined) {
    linha.resumo_diario = parsed.data.resumo_diario;
  }

  const { error } = await admin.from("platform_avisos").upsert(linha, { onConflict: "id" });
  if (error) return fail("db_error", error.message, 500, { requestId });

  void audit({
    action: "platform.report_alterado",
    actorUserId: ctx.user.id,
    organizationId: null,
    requestId,
    metadata: { grupo: parsed.data.grupo, limite_saldo_usd: parsed.data.limite_saldo_usd },
  });

  return ok({ ok: true }, { requestId });
}
