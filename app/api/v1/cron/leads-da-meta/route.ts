/**
 * FORK MIA — cron dos leads dos formulários da Meta (a cada 5 minutos, no
 * `scheduler`). A rodada inteira mora em `lib/leads-da-meta/rodada.ts`; aqui é a
 * porta: segredo do cron, resumo e auditoria SÓ quando houve efeito (lead gravado
 * ou erro) — a rodada vazia é a comum e não escreve na trilha.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { rodarLeadsDaMeta } from "@/lib/leads-da-meta/rodada";
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
    resumo = await rodarLeadsDaMeta(admin, { requestId });
  } catch (erro) {
    logger.error("[cron.leads-da-meta] a rodada não começou", {
      requestId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return fail("internal_error", "Falha ao ler a configuração dos formulários da Meta.", 500, {
      requestId,
    });
  }

  const efeito = resumo.novos + resumo.repetidos + resumo.recusados + resumo.erros;
  if (efeito > 0) {
    await audit({
      action: "leads_da_meta.rodada",
      organizationId: null,
      bypassedRls: true,
      requestId,
      metadata: {
        empresas: resumo.empresas,
        formularios: resumo.formularios,
        novos: resumo.novos,
        repetidos: resumo.repetidos,
        recusados: resumo.recusados,
        erros: resumo.erros,
      },
    });
  }

  return ok(
    {
      empresas: resumo.empresas,
      formularios: resumo.formularios,
      novos: resumo.novos,
      repetidos: resumo.repetidos,
      recusados: resumo.recusados,
      erros: resumo.erros,
    },
    { requestId },
  );
}

export const GET = handle;
export const POST = handle;
