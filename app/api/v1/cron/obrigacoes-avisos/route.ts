/**
 * FORK MIA — DOCUMENTO VENCENDO, VENCIDO, NÃO ENVIADO E ATIVIDADE CHEGANDO: a
 * varredura.
 *
 * Um documento vencer não tem acontecimento: a data mora no item e o dia em que
 * ela chega passa em silêncio. Quem percebe é o relógio, aqui. Esta rota existe
 * para transformar a data em ACONTECIMENTO (`obrigacao.*` no `event_log`), e
 * quem decide o que fazer com ele é a automação que a empresa configurou: as
 * ações (mensagem, tarefa, aviso no grupo, mover de etapa, etiqueta) já vivem no
 * motor de regras.
 *
 * Mesmo modelo de `cron/lead-date-field-due`: começa pelas REGRAS (empresa sem
 * regra não é varrida), age na empresa cujo relógio de parede marca 9h, e o
 * evento é dirigido a uma regra. A trava de "uma vez por item e ciclo" mora em
 * tabela própria (`mia_obrigacoes_avisos`), gravada na mesma transação do
 * evento. A lógica inteira está em `lib/obrigacoes/avisos.ts`.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { varrerAvisosDeObrigacao } from "@/lib/obrigacoes/avisos";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  let resultado;
  try {
    resultado = await varrerAvisosDeObrigacao(createAdminClient(), new Date());
  } catch (err) {
    logger.error("[obrigacoes-avisos] varredura falhou", {
      error: err instanceof Error ? err.message : String(err),
      requestId,
    });
    return fail("internal_error", "Falha na varredura das obrigações.", 500, { requestId });
  }

  // Rodada que não emitiu nada NÃO é mutação, e não audita
  // (tests/unit/cron-audita-so-quando-ha-efeito.test.ts).
  if (resultado.emitidos > 0) {
    await audit({
      action: "obrigacao.aviso_emitido",
      resourceType: "automation_rule",
      metadata: {
        emitidos: resultado.emitidos,
        segurados: resultado.segurados,
        examinados: resultado.examinados,
        pulados: resultado.pulados,
      },
      requestId,
    });
  }

  return ok(resultado, { requestId });
}

export const GET = handle;
export const POST = handle;
