"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";

export interface ChegadaDeCadastro {
  id: string;
  waba_id: string;
  business_name: string | null;
  phone_number_id: string | null;
  phone_number: string | null;
  organization_id: string | null;
  organizacao: string | null;
  bound_at: string | null;
  created_at: string;
}

export interface EstadoDoCadastro {
  embedded_signup_url: string | null;
  chegadas: ChegadaDeCadastro[];
  empresas: Array<{ id: string; display_name: string }>;
}

const CHAVE = ["admin", "cadastro-incorporado"];

export function useCadastroIncorporado() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () =>
      apiClient.get<{ data: EstadoDoCadastro }>("/api/v1/admin/cadastro-incorporado"),
    select: (r) => r.data,
    staleTime: 10_000,
  });
}

export function useSalvarLinkDoCadastro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { embedded_signup_url: string | null }) =>
      apiClient.put("/api/v1/admin/cadastro-incorporado", v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar o link.");
    },
  });
}

export function useAmarrarCadastro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      waba_id: string;
      organization_id: string;
      phone_number_id: string;
    }) => apiClient.post("/api/v1/admin/cadastro-incorporado", v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao amarrar a conta.");
    },
  });
}
