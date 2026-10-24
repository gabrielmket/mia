/**
 * FORK MIA (.88) — PUT /api/v1/assistente/preferencias: o resumo da manhã de
 * cada pessoa (regra "Resumo da manhã": desligado por padrão, cada pessoa liga
 * o seu). Pela sessão: a RLS da 9050 só deixa a pessoa mexer no próprio.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ resumo_da_manha: z.boolean() }).strict();

export async function PUT(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "mia_assistente" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Pedido inválido."), 422, { requestId });

  const db = await createClient();
  const linha = {
    organization_id: authz.org.orgId,
    user_id: authz.user.id,
    resumo_da_manha: parsed.data.resumo_da_manha,
    updated_at: new Date().toISOString(),
  };
  const { data: existente } = await db
    .from("mia_assistente_preferencias")
    .select("user_id")
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", authz.user.id)
    .maybeSingle();
  const { error } = existente
    ? await db
        .from("mia_assistente_preferencias")
        .update({ resumo_da_manha: linha.resumo_da_manha, updated_at: linha.updated_at })
        .eq("organization_id", authz.org.orgId)
        .eq("user_id", authz.user.id)
    : await db.from("mia_assistente_preferencias").insert(linha);
  if (error) return fail("unavailable", t("Não deu para guardar a escolha agora."), 503, { requestId });
  return ok({ resumo_da_manha: parsed.data.resumo_da_manha }, { requestId });
}
