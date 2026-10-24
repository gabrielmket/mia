"use client";

/**
 * FORK MIA (.89) — as campanhas do caminho "Número por QR" na lista do
 * Broadcast, com um INTERRUPTOR.
 *
 * O `useCampanhas` do upstream (`hooks/campanhas/useCampanhas.ts`) pergunta
 * sempre, e mostra o erro em toast. Desde o e-mail marketing, a lista do
 * Broadcast abre também para quem só contratou o e-mail, e aí a rota das
 * Campanhas recusa (403): sem o interruptor, essa pessoa veria um erro em toda
 * visita. Mesma consulta e mesma chave de cache do upstream; só o `enabled` é
 * nosso. O hook do upstream fica intacto.
 */
import { useInfiniteQuery } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { CampanhaDaLista } from "@/hooks/campanhas/useCampanhas";
import { apiClient } from "@/lib/api/client";

export function useCampanhasDoQr(
  filtros: { status?: string; limit?: number },
  habilitado: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["campanhas", filtros],
    enabled: habilitado,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (filtros.status) qs.set("status", filtros.status);
      qs.set("limit", String(filtros.limit ?? 30));
      if (pageParam) qs.set("cursor", pageParam);
      try {
        return await apiClient.get<{
          data: CampanhaDaLista[];
          meta?: { cursor?: string; has_more?: boolean };
        }>(`/api/v1/campaigns?${qs.toString()}`);
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    getNextPageParam: (ultima) => (ultima.meta?.has_more ? ultima.meta.cursor : undefined),
  });
}
