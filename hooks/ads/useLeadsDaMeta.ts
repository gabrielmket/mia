"use client";
/**
 * FORK MIA — os hooks da aba Formulários de leads (Configurações › Meta Ads).
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
import type { EscolhaDasPaginas } from "@/lib/leads-da-meta/autoatendimento";
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
  /** .62: chave da pergunta → texto, como a Meta devolveu ao ligar. */
  perguntas?: Record<string, string> | null;
  /** .62: a pergunta escolhida para cada papel. Nulo = automático. */
  campo_telefone?: string | null;
  campo_nome?: string | null;
  campo_email?: string | null;
  /** .62: a Página assinada no app para o aviso em tempo real. */
  tempo_real?: "assinado" | "recusado" | null;
  tempo_real_motivo?: string | null;
  tempo_real_em?: string | null;
  /** .62: quando o último lead chegou pelo aviso da Meta. */
  ultimo_aviso_da_meta_em?: string | null;
  /** .62: leituras com erro seguidas, e o motivo já avisado aos administradores. */
  falhas_seguidas?: number;
  aviso_de_falha_motivo?: string | null;
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

/** FORK MIA (.61): uma Página desta empresa (9004). */
export interface PaginaDaEmpresa {
  page_id: string;
  page_name: string | null;
  /** .64 (9008): atribuída pela plataforma ou assumida pela própria empresa. */
  origem?: "plataforma" | "conta_propria" | null;
}

export interface EstadoDosLeadsDaMeta {
  config: ConfigDosLeadsDaMeta;
  /** Há token para ler: o da própria empresa ou, sem ele, o da plataforma. */
  conectada: boolean;
  origem_da_conexao: "propria" | "plataforma" | null;
  /** As Páginas desta empresa. Vazia = nada a importar, e a Meta nem é consultada. */
  paginas: PaginaDaEmpresa[];
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
const CHAVE_ESCOLHA = ["leads-da-meta", "escolha-das-paginas"] as const;

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
  /** .62: a chave da pergunta; nulo = automático; ausente = não muda. */
  campo_telefone?: string | null;
  campo_nome?: string | null;
  campo_email?: string | null;
}

/** O que o PUT devolve: o formulário salvo e, ligado, o resultado do tempo real. */
export interface FormularioSalvo {
  id: string;
  ativo: boolean;
  tempo_real: "assinado" | "recusado" | null;
  tempo_real_motivo: string | null;
}

export function useSalvarFormularioDaMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (formulario: FormularioParaSalvar) =>
      apiClient.put<{ data: FormularioSalvo }>("/api/v1/leads-da-meta/formularios", formulario, {
        // Ligar confere o formulário na Meta E assina a Página: duas idas a mais.
        timeoutMs: 45_000,
      }),
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

// ─── FORK MIA (.64) — a empresa com conta própria escolhe as Páginas (9008) ─

/**
 * As Páginas que a conta da Meta DESTA empresa alcança, cada uma com o estado.
 * Consulta a Meta: mesma frequência do diagnóstico (só ao abrir e depois de
 * cada mudança), e `retry: false` pelo mesmo motivo.
 */
export function useEscolhaDasPaginas(enabled: boolean) {
  return useQuery({
    queryKey: CHAVE_ESCOLHA,
    queryFn: async () =>
      apiClient.get<{ data: EscolhaDasPaginas }>("/api/v1/leads-da-meta/paginas/escolha", {
        timeoutMs: 60_000,
      }),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** Depois de assumir ou soltar, tudo o que depende das Páginas da empresa relê. */
function releDepoisDaEscolha(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: CHAVE_ESCOLHA });
  void qc.invalidateQueries({ queryKey: CHAVE_ESTADO });
  void qc.invalidateQueries({ queryKey: CHAVE_DIAGNOSTICO });
}

export function useAssumirPagina() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pageId: string) =>
      apiClient.post<{ data: { page_id: string; page_name?: string } }>(
        "/api/v1/leads-da-meta/paginas/escolha",
        { page_id: pageId },
        // Confere a Página na Meta antes de gravar.
        { timeoutMs: 45_000 },
      ),
    onError: showApiError,
    onSettled: () => releDepoisDaEscolha(qc),
  });
}

export function useSoltarPagina() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pageId: string) =>
      apiClient.delete<{ data: { page_id: string; formularios_desligados: number } }>(
        `/api/v1/leads-da-meta/paginas/escolha?page_id=${encodeURIComponent(pageId)}`,
      ),
    onError: showApiError,
    onSettled: () => releDepoisDaEscolha(qc),
  });
}
