"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { ProdutoNoRelatorio } from "@/components/produto-no-negocio/QuadrosDoRelatorio";

export interface RelatorioDeVendas {
  periodo: string;
  fuso: string;
  taxa_de_ganho: { ganhos: number; perdidos: number; taxa: number | null };
  ciclo_de_venda: { mediaDias: number | null; medianaDias: number | null; vendas: number };
  motivos_de_perda: Array<{ motivo: string; quantidade: number; valorCents: number }>;
  historico: Array<{
    periodo: string;
    receitaCents: number;
    recorrenteCents: number;
    avulsoCents: number;
    vendas: number;
    perdas: number;
  }>;
  /**
   * FORK MIA: o período passou do teto de leitura da rota, e os números contam
   * só os negócios fechados mais recentes. A tela avisa.
   */
  truncado: boolean;
  /**
   * FORK MIA (.109): vendidos no mês e tempo até fechar, por produto
   * (docs/fork/produto-no-negocio.md). Nulo quando a leitura dos itens falhou.
   */
  produto_no_negocio?: ProdutoNoRelatorio | null;
}

export function useRelatorioDeVendas(periodo: string) {
  return useQuery({
    queryKey: ["relatorio-de-vendas", periodo],
    queryFn: async () =>
      apiClient.get<{ data: RelatorioDeVendas }>(
        `/api/v1/relatorio-de-vendas?periodo=${encodeURIComponent(periodo)}`,
      ),
    select: (r) => r.data,
    // Mês fechado não muda; o corrente muda devagar. Um minuto é o suficiente
    // para o número acompanhar sem transformar a tela num contador ao vivo.
    staleTime: 60_000,
  });
}
