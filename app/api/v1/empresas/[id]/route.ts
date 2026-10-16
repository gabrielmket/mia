/**
 * GET|PATCH|DELETE /api/v1/empresas/[id] — a ficha de uma empresa.
 *
 * FORK MIA (.79, empresa única): a empresa é a do cadastro do upstream
 * (`companies` + `mia_companies_extra`), lida e gravada por
 * `lib/empresas/fonte-unica.ts` (docs/fork/empresa-unica.md).
 *
 * O GET traz a empresa COM as pessoas e os negócios dela. É a razão de existir
 * da entidade: se a ficha abrisse só com os dados cadastrais, ela seria uma
 * agenda de CNPJ. Empresa que foi juntada a outra responde 404 com o destino
 * (`mesclada_com`), para a tela levar a quem tem o endereço antigo salvo.
 *
 * DELETE é do GESTOR e RECUSA com negócio aberto (decisão do protótipo
 * aprovado em 15/10/2026). Sem negócio aberto, a empresa sai: as pessoas ficam
 * como contato sem empresa (ou com a outra delas no cartão) e os negócios
 * encerrados ficam no histórico, sem empresa. A regra mora em
 * `fn_mia_excluir_empresa` (9034).
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { empresaUpdateSchema } from "@/lib/schemas/empresas";
import { createClient } from "@/lib/supabase/server";
import { montarFichaDaEmpresa } from "@/lib/cartoes/fichas-servidor";
import {
  gravarEmpresa,
  lerEmpresa,
  lerTodasAsEmpresas,
  nomeDaEmpresa,
  type CamposDaReceita,
  type DadosDaEmpresa,
} from "@/lib/empresas/fonte-unica";
import { saoParecidas } from "@/lib/empresas/parecida";
import { recusaDaGravacao } from "@/lib/empresas/respostas";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "empresas" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const supabase = await createClient();
  const empresa = await lerEmpresa(supabase, authz.org.orgId, id);
  if (!empresa) {
    // Juntada a outra: a lápide diz para onde foi.
    const { data: lapide } = await supabase
      .from("mia_companies_mescladas")
      .select("mesclada_com")
      .eq("organization_id", authz.org.orgId)
      .eq("id", id)
      .maybeSingle();
    return fail("not_found", "Empresa não encontrada.", 404, {
      requestId,
      details: lapide?.mesclada_com ? { mesclada_com: lapide.mesclada_com } : undefined,
    });
  }

  // A ficha CONECTADA (pessoas com papel, negócios com etapa e dono, números e
  // histórico de compras): lib/cartoes/fichas-servidor.ts.
  const ficha = await montarFichaDaEmpresa(supabase, authz.org.orgId, id);

  /**
   * O total soma só negócio GANHO: "quanto essa empresa já nos rendeu" e
   * "quanto tem em aberto com ela" são perguntas diferentes.
   */
  const ganhoCents = ficha.negocios
    .filter((n) => n.status === "won")
    .reduce((soma, n) => soma + Number(n.valorCents ?? 0), 0);

  // Sem CNPJ e com nome parecido com outra: a ficha avisa e oferece mesclar
  // (protótipo, tela 2).
  let pareceCom: { id: string; nome: string } | null = null;
  if (!empresa.cnpj) {
    const lidas = await lerTodasAsEmpresas(supabase, authz.org.orgId, "id, trade_name, legal_name, normalized_cnpj");
    const outra = lidas.linhas.find((l) => l.id !== id && saoParecidas(empresa.nome, nomeDaEmpresa(l)));
    if (outra) pareceCom = { id: outra.id, nome: nomeDaEmpresa(outra) };
  }

  return ok({ ...empresa, total_ganho_cents: ganhoCents, parece_com: pareceCom, ficha }, { requestId });
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "empresas" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const parsed = empresaUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, {
      requestId,
    });
  }

  // Só o que veio muda. Texto apagado pela pessoa vira `null`: "vazio" e "nunca
  // preenchido" são a mesma coisa para quem lê a ficha, e `''` colidiria no
  // índice único do CNPJ.
  const dados: DadosDaEmpresa = {};
  const d = parsed.data;
  const texto = (v: string | undefined) => (v === undefined ? undefined : v.trim() === "" ? null : v);
  if (d.nome !== undefined) dados.nome = d.nome;
  if (d.razao_social !== undefined) dados.razao_social = texto(d.razao_social);
  if (d.cnpj !== undefined) dados.cnpj = texto(d.cnpj);
  if (d.telefone !== undefined) dados.telefone = texto(d.telefone);
  if (d.email !== undefined) dados.email = texto(d.email);
  if (d.site !== undefined) dados.site = texto(d.site);
  if (d.endereco !== undefined) dados.endereco = texto(d.endereco);
  if (d.observacoes !== undefined) dados.observacoes = texto(d.observacoes);
  if (d.tags !== undefined) dados.tags = d.tags;
  // Objeto vazio é valor legítimo em `custom_fields` ("apaguei todos os campos").
  if (d.custom_fields !== undefined) dados.custom_fields = d.custom_fields;
  if (d.receita !== undefined) {
    dados.receita = d.receita as CamposDaReceita;
    dados.receita_bruta = d.receita_bruta ?? null;
  }

  const supabase = await createClient();
  const gravada = await gravarEmpresa(supabase, authz.org.orgId, id, dados);
  if (!gravada.ok) return recusaDaGravacao(gravada, requestId);

  void audit({
    action: "empresas.editada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    resourceType: "companies",
    resourceId: id,
    // Os NOMES dos campos, nunca os valores (o que a pessoa escreveu fica na ficha).
    metadata: { campos: Object.keys(dados) },
  });

  const empresa = await lerEmpresa(supabase, authz.org.orgId, id);
  return ok(empresa, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "empresas" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_mia_excluir_empresa", {
    p_organization_id: authz.org.orgId,
    p_empresa_id: id,
  });
  if (error) {
    if (error.message.includes("empresa_com_negocio_aberto")) {
      const abertos = Number(error.details ?? 0) || 1;
      return fail(
        "empresa_com_negocio_aberto",
        abertos === 1
          ? "Não dá para excluir: há 1 negócio aberto com esta empresa. Encerre ou mova o negócio, ou mescle com outra empresa."
          : `Não dá para excluir: há ${abertos} negócios abertos com esta empresa. Encerre ou mova os negócios, ou mescle com outra empresa.`,
        409,
        { requestId, details: { negocios_abertos: abertos } },
      );
    }
    if (error.message.includes("empresa_nao_encontrada")) return fail("not_found", "Empresa não encontrada.", 404, { requestId });
    if (error.message.includes("insufficient_role")) return fail("forbidden", "Excluir empresa é ação de gestor.", 403, { requestId });
    return fail("db_error", error.message, 500, { requestId });
  }

  void audit({
    action: "empresas.excluida",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    resourceType: "companies",
    resourceId: id,
    metadata: { resultado: data },
  });

  return ok({ id, ...(data as Record<string, unknown>) }, { requestId });
}
