"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

export interface TemplateSlotView {
  /** A chave como a Meta a escreve (`1`) — ambígua entre corpo e cabeçalho. */
  key: string;
  /** A chave QUALIFICADA (`1`, `header:1`) — é esta que vale para montar. */
  chave: string;
  expects: string;
  /** Rótulo humano do endereço: "corpo", "cabeçalho", "card 2 › cabeçalho". */
  onde: string;
}

/** Texto de um componente, inteiro e uma vez só — a UI marca os `{{n}}`. */
export interface TemplatePreview {
  onde: string;
  text: string;
}

export interface TemplateView {
  name: string;
  language: string;
  status: string;
  category: string | null;
  rejectedReason: string | null;
  qualityScore: string | null;
  parameterFormat: string;
  contractHash: string;
  syncedAt: string;
  /** DERIVADOS do template pela API — nunca digitados, nunca contados à mão. */
  slots: TemplateSlotView[];
  previews: TemplatePreview[];
}

export interface TemplatesPayload {
  /** `null` = canal oficial não conectado. Distinto de "conectado e sem template". */
  waba: string | null;
  templates: TemplateView[];
}

export interface SyncCounts {
  inserted: number;
  updated: number;
  unchanged: number;
  disabled: number;
}

export function useTemplates() {
  return useQuery({
    queryKey: ["channel-templates"],
    queryFn: async () => apiClient.get<{ data: TemplatesPayload }>("/api/v1/channels/templates"),
    staleTime: 30_000,
  });
}

export function useSyncTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => apiClient.post<{ data: SyncCounts }>("/api/v1/channels/templates", {}),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel-templates"] });
    },
  });
}

export interface CabecalhoDeMidia {
  formato: "IMAGE" | "VIDEO" | "DOCUMENT";
  /** Devolvido por POST /channels/templates/midia — a AMOSTRA, não a imagem enviada. */
  handle: string;
}

export interface NovoTemplateInput {
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  body: string;
  exemplos?: string[];
  botoes?: string[];
  header?: string;
  footer?: string;
  header_midia?: CabecalhoDeMidia;
}

/**
 * Cria o template NA META, daqui.
 *
 * Invalida a lista no sucesso porque a própria rota já sincroniza depois de
 * criar — sem isso o template novo só apareceria no próximo sync manual, e
 * pareceria que a criação falhou.
 */
export function useCriarTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NovoTemplateInput) =>
      apiClient.post<{ data: { id: string; status: string; category: string } }>(
        "/api/v1/channels/templates/criar",
        input,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel-templates"] });
    },
  });
}
