/**
 * FORK MIA (.91) — GET /api/v1/assistente/propostas: as propostas do assistente
 * da empresa (9080), para o cartão mostrar a situação de cada uma.
 *
 *   ?ids=<id>,<id>   as pedidas (as do histórico de quem pergunta)
 *   sem ids          as pendentes da empresa
 *
 * Pela SESSÃO: a RLS da 9080 mostra as propostas a gestor e administrador. O
 * pedido (o texto do agente) não sai daqui: o cartão mostra o "o que muda".
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { COLUNAS_DA_PROPOSTA } from "@/lib/assistente/propostas/tipos";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const consulta = z
  .object({
    ids: z
      .string()
      .max(2000)
      .optional()
      .transform((v) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []))
      .pipe(z.array(z.string().uuid()).max(50)),
  })
  .strict();

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "mia_assistente_propostas" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const lido = consulta.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (!lido.success) {
    return fail("validation_failed", t("Filtro inválido."), 422, { requestId, details: lido.error.flatten() });
  }
  const administra = roleAtLeast(authz.org.role, "admin");
  // O atendente não vê proposta (a RLS devolveria zero): resposta vazia, sem erro.
  if (!roleAtLeast(authz.org.role, "manager")) return ok({ propostas: [], pode_aplicar: false }, { requestId });

  const db = await createClient();
  let q = db
    .from("mia_assistente_propostas")
    .select(COLUNAS_DA_PROPOSTA)
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  q = lido.data.ids.length > 0 ? q.in("id", lido.data.ids) : q.eq("situacao", "pendente");
  const { data, error } = await q;
  if (error) return fail("unavailable", t("Não deu para ler as propostas agora."), 503, { requestId });
  return ok({ propostas: data ?? [], pode_aplicar: administra }, { requestId });
}
