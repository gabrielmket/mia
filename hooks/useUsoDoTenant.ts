"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
// FORK MIA (MIA-44): os tipos da leitura do consumo, a mesma do MCP.
import type { PedidoDePeriodo } from "@/lib/ai/usage/atalhos-de-periodo";
import type { ConsumoDoPeriodo } from "@/lib/ai/usage/consumo-do-periodo";

export interface UsoDoTenant {
  dias: number;
  /** FORK MIA (MIA-44): AAAA-MM quando o período é um mês do calendário em Brasília. */
  mes: string | null;
  /** FORK MIA (MIA-44): por agente, a linha "Sistema", por finalidade e em R$. */
  consumo: Omit<ConsumoDoPeriodo, "periodo">;
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
    /** A leitura das mensagens cobradas foi cortada no teto de páginas da rota. */
    truncado: boolean;
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

export function useUsoDoTenant(organizationId: string, pedido: PedidoDePeriodo) {
  // FORK MIA (MIA-44): ou `dias`, ou `mes=AAAA-MM`. A rota resolve o início e o fim.
  const busca = pedido.tipo === "mes" ? `mes=${pedido.mes}` : `dias=${pedido.dias}`;
  return useQuery({
    queryKey: ["admin", "uso-do-tenant", organizationId, busca],
    queryFn: async () =>
      apiClient.get<{ data: UsoDoTenant }>(
        `/api/v1/admin/tenants/${organizationId}/usage?${busca}`,
      ),
    select: (r) => r.data,
    staleTime: 30_000,
  });
}
