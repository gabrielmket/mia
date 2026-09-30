/**
 * GET/POST /api/v1/cron/cotacao-do-dolar — a cotação que o painel usa, sem ninguém digitar.
 *
 * O provedor de IA cobra em DÓLAR e a decisão de preço é em REAL. Sem cotação, o
 * painel de custo só fala dólar; com uma cotação digitada à mão, ela envelhece e
 * ninguém lembra de quando é.
 *
 * Este cron busca a cotação de mercado e grava a do DIA (`platform_fx_rates`),
 * mais o espelho em `platform_ai_custo`, que é o que a tela lê. Guardar por dia
 * é o que impede o custo de um mês fechado mudar quando o câmbio mexe depois.
 *
 * O que ele NÃO faz, de propósito:
 *
 *  - **não grava resposta suspeita.** Fora do intervalo de sanidade, ou em forma
 *    inesperada, a rodada é recusada e o dia fica sem cotação — melhor um dia
 *    faltando (que a tela declara) do que dinheiro convertido por lixo.
 *  - **não derruba nada quando a origem está fora do ar.** Devolve 200 com o
 *    motivo: é uma indisponibilidade de terceiro, não um incidente nosso, e o
 *    agendador não deve ficar retentando contra quem está de pé no dia seguinte.
 *  - **não sobrescreve valor lançado à mão no mesmo dia.** Quem corrigiu a
 *    cotação porque a origem estava errada tem razão sobre o robô.
 *
 * Auth: mesmo contrato dos demais crons (Bearer `INTERNAL_CRON_SECRET` |
 * `INTERNAL_SECRET`, fail-closed).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { lerCotacaoDaOrigem } from "@/lib/ai/custo/cotacao";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const ORIGEM = "https://economia.awesomeapi.com.br/json/last/USD-BRL";
const FONTE = "awesomeapi";
const TIMEOUT_MS = 10_000;

export interface ResultadoDaCotacao {
  dia: string;
  usd_brl: number | null;
  gravado: boolean;
  motivo?: string;
}

async function buscarDaOrigem(): Promise<unknown> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetch(ORIGEM, { signal: controle.signal, cache: "no-store" });
    if (!resposta.ok) return null;
    return await resposta.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Separado do handler para o teste exercitar a REGRA sem montar request nem
 * autenticação — mesmo padrão de `sync-model-catalog`.
 */
export async function atualizarCotacao(
  admin: ReturnType<typeof createAdminClient>,
  buscar: () => Promise<unknown>,
  agora: Date = new Date(),
): Promise<ResultadoDaCotacao> {
  // O dia é em UTC, como todo carimbo deste repo — e como `llm_calls.created_at`,
  // que é o que vai ser convertido por esta cotação.
  const dia = agora.toISOString().slice(0, 10);

  let payload: unknown;
  try {
    payload = await buscar();
  } catch {
    return { dia, usd_brl: null, gravado: false, motivo: "origem_indisponivel" };
  }

  const valor = lerCotacaoDaOrigem(payload);
  if (valor === null) {
    return { dia, usd_brl: null, gravado: false, motivo: "resposta_invalida" };
  }

  const { data: existente } = await admin
    .from("platform_fx_rates")
    .select("dia, fonte")
    .eq("dia", dia)
    .maybeSingle();

  if (existente && existente.fonte !== FONTE) {
    // Alguém corrigiu a cotação de hoje à mão. O robô não desfaz.
    return { dia, usd_brl: valor, gravado: false, motivo: "dia_lancado_a_mao" };
  }

  const { error } = await admin
    .from("platform_fx_rates")
    .upsert({ dia, usd_brl: valor, fonte: FONTE, capturado_em: agora.toISOString() }, { onConflict: "dia" });
  if (error) return { dia, usd_brl: valor, gravado: false, motivo: "falha_ao_gravar" };

  // Espelho do valor mais recente, que é o que a tela lê hoje.
  await admin
    .from("platform_ai_custo")
    .upsert({ id: 1, usd_brl: valor, cotado_em: agora.toISOString() }, { onConflict: "id" });

  return { dia, usd_brl: valor, gravado: true };
}

async function handler(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("unauthorized", "cron secret ausente ou inválido", 401, { requestId });
  }
  const resultado = await atualizarCotacao(createAdminClient(), buscarDaOrigem);
  if (!resultado.gravado) {
    logger.warn("[cotacao-do-dolar] rodada sem gravação", { ...resultado, request_id: requestId });
  } else {
    logger.info("[cotacao-do-dolar] cotação do dia gravada", { ...resultado, request_id: requestId });
  }
  return ok(resultado, { requestId });
}

export const GET = handler;
export const POST = handler;
