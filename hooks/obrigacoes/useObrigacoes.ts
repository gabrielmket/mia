"use client";

/**
 * FORK MIA — os dados e as ações de Documentos e obrigações.
 *
 * Uma leitura por ESCOPO (`/api/v1/obrigacoes?lead_id=|empresa_id=|contact_id=`
 * ou a lista geral) e uma chave de cache por escopo: o Foco e a seção do cartão
 * aberto pedem o mesmo negócio e dividem a mesma resposta. Toda ação invalida
 * TODAS as leituras de obrigações (o item da empresa aparece em vários
 * negócios: mexer num lugar muda no outro) e o quadro (o aviso do cartão
 * fechado sai da rota do quadro).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import { ApiError, type ApiErrorBody } from "@/lib/api/types";
import type { ModeloDeTipo, SegmentoDeObrigacao } from "@/lib/obrigacoes/catalogo";
import type { Dia } from "@/lib/obrigacoes/datas";
import type { ContextoDoEscopo } from "@/lib/obrigacoes/leitura";
import type {
  DetalheDaObrigacao,
  EscopoDaLeitura,
  ObrigacaoNaTela,
  TipoDeObrigacao,
} from "@/lib/obrigacoes/tipos";

const RAIZ = "obrigacoes";

export interface LeituraNaTela {
  itens: ObrigacaoNaTela[];
  contexto: ContextoDoEscopo;
  cortada: boolean;
  /** O "hoje" do fuso da empresa, com que a situação é calculada. */
  hoje: Dia;
}

function enderecoDoEscopo(escopo: EscopoDaLeitura): string {
  if (escopo.tipo === "negocio") return `/api/v1/obrigacoes?lead_id=${escopo.id}`;
  if (escopo.tipo === "empresa") return `/api/v1/obrigacoes?empresa_id=${escopo.id}`;
  if (escopo.tipo === "contato") return `/api/v1/obrigacoes?contact_id=${escopo.id}`;
  return "/api/v1/obrigacoes";
}

export function useObrigacoes(escopo: EscopoDaLeitura | null) {
  const chave = escopo ? [RAIZ, escopo.tipo, "id" in escopo ? escopo.id : "todas"] : [RAIZ, "nenhum"];
  return useQuery({
    queryKey: chave,
    enabled: escopo !== null,
    staleTime: 15_000,
    queryFn: async () => (await apiClient.get<{ data: LeituraNaTela }>(enderecoDoEscopo(escopo!))).data,
  });
}

export function useDetalheDaObrigacao(id: string | null) {
  return useQuery({
    queryKey: [RAIZ, "detalhe", id],
    enabled: Boolean(id),
    staleTime: 5_000,
    queryFn: async () =>
      (await apiClient.get<{ data: DetalheDaObrigacao & { hoje: Dia } }>(`/api/v1/obrigacoes/${id}`)).data,
  });
}

export interface CatalogoNaTela {
  tipos: TipoDeObrigacao[];
  modelos: ModeloDeTipo[];
}

export function useTiposDeObrigacao(habilitado = true) {
  return useQuery({
    queryKey: [RAIZ, "tipos"],
    enabled: habilitado,
    staleTime: 60_000,
    queryFn: async () => (await apiClient.get<{ data: CatalogoNaTela }>("/api/v1/obrigacoes/tipos")).data,
  });
}

/** O que o formulário de adicionar entrega. */
export interface NovaObrigacao {
  nome: string;
  nome_curto?: string | null;
  tipo_id?: string | null;
  categoria: "documento" | "atividade";
  lead_id?: string | null;
  empresa_id?: string | null;
  contact_id?: string | null;
  quem_entrega?: "cliente" | "nos";
  recorrencia?: "unica" | "mensal" | "anual" | "n_meses";
  recorrencia_meses?: number | null;
  validade_meses?: number;
  avisos_dias?: number[];
  dias_sem_resposta?: number;
  pedido_em?: Dia | null;
  prazo_em?: Dia | null;
  recebido_em?: Dia | null;
  valido_ate?: Dia | null;
  proxima_em?: Dia | null;
  responsavel_user_id?: string | null;
  observacao?: string | null;
}

/** Sobe um formulário com arquivo. O cliente de API só fala JSON. */
async function enviarFormulario<T>(endereco: string, formulario: FormData): Promise<T> {
  const resposta = await fetch(endereco, { method: "POST", body: formulario });
  const corpo = (await resposta.json().catch(() => ({}))) as Partial<ApiErrorBody> & { data?: T };
  if (!resposta.ok || corpo.data === undefined) {
    const e = corpo.error;
    throw new ApiError(resposta.status, e?.code ?? "request_failed", e?.details, e?.request_id ?? "", e?.message);
  }
  return corpo.data;
}

