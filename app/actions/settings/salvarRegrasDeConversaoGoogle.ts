"use server";

/**
 * Grava as regras de conversão do Google Ads por etapa (migration 0436).
 *
 * A tela manda a lista INTEIRA das etapas abertas, cada uma ligada ou não.
 * Regra que some da lista é DESLIGADA, nunca apagada: a linha guarda o
 * `event_name` que o livro-razão já usa para aquela etapa, e apagar faria uma
 * religação futura nascer com outro nome — e reenviar negócios que já foram.
 *
 * O `event_name` de uma etapa nasce uma vez (`Etapa:<uuid>`) e não muda; a
 * qualificação migrada da 0402 mantém `QualifiedLead`.
 */
import { supportWriteError } from "@/lib/impersonate/support";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { loadAuthUser, mfaEmDivida, resolveActiveOrg } from "@/lib/auth/server";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { createAdminClient } from "@/lib/supabase/admin";
import { gravarRegrasDeConversaoGoogle } from "@/lib/conversoes/gravar-regras-google";
import { VALORES_DE_CATEGORIA } from "@/lib/conversoes/regras-google";

export type SalvarRegrasResult =
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

const regraSchema = z
  .object({
    stage_id: z.uuid(),
    enabled: z.boolean(),
    label: z.string().trim().max(100),
    google_action_id: z.string().trim().max(32).regex(/^\d*$/, "só dígitos"),
    category: z.enum(VALORES_DE_CATEGORIA),
    included_in_conversions: z.boolean(),
    channel: z.enum(["todos", "whatsapp", "outros"]),
  })
  .refine((r) => !r.enabled || (r.label.length > 0 && r.google_action_id.length > 0), {
    message: "Regra ligada precisa de nome e de ação de conversão.",
  });

const entradaSchema = z
  .array(regraSchema)
  .max(200)
  .refine((lista) => new Set(lista.map((r) => r.stage_id)).size === lista.length, {
    message: "Etapa repetida.",
  });

export type RegraDeConversaoInput = z.input<typeof regraSchema>;

export async function salvarRegrasDeConversaoGoogle(
  input: RegraDeConversaoInput[],
): Promise<SalvarRegrasResult> {
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
  // `lib/conversoes/gravar-regras-google.ts`, compartilhadas com o MCP de
  // plataforma. A regra é a mesma; só mudou de endereço.
  const gravado = await gravarRegrasDeConversaoGoogle(
    createAdminClient(),
    { organizationId: orgId, autorUserId: authUser.id },
    parsed.data,
  );
  if (!gravado.ok) return gravado;

  const hdrs = await headers();
  await audit({
    action: "google_ads_conversion_rules.updated",
    actorUserId: authUser.id,
    organizationId: orgId,
    resourceType: "google_ads_conversion_rules",
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
