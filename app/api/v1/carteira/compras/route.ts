/**
 * FORK MIA (.90) — /api/v1/carteira/compras: comprar créditos por Pix
 * (lib/carteira/compra-pelo-asaas.ts, docs/fork/jornada-de-assinatura.md).
 *
 *   - GET: os pacotes à venda, se a empresa pode comprar agora (e por que não),
 *     e as compras recentes. Gestor para cima, como a carteira.
 *   - POST {valor_cents}: gera o Pix de um pacote no Asaas da instalação. Só quem
 *     ADMINISTRA a empresa (é pagamento, como Plano e cobrança). O valor entra na
 *     carteira quando a releitura no Asaas diz pago — nunca aqui.
 *
 * As duas exigem o módulo que usa a carteira (Broadcast ou e-mail marketing): o
 * menu esconde, a rota recusa. `organization_id` sempre da sessão.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  FRASE_SEM_COMPRA,
  iniciarCompraDeCreditos,
  lerComprasDaEmpresa,
  lerPacotesAtivos,
  podeComprarCreditos,
} from "@/lib/carteira/compra-pelo-asaas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { moduloLiberado } from "@/lib/modulos/liberacao";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({ valor_cents: z.number().int().min(500).max(10_000_000) });

async function temModuloDaCarteira(orgId: string): Promise<boolean> {
  const db = await createClient();
  const [doBroadcast, doEmail] = await Promise.all([
    moduloLiberado(db, orgId, "disparador"),
    moduloLiberado(db, orgId, "email_marketing"),
  ]);
  return doBroadcast || doEmail;
}

export async function GET(_req: NextRequest) {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;
  if (!(await temModuloDaCarteira(authz.org.orgId))) {
    return fail("forbidden", "Módulo não contratado.", 403, { requestId });
  }
  const admin = createAdminClient();
  try {
    const [pacotes, pode, compras] = await Promise.all([
      lerPacotesAtivos(admin),
      podeComprarCreditos(admin, authz.org.orgId),
      lerComprasDaEmpresa(admin, authz.org.orgId),
    ]);
    return ok(
      {
        pacotes: pacotes.map((p) => ({ valor_cents: p.valor_cents })),
        pode_comprar: pode.pode && pacotes.length > 0,
        motivo: pode.pode ? (pacotes.length > 0 ? null : "sem_pacotes") : pode.motivo,
        frase: pode.pode ? null : FRASE_SEM_COMPRA[pode.motivo],
        quem_compra: "admin",
        compras,
      },
      { requestId },
    );
  } catch (erro) {
    logger.warn("[carteira/compras] leitura falhou", {
      requestId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return fail("internal_error", "Não foi possível ler as compras.", 500, { requestId });
  }
}

export async function POST(req: NextRequest) {
  const bloqueio = await requireSupportWrite();
  if (bloqueio) return bloqueio;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "carteira" });
  if (!authz.ok) return authz.response;
  if (!(await temModuloDaCarteira(authz.org.orgId))) {
    return fail("forbidden", "Módulo não contratado.", 403, { requestId });
  }
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", "Escolha um pacote.", 400, { requestId });
  const r = await iniciarCompraDeCreditos(createAdminClient(), {
    orgId: authz.org.orgId,
    valorCents: corpo.data.valor_cents,
    userId: authz.user.id,
    requestId,
  });
  if (!r.ok) return fail(r.code, r.message, r.status, { requestId });
  return ok(
    { compra: r.compra, reaproveitada: r.reaproveitada },
    { requestId, status: r.reaproveitada ? 200 : 201 },
  );
}
