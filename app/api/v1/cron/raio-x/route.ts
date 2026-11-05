/**
 * FORK MIA (.101) · GET/POST /api/v1/cron/raio-x — anda os raio-X do atendimento
 * (docs/fork/raio-x-do-atendimento.md).
 *
 * As rotas da tela, do MCP e da página pública só mudam o ESTADO; quem lê as
 * conversas, transcreve, classifica, gera o relatório e cumpre os prazos é este
 * cron, a cada minuto, dentro de `PRAZO_DA_CHAMADA_MS` (o mesmo prazo da
 * importação do histórico do upstream, `lib/channels/historico/prazo.ts`). O
 * `-m` do curl no agendador (`docker/scheduler/entrypoint.sh`) fica acima dele.
 * O que roda, na ordem, está em `lib/raio-x/ciclo.ts`.
 *
 * Auditoria: uma linha por EFEITO (conectou, terminou a leitura, gerou o
 * relatório, desconectou por prazo, apagou as conversas, abriu o mês do
 * mensal). Rodada que só andou o cursor não audita
 * (tests/unit/cron-audita-so-quando-ha-efeito.test.ts).
 *
 * Empresa parada não entra na conta: o raio-X é da PLATAFORMA, não de uma
 * empresa da MIA (ver o motivo em tests/unit/cron-respeita-org-operante.test.ts).
 *
 * Auth: Bearer INTERNAL_CRON_SECRET | INTERNAL_SECRET (fail-closed), igual aos
 * demais crons.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { PRAZO_DA_CHAMADA_MS } from "@/lib/channels/historico/prazo";
import { leitorDoRaioX } from "@/lib/channels/raio-x/leitor";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { rodarOCiclo } from "@/lib/raio-x/ciclo";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }
  const prazo = Date.now() + PRAZO_DA_CHAMADA_MS;
  try {
    const resumo = await rodarOCiclo({ admin: createAdminClient(), leitor: leitorDoRaioX(), prazo });
    for (const efeito of resumo.efeitos) {
      const { acao, raioXId, ...metadata } = efeito;
      // Só o EFEITO audita (a lista vem vazia na rodada que só andou o cursor).
      if (raioXId) {
        void audit({
          action: acao,
          actorUserId: null,
          actingAsPlatformAdmin: true,
          resourceType: "mia_raio_x",
          resourceId: raioXId,
          requestId,
          metadata: { origem: "cron", ...metadata },
        });
      }
    }
    return ok(
      { efeitos: resumo.efeitos.length, rodadas: resumo.rodadas, puladas: resumo.puladas, falhas: resumo.falhas },
      { requestId },
    );
  } catch (err) {
    logger.warn("[raio-x] a rodada do cron falhou", { detail: err instanceof Error ? err.message : "erro", requestId });
    return fail("internal_error", "A rodada do raio-X falhou.", 500, { requestId });
  }
}

export const GET = handle;
export const POST = handle;
