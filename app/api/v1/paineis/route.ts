/**
 * FORK MIA (item 8) — GET /api/v1/paineis?periodo=30&funil=<id>&paineis=resultado,meta
 *
 * Os painéis prontos da empresa da sessão, com os números do motor de conta
 * (`fn_mia_relatorio`, migration 9030) — os mesmos da tela `/app/paineis`, do
 * link para o dono e de `plataforma_ver_paineis`.
 *
 * O cliente é o da SESSÃO: o motor é `security invoker`, e cada um vê o que a
 * RLS já deixa ver no CRM (o atendente, os negócios e as conversas dele). A
 * organização vem do cookie validado por `requireRole`, nunca da query. Só lê:
 * sem auditoria.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { ehChaveDoPainel, ehPeriodoDosPaineis, PERIODO_PADRAO } from "@/lib/paineis/catalogo";
import { calcularPaineis } from "@/lib/paineis/calcular";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "paineis" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const busca = req.nextUrl.searchParams;
  const periodo = busca.get("periodo") ?? PERIODO_PADRAO;
  if (!ehPeriodoDosPaineis(periodo)) {
    return fail("validation_failed", t("Período inválido: use 7, 30, 90 ou mes."), 422, { requestId });
  }
  const funil = busca.get("funil");
  if (funil && !UUID.test(funil)) {
    return fail("validation_failed", t("Funil inválido."), 422, { requestId });
  }
  const pedidos = (busca.get("paineis") ?? "").split(",").filter(Boolean);
  if (pedidos.some((p) => !ehChaveDoPainel(p))) {
    return fail("validation_failed", t("Painel desconhecido."), 422, { requestId });
  }

  const calculados = await calcularPaineis(await createClient(), {
    organizationId: authz.org.orgId,
    periodo,
    pipelineId: funil,
    paineis: pedidos.filter(ehChaveDoPainel),
    valores: true,
  });
  return ok(calculados, { requestId });
}
