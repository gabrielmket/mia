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
  /** A chave deste valor em `template_values` e em `savedValues` (`header:1`). */
  valueKey: string;
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
  /** Links de mídia salvos no modelo — o painel da janela fechada pré-preenche com eles. */
  savedValues: Record<string, string>;
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
 * As duas listas que mostram template: a aba de Conexões (`channel-templates`) e
 * o painel da janela fechada na conversa (`templates-da-conversa`, prefixo — a
 * chave real leva a fonte).
 *
 * Editar e excluir invalidavam `["templates"]`, chave que nenhuma consulta usa: o
 * template editado continuava com o texto velho na tela até o `staleTime`, e o
 * excluído continuava lá para ser clicado. As chaves certas vieram do upstream
 * (`useSaveTemplateValues`, v1.60), que invalida as duas pelo mesmo motivo.
 */
function invalidarListasDeTemplate(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ["channel-templates"] });
  void qc.invalidateQueries({ queryKey: ["templates-da-conversa"] });
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
      invalidarListasDeTemplate(qc);
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
      invalidarListasDeTemplate(qc);
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir o template.");
    },
  });
}

/**
 * Grava (ou esquece, com string vazia) o link de mídia do modelo. Invalida
 * também a lista do painel da janela fechada, que lê a mesma rota com outra
 * chave: sem isso o link salvo aqui só apareceria na conversa depois do
 * `staleTime`.
 */
export function useSaveTemplateValues() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { name: string; language: string; values: Record<string, string> }) =>
      apiClient.patch<{ data: { savedValues: Record<string, string> } }>(
        "/api/v1/channels/templates",
        args,
      ),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel-templates"] });
      qc.invalidateQueries({ queryKey: ["templates-da-conversa"] });
    },
  });
}
