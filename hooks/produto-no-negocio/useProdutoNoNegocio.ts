"use client";
/**
 * FORK MIA (.109) · os hooks do produto no negócio (docs/fork/produto-no-negocio.md).
 *
 *   useItensDoNegocio(leadId)        os itens, o estado do valor e o funil
 *   useProdutoNoFunil(pipelineId)    a palavra e as opções do funil (o quadro já
 *                                    carregado serve de valor inicial)
 *   useGravarItensDoNegocio(...)     o PUT da lista inteira e do modo do valor
 *   usePalavraDoProduto(palavra)     as quatro formas da palavra, já na língua da tela
 */
import { useContext, useMemo } from "react";
import { QueryClient, QueryClientContext, useMutation, useQuery } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { BoardData } from "@/lib/kanban/types";
import {
  formasDaPalavra,
  funilDoProduto,
  type FunilDoProduto,
  type PalavraDoProduto,
} from "@/lib/produto-no-negocio/funil";
import type { EstadoDoValor, ItemDoNegocio } from "@/lib/produto-no-negocio/regras";

export interface ItensDoNegocio {
  lead_id: string;
  pipeline_id: string;
  updated_at: string;
  moeda: string;
  itens: ItemDoNegocio[];
  valor: EstadoDoValor;
  funil: FunilDoProduto | null;
}

export interface PedidoDosItens {
  itens: Array<{ id?: string; product_id?: string; quantidade: number; desconto_cents: number }>;
  valor: { modo: "soma" } | { modo: "a_mao"; value_cents: number | null };
}

/**
 * O cliente do React Query de quem monta a tela; sem provedor, um de reserva.
 *
 * As peças do fork entram em formulários do upstream (`LeadFieldsForm`) que,
 * nos testes dele, montam sem `QueryClientProvider`. Sem a reserva, a peça nova
 * derrubaria a tela inteira; com ela, a leitura falha e o formulário segue com o
 * campo Valor de antes. Na aplicação o provedor sempre existe.
 */
const RESERVA = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function useCliente(): QueryClient {
  return useContext(QueryClientContext) ?? RESERVA;
}

export const chaveDosItens = (leadId: string) => ["produto-no-negocio", "itens", leadId] as const;
export const chaveDoFunil = (pipelineId: string) => ["produto-no-negocio", "funil", pipelineId] as const;

export function useItensDoNegocio(leadId: string | null, enabled = true) {
  const cliente = useCliente();
  return useQuery({
    queryKey: chaveDosItens(leadId ?? "-"),
    enabled: enabled && !!leadId,
    queryFn: async () => (await apiClient.get<{ data: ItensDoNegocio }>(`/api/v1/leads/${leadId}/itens`)).data,
    // A janela e o formulário abrem com o que está gravado AGORA: outra pessoa
    // pode ter mudado um item com a ficha fechada.
    staleTime: 0,
    retry: 1,
  }, cliente);
}

export function useProdutoNoFunil(pipelineId: string | null | undefined) {
  const qc = useCliente();
  return useQuery({
    queryKey: chaveDoFunil(pipelineId ?? "-"),
    enabled: !!pipelineId,
    queryFn: async () =>
      (await apiClient.get<{ data: FunilDoProduto }>(`/api/v1/pipelines/${pipelineId}/produto-no-negocio`)).data,
    // O quadro aberto já leu o funil (`["board", id]`): a tela não espera a rota
    // para saber se esconde o valor recorrente.
    initialData: () => {
      const quadro = pipelineId ? qc.getQueryData<BoardData>(["board", pipelineId]) : undefined;
      return quadro?.pipeline?.id ? funilDoProduto(quadro.pipeline) : undefined;
    },
    staleTime: 60_000,
  }, qc);
}

export function useGravarItensDoNegocio(leadId: string, pipelineId: string | null) {
  const qc = useCliente();
  return useMutation({
    mutationFn: async (pedido: PedidoDosItens) =>
      (await apiClient.put<{ data: ItensDoNegocio & { mudou: boolean } }>(`/api/v1/leads/${leadId}/itens`, pedido)).data,
    onSuccess: (dados) => {
      qc.setQueryData(chaveDosItens(leadId), (atual: ItensDoNegocio | undefined) => ({
        ...dados,
        funil: atual?.funil ?? null,
      }));
      // O valor e a linha do cartão mudaram: o quadro relê.
      if (pipelineId) void qc.invalidateQueries({ queryKey: ["board", pipelineId] });
    },
    onError: showApiError,
  }, qc);
}

/** As formas da palavra do funil; sem palavra, o padrão do sistema na língua da tela. */
export function usePalavraDoProduto(palavra: string | null | undefined): PalavraDoProduto {
  const t = useT();
  return useMemo(
    () =>
      // As chaves por extenso (e não `PADRAO_DO_SISTEMA.singular`): a cerca de
      // i18n lê o texto literal de cada `t()`.
      formasDaPalavra(palavra ?? null, { singular: t("produto ou serviço"), plural: t("produtos e serviços") }),
    [palavra, t],
  );
}
