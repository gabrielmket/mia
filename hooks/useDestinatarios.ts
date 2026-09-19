"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface DestinatarioDaCampanha {
  id: string;
  nome: string | null;
  telefone: string;
  status: string;
  erro: string | null;
  enviado_em: string | null;
}

export interface PaginaDeDestinatarios {
  total: number;
  inicio: number;
  limite: number;
  filtro: string | null;
  /** Contagem por estado, do banco inteiro — não só da página. */
  resumo: Record<string, number>;
  destinatarios: DestinatarioDaCampanha[];
}

/**
 * A PÁGINA de destinatários — não confundir com `useDestinatarios` de
 * `useBroadcasts.ts`, que é a prévia inline do cartão (lista curta, sem
 * filtro). Esta é a da tela cheia: pagina, filtra por estado e traz o resumo.
 */
export function usePaginaDaCampanha(id: string, status: string | null, inicio: number) {
  return useQuery({
    queryKey: ["broadcast-destinatarios", id, status, inicio],
    queryFn: async () => {
      const q = new URLSearchParams({ inicio: String(inicio) });
      if (status) q.set("status", status);
      return apiClient.get<{ data: PaginaDeDestinatarios }>(
        `/api/v1/broadcasts/${id}?${q.toString()}`,
      );
    },
    select: (r) => r.data,
    /**
     * Cinco segundos: uma campanha em andamento muda enquanto a tela está
     * aberta, e o número que ela existe para mostrar ("quantos falharam") é
     * justamente o que cresce durante o disparo.
     */
    staleTime: 5_000,
  });
}
