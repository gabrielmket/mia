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

export interface ConfiguracaoDoReport {
  /** `null` = report desligado: nada é enviado ao grupo interno. */
  grupo: GrupoDeAvisos | null;
  /** Abaixo disto, avisa que o crédito de IA está acabando. Em dólares. */
  limite_saldo_usd: number;
  resumo_diario: boolean;
}

export interface NumeroDeAvisos {
  sessao: SessaoDeAvisos | null;
  candidatas: SessaoDeAvisos[];
  grupos: GrupoDeAvisos[];
  /** `true` = não deu para perguntar ao WhatsApp. Diferente de "não há grupos". */
  grupos_indisponiveis: boolean;
  empresas: EmpresaComGrupo[];
  report: ConfiguracaoDoReport;
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

/** O grupo INTERNO — o que recebe crédito acabando, número caído e o resumo. */
export function useSalvarReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      grupo: GrupoDeAvisos | null;
      limite_saldo_usd?: number;
      resumo_diario?: boolean;
    }) => apiClient.put("/api/v1/admin/numero-de-avisos/report", v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar o report.");
    },
  });
}

/**
 * Pareia um número NOVO e já o marca como o de avisos.
 *
 * A organização vai no corpo porque a sessão precisa de uma (a coluna é NOT
 * NULL e toda a máquina de conexão se apoia nela) — e porque o admin pode estar
 * com outra organização ativa na hora em que conecta o número da plataforma.
 */
export function useConectarNumeroDeAvisos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { organization_id: string; display_name?: string }) =>
      apiClient.post("/api/v1/admin/numero-de-avisos/conectar", v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao conectar o número.");
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
