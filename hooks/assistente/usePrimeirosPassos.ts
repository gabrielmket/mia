"use client";

/**
 * FORK MIA (.91) — os ganchos de dados dos primeiros passos: o "o que falta"
 * (`/api/v1/assistente/o-que-falta`) e as propostas do assistente
 * (`/api/v1/assistente/propostas`).
 *
 * O "o que falta" de quem administra vai por POST: é a rodada que guarda o
 * retrato (9081) quando algo mudou. Para o gestor, GET (ele lê a evolução e não
 * grava a dele).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { PropostaLida, PropostaNoCartao } from "@/lib/assistente/propostas/tipos";
import type { Evolucao } from "@/lib/assistente/retratos";
import type { RotuloDoCliente } from "@/lib/mcp-plataforma/checklist/rotulo-do-cliente";
import type { Criterio } from "@/lib/onboarding/o-que-falta-aparece";

export interface EstadoDoQueFalta {
  criterio: Criterio;
  rotulo: RotuloDoCliente | null;
  evolucao: Evolucao | null;
  guardou_retrato?: boolean;
  pode_aplicar: boolean;
}

export const CHAVE_DO_QUE_FALTA = ["o-que-falta"] as const;
export const CHAVE_DAS_PROPOSTAS = ["assistente", "propostas"] as const;

export function useOQueFalta(opcoes: { guardar: boolean; ativo?: boolean }) {
  return useQuery({
    enabled: opcoes.ativo ?? true,
    queryKey: [...CHAVE_DO_QUE_FALTA, opcoes.guardar],
    staleTime: 15_000,
    queryFn: () =>
      (opcoes.guardar
        ? apiClient.post<{ data: EstadoDoQueFalta }>("/api/v1/assistente/o-que-falta", {})
        : apiClient.get<{ data: EstadoDoQueFalta }>("/api/v1/assistente/o-que-falta")
      ).then((r) => r.data),
  });
}

export function usePropostas(ids: readonly string[]) {
  const lista = [...ids].sort();
  return useQuery({
    enabled: lista.length > 0,
    queryKey: [...CHAVE_DAS_PROPOSTAS, lista.join(",")],
    queryFn: () =>
      apiClient
        .get<{ data: { propostas: PropostaNoCartao[]; pode_aplicar: boolean } }>(
          `/api/v1/assistente/propostas?ids=${encodeURIComponent(lista.join(","))}`,
        )
        .then((r) => r.data),
  });
}

export function useDecidirProposta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pedido: { id: string; decisao: "aplicar" | "rejeitar" }) =>
      apiClient
        .post<{ data: { desfecho: string; proposta: PropostaLida; avisos: string[] } }>(
          `/api/v1/assistente/propostas/${encodeURIComponent(pedido.id)}`,
          { decisao: pedido.decisao },
          // Aplicar cria a peça pelo caminho da implantação: 10 s pode não bastar.
          { timeoutMs: 60_000 },
        )
        .then((r) => r.data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: CHAVE_DAS_PROPOSTAS });
      void qc.invalidateQueries({ queryKey: CHAVE_DO_QUE_FALTA });
    },
  });
}
