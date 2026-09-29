/**
 * FORK MIA — GET /api/v1/leads-da-meta/paginas: o diagnóstico do token da empresa
 * para os leads da Meta. Permissões que faltam, Páginas alcançadas e os
 * formulários de cada uma — com o motivo exato de cada ausência.
 *
 * Admin: é a leitura que monta a tela de escolha, e só o admin escolhe. O token
 * é decifrado aqui, usado na Meta e descartado; nada dele volta na resposta (nem
 * o token de Página, que `listarPaginas` também devolve).
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { diagnosticar } from "@/lib/leads-da-meta/diagnostico";
import { leadsDaMetaLiberados } from "@/lib/leads-da-meta/liberacao";
import { lerCredencialDeLeitura } from "@/lib/plataformas-de-anuncio/credenciais-de-leitura";
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

  const credencial = await lerCredencialDeLeitura(admin, org, "meta_ads");
  if (!credencial.ok) return respostaSemConexao(credencial.motivo, { requestId });

  const diagnostico = await diagnosticar(credencial.credencial.accessToken);
  return ok(diagnostico, { requestId });
}
