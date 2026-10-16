/**
 * POST   /api/v1/empresas/[id]/pessoas — liga um contato à empresa, ou muda o
 *                                       vínculo (papel, cargo, setor, principal,
 *                                       se é a empresa do cartão).
 * DELETE /api/v1/empresas/[id]/pessoas?contato_id=... — tira o contato da empresa.
 *
 * FORK MIA (.79, empresa única). O vínculo é o do cadastro do upstream
 * (`company_people`, com o nosso `papel`), gravado pelas portas da 9034
 * (`fn_mia_vincular_pessoa`, `fn_mia_desvincular_pessoa`), com o client de
 * SESSÃO: a função reconfere o papel (`agent` em diante).
 *
 * As regras do protótipo aprovado em 15/10/2026 que moram no banco: contato
 * pode estar em várias empresas (uma aparece no cartão); papéis numa lista
 * fechada de cinco; um principal por empresa (quem vira principal tira o de
 * antes); vários números da mesma pessoa contam como uma pessoa. Tirar alguém
 * da empresa não mexe nos negócios de antes.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { PAPEIS } from "@/lib/cartoes/papel";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

const corpoSchema = z.object({
  contato_id: z.string().uuid(),
  papel: z.enum(PAPEIS).nullable().optional(),
  cargo: z.string().trim().max(120).nullable().optional(),
  setor: z.string().trim().max(120).nullable().optional(),
  principal: z.boolean().optional(),
  /** Esta passa a ser a empresa que aparece no cartão do contato. */
  no_cartao: z.boolean().optional(),
});

const FRASES: Record<string, { status: number; frase: string }> = {
  insufficient_role: { status: 403, frase: "Seu papel não permite vincular pessoas a empresas." },
  contato_nao_encontrado: { status: 404, frase: "O contato não existe nesta conta." },
  empresa_nao_encontrada: { status: 404, frase: "A empresa não existe nesta conta." },
  contato_anonimizado: { status: 422, frase: "Este contato foi anonimizado (LGPD): não recebe mais vínculo." },
  contato_mesclado: { status: 422, frase: "Este contato foi juntado a outro: ligue o que ficou." },
  papel_invalido: { status: 422, frase: "Papel inválido." },
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
  const authz = await requireRole("agent", { requestId, resource: "empresas" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "Dados do vínculo inválidos.", 422, { requestId });
  const { contato_id, ...resto } = parsed.data;
  // Só o que veio muda: chave ausente fica como está no vínculo.
  const p_dados = JSON.parse(JSON.stringify(resto)) as Record<string, unknown>;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_mia_vincular_pessoa", {
    p_organization_id: authz.org.orgId,
    p_contato_id: contato_id,
    p_empresa_id: id,
    p_dados,
  });
  if (error) return recusa(error.message, requestId);

  void audit({
    action: "empresas.pessoa_vinculada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    resourceType: "companies",
    resourceId: id,
    metadata: { contato_id, campos: Object.keys(p_dados) },
  });
  return ok(data, { requestId });
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "empresas" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const contatoId = req.nextUrl.searchParams.get("contato_id") ?? "";
  if (!z.string().uuid().safeParse(contatoId).success) {
    return fail("validation_failed", "Diga qual contato sai da empresa.", 422, { requestId });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_mia_desvincular_pessoa", {
    p_organization_id: authz.org.orgId,
    p_contato_id: contatoId,
    p_empresa_id: id,
  });
  if (error) return recusa(error.message, requestId);

  void audit({
    action: "empresas.pessoa_desvinculada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    resourceType: "companies",
    resourceId: id,
    metadata: { contato_id: contatoId },
  });
  return ok(data, { requestId });
}
