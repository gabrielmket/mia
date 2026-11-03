/**
 * FORK MIA (.99) · GET /api/v1/admin/tenants/[id]/dados-de-cobranca: a cópia dos dados
 * de cobrança da empresa (LGPD, o acesso do titular): os dados fiscais inteiros, o passo
 * do pagamento do início, o cartão das mensalidades (só o final e a bandeira) e quando
 * foram ao Asaas, em JSON para baixar (docs/fork/pagamento-no-inicio.md, seção 2). Traz o
 * CPF ou CNPJ, o endereço e o WhatsApp de quem assina, então pede a verificação em duas
 * etapas e fica na auditoria, como a cópia do parceiro (.98). A auditoria leva só a
 * empresa, nunca o conteúdo.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { exportarDadosDeCobrancaDaEmpresa } from "@/lib/lgpd/export-collector";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  let ator: string;
  try {
    ator = (await requirePlatformAdminEscrita()).user.id;
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const admin = createAdminClient();
  const { id } = await params;
  if (!(await moduloLigado(admin, "cobranca")) || !z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Empresa não encontrada.", 404, { requestId });
  }
  let dados: Record<string, unknown> | null;
  try {
    dados = await exportarDadosDeCobrancaDaEmpresa(admin, id);
  } catch (err) {
    logger.warn("[dados-de-cobranca] leitura falhou", { request_id: requestId, error: err instanceof Error ? err.message : "erro" });
    return fail("internal_error", "Não deu para ler os dados agora. Tente de novo em instantes.", 500, { requestId });
  }
  if (!dados) return fail("not_found", "Empresa não encontrada.", 404, { requestId });
  void audit({
    action: "area_de_cobranca.dados_exportados",
    actorUserId: ator,
    actingAsPlatformAdmin: true,
    organizationId: id,
    resourceType: "mia_dados_fiscais",
    resourceId: id,
    requestId,
  });
  return new Response(JSON.stringify(dados, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="dados-de-cobranca-${id}.json"`,
      "cache-control": "no-store",
    },
  });
}
