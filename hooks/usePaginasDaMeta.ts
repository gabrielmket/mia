"use client";
/**
 * FORK MIA (.61) — os hooks do painel da plataforma › Páginas da Meta
 * (`/admin/paginas-da-meta`). De qual empresa é cada Página, e qual empresa
 * empresta a conexão de Meta Ads da plataforma. Migration 9004.
 *
 * A leitura consulta a Meta (lista as Páginas do token), então não relê sozinha:
 * só ao abrir e depois de cada mudança.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

export interface PaginaNoPainel {
  id: string;
  nome: string;
  organization_id: string | null;
  organizacao: string | null;
  /** A conexão da plataforma alcança esta Página hoje? */
  alcancada: boolean;
  /** .64 (9008): atribuída pela plataforma ou assumida pela empresa. `null` = sem dono. */
  origem: "plataforma" | "conta_propria" | null;
}

export interface EstadoDasPaginasDaMeta {
  conexao: { organizacao_da_conexao: string | null; organizacao: string | null };
  empresas: Array<{ id: string; display_name: string }>;
  empresas_com_conexao: Array<{ id: string; display_name: string }>;
  paginas: PaginaNoPainel[];
  permissoes: {
    verificadas: boolean;
    faltandoObrigatorias: string[];
    faltandoRecomendadas: string[];
  } | null;
  erro: { falha: string; detalhe: string } | null;
}

const CHAVE = ["admin", "paginas-da-meta"] as const;

export function usePaginasDaMeta() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () =>
      apiClient.get<{ data: EstadoDasPaginasDaMeta }>("/api/v1/admin/paginas-da-meta", {
        timeoutMs: 60_000,
      }),
    select: (r) => r.data,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useEscolherConexaoDaPlataforma() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (organizacao_da_conexao: string | null) =>
      apiClient.put("/api/v1/admin/paginas-da-meta", { organizacao_da_conexao }),
    onError: showApiError,
    onSuccess: () => void qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useAtribuirPagina() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { page_id: string; page_name: string; organization_id: string }) =>
      apiClient.post("/api/v1/admin/paginas-da-meta", v),
    onError: showApiError,
    onSuccess: () => void qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useRetirarDonoDaPagina() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pageId: string) =>
      apiClient.delete(`/api/v1/admin/paginas-da-meta?page_id=${encodeURIComponent(pageId)}`),
    onError: showApiError,
    onSuccess: () => void qc.invalidateQueries({ queryKey: CHAVE }),
  });
}
