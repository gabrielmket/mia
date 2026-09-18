/**
 * Quanto ainda tem de crédito no provedor de IA — a pergunta, com as consultas.
 *
 * `derivarSaldo` é só a conta. Juntar os três números que entram nela (os
 * lançamentos, o consumo desde a última leitura e a média diária) era trabalho
 * da rota do painel, e ficou lá enquanto só a tela perguntava.
 *
 * Passou a existir um segundo perguntador — o vigia que avisa no grupo quando o
 * crédito está acabando — e duas cópias da mesma coleta divergiriam no primeiro
 * ajuste: a tela diria "dura 9 dias" e o aviso, "dura 40". Quem lê os dois
 * perderia a confiança nos dois.
 *
 * ⚠️ Sem nenhuma LEITURA registrada não há saldo, e a resposta diz isso
 * (`saldoUsd: null`) em vez de chutar zero — que se leria como "acabou" e faria
 * o vigia gritar todo dia numa instalação que nunca registrou o crédito.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { derivarSaldo, type LancamentoBruto, type SaldoDerivado } from "./saldo";

/** A janela do "dura até". Média sobre o período inteiro: crédito acaba por calendário. */
export const DIAS_DA_MEDIA = 30;

export async function saldoDaPlataforma(admin: SupabaseClient): Promise<SaldoDerivado> {
  const { data: linhas } = await admin
    .from("platform_ai_ledger")
    .select("tipo, amount_usd, occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(100);

  const lancamentos: LancamentoBruto[] = (linhas ?? []).map((l) => ({
    tipo: (l as { tipo: string }).tipo as "recarga" | "leitura",
    amount_usd: Number((l as { amount_usd: unknown }).amount_usd),
    occurred_at: (l as { occurred_at: string }).occurred_at,
  }));

  // A leitura mais recente é a âncora; só o intervalo dela precisa de consulta.
  const leitura = lancamentos.find((l) => l.tipo === "leitura") ?? null;

  let consumoDesdeLeituraUsd = 0;
  if (leitura) {
    const { data: gastos } = await admin
      .from("llm_calls")
      .select("cost_cents")
      .gte("created_at", leitura.occurred_at)
      .limit(100_000);
    consumoDesdeLeituraUsd =
      (gastos ?? []).reduce((acc, g) => acc + Number((g as { cost_cents: unknown }).cost_cents ?? 0), 0) /
      100;
  }

  const desde = new Date(Date.now() - DIAS_DA_MEDIA * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentes } = await admin
    .from("llm_calls")
    .select("cost_cents")
    .gte("created_at", desde)
    .limit(100_000);
  const consumo30dUsd =
    (recentes ?? []).reduce((acc, g) => acc + Number((g as { cost_cents: unknown }).cost_cents ?? 0), 0) /
    100;

  return derivarSaldo({
    lancamentos,
    consumoDesdeLeituraUsd,
    mediaDiariaUsd: consumo30dUsd / DIAS_DA_MEDIA,
  });
}
