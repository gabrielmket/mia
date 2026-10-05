"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { MetricaDeMeta, ProgressoDaMeta, ResumoDoMes } from "@/lib/crm/metas/progresso";

export interface PainelDeMetas {
  periodo: string;
  metas: ProgressoDaMeta[];
  resumo: ResumoDoMes;
  reunioes_no_mes: number;
  /** Marcar e comparecer são medidas diferentes — ver lib/crm/metas/progresso.ts. */
  reunioes: {
    marcadas: number;
    realizadas: number;
    faltas: number;
    sem_desfecho: number;
    /** NULO enquanto nenhuma reunião tiver desfecho. Não é zero. */
    taxa_de_comparecimento: number | null;
  };
  /**
   * FORK MIA: o mês passou do teto de leitura da rota, e os números contam só
   * as vendas e as reuniões mais recentes. A tela avisa.
   */
  truncado: boolean;
}

const CHAVE = (periodo: string) => ["metas", periodo] as const;

export function useMetas(periodo: string) {
  return useQuery({
    queryKey: CHAVE(periodo),
    queryFn: () =>
      apiClient
        .get<{ data: PainelDeMetas }>(`/api/v1/metas?periodo=${encodeURIComponent(periodo)}`)
        .then((r) => r.data),
    staleTime: 60 * 1000,
  });
}

export function useDefinirMeta(periodo: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: {
      periodo: string;
      metrica: MetricaDeMeta;
      alvo_cents?: number;
      alvo_quantidade?: number;
      user_id?: string | null;
      agent_id?: string | null;
    }) => apiClient.post<{ data: { id: string } }>("/api/v1/metas", corpo),
    // O progresso é derivado: mexer na meta muda a barra na mesma hora.
    onSuccess: () => void qc.invalidateQueries({ queryKey: CHAVE(periodo) }),
  });
}
