"use client";
/**
 * FORK MIA (.85) — o horário de atendimento da IA dos agentes PUBLICADOS, para
 * os selos da equipe (lista de agentes e cabeçalho da conversa). A rota é
 * `GET /api/v1/ai/horario-da-ia`; o que ela devolve é o dado gravado, e o
 * estado de agora é calculado na tela, no relógio de quem lê.
 */
import { useQuery } from "@tanstack/react-query";

import type { HorarioDaIaGravado } from "@/lib/agent-engine/agent/horario-da-ia";
import { apiClient } from "@/lib/api/client";

export interface HorarioDoAgente {
  id: string;
  horario: HorarioDaIaGravado;
}

/** Os agentes publicados e no ar que têm horário (os demais não ganham selo). */
export function useHorariosDosAgentes() {
  return useQuery({
    queryKey: ["ai", "horario-da-ia", "agentes"],
    queryFn: () =>
      apiClient
        .get<{ data: { agentes: HorarioDoAgente[] } }>("/api/v1/ai/horario-da-ia")
        .then((r) => r.data.agentes),
    staleTime: 60_000,
  });
}

/** O agente que responde ESTA conversa e o horário dele (ou `null`s). */
export function useHorarioDaIaDaConversa(conversationId: string | null | undefined) {
  return useQuery({
    queryKey: ["ai", "horario-da-ia", "conversa", conversationId],
    enabled: typeof conversationId === "string" && conversationId !== "",
    queryFn: () =>
      apiClient
        .get<{ data: { agente: { id: string; nome: string } | null; horario: HorarioDaIaGravado | null } }>(
          `/api/v1/ai/horario-da-ia?conversa=${encodeURIComponent(conversationId ?? "")}`,
        )
        .then((r) => r.data),
    staleTime: 60_000,
  });
}
