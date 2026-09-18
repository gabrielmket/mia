"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";

export interface LinhaDeCusto {
  categoria: string;
  cobradas: number;
  centavosUnitarios: number | null;
  totalCentavos: number | null;
}

export interface CustoDeCliente {
  organization_id: string;
  organizacao: string;
  linhas: LinhaDeCusto[];
  totalCentavos: number;
  semPreco: string[];
}

export interface CustoDaMeta {
  mes: string;
  truncado: boolean;
  precos: Array<{ categoria: string; centavos_brl: number }>;
  clientes: CustoDeCliente[];
}

const CHAVE = ["admin", "custo-da-meta"];

export function useCustoDaMeta(mes: string | null) {
  return useQuery({
    queryKey: [...CHAVE, mes],
    queryFn: async () =>
      apiClient.get<{ data: CustoDaMeta }>(
        `/api/v1/admin/custo-da-meta${mes ? `?mes=${encodeURIComponent(mes)}` : ""}`,
      ),
    select: (r) => r.data,
    staleTime: 30_000,
  });
}

export function useSalvarPrecosDaMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (precos: Array<{ categoria: string; centavos_brl: number }>) =>
      apiClient.put("/api/v1/admin/custo-da-meta", { precos }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar os preços.");
    },
  });
}
