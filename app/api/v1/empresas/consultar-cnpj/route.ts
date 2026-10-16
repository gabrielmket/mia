/**
 * GET /api/v1/empresas/consultar-cnpj?cnpj=... — a consulta do CNPJ na Receita
 * ANTES de cadastrar (protótipo aprovado em 15/10/2026, tela 1).
 *
 * FORK MIA (.79, empresa única). Não grava nada: devolve os campos públicos para
 * a tela preencher e a pessoa revisar, e diz se o CNPJ já é de uma empresa da
 * conta (CNPJ repetido é recusado; a tela oferece "Abrir a empresa").
 *
 * `agent` em diante, o mesmo piso de quem cria empresa no fork (o upstream pede
 * gestor, porque lá só o gestor cria). Só a TELA chama: o agente e o MCP não
 * consultam a Receita, e a empresa de demonstração não consulta
 * (`lib/empresas/receita.ts`).
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { nomeDaEmpresa } from "@/lib/empresas/fonte-unica";
import { consultarReceita } from "@/lib/empresas/receita";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "empresas" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const cnpj = req.nextUrl.searchParams.get("cnpj") ?? "";
  const digitos = cnpj.replace(/\D/g, "");

  // O CNPJ repetido é conferido ANTES de sair para a Receita: já cadastrado,
  // não há o que consultar, e a tela leva à empresa que existe.
  if (digitos.length === 14) {
    const { data: existente } = await supabase
      .from("companies")
      .select("id, trade_name, legal_name, normalized_cnpj")
      .eq("organization_id", authz.org.orgId)
      .eq("normalized_cnpj", digitos)
      .maybeSingle();
    if (existente) {
      return fail("cnpj_ja_cadastrado", "Este CNPJ já está cadastrado. Não dá para cadastrar de novo.", 409, {
        requestId,
        details: { existente: { id: existente.id, nome: nomeDaEmpresa(existente), cnpj: existente.normalized_cnpj } },
      });
    }
  }

  const r = await consultarReceita(supabase, authz.org.orgId, cnpj);
  if (!r.ok) {
    const status = r.motivo === "cnpj_invalido" ? 422 : r.motivo === "nao_encontrado" ? 404 : r.motivo === "demonstracao" ? 403 : 502;
    return fail(r.motivo, r.mensagem, status, { requestId });
  }

  void audit({
    action: "empresas.consultada_na_receita",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    resourceType: "companies",
    metadata: { antes_de_cadastrar: true },
  });

  return ok({ cnpj: r.cnpj, normalized_cnpj: r.normalizado, campos: r.campos, bruta: r.bruta }, { requestId });
}
