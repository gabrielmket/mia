/**
 * POST /api/v1/empresas/[id]/receita — "Atualizar pela Receita" (protótipo, tela 2).
 *
 * FORK MIA (.79, empresa única). Consulta o CNPJ da empresa na Receita e grava
 * o que veio (razão social, situação, atividade, endereço da Receita) pela
 * porta `fn_mia_gravar_empresa`. O NOME que a equipe deu à empresa fica: a
 * Receita só preenche o nome fantasia de quem não tem nome nenhum.
 *
 * Só a tela chama, por uma pessoa (`agent` em diante); a empresa de
 * demonstração não consulta (`lib/empresas/receita.ts`).
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { gravarEmpresa, lerEmpresa } from "@/lib/empresas/fonte-unica";
import { consultarReceita } from "@/lib/empresas/receita";
import { recusaDaGravacao } from "@/lib/empresas/respostas";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "empresas" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const supabase = await createClient();
  const empresa = await lerEmpresa(supabase, authz.org.orgId, id);
  if (!empresa) return fail("not_found", "Empresa não encontrada.", 404, { requestId });
  if (!empresa.cnpj) {
    return fail("validation_failed", "Sem CNPJ, não há o que consultar. Informe o CNPJ na ficha.", 422, { requestId });
  }

  const r = await consultarReceita(supabase, authz.org.orgId, empresa.cnpj);
  if (!r.ok) {
    const status = r.motivo === "cnpj_invalido" ? 422 : r.motivo === "nao_encontrado" ? 404 : r.motivo === "demonstracao" ? 403 : 502;
    return fail(r.motivo, r.mensagem, status, { requestId });
  }

  const gravada = await gravarEmpresa(supabase, authz.org.orgId, id, { receita: r.campos, receita_bruta: r.bruta });
  if (!gravada.ok) return recusaDaGravacao(gravada, requestId);

  void audit({
    action: "empresas.consultada_na_receita",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    resourceType: "companies",
    resourceId: id,
  });

  return ok(await lerEmpresa(supabase, authz.org.orgId, id), { requestId });
}
