"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { marcadoresEscolhidos } from "@/lib/inbox/marcador-da-conversa";
import type { FiltroDoLote } from "@/lib/contacts/lote-em-partes";

/**
 * FORK MIA (.97): quantos contatos o filtro da tela tem ao todo.
 *
 * É o N de "Selecionar todos os N contatos deste filtro". A conta vem do mesmo
 * handler da lista (`?com_total=true`), então ela sempre bate com o que a lista
 * mostra, e só é pedida quando a faixa precisa dela: contar a base inteira a
 * cada letra digitada na busca seria gasto sem ninguém olhando.
 *
 * Mora debaixo de `["contacts"]` de propósito: toda invalidação da lista (uma
 * importação, um lote) refaz a conta junto.
 */
export function useTotalDeContatos(filtro: FiltroDoLote, habilitado: boolean) {
  return useQuery({
    queryKey: ["contacts", "total", filtro],
    enabled: habilitado,
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: "1", com_total: "true" });
      if (filtro.search) qs.set("search", filtro.search);
      for (const marcador of marcadoresEscolhidos(filtro.tag ?? [])) qs.append("tag", marcador);
      if (filtro.modo === "ou") qs.set("modo", "ou");
      if (filtro.source) qs.set("source", filtro.source);
      if (filtro.pessoais) qs.set("pessoais", "true");
      const r = await apiClient.get<{ meta?: { total?: number | null } }>(`/api/v1/contacts?${qs.toString()}`);
      return r.meta?.total ?? null;
    },
  });
}
