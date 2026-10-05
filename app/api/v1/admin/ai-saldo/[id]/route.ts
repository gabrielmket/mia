/**
 * Apagar um lançamento de saldo (erro de digitação, valor lançado duas vezes).
 *
 * Apagar é aceitável aqui porque o saldo é DERIVADO: some o lançamento, some o
 * efeito dele, e a próxima leitura reancora tudo de qualquer jeito. O que não
 * some é o rastro — o audit guarda o que foi apagado, por quem.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { falhaDaEscritaDePlatformAdmin, requirePlatformAdminEscrita, requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const bloqueioDeSuporte = await requireSupportWrite();
  if (bloqueioDeSuporte) return bloqueioDeSuporte;

  const requestId = randomUUID();

  let ctx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    ctx = await requirePlatformAdminEscrita();
  } catch (err) {
    return falhaDaEscritaDePlatformAdmin(err, requestId);
  }

  const { id } = await params;
  if (!UUID.test(id)) return fail("validation_failed", "Lançamento inválido.", 422, { requestId });

  const admin = createAdminClient();
  // Lê antes de apagar: sem isto o audit registraria um id e nada do que ele era.
  const { data: antes } = await admin
    .from("platform_ai_ledger")
    .select("id, tipo, amount_usd, occurred_at")
    .eq("id", id)
    .maybeSingle();
  if (!antes) return fail("not_found", "Lançamento não encontrado.", 404, { requestId });

  const { error } = await admin.from("platform_ai_ledger").delete().eq("id", id);
  if (error) return fail("db_error", "Falha ao apagar o lançamento.", 500, { requestId });

  void audit({
    action: "platform_admin.ai_saldo_lancamento_apagado",
    actorUserId: ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    requestId,
    metadata: {
      id: antes.id,
      tipo: antes.tipo,
      amount_usd: Number(antes.amount_usd),
      occurred_at: antes.occurred_at,
    },
  });

  return ok({ id }, { requestId });
}
