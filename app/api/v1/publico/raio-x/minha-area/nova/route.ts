/**
 * FORK MIA (.107) · POST /api/v1/publico/raio-x/minha-area/nova — "Pedir nova
 * análise" (protótipo de 06/11/2026, tela 8). Corpo: `{ tipo: "avulsa" |
 * "mensal", aceite: true, documento? }`.
 *
 * Sem preço ativo para o tipo: o pedido vira INTERESSE (o lead e a Time ficam
 * sabendo; a tela diz que a equipe vai falar com a pessoa). Com preço: a
 * cobrança (avulsa) ou a assinatura (mensal) no Asaas da MIA, e a resposta traz
 * o link de pagamento. Confere a origem (o próprio app) e o cookie da área.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { conferirPedidoDaArea } from "@/lib/raio-x/area";
import { fraseDaRecusaDoPedido, pedirNovaAnalise } from "@/lib/raio-x/pedidos";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const admin = createAdminClient();
  const acesso = await conferirPedidoDaArea(admin, req.headers);
  if (!acesso.ok) {
    return acesso.motivo === "origem"
      ? fail("forbidden", "Pedido de fora da página do Raio-X.", 403, { requestId })
      : fail("unauthenticated", "Entre de novo na área do Raio-X.", 401, { requestId });
  }
  const r = await pedirNovaAnalise(admin, acesso.conta, await req.json().catch(() => null));
  if (!r.ok) return fail(r.motivo === "em_andamento" ? "conflict" : "validation_failed", fraseDaRecusaDoPedido(r.motivo), r.motivo === "em_andamento" ? 409 : 400, { requestId, details: { motivo: r.motivo } });
  void audit({
    action: "raio_x.pedido_criado",
    actorUserId: null,
    actingAsPlatformAdmin: false,
    resourceType: "mia_raio_x_pedidos",
    resourceId: r.pedido.id,
    requestId,
    // Nunca o CPF ou o CNPJ: ele foi direto ao Asaas.
    metadata: { conta_id: acesso.conta.id, tipo: r.pedido.tipo, situacao: r.situacao, valor_centavos: r.pedido.valor_centavos, erro: r.pedido.erro },
  });
  return ok({ pedido_id: r.pedido.id, situacao: r.situacao, link_pagamento: r.link }, { requestId, headers: { "Cache-Control": "no-store" } });
}
