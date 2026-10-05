"use client";

/**
 * A carteira da PRÓPRIA organização — a que o cliente vê.
 *
 * Só leitura, e é o desenho: crédito entra por decisão comercial e débito entra
 * pelo motor de envio. O banco recusa a escrita pelo cookie do tenant (0244),
 * então não há mutação aqui que o servidor pudesse aceitar.
 */
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface LinhaDaCarteira {
  id: string;
  tipo: string;
  amount_cents: number;
  currency: string;
  occurred_at: string;
  ref_kind: string | null;
  ref_id: string | null;
  note: string | null;
}

export interface Carteira {
  saldo_cents: number;
  creditado_cents: number;
  debitado_cents: number;
  estornado_cents: number;
  preco_por_mensagem_cents: number | null;
  /** `null` = sem preço acordado. NÃO é "ilimitado" — ver a tela. */
  mensagens_que_cabem: number | null;
  credito_acabando: boolean;
  alerta_saldo_cents: number | null;
  extrato: LinhaDaCarteira[];
  extrato_truncado: boolean;
  /**
   * FORK MIA: o extrato passou do teto de leitura (lib/carteira/ler-saldo.ts) e
   * o saldo é a soma só dos lançamentos mais recentes. A tela avisa.
   */
  saldo_truncado: boolean;
}

/**
 * `habilitado`: a lista do Broadcast (.58) só lê a carteira quando a organização
 * pode usar o número oficial — sem o módulo a rota recusa, e a carteira não
 * existe para quem não contratou.
 */
export function useCarteira(opcoes: { habilitado?: boolean } = {}) {
  return useQuery({
    queryKey: ["carteira"],
    enabled: opcoes.habilitado ?? true,
    queryFn: async () => apiClient.get<{ data: Carteira }>("/api/v1/carteira"),
    select: (r) => r.data,
    staleTime: 30_000,
  });
}
