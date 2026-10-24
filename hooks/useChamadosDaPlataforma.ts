"use client";

/**
 * FORK MIA (.88) — os chamados do assistente da MIA no admin da plataforma.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { ChamadoDaPlataforma } from "@/lib/assistente/chamados-da-plataforma";
import type { SituacaoDeChamado } from "@/lib/assistente/tipos";

export type FiltroDeSituacao = "abertos" | SituacaoDeChamado | "todos";

export function useChamadosDaPlataforma(situacao: FiltroDeSituacao) {
  return useQuery({
    queryKey: ["admin-chamados", situacao],
    refetchInterval: 60_000,
    queryFn: () =>
      apiClient
        .get<{ data: { chamados: ChamadoDaPlataforma[] } }>(`/api/v1/admin/chamados?situacao=${situacao}`)
        .then((r) => r.data.chamados),
  });
}

export function useResponderChamado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pedido: { id: string; situacao: SituacaoDeChamado; resposta: string | null }) =>
      apiClient.patch<{ data: { numero: number; entregue: { assistente: boolean; sino: boolean; email: boolean } } }>(
        `/api/v1/admin/chamados/${pedido.id}`,
        { situacao: pedido.situacao, resposta: pedido.resposta },
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin-chamados"] }),
  });
}
