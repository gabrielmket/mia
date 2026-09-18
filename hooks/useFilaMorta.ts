"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";

export interface GrupoMorto {
  assinatura: string;
  exemplo: string | null;
  quantidade: number;
  tipos: string[];
  organizacoes: string[];
  maisAntigo: string;
  maisRecente: string;
  ids: string[];
}

const CHAVE = ["admin", "fila-morta"];

export function useFilaMorta() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () =>
      apiClient.get<{ data: { total: number; truncado: boolean; grupos: GrupoMorto[] } }>(
        "/api/v1/admin/fila-morta",
      ),
    select: (r) => r.data,
    staleTime: 10_000,
  });
}

export function useReprocessar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => apiClient.post("/api/v1/admin/fila-morta", { ids }),
    onSuccess: (r: unknown) => {
      const voltaram = (r as { data?: { voltaram?: number } })?.data?.voltaram ?? 0;
      toast.success(`${voltaram} de volta na fila.`);
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao reprocessar.");
    },
  });
}
