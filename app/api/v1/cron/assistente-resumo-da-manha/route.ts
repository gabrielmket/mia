/**
 * FORK MIA (.88) — o RESUMO DA MANHÃ do assistente da MIA e a RETENÇÃO dele.
 *
 * De hora em hora (docker/scheduler/entrypoint.sh). Cada rodada:
 *
 *   1. escreve o plano do dia de quem ligou o resumo, nas empresas operantes
 *      cujo relógio marca 8h de um dia útil (`lib/assistente/resumo-da-manha.ts`).
 *      Sem IA: são as mesmas leituras e a mesma ordem do assistente. Aviso no
 *      sino de cada pessoa;
 *   2. apaga o histórico do assistente com mais de 90 dias e os chamados
 *      resolvidos há mais de um ano (`fn_mia_expurgar_assistente_vencido`, 9051).
 *
 * A empresa parada não recebe resumo (`ehOperante`, cerca
 * `cron-respeita-org-operante`). A retenção é de todas: é obrigação, não envio.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { escreverResumosDaManha, expurgarAssistenteVencido } from "@/lib/assistente/resumo-da-manha";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  let resumo;
  try {
    resumo = await escreverResumosDaManha(admin, new Date());
  } catch (err) {
    logger.error("[assistente-resumo-da-manha] a rodada falhou", {
      error: err instanceof Error ? err.message : String(err),
      requestId,
    });
    return fail("internal_error", "Falha no resumo da manhã do assistente.", 500, { requestId });
  }
  const expurgo = await expurgarAssistenteVencido(admin);

  // Rodada sem resumo escrito NÃO é mutação, e não audita
  // (tests/unit/cron-audita-so-quando-ha-efeito.test.ts).
  if (resumo.escritos > 0) {
    await audit({
      action: "assistente.resumo_da_manha_gerado",
      resourceType: "mia_assistente_conversas",
      metadata: { escritos: resumo.escritos, empresas: resumo.empresas, pulados: resumo.pulados },
      requestId,
    });
  }

  return ok({ resumo, expurgo }, { requestId });
}

export const GET = handle;
export const POST = handle;
