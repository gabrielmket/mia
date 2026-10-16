"use client";
/**
 * FORK MIA (item 8) — a análise do funil do upstream (`GET /api/v1/metrics/funil`,
 * issue #1750), que até aqui era só API. A conta é `lib/metrics/funil.ts`; a
 * tela é `app/app/paineis/funil`.
 */
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { RelatorioDeFunil } from "@/lib/metrics/funil";

export interface AnaliseDoFunilPayload extends RelatorioDeFunil {
  /** A contra-métrica da doutrina §3.3: turnos até o desfecho e opt-outs. */
  contra_metrica: {
    turnos: { p50: number | null; p90: number | null; denominador: string } | null;
    opt_outs: { quantidade: number | null; denominador: string } | null;
    fonte: string;
    nota: string;
  } | null;
  /** Alguma das leituras bateu no teto de 5 páginas: o relatório está cortado. */
  truncado: boolean;
}

export function useAnaliseDoFunil(janela: { from: string; to: string }) {
  return useQuery({
    queryKey: ["metrics", "funil", janela.from, janela.to],
    queryFn: async () =>
      apiClient.get<{ data: AnaliseDoFunilPayload }>(
        `/api/v1/metrics/funil?from=${encodeURIComponent(janela.from)}&to=${encodeURIComponent(janela.to)}`,
      ),
    staleTime: 60_000,
  });
}
