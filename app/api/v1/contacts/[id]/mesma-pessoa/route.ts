/**
 * POST   /api/v1/contacts/[id]/mesma-pessoa — este número e outro são a MESMA
 *                                             pessoa (`{ outro_contato_id }`).
 * DELETE /api/v1/contacts/[id]/mesma-pessoa — este número deixa de ser da
 *                                             pessoa (o desfazer).
 *
 * FORK MIA (.79, empresa única). Decisão do protótipo aprovado em 15/10/2026:
 * "vários números da mesma pessoa viram uma pessoa só, com vários números. Cada
 * número segue com a sua conversa." A pessoa é a do upstream (`people`,
 * `contacts.person_id`); a ficha, as empresas e os negócios passam a ser um só.
 *
 * As regras moram em `fn_mia_juntar_numeros` e `fn_mia_separar_numero` (9034):
 * juntar soma as empresas dos dois; separar leva uma CÓPIA delas (o número não
 * some de onde estava). Client de SESSÃO: a função reconfere o papel.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const FRASES: Record<string, { status: number; frase: string }> = {
  insufficient_role: { status: 403, frase: "Seu papel não permite juntar números." },
  contato_nao_encontrado: { status: 404, frase: "O contato não existe nesta conta." },
  contato_anonimizado: { status: 422, frase: "Um dos números foi anonimizado (LGPD) e não entra numa pessoa." },
  contato_mesclado: { status: 422, frase: "Um dos números foi juntado a outro contato: use o que ficou." },
  escolha_dois_numeros: { status: 422, frase: "Escolha outro número, diferente deste." },
};

function recusa(mensagem: string, requestId: string): Response {
  const conhecida = Object.entries(FRASES).find(([chave]) => mensagem.includes(chave));
  if (conhecida) return fail("invalid_request", conhecida[1].frase, conhecida[1].status, { requestId });
  return fail("db_error", mensagem, 500, { requestId });
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const parsed = z.object({ outro_contato_id: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Escolha o outro número da pessoa.", 422, { requestId });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_mia_juntar_numeros", {
    p_organization_id: authz.org.orgId,
    p_contato_id: id,
    p_outro_contato_id: parsed.data.outro_contato_id,
  });
  if (error) return recusa(error.message, requestId);

  void audit({
    action: "contatos.numeros_juntados",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    resourceType: "contacts",
    resourceId: id,
    metadata: { outro_contato_id: parsed.data.outro_contato_id },
  });
  return ok(data, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_mia_separar_numero", {
    p_organization_id: authz.org.orgId,
    p_contato_id: id,
  });
  if (error) return recusa(error.message, requestId);

  void audit({
    action: "contatos.numero_separado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    resourceType: "contacts",
    resourceId: id,
  });
  return ok(data, { requestId });
}
