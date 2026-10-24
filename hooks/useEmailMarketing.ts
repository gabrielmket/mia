"use client";

/**
 * FORK MIA (.89) — o que as telas do disparo de e-mail leem e gravam
 * (`/api/v1/email-marketing/*`). Um lugar só para as chaves de cache: gravar a
 * configuração invalida o retrato; editar a campanha invalida a conferência.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import type { BlocoDoEmail } from "@/lib/email-marketing/blocos";
import type { RecorteDoEmail } from "@/lib/email-marketing/recorte";
import type { RetratoDaConfiguracao } from "@/lib/email-marketing/retrato";

type Dados<T> = { data: T };

export type Retrato = RetratoDaConfiguracao & { pode_mudar: boolean };

export function useRetratoDoEmail(habilitado = true) {
  return useQuery({
    queryKey: ["email-marketing", "estado"],
    enabled: habilitado,
    queryFn: async () =>
      (await apiClient.get<Dados<Retrato>>("/api/v1/email-marketing/estado")).data,
    staleTime: 15_000,
  });
}

function useGravar<TCorpo, TResposta>(
  metodo: "post" | "put" | "patch" | "delete",
  caminho: (corpo: TCorpo) => string,
  invalidar: string[][],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (corpo: TCorpo) => {
      const url = caminho(corpo);
      const r =
        metodo === "delete"
          ? await apiClient.delete<Dados<TResposta>>(url)
          : await apiClient[metodo]<Dados<TResposta>>(url, corpo);
      return r.data;
    },
    onSuccess: () => {
      for (const k of invalidar) void qc.invalidateQueries({ queryKey: k });
    },
    onError: (err) => showApiError(err),
  });
}

export function useGravarConfiguracao() {
  return useGravar<Record<string, unknown>, Retrato>(
    "put",
    () => "/api/v1/email-marketing/configuracao",
    [["email-marketing", "estado"]],
  );
}

export interface RegistroConferido {
  id: string;
  tipo: string;
  nome: string;
  nomeCurto: string;
  valor: string;
  para: string;
  ok: boolean;
}

export function useVerificarDominio() {
  return useGravar<
    { dominio?: string; subdominio_de_retorno?: string },
    { dominio: string; verificado: boolean; faltam: string[]; registros: RegistroConferido[] }
  >("post", () => "/api/v1/email-marketing/dominio", [["email-marketing", "estado"]]);
}

export function useGravarRemetente() {
  return useGravar<{ nome: string; local: string; padrao?: boolean }, unknown>(
    "post",
    () => "/api/v1/email-marketing/remetentes",
    [["email-marketing", "estado"]],
  );
}

export function useArquivarRemetente() {
  return useGravar<{ id: string }, unknown>(
    "delete",
    (c) => `/api/v1/email-marketing/remetentes/${c.id}`,
    [["email-marketing", "estado"]],
  );
}

export function useGravarTexto() {
  return useGravar<{ versao: string; texto: string; inclui_aviso_de_medicao: boolean }, unknown>(
    "post",
    () => "/api/v1/email-marketing/textos",
    [
      ["email-marketing", "estado"],
      ["email-marketing", "textos"],
    ],
  );
}

export interface VersaoDoTextoNaTela {
  versao: string;
  texto: string;
  incluiAvisoDeMedicao: boolean;
  rascunhoJuridico: boolean;
}

export function useTextosDeConsentimento() {
  return useQuery({
    queryKey: ["email-marketing", "textos"],
    queryFn: async () =>
      (
        await apiClient.get<Dados<{ versoes: VersaoDoTextoNaTela[] }>>(
          "/api/v1/email-marketing/textos",
        )
      ).data.versoes,
    staleTime: 60_000,
  });
}

// ─── supressão ──────────────────────────────────────────────────────────────

export interface LinhaDaSupressaoNaTela {
  id: string;
  endereco: string | null;
  motivo: string;
  deOnde: string | null;
  quando: string;
}

export function useSupressao(filtro: { motivo: string; busca: string }) {
  return useQuery({
    queryKey: ["email-marketing", "supressao", filtro],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (filtro.motivo) qs.set("motivo", filtro.motivo);
      if (filtro.busca.trim()) qs.set("busca", filtro.busca.trim());
      return (
        await apiClient.get<
          Dados<{
            linhas: LinhaDaSupressaoNaTela[];
            total: number;
            porMotivo: Record<string, number>;
          }>
        >(`/api/v1/email-marketing/supressao?${qs.toString()}`)
      ).data;
    },
    staleTime: 15_000,
  });
}

export function useAcrescentarSupressao() {
  return useGravar<{ email: string; motivo: string }, { entrou: boolean }>(
    "post",
    () => "/api/v1/email-marketing/supressao",
    [
      ["email-marketing", "supressao"],
      ["email-marketing", "estado"],
    ],
  );
}

export function useImportarSupressao() {
  return useGravar<
    { enderecos: string[]; de_onde?: string },
    {
      lidas: number;
      acrescentadas: number;
      ja_estavam: number;
      recusadas: Array<{ linha: number; motivo: string }>;
    }
  >("post", () => "/api/v1/email-marketing/supressao/importar", [
    ["email-marketing", "supressao"],
    ["email-marketing", "estado"],
  ]);
}

export function useImportarAceites() {
  return useGravar<
    {
      linhas: Array<{
        email: string;
        data: string | null;
        origem: string | null;
        versao?: string | null;
      }>;
    },
    {
      lidas: number;
      gravadas: number;
      ja_estavam: number;
      ja_descadastrados: number;
      sem_contato: number;
      recusadas: Array<{ linha: number; email: string; motivo: string }>;
    }
  >("post", () => "/api/v1/email-marketing/consentimentos/importar", []);
}

// ─── público e segmentos ────────────────────────────────────────────────────

export interface ContagemNaTela {
  sem_criterio: boolean;
  truncado: boolean;
  no_recorte: number;
  recebem: number;
  fora_por_motivo: Record<string, number>;
  amostras: Record<string, Array<{ nome: string | null; email: string | null }>>;
}

export function useContagemDoPublico(
  recorte: RecorteDoEmail,
  base: "consent" | "legitimate_interest",
  habilitado = true,
) {
  return useQuery({
    queryKey: ["email-marketing", "publico", recorte, base],
    enabled: habilitado,
    queryFn: async () =>
      (
        await apiClient.post<Dados<ContagemNaTela>>("/api/v1/email-marketing/publico", {
          recorte,
          base_legal: base,
        })
      ).data,
    staleTime: 10_000,
  });
}

export interface SegmentoNaTela {
  id: string;
  nome: string;
  recorte: RecorteDoEmail;
  base_legal: "consent" | "legitimate_interest";
  lia_ref: string | null;
  created_at: string;
}

export function useSegmentos(habilitado = true) {
  return useQuery({
    queryKey: ["email-marketing", "segmentos"],
    enabled: habilitado,
    queryFn: async () =>
      (
        await apiClient.get<Dados<{ segmentos: SegmentoNaTela[] }>>(
          "/api/v1/email-marketing/segmentos",
        )
      ).data.segmentos,
    staleTime: 30_000,
  });
}

export function useSalvarSegmento() {
  return useGravar<
    {
      nome: string;
      recorte: RecorteDoEmail;
      base_legal: "consent" | "legitimate_interest";
      lia_ref?: string | null;
    },
    unknown
  >("post", () => "/api/v1/email-marketing/segmentos", [["email-marketing", "segmentos"]]);
}

// ─── campanhas ──────────────────────────────────────────────────────────────

export interface CampanhaNaLista {
  id: string;
  nome: string;
  status: string;
  assunto: string;
  base_legal: string;
  agendada_para: string | null;
  iniciada_em: string | null;
  concluida_em: string | null;
  total_previsto: number | null;
  preco_cents: number | null;
  motivo_da_pausa: string | null;
  created_at: string;
  andamento: Record<string, number> | null;
}

export function useCampanhasDeEmail(habilitado = true) {
  return useQuery({
    queryKey: ["email-marketing", "campanhas"],
    enabled: habilitado,
    queryFn: async () =>
      (
        await apiClient.get<Dados<{ campanhas: CampanhaNaLista[] }>>(
          "/api/v1/email-marketing/campanhas",
        )
      ).data.campanhas,
    staleTime: 15_000,
  });
}

export interface CampanhaNaTela {
  id: string;
  nome: string;
  status: string;
  remetente_id: string | null;
  assunto: string;
  pre_cabecalho: string;
  blocos: BlocoDoEmail[];
  reservas: Record<string, string>;
  versao: number;
  teste_versao: number | null;
  recorte: RecorteDoEmail;
  segmento_id: string | null;
  base_legal: "consent" | "legitimate_interest";
  lia_ref: string | null;
  ritmo_por_hora: number | null;
  so_dias_uteis: boolean | null;
  agendada_para: string | null;
  plano: unknown[] | null;
  total_previsto: number | null;
  preco_cents: number | null;
  custo_previsto_cents: number | null;
  confirmada_em: string | null;
  declaracao_base_legal: string | null;
  motivo_da_pausa: string | null;
  iniciada_em: string | null;
  concluida_em: string | null;
  origem: string;
}

export interface TesteNaTela {
  id: string;
  versao: number;
  para: string[];
  enviado_em: string;
  resultado: { enviados?: string[]; recusados?: Array<{ para: string; erro: string }> };
}

export function useCampanhaDeEmail(id: string) {
  return useQuery({
    queryKey: ["email-marketing", "campanha", id],
    queryFn: async () =>
      (
        await apiClient.get<
          Dados<{
            campanha: CampanhaNaTela;
            andamento: Record<string, number> | null;
            testes: TesteNaTela[];
          }>
        >(`/api/v1/email-marketing/campanhas/${id}`)
      ).data,
    staleTime: 5_000,
    refetchInterval: (q) => {
      const s = q.state.data?.campanha.status;
      return s === "enviando" || s === "agendada" ? 15_000 : false;
    },
  });
}

export function useCriarCampanhaDeEmail() {
  return useGravar<
    { nome: string; modelo?: string; segmento_id?: string },
    { campanha: CampanhaNaTela }
  >("post", () => "/api/v1/email-marketing/campanhas", [["email-marketing", "campanhas"]]);
}

export function useEditarCampanha(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Record<string, unknown>) =>
      (
        await apiClient.patch<Dados<{ campanha: CampanhaNaTela }>>(
          `/api/v1/email-marketing/campanhas/${id}`,
          patch,
        )
      ).data.campanha,
    onSuccess: (campanha) => {
      qc.setQueryData(
        ["email-marketing", "campanha", id],
        (velho: { campanha: CampanhaNaTela } | undefined) =>
          velho ? { ...velho, campanha } : velho,
      );
      void qc.invalidateQueries({ queryKey: ["email-marketing", "conferencia", id] });
    },
    onError: (err) => showApiError(err),
  });
}

export function useEnviarTeste(id: string) {
  return useGravar<
    { para: string[]; ver_como_contato_id?: string | null },
    { versao: number; enviados: string[]; recusados: Array<{ para: string; erro: string }> }
  >("post", () => `/api/v1/email-marketing/campanhas/${id}/teste`, [
    ["email-marketing", "campanha", id],
    ["email-marketing", "conferencia", id],
  ]);
}

export interface ItemDaConferenciaNaTela {
  nivel: "ok" | "aviso" | "trava";
  titulo: string;
  detalhe: string | null;
  valores: { n?: number; lista?: string };
}

export interface DiaDoPlanoNaTela {
  data: string;
  diaDaSemana: number;
  inicio: string;
  fim: string;
  horaInicio: number;
  horaFim: number;
  quantidade: number;
  tetoDoAquecimento: number;
  porRitmo: number;
  degrau: number;
  porQuePara: "fim" | "aquecimento" | "ritmo";
}

export interface ConferenciaNaTela {
  publico: {
    contagem: { noRecorte: number; recebem: number; foraPorMotivo: Record<string, number> };
    truncado: boolean;
    semCriterio: boolean;
  };
  total: number;
  semDado: number;
  conteudo: ItemDaConferenciaNaTela[];
  travas: Array<{
    codigo: string;
    texto: string;
    ir: "config" | "publico" | "mensagem" | "envio" | null;
  }>;
  precoCents: number;
  precoPadrao: boolean;
  custoCents: number;
  saldoCents: number;
  plano: DiaDoPlanoNaTela[];
  ritmoPorHora: number;
  soDiasUteis: boolean;
  janela: [number, number];
  degrau: number;
  cotaDaConta: number;
  medicao: "cliques_e_aberturas" | "so_cliques";
}

export function useConferencia(
  id: string,
  pedido: { quando: string; ritmo_por_hora?: number | null; so_dias_uteis?: boolean | null },
  habilitado = true,
) {
  return useQuery({
    queryKey: ["email-marketing", "conferencia", id, pedido],
    enabled: habilitado,
    queryFn: async () =>
      (
        await apiClient.post<Dados<ConferenciaNaTela>>(
          `/api/v1/email-marketing/campanhas/${id}/conferencia`,
          pedido,
        )
      ).data,
    staleTime: 10_000,
  });
}

export function useConfirmarCampanha(id: string) {
  return useGravar<
    {
      quando: string;
      ritmo_por_hora?: number | null;
      so_dias_uteis?: boolean | null;
      confirmo_a_base_legal: true;
    },
    unknown
  >("post", () => `/api/v1/email-marketing/campanhas/${id}/confirmar`, [
    ["email-marketing", "campanha", id],
    ["email-marketing", "campanhas"],
    ["email-marketing", "conferencia", id],
  ]);
}

export function useControleDaCampanha(id: string) {
  return useGravar<{ acao: "pausar" | "retomar" | "cancelar"; mesmo_assim?: boolean }, unknown>(
    "post",
    () => `/api/v1/email-marketing/campanhas/${id}/controle`,
    [
      ["email-marketing", "campanha", id],
      ["email-marketing", "campanhas"],
      ["email-marketing", "resultados", id],
    ],
  );
}

export interface ResultadosNaTela {
  campanha: {
    id: string;
    nome: string;
    status: string;
    base_legal: string;
    motivo_da_pausa: string | null;
    total_previsto: number | null;
    plano: DiaDoPlanoNaTela[] | null;
  };
  numeros: {
    enviados: number;
    entregues: number;
    medidas: number;
    aberturas: number;
    cliquesUnicos: number;
    cliquesTotais: number;
    descadastros: number;
    rejeicoesPermanentes: number;
    rejeicoesTemporarias: number;
    reclamacoes: number;
    pendentes: number;
    pulados: number;
    falhas: number;
    cobradoCents: number;
    rejeicaoPct: number;
    reclamacaoPct: number;
    links: Array<{ id: string; rotulo: string; url: string; pessoas: number; cliques: number }>;
  };
  quem_clicou: Array<{
    contato_id: string;
    nome: string | null;
    email: string | null;
    link_id: string | null;
    responsavel_id: string | null;
    tem_negocio_aberto: boolean;
  }>;
}

export function useResultados(id: string, habilitado = true) {
  return useQuery({
    queryKey: ["email-marketing", "resultados", id],
    enabled: habilitado,
    queryFn: async () =>
      (
        await apiClient.get<Dados<ResultadosNaTela>>(
          `/api/v1/email-marketing/campanhas/${id}/resultados`,
        )
      ).data,
    staleTime: 15_000,
    refetchInterval: (q) => (q.state.data?.campanha.status === "enviando" ? 20_000 : false),
  });
}

export function useAcaoSobreCliques(id: string) {
  return useGravar<Record<string, unknown>, Record<string, unknown>>(
    "post",
    () => `/api/v1/email-marketing/campanhas/${id}/acoes`,
    [["email-marketing", "segmentos"]],
  );
}

// ─── consentimento na ficha ─────────────────────────────────────────────────

export interface FichaDoConsentimentoNaTela {
  email: string | null;
  vigente: boolean;
  consentimento: {
    granted_at: string | null;
    source: string | null;
    version: string | null;
    evidence: string | null;
    measurement: boolean;
    registered_by_kind: string | null;
    declined_at: string | null;
  } | null;
  supressao: { motivo: string; quando: string; deOnde: string | null } | null;
  recusouMarketingNoWhatsapp: boolean;
  registros: Array<{
    tipo: "aceite" | "recusa";
    ocorrido_em: string;
    origem: string | null;
    versao_do_texto: string | null;
    texto_aceito: string | null;
    evidencia: string | null;
    registrado_pelo: string;
  }>;
  versoes: VersaoDoTextoNaTela[];
}

export function useConsentimentoDoContato(contactId: string, habilitado = true) {
  return useQuery({
    queryKey: ["email-marketing", "consentimento", contactId],
    enabled: habilitado,
    queryFn: async () =>
      (
        await apiClient.get<Dados<FichaDoConsentimentoNaTela>>(
          `/api/v1/contacts/${contactId}/consentimento-de-email`,
        )
      ).data,
    staleTime: 15_000,
  });
}

export function useRegistrarConsentimento(contactId: string) {
  return useGravar<Record<string, unknown>, FichaDoConsentimentoNaTela>(
    "post",
    () => `/api/v1/contacts/${contactId}/consentimento-de-email`,
    [["email-marketing", "consentimento", contactId]],
  );
}
