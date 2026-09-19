"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
  /** O id da NOSSA linha — é com ele que a tela edita e exclui. */
  id: string;
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

/**
 * Editar o texto de um template NA META.
 *
 * ⚠️ Um template APROVADO volta para análise e para de poder ser disparado até
 * a nova aprovação. A resposta traz `voltou_para_analise` para a tela avisar —
 * uma campanha agendada para amanhã morreria calada sem esse aviso.
 */
export function useEditarTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      id: string;
      body: string;
      header_texto?: string;
      footer?: string;
      exemplos?: string[];
    }) => {
      const { id, ...corpo } = v;
      return apiClient.patch<{ data: { voltou_para_analise: boolean } }>(
        `/api/v1/channels/templates/${id}`,
        corpo,
      );
    },
    onSuccess: (r) => {
      if (r.data?.voltou_para_analise) {
        toast.warning(
          "Editado. Como ele estava aprovado, voltou para análise da Meta e não pode ser disparado até ser aprovado de novo.",
        );
      } else {
        toast.success("Template editado.");
      }
      void qc.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao editar o template.");
    },
  });
}

/**
 * Excluir. A Meta apaga TODOS os idiomas daquele nome — ela não oferece apagar
 * um só, e a tela precisa dizer isso antes do clique.
 */
export function useExcluirTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiClient.delete(`/api/v1/channels/templates/${id}`),
    onSuccess: () => {
      toast.success("Template excluído na Meta.");
      void qc.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir o template.");
    },
  });
}
