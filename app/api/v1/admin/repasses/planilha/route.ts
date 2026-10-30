/**
 * FORK MIA (.98) · GET /api/v1/admin/repasses/planilha?competencia=AAAA-MM-01: a
 * planilha do mês para baixar (CSV que o Excel abre em pt-BR), cliente a cliente,
 * com a conta inteira e a chave Pix de cada parceiro. Só a Time.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { lerRepassesParaATela } from "@/lib/parceiros/leitura";
import { planilhaDoMes } from "@/lib/parceiros/repasses";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const admin = createAdminClient();
  const competencia = req.nextUrl.searchParams.get("competencia") ?? "";
  if (!(await moduloLigado(admin, "cobranca")) || !/^\d{4}-\d{2}-01$/.test(competencia)) {
    return fail("not_found", "Mês não encontrado.", 404, { requestId });
  }
  const { repasses } = await lerRepassesParaATela(admin, competencia);
  return new Response(planilhaDoMes(repasses), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="repasses-${competencia.slice(0, 7)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
