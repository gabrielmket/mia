"use client";

/**
 * FORK MIA (.94) — os ganchos do "faz com aprovação": as listas da página do
 * assistente (pedidos esperando você, seus pedidos, o que o assistente fez) e
 * as ações do cartão (pedir, ajustar, desfazer). Aprovar e recusar continuam em
 * `usePrimeirosPassos` (`useDecidirProposta`), que a .91 já usava.
 *
 * Toda ação relê as propostas (o cartão mostra o que o BANCO diz, não o clique)
 * e o "o que falta" (uma peça desfeita pode voltar a faltar).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { PropostaLida, PropostaNoCartao } from "@/lib/assistente/propostas/tipos";

import { CHAVE_DAS_PROPOSTAS, CHAVE_DO_QUE_FALTA } from "./usePrimeirosPassos";

export type ListaDePropostas = "pedidos" | "meus_pedidos" | "feitas";

export function useListaDePropostas(lista: ListaDePropostas, ativo = true) {
  return useQuery({
    enabled: ativo,
    queryKey: [...CHAVE_DAS_PROPOSTAS, "lista", lista],
    staleTime: 10_000,
    queryFn: () =>
      apiClient
        .get<{ data: { propostas: PropostaNoCartao[] } }>(`/api/v1/assistente/propostas?lista=${lista}`)
        .then((r) => r.data.propostas),
  });
}

function useRelerDepois() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: CHAVE_DAS_PROPOSTAS });
    void qc.invalidateQueries({ queryKey: CHAVE_DO_QUE_FALTA });
  };
}

export function useDesfazerProposta() {
  const reler = useRelerDepois();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient
        .post<{ data: { desfecho: "desfeita" | "ja_estava"; proposta: PropostaLida; avisos: string[] } }>(
          `/api/v1/assistente/propostas/${encodeURIComponent(id)}/desfazer`,
          {},
          { timeoutMs: 60_000 },
        )
        .then((r) => r.data),
    onSettled: reler,
  });
}

export function usePedirProposta() {
  const reler = useRelerDepois();
  return useMutation({
    mutationFn: (pedido: { id: string; para_user_id?: string | null }) =>
      apiClient
        .post<{ data: { desfecho: "pedida" | "ja_estava"; para: { user_id: string; nome: string } } }>(
          `/api/v1/assistente/propostas/${encodeURIComponent(pedido.id)}/pedir`,
          { para_user_id: pedido.para_user_id ?? null },
        )
        .then((r) => r.data),
    onSettled: reler,
  });
}

export function useAjustarProposta() {
  const reler = useRelerDepois();
  return useMutation({
    mutationFn: (pedido: { id: string; campos: Record<string, string> }) =>
      apiClient
        .post<{ data: { proposta: PropostaLida } }>(`/api/v1/assistente/propostas/${encodeURIComponent(pedido.id)}/ajustar`, {
          campos: pedido.campos,
        })
        .then((r) => r.data),
    onSettled: reler,
  });
}
