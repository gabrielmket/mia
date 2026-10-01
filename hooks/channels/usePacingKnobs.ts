"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { PacingKnobs } from "@/lib/agent-engine/pacing/defaults";
import type { ChannelKnobsRow, PacingKnobsUpdate } from "@/lib/ai/pacing-knobs";

export interface PacingSessionLite {
  id: string;
  waha_session_name: string | null;
  display_name: string | null;
  phone_number: string | null;
  status: string | null;
  daily_message_limit: number | null;
}

/** Estado do aquecimento, já calculado no servidor (a tela não recalcula a regra). */
export interface PacingWarmupView {
  number_activated_at: string | null;
  age_days: number;
  skipped: boolean;
  /** Teto de HOJE pelo aquecimento; null = sem teto (número formado ou aquecimento pulado). */
  cap_today: number | null;
}

export interface PacingKnobsItem {
  channel_session: PacingSessionLite;
  effective: PacingKnobs;
  warmup: PacingWarmupView;
  overrides: ChannelKnobsRow | null;
  defaults: PacingKnobs;
  bounds: {
    intervalMaxMs: number;
    msPorCaractereMax: number;
    atrasoMaximoMsMax: number;
    hourLastStart: number;
    hourEnd: number;
    daily_limit: { min: number; max: number };
  };
}

/** Knobs anti-ban por conexão (Operação Visível F2ii) — GET /api/v1/ai/pacing. */
export function usePacingKnobs(enabled = true) {
  return useQuery({
    queryKey: ["pacing-knobs"],
    enabled,
    queryFn: () =>
      apiClient.get<{ data: { items: PacingKnobsItem[] } }>("/api/v1/ai/pacing").then((r) => r.data),
  });
}

/**
 * O que o PUT devolve além dos knobs salvos.
 *
 * `turnos_reprogramados` é quantos atendimentos estavam PARADOS esperando a
 * janela e voltaram para a fila agora. `null` é "não consegui conferir", e a
 * tela precisa saber dizer isso — afirmar "nenhum" sem ter medido é o defeito
 * que `channel_knobs.updated_at` custou uma hora para ensinar.
 */
export interface PacingKnobsUpdateResult {
  data: { channel_session_id: string; turnos_reprogramados: number | null };
}

export function useUpdatePacingKnobs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PacingKnobsUpdate) =>
      apiClient.put<PacingKnobsUpdateResult>("/api/v1/ai/pacing", body),
    onSettled: () => qc.invalidateQueries({ queryKey: ["pacing-knobs"] }),
  });
}
