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
import type { MotivoDaFalhaDeGrupos } from "@/lib/channels/motivo-da-falha-de-grupos";

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

/**
 * FORK MIA (.62) — por qual número sai o aviso da empresa. Ausente no banco =
 * `plataforma`. `channel_session_id: null` = o que estava gravado não é mais um
 * número válido (a tela mostra como "não existe mais").
 */
export type OrigemDaEmpresa =
  | { modo: "plataforma" }
  | { modo: "empresa"; channel_session_id: string | null; reserva_da_plataforma: boolean };

/** Por que o número escolhido pela empresa não serve agora. */
export type ProblemaDoNumeroDaEmpresa =
  | "numero_da_empresa_sumiu"
  | "numero_da_empresa_nao_entrega_em_grupo"
  | "numero_da_empresa_fora_do_ar";

/**
 * Por onde o aviso desta empresa sai AGORA — a mesma decisão do envio.
 *  - `via` preenchido: sai. `reserva` = pelo da plataforma porque o da empresa
 *    não serve, e `motivo` diz por quê.
 *  - `via: null`: NÃO sai. `motivo` diz por quê, e `reserva` se ela estava
 *    desligada ou também indisponível.
 */
export interface SituacaoDoAviso {
  via: "plataforma" | "empresa" | "reserva" | null;
  motivo: string | null;
  reserva: "desligada" | "indisponivel" | null;
}

export interface EmpresaComGrupo {
  id: string;
  display_name: string | null;
  grupo: GrupoDeAvisos | null;
  origem: OrigemDaEmpresa;
  /** Números desta empresa que podem ser escolhidos (conectados, entregam em grupo). */
  numeros: SessaoDeAvisos[];
  /** O número escolhido como está agora (caído inclusive). */
  numero_escolhido: SessaoDeAvisos | null;
  situacao: SituacaoDoAviso;
  /** Grupos do número da empresa (modo empresa). `null` no modo plataforma. */
  grupos_do_numero: {
    grupos: GrupoDeAvisos[];
    indisponiveis: boolean;
    motivo: MotivoDaFalhaDeGrupos | null;
  } | null;
  /** Reserva ligada: o número da plataforma está no grupo? `null` = não se sabe. */
  reserva_no_grupo: boolean | null;
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
  /** O porquê de `grupos_indisponiveis` — o componente o transforma em frase e ação. */
  grupos_motivo?: MotivoDaFalhaDeGrupos | null;
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

/** FORK MIA (.62) — o número que manda o aviso da empresa, e a reserva. */
export function useDefinirOrigemDaEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      organization_id: string;
      origem:
        | { modo: "plataforma" }
        | { modo: "empresa"; channel_session_id: string; reserva_da_plataforma: boolean };
    }) => apiClient.put("/api/v1/admin/numero-de-avisos/origem", v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar o número dos avisos.");
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
