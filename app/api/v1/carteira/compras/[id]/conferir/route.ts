/**
 * FORK MIA (.90) — POST /api/v1/carteira/compras/[id]/conferir: o "Já paguei"
 * da compra de créditos. Relê a cobrança no Asaas e, se paga, lança na carteira
 * (`lib/carteira/compra-pelo-asaas.ts`). O mesmo efeito do aviso do Asaas e da
 * rodada: chamar de novo não lança duas vezes. Gestor para cima (não cria
 * cobrança nenhuma, só confere); a compra tem de ser da empresa da sessão, e a
 * empresa tem de ter o módulo que usa a carteira (a regra de toda rota de
 * /api/v1/carteira). Se o módulo saiu no meio, o aviso do Asaas e a rodada
 * lançam do mesmo jeito: o pagamento feito nunca se perde.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { conferirCompra } from "@/lib/carteira/compra-pelo-asaas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { moduloLiberado } from "@/lib/modulos/liberacao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;
  const db = await createClient();
  const [doBroadcast, doEmail] = await Promise.all([
    moduloLiberado(db, authz.org.orgId, "disparador"),
    moduloLiberado(db, authz.org.orgId, "email_marketing"),
  ]);
  if (!doBroadcast && !doEmail) return fail("forbidden", "Módulo não contratado.", 403, { requestId });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return fail("not_found", "Compra não encontrada.", 404, { requestId });
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mia_compras_de_creditos")
    .select("id")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", "Não foi possível ler a compra.", 500, { requestId });
  if (!data) return fail("not_found", "Compra não encontrada.", 404, { requestId });
  try {
    const r = await conferirCompra(admin, id);
    return ok({ status: r.status, lancou: r.lancou }, { requestId });
  } catch (erro) {
    logger.warn("[carteira/compras] conferência falhou", {
      requestId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return fail("internal_error", "Não foi possível conferir o pagamento agora.", 500, {
      requestId,
    });
  }
}
