"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";

export interface Empresa {
  id: string;
  nome: string;
  cnpj: string | null;
  site: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  observacoes: string | null;
  tags: string[];
  /** Campos adicionais. As definições vêm dos funis — ver a tela. */
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EmpresaComVinculos extends Empresa {
  contatos: Array<{
    id: string;
    display_name: string | null;
    name: string | null;
    phone_number: string | null;
    email: string | null;
  }>;
  negocios: Array<{
    id: string;
    title: string;
    status: string;
    value_cents: number | null;
    currency: string | null;
    created_at: string;
  }>;
  total_ganho_cents: number;
}

export type EmpresaEntrada = Partial<Omit<Empresa, "id" | "created_at" | "updated_at">> & {
  nome?: string;
};

const CHAVE = ["empresas"];

export function useEmpresas(busca: string) {
  return useQuery({
    queryKey: [...CHAVE, busca],
    queryFn: async () =>
      apiClient.get<{ data: Empresa[]; meta: { total: number } }>(
        `/api/v1/empresas${busca ? `?q=${encodeURIComponent(busca)}` : ""}`,
      ),
    staleTime: 10_000,
  });
}

export function useEmpresa(id: string | null) {
  return useQuery({
    queryKey: [...CHAVE, "ficha", id],
    queryFn: async () => apiClient.get<{ data: EmpresaComVinculos }>(`/api/v1/empresas/${id}`),
    select: (r) => r.data,
    enabled: Boolean(id),
  });
}

export function useSalvarEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id?: string | null; dados: EmpresaEntrada }) =>
      v.id
        ? apiClient.patch(`/api/v1/empresas/${v.id}`, v.dados)
        : apiClient.post("/api/v1/empresas", v.dados),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar a empresa.");
    },
  });
}

export function useExcluirEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiClient.delete(`/api/v1/empresas/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir a empresa.");
    },
  });
}
