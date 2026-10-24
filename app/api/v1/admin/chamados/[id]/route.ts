/**
 * FORK MIA (.88) — PATCH /api/v1/admin/chamados/:id: a Time responde e muda a
 * situação de um chamado. A resposta chega a quem abriu no assistente, no sino e
 * no e-mail (`lib/assistente/chamados-da-plataforma.ts`).
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { RecusaDoChamado, responderChamado } from "@/lib/assistente/chamados-da-plataforma";
import { SITUACOES_DE_CHAMADO } from "@/lib/assistente/tipos";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const corpoSchema = z
  .object({
    situacao: z.enum(SITUACOES_DE_CHAMADO),
    resposta: z.string().trim().max(8000).nullish(),
  })
  .strict();

async function exigirPlataformaParaEscrever(requestId: string) {
  try {
    return { ok: true as const, ctx: await requirePlatformAdminEscrita() };
  } catch (err) {
    return { ok: false as const, resposta: falhaDaEscritaDePlatformAdmin(err, requestId) };
  }
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const escrita = await exigirPlataformaParaEscrever(requestId);
  if (!escrita.ok) return escrita.resposta;

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return fail("not_found", "Chamado não encontrado.", 404, { requestId });
  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Dados inválidos.", 422, { requestId });

  const admin = createAdminClient();
  try {
    const r = await responderChamado(admin, {
      id,
      situacao: parsed.data.situacao,
      resposta: parsed.data.resposta ?? null,
      respondidoPor: escrita.ctx.user.id,
    });
    const { data: linha } = await admin.from("mia_chamados").select("organization_id").eq("id", id).maybeSingle();
    void audit({
      action: "assistente.chamado_respondido",
      actorUserId: escrita.ctx.user.id,
      organizationId: (linha as { organization_id?: string } | null)?.organization_id ?? null,
      resourceType: "mia_chamados",
      resourceId: id,
      requestId,
      metadata: { numero: r.numero, situacao: r.situacao, entregue: r.entregue, via: "admin" },
    });
    return ok(r, { requestId });
  } catch (erro) {
    if (erro instanceof RecusaDoChamado) return fail("conflict", erro.message, 409, { requestId });
    return fail("internal_error", "Não consegui gravar a resposta.", 500, { requestId });
  }
}
