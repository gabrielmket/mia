/**
 * FORK MIA (.64) — GET|POST|DELETE /api/v1/leads-da-meta/paginas/escolha
 *
 * A empresa com conta PRÓPRIA da Meta escolhe as Páginas dela (migration 9008,
 * `lib/leads-da-meta/autoatendimento.ts`).
 *
 * GET    → quem escolhe (a empresa ou a plataforma) e, se for a empresa, as
 *          Páginas que o token DELA alcança, cada uma: desta empresa, livre ou
 *          já ligada a outra empresa (sem dizer qual).
 * POST   → assume uma Página (`{ page_id }`). Confere NA META, na hora, que o
 *          token da empresa alcança a Página; o nome vem da Meta, não do corpo.
 * DELETE → solta uma Página que a empresa assumiu (`?page_id=`): os formulários
 *          dela ali desligam, com o motivo, na mesma transação do banco.
 *
 * Admin: é quem escolhe o que vira lead no funil. A empresa é SEMPRE a da
 * sessão (`requireRole`). Nenhum token sai daqui, nem o de Página.
 *
 * O banco segura o mesmo, venha a escrita de onde vier (gatilho da 9008):
 * assumir nunca toma a Página de outra empresa e só vale com conexão própria.
 * A empresa que lê pela conexão da plataforma continua como na .61: quem
 * atribui é o dono da plataforma, em /admin/paginas-da-meta.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  donosParaAEscolha,
  modoDasPaginas,
  montarEscolha,
  type EscolhaDasPaginas,
  type ModoDasPaginas,
  type PaginaParaEscolher,
} from "@/lib/leads-da-meta/autoatendimento";
import { fecharAvisos } from "@/lib/leads-da-meta/aviso-de-falha";
import { leadsDaMetaLiberados } from "@/lib/leads-da-meta/liberacao";
import {
  MENSAGEM_DO_MODO_DA_PLATAFORMA,
  PAGINA_JA_LIGADA_A_OUTRA_EMPRESA,
} from "@/lib/leads-da-meta/mensagens";
import { listarPaginas } from "@/lib/plataformas-de-anuncio/meta/leads";
import { createAdminClient } from "@/lib/supabase/admin";

import { respostaDeFalha, respostaSemConexao } from "../../../ads/meta/_falha";

export const dynamic = "force-dynamic";

const RECURSO = "leads_da_meta";

const idDaPagina = z.string().regex(/^\d{1,30}$/, "Id de Página inválido.");
const assumirSchema = z.object({ page_id: idDaPagina }).strict();

async function autorizar(requestId: string) {
  const authz = await requireRole("admin", { requestId, resource: RECURSO });
  if (!authz.ok) return { ok: false as const, response: authz.response };
  const admin = createAdminClient();
  if (!(await leadsDaMetaLiberados(admin, authz.org.orgId))) {
    return {
      ok: false as const,
      response: fail(
        "forbidden",
        "A importação dos leads da Meta não está contratada para esta empresa.",
        403,
        { requestId },
      ),
    };
  }
  return { ok: true as const, authz, admin, org: authz.org.orgId };
}

/** A recusa de quem não escolhe as Páginas: plataforma ou modo indefinido. */
function recusaDoModo(modo: Exclude<ModoDasPaginas, { modo: "conta_propria" }>, requestId: string) {
  if (modo.modo === "plataforma") {
    return fail("sem_conta_propria", MENSAGEM_DO_MODO_DA_PLATAFORMA[modo.motivo]!, 403, {
      requestId,
    });
  }
  if (modo.falha === "sem_conexao" || modo.falha === "cifra_indisponivel") {
    return respostaSemConexao(modo.falha, { requestId });
  }
  return respostaDeFalha(modo.falha, modo.detalhe ?? "", { requestId });
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const a = await autorizar(requestId);
  if (!a.ok) return a.response;
  const { admin, org } = a;

  let modo: ModoDasPaginas;
  try {
    modo = await modoDasPaginas(admin, org);
  } catch {
    return fail("internal_error", "Não consegui ler a conexão da Meta desta empresa.", 500, {
      requestId,
    });
  }

  if (modo.modo === "plataforma") {
    return ok<EscolhaDasPaginas>(
      { modo: "plataforma", motivo: modo.motivo, erro: null, paginas: [] },
      { requestId },
    );
  }
  if (modo.modo === "indefinido") {
    return ok<EscolhaDasPaginas>(
      {
        modo: "indefinido",
        motivo: null,
        erro: { falha: modo.falha, detalhe: modo.detalhe ?? "" },
        paginas: [],
      },
      { requestId },
    );
  }

  const lidas = await listarPaginas(modo.token);
  let erro: EscolhaDasPaginas["erro"] = null;
  const alcancadas = lidas.ok ? lidas.dados : [];
  if (!lidas.ok) erro = { falha: lidas.falha, detalhe: lidas.detalhe };

  let paginas: PaginaParaEscolher[];
  try {
    const donos = await donosParaAEscolha(
      admin,
      org,
      alcancadas.map((p) => p.id),
    );
    // Só id e nome da Meta entram: o token de cada Página fica aqui dentro.
    paginas = montarEscolha(
      org,
      alcancadas.map((p) => ({ id: p.id, nome: p.nome })),
      donos,
    );
  } catch {
    return fail("internal_error", "Não consegui ler as Páginas desta empresa.", 500, {
      requestId,
    });
  }

  return ok<EscolhaDasPaginas>(
    { modo: "conta_propria", motivo: null, erro, paginas },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const a = await autorizar(requestId);
  if (!a.ok) return a.response;
  const { admin, org, authz } = a;

  const parsed = assumirSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return fail("validation_failed", "Id de Página inválido.", 422, { requestId });
  const pageId = parsed.data.page_id;

  let modo: ModoDasPaginas;
  try {
    modo = await modoDasPaginas(admin, org);
  } catch {
    return fail("internal_error", "Não consegui ler a conexão da Meta desta empresa.", 500, {
      requestId,
    });
  }
  if (modo.modo !== "conta_propria") return recusaDoModo(modo, requestId);

  // Quem é o dono hoje. Pelo service role: a outra empresa é invisível à sessão.
  const { data: dono, error: erroDoDono } = await admin
    .from("mia_paginas_da_meta")
    .select("organization_id")
    .eq("page_id", pageId)
    .maybeSingle();
  if (erroDoDono) {
    return fail("internal_error", "Não consegui ler o dono desta Página.", 500, { requestId });
  }
  const donoAtual = (dono as { organization_id?: string } | null)?.organization_id ?? null;
  if (donoAtual && donoAtual !== org) {
    return fail("pagina_de_outra_empresa", PAGINA_JA_LIGADA_A_OUTRA_EMPRESA, 409, { requestId });
  }
  if (donoAtual === org) return ok({ page_id: pageId, ja_era_desta_empresa: true }, { requestId });

  // NA META, agora: o token desta empresa alcança a Página? O nome vem daqui.
  const lidas = await listarPaginas(modo.token);
  if (!lidas.ok) return respostaDeFalha(lidas.falha, lidas.detalhe, { requestId });
  const naMeta = lidas.dados.find((p) => p.id === pageId);
  if (!naMeta) {
    return fail(
      "pagina_fora_do_alcance",
      "A conta da Meta desta empresa não alcança esta Página. No Gerenciador de Negócios, dê ao usuário do token acesso à Página e tente de novo.",
      422,
      { requestId },
    );
  }

  const { error } = await admin.from("mia_paginas_da_meta").insert({
    page_id: pageId,
    organization_id: org,
    page_name: naMeta.nome,
    origem: "conta_propria",
    atribuida_em: new Date().toISOString(),
    atribuida_por: authz.user.id,
  });
  if (error) {
    // 23505: outra empresa assumiu no meio do caminho (a chave da 9004).
    // 42501: o gatilho da 9008 recusou (sem conexão própria, ou dono trocado).
    const codigo = (error as { code?: string }).code;
    if (codigo === "23505" || codigo === "42501") {
      return fail("pagina_de_outra_empresa", PAGINA_JA_LIGADA_A_OUTRA_EMPRESA, 409, { requestId });
    }
    return fail("internal_error", "Não consegui ligar esta Página à empresa.", 500, { requestId });
  }

  void audit({
    action: "leads_da_meta.pagina_assumida",
    actorUserId: authz.user.id,
    organizationId: org,
    requestId,
    metadata: { page_id: pageId },
  });

  return ok({ page_id: pageId, page_name: naMeta.nome }, { requestId });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const a = await autorizar(requestId);
  if (!a.ok) return a.response;
  const { admin, org, authz } = a;

  const pageId = idDaPagina.safeParse(req.nextUrl.searchParams.get("page_id"));
  if (!pageId.success)
    return fail("validation_failed", "Id de Página inválido.", 422, { requestId });

  // Soltar não exige a conexão ainda estar lá: quem desconectou também precisa
  // conseguir largar a Página que assumiu.
  const { data, error } = await admin.rpc("fn_mia_soltar_pagina_da_meta", {
    p_organization_id: org,
    p_page_id: pageId.data,
  });
  if (error) {
    return fail("internal_error", "Não consegui soltar esta Página.", 500, { requestId });
  }
  const r = (data ?? {}) as { solta?: boolean; motivo?: string; formularios?: string[] };
  if (!r.solta) {
    if (r.motivo === "atribuida_pela_plataforma") {
      return fail(
        "pagina_da_plataforma",
        "Esta Página foi atribuída pela plataforma. Para soltá-la, fale com o suporte.",
        403,
        { requestId },
      );
    }
    return fail("not_found", "Esta Página não é desta empresa.", 404, { requestId });
  }

  const desligados = Array.isArray(r.formularios) ? r.formularios : [];
  // O aviso de falha dos formulários desligados fecha agora, e não na próxima rodada.
  if (desligados.length > 0) await fecharAvisos(admin, org, desligados);

  void audit({
    action: "leads_da_meta.pagina_solta",
    actorUserId: authz.user.id,
    organizationId: org,
    requestId,
    metadata: { page_id: pageId.data, formularios_desligados: desligados.length },
  });

  return ok({ page_id: pageId.data, formularios_desligados: desligados.length }, { requestId });
}
