/**
 * FORK MIA (.93) — POST /api/v1/admin/assistente/melhorias: anota ou atualiza
 * uma melhoria do produto (9091), pelo título. É o "Anotar como melhoria" da
 * tela da Time e o mesmo caminho de `plataforma_anotar_melhoria_do_produto`.
 * Só o administrador da plataforma, com a guarda de escrita.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import {
  anotarMelhoria,
  ORIGENS_DA_MELHORIA,
  RecusaDaMelhoria,
  SITUACOES_DA_MELHORIA,
} from "@/lib/assistente/trilhas/melhorias";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z
  .object({
    titulo: z.string().trim().min(3).max(300),
    evidencia: z.string().trim().max(1000).nullish(),
    origem: z.enum(ORIGENS_DA_MELHORIA).optional(),
    situacao: z.enum(SITUACOES_DA_MELHORIA).optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  let usuario: { id: string };
  try {
    usuario = (await requirePlatformAdminEscrita()).user;
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Dados inválidos.", 422, { requestId });

  try {
    const r = await anotarMelhoria(createAdminClient(), {
      titulo: parsed.data.titulo,
      evidencia: parsed.data.evidencia === undefined ? undefined : (parsed.data.evidencia ?? null),
      origem: parsed.data.origem,
      situacao: parsed.data.situacao,
      autorUserId: usuario.id,
    });
    if (r.desfecho !== "igual") {
      void audit({
        actorUserId: usuario.id,
        action: "assistente.melhoria_anotada",
        organizationId: null,
        resourceType: "mia_melhorias_do_produto",
        resourceId: r.melhoria.id,
        requestId,
        metadata: { desfecho: r.desfecho, situacao: r.melhoria.situacao, origem: r.melhoria.origem, via: "tela" },
      });
    }
    return ok(r, { requestId });
  } catch (erro) {
    if (erro instanceof RecusaDaMelhoria) return fail("validation_failed", erro.message, 422, { requestId });
    return fail("internal_error", "Não consegui anotar a melhoria.", 500, { requestId });
  }
}
