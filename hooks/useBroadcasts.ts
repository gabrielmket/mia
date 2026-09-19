"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface AndamentoDaCampanha {
  total: number;
  pendente?: number;
  enviada?: number;
  entregue?: number;
  lida?: number;
  falhou?: number;
  estornada?: number;
}

export interface Campanha {
  id: string;
  nome: string;
  template_name: string;
  template_language: string;
  status: "rascunho" | "agendada" | "enviando" | "pausada" | "concluida" | "cancelada";
  preco_cents: number | null;
  agendado_para: string | null;
  iniciado_em: string | null;
  concluido_em: string | null;
  motivo_da_parada: string | null;
  created_at: string;
  andamento: AndamentoDaCampanha;
}

export interface CampanhaCriada {
  id: string;
  destinatarios: number;
  fora: { sem_telefone: number; repetidos: number; pediram_para_sair: number };
  pode_disparar: boolean;
  motivo: string | null;
  falta_cents: number | null;
  custo_estimado_cents: number | null;
}

export function useBroadcasts() {
  return useQuery({
    queryKey: ["broadcasts"],
    queryFn: async () => apiClient.get<{ data: { campanhas: Campanha[] } }>("/api/v1/broadcasts"),
    select: (r) => r.data.campanhas,
    // Campanha em curso muda sozinha (o cron manda a cada minuto): sem isto a
    // tela ficaria parada mostrando "0 enviadas" com o disparo andando.
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

export function useCriarCampanha() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      nome: string;
      template_name: string;
      template_language: string;
      valores_padrao: Record<string, string>;
      tags: string[];
      /** Etapas do funil cujos negócios ABERTOS entram. Vazio = não filtra. */
      etapas?: string[];
      variavel_do_nome: string | null;
    }) => apiClient.post<{ data: CampanhaCriada }>("/api/v1/broadcasts", input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["broadcasts"] });
    },
  });
}

export interface DestinatarioDaCampanha {
  id: string;
  nome: string | null;
  telefone: string;
  status: string;
  erro: string | null;
  enviado_em: string | null;
}

/**
 * QUEM vai receber (ou recebeu, e com qual desfecho).
 *
 * `habilitado` porque a lista só é buscada quando alguém abre a campanha:
 * carregar destinatário de toda campanha na tela inicial seria puxar milhares
 * de linhas que ninguém pediu.
 */
export function useDestinatarios(id: string | null, habilitado: boolean) {
  return useQuery({
    queryKey: ["broadcast-destinatarios", id],
    queryFn: async () =>
      apiClient.get<{ data: { total: number; destinatarios: DestinatarioDaCampanha[] } }>(
        `/api/v1/broadcasts/${id}?limite=200`,
      ),
    select: (r) => r.data,
    enabled: habilitado && Boolean(id),
    // Acompanha o disparo andando, pela mesma razão da lista de campanhas.
    refetchInterval: habilitado ? 15_000 : false,
  });
}

export function useExcluirCampanha() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      apiClient.delete<{ data: { id: string; excluida: boolean } }>(`/api/v1/broadcasts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["broadcasts"] });
    },
  });
}

export function useEditarCampanha() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      nome?: string;
      /**
       * Trocar template exige o PAR nome+idioma: é ele que identifica o
       * template na Meta, e mandar só um faz a rota recusar com essa frase.
       */
      template_name?: string;
      template_language?: string;
      /** Presente = REMONTAR a lista com este filtro. Vazio = todos. */
      tags?: string[];
    }) => {
      const { id, ...resto } = input;
      return apiClient.patch<{ data: { id: string; peneira: unknown } }>(
        `/api/v1/broadcasts/${id}`,
        resto,
      );
    },
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ["broadcasts"] });
      void qc.invalidateQueries({ queryKey: ["broadcast-destinatarios", v.id] });
    },
  });
}

export function useDispararCampanha() {
  const qc = useQueryClient();
  return useMutation({
    /**
     * Sem `quando`, dispara agora — o comportamento de sempre. Com `quando`,
     * a campanha vai para `agendada` e o cron a pega na hora marcada.
     */
    mutationFn: async (input: string | { id: string; quando: string }) => {
      const id = typeof input === "string" ? input : input.id;
      const corpo = typeof input === "string" ? {} : { agendado_para: input.quando };
      return apiClient.post<{
        data: { id: string; status: string; agendado_para: string | null; na_fila: number };
      }>(`/api/v1/broadcasts/${id}/disparar`, corpo);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["broadcasts"] });
      // O saldo cai junto com o disparo; sem isto a tela de Créditos mentiria.
      void qc.invalidateQueries({ queryKey: ["carteira"] });
    },
  });
}
