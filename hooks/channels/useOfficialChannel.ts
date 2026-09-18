"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

export interface OfficialChannelState {
  channel_session_id?: string | null;
  connected: boolean;
  /**
   * O link do cadastro incorporado, quando a plataforma configurou um.
   *
   * Nulo = só a porta manual. Ausência ESCONDE a porta; nunca mostra uma que
   * não abre.
   */
  embedded_signup_url?: string | null;
  /** Existe token gravado? O token em si NUNCA volta — ver a rota. */
  hasToken: boolean;
  phoneNumberId: string | null;
  wabaId: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  status: string | null;
  /**
   * A instalação consegue RECEBER? São DOIS segredos de servidor, e faltar um
   * produz o pior sintoma: conecta, diz "conectado", envia — e nada volta,
   * porque cada POST da Meta morre em 401 antes de virar linha.
   */
  podeReceber?: boolean;
  /** Os NOMES do que falta no `.env`. Valor de segredo não trafega aqui. */
  faltaNoAmbiente?: string[];
  webhook: {
    callbackUrl: string;
    verifyToken: string | null;
    fields: string[];
  } | null;
}

export interface ConnectInput {
  phone_number_id: string;
  waba_id: string;
  token: string;
}

export function useOfficialChannel() {
  return useQuery({
    queryKey: ["official-channel"],
    queryFn: async () => apiClient.get<{ data: OfficialChannelState }>("/api/v1/channels/official"),
    staleTime: 15_000,
  });
}

export function useConnectOfficialChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ConnectInput) =>
      apiClient.post<{ data: { connected: boolean; displayName: string; phoneNumber: string | null } }>(
        "/api/v1/channels/official",
        input,
      ),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["official-channel"] });
    },
  });
}
