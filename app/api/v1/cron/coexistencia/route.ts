/**
 * coexistencia — FORK MIA (S3; docs/fork/coexistencia.md). De 5 em 5 minutos.
 *
 * Fecha o que a conexão pelo app e o pedido da sincronização deixaram no
 * meio, sem nunca pedir à Meta duas vezes (a trava `unique (conexao_id, tipo)`
 * vale aqui também): pedido parado em `pedindo` vira `sem_resposta`, ciclo sem
 * pedido é pedido (ou vence o prazo), lote do histórico esquecido volta ao
 * worker e lote cru parado há 7 dias perde o `payload` (LGPD).
 *
 * Fora da régua da empresa operante, de propósito (declarado em
 * `tests/unit/cron-respeita-org-operante.test.ts`): é ENTRADA da própria
 * empresa e o prazo da Meta é de 24 horas; nada sai para cliente.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { varrerCoexistencia } from "@/lib/channels/meta/coexistencia/varredura";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }
  const resultado = await varrerCoexistencia(createAdminClient());
  return ok(resultado, { requestId });
}

export const GET = handle;
export const POST = handle;
