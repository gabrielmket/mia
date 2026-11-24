"use client";
/**
 * FORK MIA · coexistência (S3; docs/fork/coexistencia.md): o estado da
 * conexão pelo app WhatsApp Business na tela do canal oficial, e a conexão.
 *
 * Hook próprio, à parte do `useOfficialChannel` do upstream: a rota é
 * `/api/v1/channels/official/coexistencia`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { abrirJanelaDaMeta } from "@/components/connections/coexistencia/sdk-da-meta";
import { apiClient } from "@/lib/api/client";

export interface PedidoDaSincronizacaoNaTela {
  id: string;
  tipo: "contatos" | "historico";
  estado: string;
  pedidaEm: string | null;
  respondidaEm: string | null;
  concluidaEm: string | null;
  erroCodigo: string | null;
  erroTitulo: string | null;
  progresso: number | null;
  fase: number | null;
  contatosRecebidos: number;
  conversasRecebidas: number;
  mensagensRecebidas: number;
  mensagensExistentes: number;
  midiasGuardadas: number;
  lotesComFalha: number;
}

export interface NumeroPeloAppNaTela {
  conexaoId: string;
  channelSessionId: string;
  phoneNumberId: string;
  phoneNumber: string | null;
  estado: "no_ar" | "fora_do_ar" | "encerrada";
  abertaPor: string;
  conectadaEm: string;
  prazoDaSincronizacao: string;
  foraDoArMotivo: string | null;
  pedidos: PedidoDaSincronizacaoNaTela[];
}

export interface EstadoDaCoexistenciaNaTela {
  /** O nome da empresa da sessão (o número volta "já amarrado à" ela). */
  empresa: string | null;
  ligada: boolean;
  janela: {
    pronta: boolean;
    appId: string | null;
    configId: string | null;
    graphVersion: string | null;
    faltaNoAmbiente: string[];
  };
  numero: NumeroPeloAppNaTela | null;
}

const CHAVE = ["coexistencia-do-canal"] as const;

export function useCoexistencia() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () => apiClient.get<{ data: EstadoDaCoexistenciaNaTela }>("/api/v1/channels/official/coexistencia"),
    // A sincronização anda sozinha (a Meta manda em partes): a tela acompanha.
    refetchInterval: (q) => {
      const numero = q.state.data?.data.numero;
      const emAberto = numero?.pedidos.some((p) => ["pedindo", "pedida", "em_andamento"].includes(p.estado));
      return emAberto ? 15_000 : false;
    },
  });
}

/**
 * Abre a janela da Meta e, quando ela devolve, conecta o número na empresa da
 * sessão. A janela pede o nonce primeiro: quem não pode concluir não abre.
 */
export function useConectarPeloApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (janela: { appId: string; configId: string; graphVersion: string; locale: string }) => {
      const aberta = await apiClient.post<{ data: { nonce: string } }>("/api/v1/channels/official/coexistencia", {
        acao: "abrir",
      });
      const volta = await abrirJanelaDaMeta(janela);
      return apiClient.post<{ data: { connected: boolean; displayName: string; phoneNumber: string | null } }>(
        "/api/v1/channels/official/coexistencia",
        {
          acao: "concluir",
          nonce: aberta.data.nonce,
          code: volta.code,
          waba_id: volta.wabaId,
          phone_number_id: volta.phoneNumberId,
        },
      );
    },
    // Sem `onError` aqui: a janela fechada no meio não é erro de API, e quem
    // chama (`ConectarPeloApp`) diz cada caso com o texto certo.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHAVE });
      qc.invalidateQueries({ queryKey: ["official-channel"] });
    },
  });
}
