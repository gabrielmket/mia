"use server";

/**
 * Grava as regras de conversão da Meta por etapa (migration 0524).
 *
 * O par de `salvarRegrasDeConversaoGoogle.ts`, com a mesma regra de ouro: a
 * tela manda a lista INTEIRA das etapas abertas, e a regra que some da lista é
 * DESLIGADA, nunca apagada — a linha guarda o `event_name` que o livro-razão já
 * usa para aquela etapa.
 */
import { supportWriteError } from "@/lib/impersonate/support";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { createAdminClient } from "@/lib/supabase/admin";
import { gravarRegrasDeConversaoMeta } from "@/lib/conversoes/gravar-regras-meta";
import { VALORES_DE_EVENTO_DA_META } from "@/lib/conversoes/regras-meta";

export type SalvarRegrasMetaResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "validation_failed"
        | "unauthenticated"
        | "forbidden_tenant"
        | "forbidden_role"
        | "mfa_required"
        | "etapa_invalida"
        | "erro_ao_gravar";
      details?: unknown;
    };

const regraSchema = z.object({
  stage_id: z.uuid(),
  enabled: z.boolean(),
  meta_event: z.enum(VALORES_DE_EVENTO_DA_META),
});

const entradaSchema = z
  .array(regraSchema)
  .max(200)
  .refine((lista) => new Set(lista.map((r) => r.stage_id)).size === lista.length, {
    message: "Etapa repetida.",
  });

export type RegraDeConversaoMetaInput = z.input<typeof regraSchema>;

export async function salvarRegrasDeConversaoMeta(
  input: RegraDeConversaoMetaInput[],
): Promise<SalvarRegrasMetaResult> {
  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation_failed", details: parsed.error.flatten() };
  }

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  if (supportWriteError(authUser.support)) return { ok: false, error: "forbidden_role" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!podeAdministrarEmpresa(authUser, activeOrg)) {
    return { ok: false, error: "forbidden_role" };
  }
  if (await mfaEmDivida()) return { ok: false, error: "mfa_required" };

  const orgId = activeOrg.orgId;

  // FORK MIA: a conferência das etapas e a gravação moram em
  // `lib/conversoes/gravar-regras-meta.ts`, compartilhadas com o MCP de
  // plataforma. A regra é a mesma; só mudou de endereço (o par do Google).
  const gravado = await gravarRegrasDeConversaoMeta(
    createAdminClient(),
    { organizationId: orgId, autorUserId: authUser.id },
    parsed.data,
  );
  if (!gravado.ok) return gravado;

  const hdrs = await headers();
  await audit({
    action: "meta_ads_conversion_rules.updated",
    actorUserId: authUser.id,
    organizationId: orgId,
    resourceType: "meta_ads_conversion_rules",
    resourceId: null,
    requestId: hdrs.get("x-request-id") ?? undefined,
    ip: hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    userAgent: hdrs.get("user-agent") ?? undefined,
    metadata: {
      ligadas: gravado.ligadas,
      desligadas: gravado.desligadas,
    },
  });

  revalidatePath("/app/settings/conversoes");
  return { ok: true };
}
