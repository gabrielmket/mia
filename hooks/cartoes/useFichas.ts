"use client";

/**
 * FORK MIA — os dados e as ações das fichas conectadas (contato e empresa).
 *
 * Vincular uma pessoa a uma empresa usa a rota de contato que já existe
 * (`PATCH /api/v1/contacts/[id]`, que aceita empresa, cargo e — desde a 9013 —
 * papel e principal); ligar um negócio à empresa usa a do negócio
 * (`PATCH /api/v1/leads/[id]`). Nenhuma rota paralela.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { FichaDaEmpresa, FichaDoContato } from "@/lib/cartoes/fichas-servidor";
import type { Papel } from "@/lib/cartoes/papel";
import type { Empresa } from "@/hooks/useEmpresas";

export function useFichaDoContato(contatoId: string | null) {
  return useQuery({
    queryKey: ["ficha-do-contato", contatoId],
    enabled: Boolean(contatoId),
    staleTime: 15_000,
    queryFn: async () => (await apiClient.get<{ data: FichaDoContato }>(`/api/v1/contacts/${contatoId}/ficha`)).data,
  });
}

export type EmpresaComFicha = Empresa & { ficha: FichaDaEmpresa };

export function useFichaDaEmpresa(empresaId: string | null) {
  return useQuery({
    queryKey: ["empresas", "ficha-conectada", empresaId],
    enabled: Boolean(empresaId),
    staleTime: 15_000,
    queryFn: async () => (await apiClient.get<{ data: EmpresaComFicha }>(`/api/v1/empresas/${empresaId}`)).data,
  });
}

export interface VinculoComEmpresa {
  contatoId: string;
  empresaId: string | null;
  cargo?: string | null;
  papel?: Papel | null;
  principal?: boolean;
  /** Negócios abertos da pessoa, sem empresa, que passam a ser da empresa. */
  ligarNegocios?: string[];
}

export function useVincularEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: VinculoComEmpresa) => {
      await apiClient.patch(`/api/v1/contacts/${v.contatoId}`, {
        empresa_id: v.empresaId,
        ...(v.cargo !== undefined ? { cargo: v.cargo } : {}),
        ...(v.papel !== undefined ? { papel_na_empresa: v.papel } : {}),
        ...(v.principal !== undefined ? { principal_na_empresa: v.principal } : {}),
      });
      for (const leadId of v.ligarNegocios ?? []) {
        await apiClient.patch(`/api/v1/leads/${leadId}`, { empresa_id: v.empresaId });
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ficha-do-contato"] });
      void qc.invalidateQueries({ queryKey: ["empresas"] });
      void qc.invalidateQueries({ queryKey: ["contact"] });
      void qc.invalidateQueries({ queryKey: ["board"] });
    },
    onError: showApiError,
  });
}
