"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface UsoDoTenant {
  dias: number;
  conversas: number;
  mensagens: number;
  ia: {
    chamadas: number;
    tokens: number;
    /** Centavos de DÓLAR — é assim que o custo de IA é medido no repositório. */
    custo_usd_cents: number;
    truncado: boolean;
  };
  mensagens_cobradas: {
    total: number;
    /** Centavos de REAL, da tabela de preços da plataforma. */
    totalCentavos: number;
    semPreco: string[];
    linhas: Array<{
      categoria: string;
      cobradas: number;
      centavosUnitarios: number | null;
      totalCentavos: number | null;
    }>;
  };
}

export function useUsoDoTenant(organizationId: string, dias: number) {
  return useQuery({
    queryKey: ["admin", "uso-do-tenant", organizationId, dias],
    queryFn: async () =>
      apiClient.get<{ data: UsoDoTenant }>(
        `/api/v1/admin/tenants/${organizationId}/usage?dias=${dias}`,
      ),
    select: (r) => r.data,
    staleTime: 30_000,
  });
}
