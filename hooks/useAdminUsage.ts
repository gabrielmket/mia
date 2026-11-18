"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { UsageData } from "@/app/api/v1/admin/usage/route";

interface UsageResponse {
  data: UsageData;
}

export type UsageRange = "7d" | "30d" | "90d";

/**
 * FORK MIA (MIA-44): `mes` (AAAA-MM, calendário de Brasília) vence `range`, e
 * a rota passa a responder sobre aquele mês.
 */
export function useAdminUsage(range: UsageRange = "30d", tenantId?: string, mes?: string | null) {
  const params = new URLSearchParams({ range });
  if (tenantId) params.set("tenant_id", tenantId);
  if (mes) params.set("mes", mes);

  return useQuery({
    queryKey: ["admin", "usage", range, tenantId ?? null, mes ?? null],
    queryFn: () =>
      apiClient
        .get<UsageResponse>(`/api/v1/admin/usage?${params.toString()}`)
        .then((r) => r.data),
    staleTime: 5 * 60 * 1000, // 5 min
  });
}
