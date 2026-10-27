"use client";

/**
 * A carteira de UM cliente, pelo painel administrativo.
 *
 * Separado de `useCarteira` (que o próprio cliente usa) de propósito: são rotas
 * diferentes com autorizações diferentes, e um hook único acabaria com um
 * parâmetro `organization_id` opcional que decide, em silêncio, se a chamada
 * pede permissão de plataforma ou de tenant.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";

export interface LinhaDoExtrato {
  id: string;
  tipo: "credito" | "debito" | "estorno";
  amount_cents: number;
  currency: string;
  occurred_at: string;
  ref_kind: string | null;
  ref_id: string | null;
  note: string | null;
}

export interface CarteiraDoTenant {
  organization_id: string;
  saldo_cents: number;
  creditado_cents: number;
  debitado_cents: number;
  estornado_cents: number;
  /** O preço por mensagem definido à mão. NULO = ninguém definiu (pode valer o do plano). */
  preco_por_mensagem_cents: number | null;
  /** FORK MIA (.95): o plano da assinatura (o atual). NULO = isenta. */
  plano: string | null;
  /** FORK MIA (.95): o preço por mensagem que VALE: o definido à mão, senão o do plano. */
  preco_por_mensagem_vigente_cents: number | null;
  preco_por_mensagem_origem: "combinado" | "plano" | null;
  /** FORK MIA (.95): o preço por e-mail definido à mão. NULO = ninguém definiu. */
  preco_por_email_cents: number | null;
  /** FORK MIA (.95): o preço por e-mail que VALE: o definido à mão, senão o do plano, senão o padrão. */
  preco_por_email_vigente_cents: number;
  preco_por_email_origem: "combinado" | "plano" | "padrao";
  alerta_saldo_cents: number | null;
  credito_acabando: boolean;
  /** O que a META cobra por mensagem de marketing. NULO = tarifa não cadastrada. */
  custo_da_meta_cents: number | null;
  custo_vigente_desde: string | null;
  /**
   * FORK MIA: o extrato passou do teto de leitura (lib/carteira/ler-saldo.ts) e
   * o saldo é a soma só dos lançamentos mais recentes. A tela avisa.
   */
  saldo_truncado: boolean;
  extrato: LinhaDoExtrato[];
}

export function useCarteiraDoTenant(organizationId: string) {
  return useQuery({
    queryKey: ["admin", "carteira", organizationId],
    queryFn: async () =>
      apiClient.get<{ data: CarteiraDoTenant }>(
        `/api/v1/admin/carteira?organization_id=${encodeURIComponent(organizationId)}`,
      ),
    select: (r) => r.data,
    staleTime: 15_000,
  });
}

export function useLancarNaCarteira(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { tipo: "credito" | "estorno"; amount_cents: number; note?: string }) =>
      apiClient.post("/api/v1/admin/carteira", { organization_id: organizationId, ...input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "carteira", organizationId] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao lançar o crédito.");
    },
  });
}

export function useDefinirPrecoDoTenant(organizationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      preco_por_mensagem_cents: number | null;
      alerta_saldo_cents: number | null;
      /** FORK MIA (.95): ausente fica como está; NULO tira o definido à mão. */
      preco_por_email_cents?: number | null;
    }) => apiClient.patch("/api/v1/admin/carteira", { organization_id: organizationId, ...input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "carteira", organizationId] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao gravar o preço.");
    },
  });
}
