"use client";

/**
 * FORK MIA — os dados e as ações do cartão aberto (components/cartoes/aberto/).
 *
 * A leitura é UMA rota (`GET /api/v1/leads/[id]/cartao`); a linha do tempo e as
 * tarefas continuam vindo dos hooks do upstream (`useLeadTimeline`, `useTasks`),
 * que já são vivos — o cartão aberto não duplica o que eles fazem.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { CartaoAberto } from "@/lib/cartoes/cartao-aberto";
import type { Papel } from "@/lib/cartoes/papel";
import type { Message } from "@/lib/types/messaging";

export function chaveDoCartaoAberto(leadId: string | null) {
  return ["cartao-aberto", leadId] as const;
}

export function useCartaoAberto(leadId: string | null) {
  return useQuery({
    queryKey: chaveDoCartaoAberto(leadId),
    enabled: Boolean(leadId),
    staleTime: 15_000,
    queryFn: async () => {
      const r = await apiClient.get<{ data: CartaoAberto }>(`/api/v1/leads/${leadId}/cartao`);
      return r.data;
    },
  });
}

/** As últimas mensagens da conversa, para o filtro "Conversas" do histórico. */
export function useMensagensDoNegocio(conversaId: string | null | undefined, habilitado: boolean) {
  return useQuery({
    queryKey: ["cartao-aberto", "mensagens", conversaId],
    enabled: Boolean(conversaId) && habilitado,
    staleTime: 10_000,
    queryFn: async () => {
      const r = await apiClient.get<{ data: Message[] }>(
        `/api/v1/conversations/${conversaId}/messages?limit=40`,
      );
      return r.data ?? [];
    },
  });
}

function useInvalidarNegocio(leadId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: chaveDoCartaoAberto(leadId) });
    void qc.invalidateQueries({ queryKey: ["timeline", leadId] });
  };
}

export function useNotaDoNegocio(leadId: string) {
  const invalidar = useInvalidarNegocio(leadId);
  return useMutation({
    mutationFn: async (v: { texto: string; fixada: boolean }) =>
      apiClient.post(`/api/v1/leads/${leadId}/notas`, v),
    onSuccess: invalidar,
    onError: showApiError,
  });
}

export function useEnvolvidosDoNegocio(leadId: string, pipelineId: string) {
  const qc = useQueryClient();
  const invalidar = useInvalidarNegocio(leadId);
  const depois = () => {
    invalidar();
    // O "+N contatos" do cartão fechado sai da rota do quadro.
    void qc.invalidateQueries({ queryKey: ["board", pipelineId] });
  };
  const incluir = useMutation({
    mutationFn: async (v: { contactId: string; papel: Papel | null }) =>
      apiClient.post(`/api/v1/leads/${leadId}/envolvidos`, { contact_id: v.contactId, papel: v.papel }),
    onSuccess: depois,
    onError: showApiError,
  });
  const retirar = useMutation({
    mutationFn: async (contactId: string) =>
      apiClient.delete(`/api/v1/leads/${leadId}/envolvidos?contact_id=${encodeURIComponent(contactId)}`),
    onSuccess: depois,
    onError: showApiError,
  });
  return { incluir, retirar };
}

export function useConfirmarCampo(leadId: string) {
  const invalidar = useInvalidarNegocio(leadId);
  return useMutation({
    mutationFn: async (chave: string) => apiClient.post(`/api/v1/leads/${leadId}/campos-confirmados`, { chave }),
    onSuccess: invalidar,
    onError: showApiError,
  });
}
