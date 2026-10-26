/**
 * O CRON DA COBRANÇA DO REVENDEDOR (spec §8): de hora em hora, pelo scheduler.
 *
 * Uma hora basta: a reativação vem pelo aviso do provedor, em segundos, e a
 * régua conta em dias. Chave desligada → sai sem auditar. Rodada que mudou
 * alguma coisa → uma linha `cobranca.rodada` com as contagens; rodada vazia, ou
 * só com leituras que falharam, não audita (cron-audita-so-quando-ha-efeito).
 * A empresa parada é filtrada na régua (`ehOperante` em lib/cobranca).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { rodadaDaCobranca } from "@/lib/cobranca/rodada";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { logger } from "@/lib/logger";
// FORK MIA (.90): a jornada de assinatura (docs/fork/jornada-de-assinatura.md).
import { rodadaDaJornada } from "@/lib/planos-mia/rodada";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const requestId = randomUUID();
  if (!autorizaCron(req)) return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  const admin = createAdminClient();
  if (!(await moduloLigado(admin, "cobranca"))) return ok({ pulado: "modulo_desligado" }, { requestId });

  const resumo = await rodadaDaCobranca(admin);
  const efeito = resumo.relidas + resumo.avisos + resumo.suspensas + resumo.reativadas + resumo.canceladas + resumo.avisosDeIa;
  if (efeito > 0) {
    await audit({
      action: "cobranca.rodada",
      actorUserId: null,
      bypassedRls: true,
      resourceType: "cobranca",
      requestId,
      metadata: { ...resumo },
    });
  }
  if (resumo.falhas > 0) logger.warn("cobranca.rodada_com_falhas", { falhas: resumo.falhas });
  // FORK MIA (.90): a jornada de assinatura na mesma rodada — os módulos seguem o
  // plano em todas as empresas, o aviso de 7 dias antes de uma descida desligar
  // módulo e a releitura das compras de crédito por Pix. Cada passo audita o seu
  // efeito; nunca lança (lib/planos-mia/rodada.ts).
  await rodadaDaJornada(admin);
  return ok(resumo, { requestId });
}

export const GET = handle;
export const POST = handle;
