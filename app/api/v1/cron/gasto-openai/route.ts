/**
 * GET/POST /api/v1/cron/gasto-openai — a fatura da conta, ao lado da nossa conta.
 *
 * O sistema mede o custo somando token × preço de tabela. Sustenta teto, alarme
 * e preço por conversa — mas é MEDIÇÃO, e medição tem erro: modelo sem preço no
 * catálogo, desconto de cache que a tarifa não descreve, uso da mesma chave fora
 * daqui. Este cron traz o número que não tem erro: o que a OpenAI COBROU.
 *
 * Guarda só dias FECHADOS (`platform_openai_spend`): o dia corrente não existe
 * na fatura até virar a meia-noite UTC, e inventá-lo repetiria o defeito que
 * esta tabela veio medir.
 *
 * Sem `OPENAI_ADMIN_KEY` ele não faz nada e diz por quê — a chave de
 * administração é outra coisa da chave que os agentes usam, e uma instalação
 * que não a tenha continua funcionando só com a medição própria.
 *
 * Auth: mesmo contrato dos demais crons (Bearer `INTERNAL_CRON_SECRET` |
 * `INTERNAL_SECRET`, fail-closed).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { faturaPorDia } from "@/lib/ai/custo/openai-org";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const DIA_S = 86_400;
/** Quantos dias reconciliar a cada rodada. A fatura de um dia pode mudar depois
 *  de fechado (crédito, ajuste), e 35 cobre um mês inteiro com folga. */
const JANELA_DIAS = 35;

export interface ResultadoDoGasto {
  dias_gravados: number;
  total_usd: number;
  motivo?: string;
}

export async function sincronizarGastoDaConta(
  admin: ReturnType<typeof createAdminClient>,
  chave: string,
  agora: Date = new Date(),
): Promise<ResultadoDoGasto> {
  if (!chave) return { dias_gravados: 0, total_usd: 0, motivo: "sem_chave_de_administracao" };

  const fim = Math.floor(agora.getTime() / 1000);
  const dias = await faturaPorDia(chave, fim - JANELA_DIAS * DIA_S, fim);
  if (dias.length === 0) return { dias_gravados: 0, total_usd: 0, motivo: "origem_sem_dados" };

  const linhas = dias.map((d) => ({
    dia: d.dia,
    usd: Number(d.usd.toFixed(4)),
    capturado_em: agora.toISOString(),
  }));

  const { error } = await admin.from("platform_openai_spend").upsert(linhas, { onConflict: "dia" });
  if (error) return { dias_gravados: 0, total_usd: 0, motivo: "falha_ao_gravar" };

  return {
    dias_gravados: linhas.length,
    total_usd: Number(linhas.reduce((acc, l) => acc + l.usd, 0).toFixed(4)),
  };
}

async function handler(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("unauthorized", "cron secret ausente ou inválido", 401, { requestId });
  }
  const resultado = await sincronizarGastoDaConta(createAdminClient(), env.OPENAI_ADMIN_KEY);
  if (resultado.motivo) {
    logger.warn("[gasto-openai] rodada sem gravação", { ...resultado, request_id: requestId });
  } else {
    logger.info("[gasto-openai] fatura sincronizada", { ...resultado, request_id: requestId });
  }
  return ok(resultado, { requestId });
}

export const GET = handler;
export const POST = handler;
