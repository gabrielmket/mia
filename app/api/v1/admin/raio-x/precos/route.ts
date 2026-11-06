/**
 * FORK MIA (.106) · GET e PUT /api/v1/admin/raio-x/precos — o preço da NOVA
 * ANÁLISE do raio-X por cadastro (avulsa e mensal). Sem preço ativo não há
 * venda: o pedido na área vira interesse. Corpo do PUT:
 * `{ tipo: "avulsa" | "mensal", valor_centavos: number | null, ativo?: boolean }`
 * (`null` tira o preço). Escrita com a verificação em duas etapas.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { definirPreco, lerPrecos } from "@/lib/raio-x/pedidos";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  try {
    await requirePlatformAdmin();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  return ok({ precos: await lerPrecos(createAdminClient()) }, { requestId });
}

export async function PUT(req: NextRequest) {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  let ator: string;
  try {
    ator = (await requirePlatformAdminEscrita()).user.id;
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const corpo = await req.json().catch(() => null);
  const r = await definirPreco(createAdminClient(), corpo, ator);
  if (!r.ok) return fail("validation_failed", `Confira os campos: ${r.campos.join(", ")}.`, 400, { requestId, details: { campos: r.campos } });
  void audit({
    action: "raio_x.precos_alterados",
    actorUserId: ator,
    actingAsPlatformAdmin: true,
    resourceType: "mia_raio_x_precos",
    resourceId: null,
    requestId,
    metadata: { via: "tela", pedido: corpo, precos: r.precos.map((p) => ({ tipo: p.tipo, valor_centavos: p.valor_centavos, ativo: p.ativo })) },
  });
  return ok({ precos: r.precos }, { requestId });
}
