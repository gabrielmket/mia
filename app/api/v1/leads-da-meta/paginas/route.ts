/**
 * FORK MIA — GET /api/v1/leads-da-meta/paginas: o diagnóstico dos leads da Meta
 * da empresa. Permissões que faltam, as Páginas DELA e os formulários de cada
 * uma, com o motivo exato de cada ausência.
 *
 * .61: as Páginas são as atribuídas à empresa pela plataforma
 * (`mia_paginas_da_meta`, 9004), nunca todas as que o token alcança. O token da
 * agência enxerga Páginas de vários clientes; listar o que ele alcança era
 * mostrar a Página de um cliente ao outro. Sem conexão própria, a empresa lê
 * pela conexão da plataforma, e só as Páginas dela (`lib/leads-da-meta/paginas.ts`).
 *
 * Admin: é a leitura que monta a tela de escolha, e só o admin escolhe. O token
 * é decifrado aqui, usado na Meta e descartado; nada dele volta na resposta (nem
 * o token de Página, que `listarPaginas` também devolve).
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { DIAGNOSTICO_SEM_PAGINAS, diagnosticar } from "@/lib/leads-da-meta/diagnostico";
import { leadsDaMetaLiberados } from "@/lib/leads-da-meta/liberacao";
import { acessoAsPaginas, paginasDaEmpresa } from "@/lib/leads-da-meta/paginas";
import { createAdminClient } from "@/lib/supabase/admin";

import { respostaSemConexao } from "../../ads/meta/_falha";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "leads_da_meta" });
  if (!authz.ok) return authz.response;
  const org = authz.org.orgId;

  const admin = createAdminClient();
  if (!(await leadsDaMetaLiberados(admin, org))) {
    return fail(
      "forbidden",
      "A importação dos leads da Meta não está contratada para esta empresa.",
      403,
      {
        requestId,
      },
    );
  }

  let atribuidas;
  try {
    atribuidas = await paginasDaEmpresa(admin, org);
  } catch {
    return fail("internal_error", "Não consegui ler as Páginas desta empresa.", 500, {
      requestId,
    });
  }
  // Sem Página atribuída não há o que perguntar à Meta, e nenhuma cota é gasta.
  if (atribuidas.length === 0) return ok(DIAGNOSTICO_SEM_PAGINAS, { requestId });

  const acesso = await acessoAsPaginas(admin, org, atribuidas);
  if (!acesso.ok) {
    if (acesso.motivo === "sem_conexao" || acesso.motivo === "cifra_indisponivel") {
      return respostaSemConexao(acesso.motivo, { requestId });
    }
    return ok(
      {
        ...DIAGNOSTICO_SEM_PAGINAS,
        erro: { falha: acesso.motivo, detalhe: acesso.detalhe ?? "" },
      },
      { requestId },
    );
  }

  const diagnostico = await diagnosticar(atribuidas, acesso);
  return ok(diagnostico, { requestId });
}
