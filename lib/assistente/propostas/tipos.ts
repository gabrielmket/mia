/**
 * FORK MIA (.91) — AS PROPOSTAS DO ASSISTENTE: as formas (módulo puro).
 *
 * Fase 2 do desenho do upstream (#2860): o assistente PROPÕE e a
 * administradora aprova. Uma proposta é UMA peça, e só três peças cabem aqui:
 *
 *   agente     o agente do modelo do segmento, em RASCUNHO
 *   funil      o funil do quadro pronto do segmento
 *   followup   o follow-up do modelo do segmento, em rascunho, armado no
 *              agente para sair junto quando o agente for publicado
 *
 * Canal, número, cobrança, usuários, convite, chave e exclusão nunca são
 * propostos (o banco recusa o risco crítico, 9080): viram "preciso confirmar"
 * no "o que falta", com o botão da tela.
 */
import type { LeadStage } from "@/lib/agent-engine/agent/lead-state";
import type { SegmentoDoOnboarding } from "@/lib/onboarding/modelos-de-agente-da-mia";
import type { PromptTemplate } from "@/lib/schemas/onboarding";

export const TIPOS_DE_PROPOSTA = ["agente", "funil", "followup"] as const;
export type TipoDeProposta = (typeof TIPOS_DE_PROPOSTA)[number];

export const SITUACOES_DA_PROPOSTA = ["pendente", "aprovada", "aplicada", "rejeitada", "expirada"] as const;
export type SituacaoDaProposta = (typeof SITUACOES_DA_PROPOSTA)[number];

/** Uma linha do "o que muda" do cartão. */
export interface Mudanca {
  rotulo: string;
  valor: string;
}

export interface PedidoDeAgenteDoModelo {
  segmento: SegmentoDoOnboarding;
  nome: string;
  persona: string;
  jeito: PromptTemplate;
  prompt: string;
}

export interface PedidoDeFunilDoPacote {
  segmento: SegmentoDoOnboarding;
  pacote: string;
  nome: string;
  etapas: Array<{ nome: string; passo: LeadStage | null }>;
}

export interface PedidoDeFollowupDoModelo {
  segmento: SegmentoDoOnboarding;
  modelo: string;
  nome: string;
  agente_id: string;
  agente_nome: string;
  /** O passo da etapa que dispara (`null` = gatilho sem etapa, como o silêncio). */
  passo: LeadStage | null;
  janela: { inicio: string; fim: string; dias: number[] };
}

export type PedidoDaProposta =
  | { tipo: "agente"; pedido: PedidoDeAgenteDoModelo }
  | { tipo: "funil"; pedido: PedidoDeFunilDoPacote }
  | { tipo: "followup"; pedido: PedidoDeFollowupDoModelo };

/** O que o turno junta para a rota gravar como proposta pendente. */
export type PropostaDoTurno = PedidoDaProposta & { titulo: string; mudancas: Mudanca[] };

/** A proposta como a tela e o MCP a leem. */
export interface PropostaLida {
  id: string;
  tipo: TipoDeProposta;
  titulo: string;
  mudancas: Mudanca[];
  situacao: SituacaoDaProposta;
  criada_por: string | null;
  aprovada_em: string | null;
  aplicada_em: string | null;
  rejeitada_em: string | null;
  saiu_com_o_agente_em: string | null;
  erro: string | null;
  resultado: Record<string, unknown> | null;
  expira_em: string;
  created_at: string;
}

export const COLUNAS_DA_PROPOSTA =
  "id, tipo, titulo, mudancas, situacao, criada_por, aprovada_em, aplicada_em, rejeitada_em, saiu_com_o_agente_em, erro, resultado, expira_em, created_at";

/** A janela do follow-up do modelo: horário comercial, de segunda a sexta. */
export const JANELA_DO_FOLLOWUP_DO_MODELO = { inicio: "08:00", fim: "19:00", dias: [1, 2, 3, 4, 5] } as const;
