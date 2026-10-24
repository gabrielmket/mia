/**
 * FORK MIA (.88) — GET /api/v1/admin/chamados: os chamados que as equipes dos
 * clientes abriram pelo assistente da MIA, do lado da Time Company.
 *
 * `?situacao=abertos|novo|em_analise|resolvido|todos` (padrão: abertos) e
 * `?organization_id=`. Os da empresa de demonstração não entram: não saem para a
 * Time (regra "Demonstração" do protótipo).
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { listarChamadosDaPlataforma } from "@/lib/assistente/chamados-da-plataforma";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const filtroSchema = z
  .object({
    situacao: z.enum(["abertos", "novo", "em_analise", "resolvido", "todos"]).optional(),
    organization_id: z.string().uuid().optional(),
  })
  .strict();

async function exigirPlataforma(requestId: string) {
  try {
    return { ok: true as const, ctx: await requirePlatformAdmin() };
  } catch (err) {
    // v1.88 (#3207): a recusa nomeada do guarda (`mfa_required`) chega como ela é.
    return { ok: false as const, resposta: falhaDaEscritaDePlatformAdmin(err, requestId) };
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const acesso = await exigirPlataforma(requestId);
  if (!acesso.ok) return acesso.resposta;

  const filtro = filtroSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (!filtro.success) return fail("validation_failed", "Filtro inválido.", 422, { requestId });

  try {
    const chamados = await listarChamadosDaPlataforma(createAdminClient(), {
      organizationId: filtro.data.organization_id ?? null,
      situacao: filtro.data.situacao ?? "abertos",
      limite: 200,
    });
    return ok({ chamados }, { requestId });
  } catch {
    return fail("internal_error", "Não consegui ler os chamados.", 500, { requestId });
  }
}
