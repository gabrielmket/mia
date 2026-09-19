"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";

export interface ModeloDoCatalogo {
  provider: string;
  model_id: string;
  display_name: string | null;
  supports_tools: boolean;
  input_price_per_million_cents: number | null;
  output_price_per_million_cents: number | null;
  is_default_for_provider: boolean;
}

export interface EscolhaDeModelo {
  provider: string | null;
  model_id: string | null;
  updated_at: string;
}

/**
 * Quais operadoras a INSTALAÇÃO sabe executar sozinha.
 *
 * `false` não é "não dá para usar": uma organização pode ter credencial
 * própria validada. É "cliente NOVO não publica com esta operadora" — e é
 * disso que esta tela trata, porque ela vale para todo cliente novo.
 */
export type ChaveDaInstalacao = Record<string, boolean>;

const CHAVE = ["admin", "modelo-de-ia"];

export function useModeloDeIa() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () =>
      apiClient.get<{
        data: {
          escolha: EscolhaDeModelo | null;
          chave_da_instalacao: Record<string, boolean>;
          modelos: ModeloDoCatalogo[];
        };
      }>(
        "/api/v1/admin/modelo-de-ia",
      ),
    select: (r) => r.data,
    staleTime: 30_000,
  });
}

export function useSalvarModeloDeIa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { provider: string | null; model_id: string | null }) =>
      apiClient.put("/api/v1/admin/modelo-de-ia", v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar o modelo.");
    },
  });
}
