"use client";

/**
 * O número da plataforma que avisa os grupos, e o grupo de cada cliente.
 *
 * Uma consulta só para as duas coisas porque a segunda depende da primeira: a
 * lista de grupos disponíveis SAI do número marcado. Duas queries separadas
 * deixariam a tela oferecer grupos de um número que já foi trocado.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";

export interface GrupoDeAvisos {
  id: string;
  nome: string;
}

export interface SessaoDeAvisos {
  id: string;
  organization_id: string;
  organizacao: string | null;
  phone_number: string | null;
  display_name: string | null;
  status: string | null;
}

export interface EmpresaComGrupo {
  id: string;
  display_name: string | null;
  grupo: GrupoDeAvisos | null;
}

export interface NumeroDeAvisos {
  sessao: SessaoDeAvisos | null;
  candidatas: SessaoDeAvisos[];
  grupos: GrupoDeAvisos[];
  /** `true` = não deu para perguntar ao WhatsApp. Diferente de "não há grupos". */
  grupos_indisponiveis: boolean;
  empresas: EmpresaComGrupo[];
}

const CHAVE = ["admin", "numero-de-avisos"];

export function useNumeroDeAvisos() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () => apiClient.get<{ data: NumeroDeAvisos }>("/api/v1/admin/numero-de-avisos"),
    select: (r) => r.data,
    staleTime: 15_000,
  });
}

export function useMarcarNumeroDeAvisos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (channel_session_id: string | null) =>
      apiClient.put("/api/v1/admin/numero-de-avisos", { channel_session_id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao definir o número de avisos.");
    },
  });
}

export function useDefinirGrupoDaEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { organization_id: string; grupo: GrupoDeAvisos | null }) =>
      apiClient.put("/api/v1/admin/numero-de-avisos/grupo", v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar o grupo.");
    },
  });
}
