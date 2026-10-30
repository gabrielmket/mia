/**
 * FORK MIA (.98) · PUT /api/v1/admin/tenants/[id]/cupom-e-parceiro: na ficha da
 * empresa, a Time põe ou troca o cupom (também depois de pago), troca o parceiro
 * do cliente (decisão 5) e gera o link do setup de implantação, a venda da Time por
 * link (decisão 10). Com a verificação em duas etapas e o Audit Log. O cliente nunca
 * chega aqui: depois de pago, só a Time troca.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { trocarCupomPelaTime, trocarParceiroDoCliente } from "@/lib/cupons/na-ficha";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { pedirSetup } from "@/lib/setup-de-implantacao/servico";
import { createAdminClient } from "@/lib/supabase/admin";

const corpoSchema = z.union([
  z.strictObject({ codigo: z.string().trim().min(1).max(40) }),
  z.strictObject({ parceiro_id: z.string().uuid().nullable() }),
  z.strictObject({ setup: z.literal(true) }),
]);

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
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
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", "Pedido inválido.", 400, { requestId });
  if ("setup" in corpo.data) {
    const setup = await pedirSetup(admin, { orgId: id, userId: ator, requestId });
    if (!setup.ok) return fail(setup.code, setup.message, setup.status, { requestId });
    return ok({ mudou: setup.criado, link: setup.setup.fatura_url }, { requestId });
  }
  const r =
    "codigo" in corpo.data
      ? await trocarCupomPelaTime(admin, { orgId: id, codigo: corpo.data.codigo, ator, requestId })
      : await trocarParceiroDoCliente(admin, { orgId: id, parceiroId: corpo.data.parceiro_id, ator, requestId });
  if (!r.ok) return fail(r.code, r.message, r.status, { requestId });
  return ok({ mudou: r.mudou }, { requestId });
}
