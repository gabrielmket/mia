/**
 * PUT /api/v1/admin/numero-de-avisos/grupo — qual grupo recebe o aviso DESTE cliente.
 *
 * A outra metade do par: o número é da plataforma (rota irmã), o grupo é de
 * cada empresa. Mora no painel administrativo e não na tela do cliente porque
 * quem adiciona o número aos grupos é quem opera — e só quem já está dentro do
 * grupo consegue vê-lo na lista para escolher.
 *
 * Grava em `organizations.settings.grupo_de_avisos` e não em coluna própria: é
 * escolha de operação, não entidade. Coluna nova exigiria migration a cada vez
 * que a configuração ganhar um campo, e este jsonb já é onde moram as outras
 * decisões por organização (`settings.routing`, `settings.branding`).
 *
 * ⚠️ O `update` é de leitura-e-escrita do jsonb inteiro, e por isso ele
 * PRESERVA o resto: escrever `{ grupo_de_avisos: … }` direto apagaria roteamento,
 * marca e tudo mais que mora em `settings`. Este é o tipo de perda que só
 * aparece semanas depois, quando alguém repara que o rodízio parou.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { CHAVE_DO_GRUPO, pareceGrupo } from "@/lib/avisos/destino-do-aviso";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({
  organization_id: z.string().uuid(),
  /** `null` desliga o aviso deste cliente. */
  grupo: z
    .object({
      id: z.string().min(6).max(120).refine(pareceGrupo, {
        message: "O identificador precisa ser de um grupo (termina em @g.us).",
      }),
      nome: z.string().trim().min(1).max(200),
    })
    .nullable(),
});

export async function PUT(req: NextRequest): Promise<Response> {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();
  let ctx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    ctx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const primeiro = parsed.error.issues[0];
    return fail("validation_failed", primeiro?.message ?? "Grupo inválido.", 422, { requestId });
  }

  const admin = createAdminClient();
  const { data: atual, error: erroLeitura } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", parsed.data.organization_id)
    .maybeSingle();
  if (erroLeitura) return fail("db_error", erroLeitura.message, 500, { requestId });
  if (!atual) return fail("not_found", "Organização não encontrada.", 404, { requestId });

  const settings = { ...((atual.settings as Record<string, unknown> | null) ?? {}) };
  if (parsed.data.grupo) {
    settings[CHAVE_DO_GRUPO] = parsed.data.grupo;
  } else {
    delete settings[CHAVE_DO_GRUPO];
  }

  const { error } = await admin
    .from("organizations")
    .update({ settings })
    .eq("id", parsed.data.organization_id);
  if (error) return fail("db_error", error.message, 500, { requestId });

  void audit({
    action: "platform.grupo_de_avisos_alterado",
    actorUserId: ctx.user.id,
    // Aqui a organização É o alvo da mudança — ao contrário da rota do número,
    // que é da plataforma. A linha da auditoria precisa dizer de quem é o grupo.
    organizationId: parsed.data.organization_id,
    requestId,
    metadata: { grupo: parsed.data.grupo },
  });

  return ok({ grupo: parsed.data.grupo }, { requestId });
}
