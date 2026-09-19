"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface PessoaDaEquipe {
  user_id: string;
  nome: string | null;
  email: string | null;
  ultimo_acesso: string | null;
  role: string;
  /** `ativo` | `convidado` (nunca aceitou) | `revogado`. */
  estado: string;
  desde: string;
}

export function useEquipeDoTenant(organizationId: string) {
  return useQuery({
    queryKey: ["admin", "equipe", organizationId],
    queryFn: async () =>
      apiClient.get<{ data: { equipe: PessoaDaEquipe[] } }>(
        `/api/v1/admin/tenants/${organizationId}/team`,
      ),
    select: (r) => r.data,
    staleTime: 15_000,
  });
}
