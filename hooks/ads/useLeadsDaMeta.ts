"use client";
/**
 * FORK MIA — os hooks da tela Configurações › Formulários da Meta.
 *
 * Duas frequências diferentes, de propósito:
 *
 *   - o ESTADO (chave, formulários escolhidos, histórico) é do NOSSO banco:
 *     relê a cada 30 s e ao voltar para a aba. Observar em tempo real é direito
 *     de quem olha (sistema vivo, regra do tempo) e não custa nada na Meta;
 *   - o DIAGNÓSTICO (permissões, Páginas, formulários) é da META: só quando a
 *     tela abre ou alguém clica em "Conferir de novo". Cada leitura gasta cota
 *     da empresa, e `retry: false` pelo mesmo motivo de `useMetaAds.ts`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import type { Diagnostico } from "@/lib/leads-da-meta/diagnostico";
import type { MotivoDaLeitura, StatusDaLeitura } from "@/lib/leads-da-meta/motivos";

export interface ConfigDosLeadsDaMeta {
  ativo: boolean;
  dias_de_recuperacao: number;
  ativado_em: string | null;
  atualizado_em: string | null;
}

export interface FormularioEscolhido {
  id: string;
  page_id: string;
  page_name: string | null;
  form_id: string;
  form_name: string | null;
  pipeline_id: string | null;
  stage_id: string | null;
  ativo: boolean;
  lido_ate: string | null;
  ultima_leitura_em: string | null;
  ultimo_status: StatusDaLeitura | null;
  ultimo_motivo: MotivoDaLeitura | null;
  ultimo_detalhe: string | null;
  importados_total: number;
}

export interface LeituraDoHistorico {
  id: string;
  formulario_id: string;
  iniciada_em: string;
  terminada_em: string;
  status: StatusDaLeitura;
  novos: number;
  repetidos: number;
  recusados: number;
  motivo: MotivoDaLeitura | null;
  detalhe: string | null;
  janela_de: string | null;
  janela_ate: string | null;
  repeticoes: number;
}

export interface EstadoDosLeadsDaMeta {
  config: ConfigDosLeadsDaMeta;
  conectada: boolean;
  formularios: FormularioEscolhido[];
  leituras: LeituraDoHistorico[];
}

export interface ResultadoDaLeituraAgora {
  formularios: number;
  novos: number;
  repetidos: number;
  recusados: number;
  erros: number;
}

const CHAVE_ESTADO = ["leads-da-meta", "estado"] as const;
const CHAVE_DIAGNOSTICO = ["leads-da-meta", "diagnostico"] as const;

export function useEstadoDosLeadsDaMeta() {
  return useQuery({
    queryKey: CHAVE_ESTADO,
    queryFn: async () => apiClient.get<{ data: EstadoDosLeadsDaMeta }>("/api/v1/leads-da-meta"),
    refetchInterval: 30_000,
  });
}

export function useDiagnosticoDaMeta(enabled: boolean) {
  return useQuery({
    queryKey: CHAVE_DIAGNOSTICO,
    queryFn: async () =>
      apiClient.get<{ data: Diagnostico }>("/api/v1/leads-da-meta/paginas", {
        // Uma chamada por Página para listar os formulários: numa conta com
        // muitas Páginas o padrão de 10 s cortaria a resposta no meio.
        timeoutMs: 60_000,
      }),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useSalvarConfigDosLeadsDaMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mudanca: { ativo?: boolean; dias_de_recuperacao?: number }) =>
      apiClient.patch<{ data: ConfigDosLeadsDaMeta }>("/api/v1/leads-da-meta", mudanca),
    onError: showApiError,
    onSuccess: () => void qc.invalidateQueries({ queryKey: CHAVE_ESTADO }),
  });
}

export interface FormularioParaSalvar {
  page_id: string;
  page_name: string | null;
  form_id: string;
  form_name: string | null;
  perguntas: Record<string, string>;
  pipeline_id: string;
  stage_id: string;
  ativo: boolean;
}

export function useSalvarFormularioDaMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (formulario: FormularioParaSalvar) =>
      apiClient.put<{ data: { id: string } }>("/api/v1/leads-da-meta/formularios", formulario),
    onError: showApiError,
    onSuccess: () => void qc.invalidateQueries({ queryKey: CHAVE_ESTADO }),
  });
}

export function useLerLeadsDaMetaAgora() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      apiClient.post<{ data: ResultadoDaLeituraAgora }>(
        "/api/v1/leads-da-meta/ler-agora",
        {},
        // A primeira leitura de um formulário pode voltar até 90 dias.
        { timeoutMs: 180_000 },
      ),
    onError: showApiError,
    onSettled: () => void qc.invalidateQueries({ queryKey: CHAVE_ESTADO }),
  });
}
