import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * FORK MIA (.109) · O PRODUTO OU SERVIÇO NO NEGÓCIO (docs/fork/produto-no-negocio.md).
 *
 *   GET /api/v1/leads/[id]/itens   os itens do negócio (os do bloco e os da
 *                                  proposta enviada), o estado do valor (a soma
 *                                  ou à mão) e a palavra e as opções do funil.
 *   PUT /api/v1/leads/[id]/itens   a lista INTEIRA do bloco e o modo do valor,
 *                                  numa escrita: { itens: [{ id?, product_id?,
 *                                  quantidade, desconto_cents }], valor: { modo:
 *                                  "soma" } | { modo: "a_mao", value_cents } }.
 *
 * Ler é de qualquer papel (o cartão mostra a linha do item); gravar é `agent`+,
 * como editar o negócio. A escrita vai pelo service_role (a 9160 não dá escrita
 * à sessão), com a empresa da sessão em toda consulta: o produto novo vem do
 * catálogo DESTA empresa e o preço sai dele, nunca do corpo.
 *
 * A resposta do PUT traz `updated_at` do negócio: quem grava os itens antes de
 * mover o card (a janela de ganho do arrasto) manda esse carimbo no move.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { lerFunilDoProduto, lerNegocioComItens, gravarItensDoNegocio } from "@/lib/produto-no-negocio/servidor";
import { QUANTIDADE_MAXIMA } from "@/lib/produto-no-negocio/regras";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const Id = z.string().uuid();

const Corpo = z.object({
  itens: z
    .array(
      z
        .object({
          id: z.string().uuid().optional(),
          product_id: z.string().uuid().optional(),
          quantidade: z.number().int().min(1).max(QUANTIDADE_MAXIMA),
          desconto_cents: z.number().int().min(0).max(1_000_000_000_00),
        })
        .refine((i) => i.id || i.product_id, { message: "id ou product_id" }),
    )
    .max(100),
  valor: z.discriminatedUnion("modo", [
    z.object({ modo: z.literal("soma") }),
    z.object({ modo: z.literal("a_mao"), value_cents: z.number().int().min(0).max(1_000_000_000_00).nullable() }),
  ]),
});

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  if (!Id.safeParse(id).success) return fail("not_found", t("Negócio não encontrado."), 404, { requestId });

  const db = await createClient();
  try {
    const negocio = await lerNegocioComItens(db, authz.org.orgId, id);
    if (!negocio) return fail("not_found", t("Negócio não encontrado."), 404, { requestId });
    const funil = await lerFunilDoProduto(db, authz.org.orgId, negocio.pipeline_id);
    return ok({ ...negocio, funil }, { requestId });
  } catch (e) {
    return fail("internal_error", e instanceof Error ? e.message : String(e), 500, { requestId });
  }
}

export async function PUT(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  if (!Id.safeParse(id).success) return fail("not_found", t("Negócio não encontrado."), 404, { requestId });

  const parsed = Corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Confira os itens: quantidade de 1 a 99 e desconto em centavos."), 422, {
      requestId,
      details: { issues: parsed.error.issues },
    });
  }

  try {
    const r = await gravarItensDoNegocio(createAdminClient(), {
      organizationId: authz.org.orgId,
      leadId: id,
      userId: authz.user.id,
      pedido: parsed.data,
      idioma: authz.user.idioma,
    });
    if (r.mudou) {
      await audit({
        action: "negocio.itens_alterados",
        actorUserId: authz.user.id,
        organizationId: authz.org.orgId,
        resourceType: "crm_lead",
        resourceId: id,
        requestId,
        bypassedRls: true,
        metadata: {
          itens_antes: r.antes.itens,
          itens_depois: r.itens.filter((i) => i.origem === "negocio").length,
          modo_antes: r.antes.modo,
          modo_depois: r.valor.modo,
          value_cents_antes: r.antes.value_cents,
          value_cents_depois: r.valor.valorCents,
        },
      });
    }
    const { mudou, antes: _antes, ...negocio } = r;
    return ok({ ...negocio, mudou }, { requestId });
  } catch (e) {
    if (e instanceof ApiError) {
      return fail(e.code, e.message, e.status, { requestId, details: e.details });
    }
    return fail("internal_error", e instanceof Error ? e.message : String(e), 500, { requestId });
  }
}
