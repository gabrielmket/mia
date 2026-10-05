"use server";

/**
 * Grava o app da Microsoft (Entra) desta instalação, pela tela `/admin/microsoft`.
 *
 * FORK MIA (9011, docs/fork/agenda-microsoft.md). Espelha `updateGoogleOAuth` do
 * upstream: só o dono da plataforma; segredo cifrado antes de gravar (sem a
 * cifra, recusa); segredo vazio = mantenha o gravado. Acrescenta a data de
 * vencimento do segredo (a Microsoft não deixa passar de 24 meses, e segredo
 * vencido derruba a renovação de todas as agendas de uma vez) e o tenant.
 */

import { headers } from "next/headers";
import { z } from "zod";

import { invalidarCredencialDaMicrosoft } from "@/lib/agenda/microsoft/config";
import { audit } from "@/lib/audit";
import { escritaDeAdminOuRecusa } from "@/lib/auth/escritaDeAdminOuRecusa";
import { MENSAGEM_DA_RECUSA_DE_ESCRITA } from "@/lib/auth/recusa-de-escrita-de-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

export type UpdateMicrosoftOAuthResult = { ok: true } | { ok: false; error: string; details?: unknown };

const entradaSchema = z.object({
  // O ID do aplicativo (cliente) do Entra é um GUID.
  client_id: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
  client_secret: z.string().trim().min(10).max(300).optional(),
  segredo_vence_em: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  tenant: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,100}$/)
    .optional(),
});

export type MicrosoftOAuthInput = z.infer<typeof entradaSchema>;

export async function updateMicrosoftOAuth(input: MicrosoftOAuthInput): Promise<UpdateMicrosoftOAuthResult> {
  // Upstream 1.70: a escrita de platform admin exige scope `full` e MFA em dia.
  const escrita = await escritaDeAdminOuRecusa();
  if (!escrita.ok) return { ok: false, error: MENSAGEM_DA_RECUSA_DE_ESCRITA[escrita.error] };
  const { user: authUser } = escrita.ctx;
  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Confira o ID do aplicativo e o segredo.", details: parsed.error.flatten() };

  const admin = createAdminClient();
  const valores: Record<string, unknown> = {
    client_id: parsed.data.client_id.toLowerCase(),
    updated_by: authUser.id,
  };
  if (parsed.data.segredo_vence_em !== undefined) valores.segredo_vence_em = parsed.data.segredo_vence_em;
  if (parsed.data.tenant) valores.tenant = parsed.data.tenant;
  if (parsed.data.client_secret) {
    const cifrado = await encryptWebhookSecret(admin, parsed.data.client_secret);
    if (!cifrado) {
      return { ok: false, error: "A cifra não está disponível nesta instalação. O segredo não foi gravado." };
    }
    valores.client_secret_encrypted = cifrado;
  }

  const { error } = await admin.from("mia_microsoft_oauth_da_plataforma").upsert({ id: 1, ...valores }, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };
  invalidarCredencialDaMicrosoft();

  const cabecalhos = await headers();
  await audit({
    action: "platform_microsoft_oauth.updated",
    actorUserId: authUser.id,
    resourceType: "mia_microsoft_oauth_da_plataforma",
    resourceId: null,
    requestId: cabecalhos.get("x-request-id") ?? undefined,
    ip: cabecalhos.get("x-forwarded-for") ?? undefined,
    userAgent: cabecalhos.get("user-agent") ?? undefined,
    actingAsPlatformAdmin: true,
    metadata: {
      campos: Object.keys(valores).filter((k) => k !== "updated_by" && k !== "client_secret_encrypted"),
      segredo_trocado: Boolean(parsed.data.client_secret),
    },
  });
  return { ok: true };
}
