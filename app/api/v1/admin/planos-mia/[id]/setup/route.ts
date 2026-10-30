/**
 * FORK MIA (.98) · PUT /api/v1/admin/planos-mia/[id]/setup: o preço do setup de
 * implantação do plano (Admin › Cobrança › Módulos dos planos). Tabela ao lado
 * (`mia_plano_setup`, 9131), sem tocar `cobranca_planos`. `null` ou zero: o plano
 * deixa de oferecer. Quem já pediu fica com o preço do dia do pedido.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita, type PlatformAdminContext } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { gravarPrecoDoSetup } from "@/lib/setup-de-implantacao/servico";
import { createAdminClient } from "@/lib/supabase/admin";

const corpoSchema = z.strictObject({ preco_cents: z.number().int().min(0).max(100_000_000).nullable() });

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  let adminCtx: PlatformAdminContext;
  try {
    adminCtx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }
  const admin = createAdminClient();
  const { id } = await params;
  if (!(await moduloLigado(admin, "cobranca")) || !z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Plano não encontrado", 404, { requestId });
  }
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", "Preço inválido", 400, { requestId });
  const { data: plano, error } = await admin.from("cobranca_planos").select("id").eq("id", id).maybeSingle();
  if (error) return fail("internal_error", "Não foi possível ler o plano", 500, { requestId });
  if (!plano) return fail("not_found", "Plano não encontrado", 404, { requestId });
  const r = await gravarPrecoDoSetup(admin, id, corpo.data.preco_cents, adminCtx.user.id);
  if (!r.ok) return fail("internal_error", "Não foi possível salvar o preço", 500, { requestId });
  if (r.mudou) {
    void audit({
      action: "setup.preco_do_plano",
      actorUserId: adminCtx.user.id,
      actingAsPlatformAdmin: true,
      resourceType: "cobranca_plano",
      resourceId: id,
      requestId,
      metadata: { preco_cents: corpo.data.preco_cents },
    });
  }
  return ok({ mudou: r.mudou }, { requestId });
}