export function useAcoesDeObrigacao() {
  const qc = useQueryClient();
  const depois = () => {
    void qc.invalidateQueries({ queryKey: [RAIZ] });
    // O aviso do cartão fechado sai da rota do quadro.
    void qc.invalidateQueries({ queryKey: ["board"] });
    void qc.invalidateQueries({ queryKey: ["timeline"] });
  };

  const adicionar = useMutation({
    mutationFn: async (v: { item: NovaObrigacao; arquivo?: File | null }) => {
      const criado = (await apiClient.post<{ data: { item: ObrigacaoNaTela } }>("/api/v1/obrigacoes", v.item)).data;
      if (v.arquivo) {
        const formulario = new FormData();
        formulario.append("file", v.arquivo, v.arquivo.name);
        await enviarFormulario(`/api/v1/obrigacoes/${criado.item.id}/arquivo`, formulario);
      }
      return criado.item;
    },
    onSuccess: depois,
    onError: showApiError,
  });

  const pedir = useMutation({
    mutationFn: async (id: string) =>
      (await apiClient.post<{ data: { item: ObrigacaoNaTela; modo: "pedido" | "renovacao_pedida" | "pedido_de_novo" } }>(
        `/api/v1/obrigacoes/${id}/pedir`,
        {},
      )).data,
    onSuccess: depois,
    onError: showApiError,
  });

  const receber = useMutation({
    mutationFn: async (v: { id: string; validoAte: Dia | null; arquivo?: File | null }) => {
      const formulario = new FormData();
      if (v.validoAte) formulario.append("valido_ate", v.validoAte);
      if (v.arquivo) formulario.append("file", v.arquivo, v.arquivo.name);
      return enviarFormulario<{ item: ObrigacaoNaTela; renovou: boolean }>(`/api/v1/obrigacoes/${v.id}/receber`, formulario);
    },
    onSuccess: depois,
    onError: showApiError,
  });

  const marcarFeita = useMutation({
    mutationFn: async (id: string) =>
      (await apiClient.post<{ data: { item: ObrigacaoNaTela; proxima_em: Dia | null } }>(`/api/v1/obrigacoes/${id}/feita`, {})).data,
    onSuccess: depois,
    onError: showApiError,
  });

  const editar = useMutation({
    mutationFn: async (v: { id: string; campos: Record<string, unknown> }) =>
      (await apiClient.patch<{ data: { item?: ObrigacaoNaTela } }>(`/api/v1/obrigacoes/${v.id}`, v.campos)).data,
    onSuccess: depois,
    onError: showApiError,
  });

  const decidirProposta = useMutation({
    mutationFn: async (v: { propostaId: string; decisao: "confirmar" | "recusar"; validoAte?: Dia | null }) =>
      (await apiClient.post<{ data: { decisao: string; arquivo_copiado?: boolean; renovou?: boolean } }>(
        `/api/v1/obrigacoes/propostas/${v.propostaId}`,
        { decisao: v.decisao, ...(v.decisao === "confirmar" ? { valido_ate: v.validoAte ?? null } : {}) },
      )).data,
    onSuccess: depois,
    onError: showApiError,
  });

  return { adicionar, pedir, receber, marcarFeita, editar, decidirProposta };
}

export function useCatalogoDeObrigacoes() {
  const qc = useQueryClient();
  const depois = () => void qc.invalidateQueries({ queryKey: [RAIZ, "tipos"] });

  const garantir = useMutation({
    mutationFn: async (v: {
      pipelineId: string | null;
      tipos?: Array<Record<string, unknown>>;
      modeloDoSegmento?: SegmentoDeObrigacao;
    }) =>
      (await apiClient.put<{ data: { resultado: Array<{ nome: string; desfecho: string }>; tipos: TipoDeObrigacao[] } }>(
        "/api/v1/obrigacoes/tipos",
        {
          pipeline_id: v.pipelineId,
          ...(v.tipos ? { tipos: v.tipos } : {}),
          ...(v.modeloDoSegmento ? { modelo_do_segmento: v.modeloDoSegmento } : {}),
        },
      )).data,
    onSuccess: depois,
    onError: showApiError,
  });

  const arquivar = useMutation({
    mutationFn: async (tipoId: string) => apiClient.delete(`/api/v1/obrigacoes/tipos/${tipoId}`),
    onSuccess: depois,
    onError: showApiError,
  });

  return { garantir, arquivar };
}

export interface SimulacaoNaTela {
  hoje: Dia;
  dispara_hoje: Array<{ id: string; nome: string; categoria: string }>;
  segurados: Array<{ id: string; nome: string; categoria: string }>;
  cortada: boolean;
}

/** O que a regra em edição alcançaria hoje. Só consulta quando há o que perguntar. */
export function useSimulacaoDoGatilho(gatilho: string, dias: string, tipo: string, habilitado: boolean) {
  const busca = new URLSearchParams({ gatilho });
  if (dias.trim()) busca.set("dias", dias.trim());
  if (tipo.trim()) busca.set("tipo", tipo.trim());
  return useQuery({
    queryKey: [RAIZ, "simular", gatilho, dias, tipo],
    enabled: habilitado,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => (await apiClient.get<{ data: SimulacaoNaTela }>(`/api/v1/obrigacoes/simular?${busca.toString()}`)).data,
  });
}
