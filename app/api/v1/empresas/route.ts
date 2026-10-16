/**
 * GET  /api/v1/empresas — a lista de empresas do tenant (busca, filtros e os
 *                         números de cada linha).
 * POST /api/v1/empresas — cadastra uma.
 *
 * FORK MIA (.79, empresa única): o cadastro é o do upstream (`companies`), com o
 * que é só nosso ao lado (`mia_companies_extra`), e esta rota é a porta da TELA
 * `/app/companies` (docs/fork/empresa-unica.md). As rotas do upstream em
 * `/api/v1/companies` continuam como ele as escreveu, atrás do módulo `crm_b2b`.
 *
 * A leitura é de qualquer membro (`viewer`): a lista de clientes é informação
 * de operação. A escrita começa em `agent` (decisão do protótipo aprovado em
 * 15/10/2026: atendente, gestor e o agente criam empresa). Quem confere o papel
 * de novo é `fn_mia_gravar_empresa`, com o client de SESSÃO: a RLS e a função
 * ficam no banco, onde não dá para esquecer.
 *
 * As regras do protótipo que moram aqui:
 *  - CNPJ repetido é RECUSADO (409 `cnpj_ja_cadastrado`, com a empresa que já
 *    o tem, para a tela oferecer "Abrir a empresa");
 *  - empresa SEM CNPJ com nome parecido com outra só AVISA (409
 *    `nome_parecido`, com a parecida); repetir com `criar_mesmo_assim: true`
 *    cria.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { empresaCreateSchema, empresaListQuerySchema } from "@/lib/schemas/empresas";
import { createClient } from "@/lib/supabase/server";
import {
  gravarEmpresa,
  lerTodasAsEmpresas,
  nomeDaEmpresa,
  paraEmpresa,
  type CamposDaReceita,
} from "@/lib/empresas/fonte-unica";
import { montarListaDeEmpresas } from "@/lib/empresas/lista";
import { pareceAMesma } from "@/lib/empresas/parecida";
import { diaNoFuso } from "@/lib/obrigacoes/datas";
import { recusaDaGravacao } from "@/lib/empresas/respostas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "empresas" });
  if (!authz.ok) return authz.response;

  const parsed = empresaListQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) return fail("validation_failed", "Busca inválida.", 422, { requestId });
  const { q, limit, offset, filtro, simples } = parsed.data;

  const supabase = await createClient();
  try {
    if (simples) {
      // O seletor de empresa (negócio, contato, obrigação) só precisa de id e
      // nome, e de todas: uma leitura, sem os números de cada linha.
      const lidas = await lerTodasAsEmpresas(supabase, authz.org.orgId);
      if (lidas.erro) return fail("db_error", lidas.erro, 500, { requestId });
      const todas = lidas.linhas
        .map(paraEmpresa)
        .filter((e) => !q || e.nome.toLowerCase().includes(q.toLowerCase()) || (e.cnpj ?? "").includes(q.replace(/\D/g, "") || "\u0000"))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      return ok(todas.slice(offset, offset + limit), { requestId, meta: { total: todas.length, limit, offset } });
    }

    const lista = await montarListaDeEmpresas(supabase, authz.org.orgId, {
      busca: q,
      filtro,
      limit,
      offset,
      hoje: diaNoFuso(new Date(), authz.org.timezone ?? "America/Sao_Paulo"),
    });
    return ok(lista.linhas, {
      requestId,
      meta: {
        total: lista.total,
        total_da_organizacao: lista.total_da_organizacao,
        truncado: lista.truncado,
        limit,
        offset,
      },
    });
  } catch (e) {
    return fail("db_error", e instanceof Error ? e.message : "Falha ao ler as empresas.", 500, { requestId });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "empresas" });
  if (!authz.ok) return authz.response;

  const parsed = empresaCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, {
      requestId,
    });
  }
  const d = parsed.data;
  const supabase = await createClient();

  // Sem CNPJ, nome parecido com uma que já existe: avisa e deixa escolher.
  if (!d.cnpj && !d.criar_mesmo_assim) {
    const lidas = await lerTodasAsEmpresas(supabase, authz.org.orgId, "id, trade_name, legal_name, normalized_cnpj");
    if (!lidas.erro) {
      const parecida = lidas.linhas.find((l) => pareceAMesma(d.nome, nomeDaEmpresa(l)));
      if (parecida) {
        return fail("nome_parecido", "Parece a mesma empresa que uma que já está cadastrada.", 409, {
          requestId,
          details: { existente: { id: parecida.id, nome: nomeDaEmpresa(parecida), cnpj: parecida.normalized_cnpj } },
        });
      }
    }
  }

  const gravada = await gravarEmpresa(supabase, authz.org.orgId, null, {
    nome: d.nome,
    ...(d.razao_social ? { razao_social: d.razao_social } : {}),
    // String vazia vira `null`: o índice único de CNPJ ignora nulo, mas trata
    // `''` como valor.
    cnpj: d.cnpj || null,
    ...(d.telefone ? { telefone: d.telefone } : {}),
    ...(d.email ? { email: d.email } : {}),
    ...(d.site ? { site: d.site } : {}),
    ...(d.endereco ? { endereco: d.endereco } : {}),
    ...(d.observacoes ? { observacoes: d.observacoes } : {}),
    ...(d.tags ? { tags: d.tags } : {}),
    ...(d.custom_fields ? { custom_fields: d.custom_fields } : {}),
    // Os dados que a consulta à Receita trouxe NA TELA (a pessoa consultou e
    // revisou antes de salvar). Ninguém mais consulta.
    ...(d.receita ? { receita: d.receita as CamposDaReceita, receita_bruta: d.receita_bruta ?? null } : {}),
  });
  if (!gravada.ok) return recusaDaGravacao(gravada, requestId);

  void audit({
    action: "empresas.criada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    requestId,
    resourceType: "companies",
    resourceId: gravada.id,
    metadata: { com_cnpj: Boolean(d.cnpj), com_receita: Boolean(d.receita) },
  });

  const { data } = await supabase
    .from("companies")
    .select("id, trade_name, legal_name, normalized_cnpj")
    .eq("organization_id", authz.org.orgId)
    .eq("id", gravada.id)
    .maybeSingle();
  return ok({ id: gravada.id, nome: data ? nomeDaEmpresa(data) : d.nome }, { requestId, status: 201 });
}
