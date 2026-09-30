/**
 * FORK MIA — "Fechamento previsto 31/10 · 78%", numa linha própria do cartão.
 *
 * Linha própria e não junto do compromisso, por decisão do Gabriel no
 * protótipo: "sáb 03/10 10h" (o que acontece) e "31/10" (quando se espera
 * fechar) são datas de naturezas diferentes, e dividir a mesma linha fazia uma
 * parecer a outra.
 *
 * ─── De onde vem a porcentagem ─────────────────────────────────────────────
 *
 * A da IA (`crm_lead_scores.ai_probability`), quando há — é a que tem porquê a
 * um clique. Sem ela, a chance calibrada da ETAPA (`crm_stages.win_probability`,
 * a mesma da previsão ponderada). Sem nenhuma das duas, a linha diz que não há
 * chance, em vez de inventar um zero que ninguém calculou.
 */
import type { Traduzir } from "@/lib/cartoes/tempo";

export interface FechamentoPrevisto {
  /** "31/10", ou "31/10/2027" fora do ano corrente. `null` = sem data. */
  data: string | null;
  /** A data já passou e o negócio segue aberto. */
  atrasado: boolean;
  pct: number | null;
  fonte: "ia" | "etapa" | null;
}

export function fechamentoPrevisto(entrada: {
  /** `crm_leads.expected_close_date` — `YYYY-MM-DD`. */
  dataPrevista: string | null;
  probabilidadeIa: number | null | undefined;
  probabilidadeEtapa: number | null | undefined;
  aberto: boolean;
  agora: Date;
}): FechamentoPrevisto {
  const pctIa = typeof entrada.probabilidadeIa === "number" ? entrada.probabilidadeIa : null;
  const pctEtapa = typeof entrada.probabilidadeEtapa === "number" ? entrada.probabilidadeEtapa : null;
  const pct = pctIa ?? pctEtapa;
  const fonte: FechamentoPrevisto["fonte"] = pctIa !== null ? "ia" : pctEtapa !== null ? "etapa" : null;

  let data: string | null = null;
  let atrasado = false;
  const m = entrada.dataPrevista?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const [, ano, mes, dia] = m;
    data = Number(ano) === entrada.agora.getFullYear() ? `${dia}/${mes}` : `${dia}/${mes}/${ano}`;
    // Compara pela DATA (texto ISO), não pelo instante: "vence hoje" não está
    // atrasado, e `new Date("2026-10-31")` nasceria à meia-noite UTC — o dia
    // anterior em São Paulo. "Hoje" é o do relógio de quem olha, não o de UTC
    // (às 22h em São Paulo, UTC já está no dia seguinte).
    const a = entrada.agora;
    const hoje = `${a.getFullYear()}-${String(a.getMonth() + 1).padStart(2, "0")}-${String(a.getDate()).padStart(2, "0")}`;
    atrasado = entrada.aberto && `${ano}-${mes}-${dia}` < hoje;
  }

  return {
    data,
    atrasado,
    pct: pct === null ? null : Math.max(0, Math.min(100, Math.round(pct))),
    fonte,
  };
}

/** A frase da linha. Sempre presente: a altura do cartão não depende do dado. */
export function textoDoFechamento(f: FechamentoPrevisto, t: Traduzir = (x) => x): string {
  const data = f.data ?? t("sem data");
  const pct = f.pct === null ? t("sem chance calculada") : `${f.pct}%`;
  return `${t("Fechamento previsto")} ${data} · ${pct}`;
}
