"use client";

/**
 * FORK MIA — os dados e as ações das fichas conectadas (contato e empresa).
 *
 * Desde a .79 (empresa única) vincular uma pessoa a uma empresa é
 * `useVincularPessoa` (`hooks/useEmpresas.ts`, a porta `fn_mia_vincular_pessoa`
 * da 9034): o contato pode estar em várias empresas, com papel em cada uma.
 * Ligar um negócio à empresa usa a rota do negócio (`PATCH /api/v1/leads/[id]`).
 */
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { FichaDaEmpresa, FichaDoContato } from "@/lib/cartoes/fichas-servidor";
import type { Empresa } from "@/hooks/useEmpresas";

export function useFichaDoContato(contatoId: string | null) {
  return useQuery({
    queryKey: ["ficha-do-contato", contatoId],
    enabled: Boolean(contatoId),
    staleTime: 15_000,
    queryFn: async () => (await apiClient.get<{ data: FichaDoContato }>(`/api/v1/contacts/${contatoId}/ficha`)).data,
  });
}

export type EmpresaComFicha = Empresa & {
  ficha: FichaDaEmpresa;
  total_ganho_cents: number;
  /** FORK MIA (.79): a outra empresa que esta parece (nome parecido e sem CNPJ). */
  parece_com: { id: string; nome: string } | null;
};

export function useFichaDaEmpresa(empresaId: string | null) {
  return useQuery({
    queryKey: ["empresas", "ficha-conectada", empresaId],
    enabled: Boolean(empresaId),
    staleTime: 15_000,
    queryFn: async () => (await apiClient.get<{ data: EmpresaComFicha }>(`/api/v1/empresas/${empresaId}`)).data,
  });
}
