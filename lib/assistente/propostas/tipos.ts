/**
 * FORK MIA (.91, .94) — AS PROPOSTAS DO ASSISTENTE: as formas (módulo puro).
 *
 * Fase 2 do desenho do upstream (#2860): o assistente PROPÕE e quem pode
 * aprova. Uma proposta é UMA peça. Na .91 cabiam três, as do modelo do
 * segmento, só do administrador:
 *
 *   agente     o agente do modelo do segmento, em RASCUNHO
 *   funil      o funil do quadro pronto do segmento
 *   followup   o follow-up do modelo do segmento, em rascunho, armado no
 *              agente para sair junto quando o agente for publicado
 *
 * Na .94 (protótipo "ensina e faz", tela 3) entram nove do dia a dia, e quem
 * aprova é quem pode fazer o mesmo na tela (`quem-aprova.ts`):
 *
 *   etapa_criar           uma etapa nova num funil, antes de outra
 *   etapa_renomear        o nome de uma etapa
 *   resposta              uma resposta rápida (sua ou da equipe)
 *   etiqueta              uma etiqueta do vocabulário, com a cor
 *   tarefa                uma tarefa (sua ou de outra pessoa)
 *   rascunho_de_followup  um follow-up com as mensagens escritas, em rascunho
 *   conhecimento          um item no conhecimento que o agente consulta
 *   relatorio             um relatório salvo (seu ou da equipe)
 *   meta                  a meta do mês da empresa
 *
 * Toda peça aplicada pode ser DESFEITA enquanto nada depende dela
 * (`desfazer.ts`). Canal, número, cobrança, convite, usuários e papéis, chaves,
 * apagar, publicar agente e mensagem a cliente nunca são propostos
 * (`nunca.ts`; o banco recusa o risco crítico, 9080).
 */
import type { LeadStage } from "@/lib/agent-engine/agent/lead-state";
import type { SegmentoDoOnboarding } from "@/lib/onboarding/modelos-de-agente-da-mia";
import type { PromptTemplate } from "@/lib/schemas/onboarding";

/** As três da .91: do modelo do segmento, só o administrador aprova. */
export const TIPOS_DA_NOVENTA_E_UM = ["agente", "funil", "followup"] as const;
/** As nove do dia a dia (.94). */
export const TIPOS_DO_DIA_A_DIA = [
  "etapa_criar",
  "etapa_renomear",
  "resposta",
  "etiqueta",
  "tarefa",
  "rascunho_de_followup",
  "conhecimento",
  "relatorio",
  "meta",
] as const;
export const TIPOS_DE_PROPOSTA = [...TIPOS_DA_NOVENTA_E_UM, ...TIPOS_DO_DIA_A_DIA] as const;
export type TipoDeProposta = (typeof TIPOS_DE_PROPOSTA)[number];
export type TipoDaNoventaEUm = (typeof TIPOS_DA_NOVENTA_E_UM)[number];
export type TipoDoDiaADia = (typeof TIPOS_DO_DIA_A_DIA)[number];

export function ehTipoDeProposta(valor: unknown): valor is TipoDeProposta {
  return typeof valor === "string" && (TIPOS_DE_PROPOSTA as readonly string[]).includes(valor);
}

export const SITUACOES_DA_PROPOSTA = ["pendente", "aprovada", "aplicada", "rejeitada", "expirada", "desfeita"] as const;
export type SituacaoDaProposta = (typeof SITUACOES_DA_PROPOSTA)[number];

/** Uma linha do "o que muda" do cartão. */
export interface Mudanca {
  rotulo: string;
  valor: string;
}

// ── as três da .91 ──────────────────────────────────────────────────────────

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

// ── as nove do dia a dia (.94) ──────────────────────────────────────────────

/** "eu" = a peça é de quem pediu; "equipe" = de todos (precisa de gestor). */
export type ParaQuem = "eu" | "equipe";

export interface PedidoDeEtapaNova {
  funil_id: string;
  funil_nome: string;
  nome: string;
  /** A etapa que fica DEPOIS da nova; `null` = no fim do funil. */
  antes_de_id: string | null;
  antes_de_nome: string | null;
}

export interface PedidoDeRenomearEtapa {
  funil_id: string;
  funil_nome: string;
  etapa_id: string;
  de: string;
  para: string;
}

export interface PedidoDeResposta {
  /** Sempre com a barra: `/endereco`. */
  atalho: string;
  titulo: string;
  texto: string;
  para: ParaQuem;
}

export interface PedidoDeEtiqueta {
  nome: string;
  /** `#rrggbb`, da paleta das etiquetas. */
  cor: string;
}

export interface PedidoDeTarefa {
  titulo: string;
  /** Instante ISO com o fuso da empresa. */
  vence_em: string;
  /** Para a pessoa ler: "amanhã, 10h". */
  quando: string;
  para_user_id: string;
  para_nome: string;
}

export interface PedidoDeRascunhoDeFollowup {
  nome: string;
  /** O modelo de retomada que dá a escada (o gatilho de 24 h sem resposta). */
  modelo: string;
  /** As três mensagens da escada, na ordem. */
  mensagens: [string, string, string];
  /** As esperas entre a 1ª e a 2ª e entre a 2ª e a 3ª, em dias. */
  esperas_dias: [number, number];
}

export interface PedidoDeItemDeConhecimento {
  titulo: string;
  /** Como o cliente pergunta (a pergunta do item). */
  pergunta: string;
  resposta: string;
  /** O material em que o item entra; `null` = um material novo com o título. */
  material_id: string | null;
  material_nome: string;
  /** O agente no ar que já lê o material (o aviso do cartão). */
  agente_nome: string | null;
  agente_usa: boolean;
}

export type AgrupamentoDoRelatorio = "origem" | "etapa" | "resp";
export type PeriodoDoRelatorio = "7" | "30" | "90" | "mes" | "mesp";

export interface PedidoDeRelatorio {
  nome: string;
  agrupar: AgrupamentoDoRelatorio;
  periodo: PeriodoDoRelatorio;
  /** O funil, quando agrupa por etapa. */
  funil_id: string | null;
  para: ParaQuem;
}

export interface PedidoDeMeta {
  /** AAAA-MM. */
  mes: string;
  valor_cents: number;
  /** A moeda da empresa, só para o cartão. */
  moeda: string;
}

export type PedidoDaProposta =
  | { tipo: "agente"; pedido: PedidoDeAgenteDoModelo }
  | { tipo: "funil"; pedido: PedidoDeFunilDoPacote }
  | { tipo: "followup"; pedido: PedidoDeFollowupDoModelo }
  | { tipo: "etapa_criar"; pedido: PedidoDeEtapaNova }
  | { tipo: "etapa_renomear"; pedido: PedidoDeRenomearEtapa }
  | { tipo: "resposta"; pedido: PedidoDeResposta }
  | { tipo: "etiqueta"; pedido: PedidoDeEtiqueta }
  | { tipo: "tarefa"; pedido: PedidoDeTarefa }
  | { tipo: "rascunho_de_followup"; pedido: PedidoDeRascunhoDeFollowup }
  | { tipo: "conhecimento"; pedido: PedidoDeItemDeConhecimento }
  | { tipo: "relatorio"; pedido: PedidoDeRelatorio }
  | { tipo: "meta"; pedido: PedidoDeMeta };

/**
 * O que o turno junta para a rota gravar como proposta pendente. `chave` é a
 * peça (uma pendente por peça e empresa, 9100); vazia nas três da .91.
 */
export type PropostaDoTurno = PedidoDaProposta & { titulo: string; mudancas: Mudanca[]; chave?: string };

/** A proposta como a tela e o MCP a leem. */
export interface PropostaLida {
  id: string;
  tipo: TipoDeProposta;
  titulo: string;
  mudancas: Mudanca[];
  situacao: SituacaoDaProposta;
  risco: "seguro" | "atencao";
  chave: string;
  criada_por: string | null;
  aprovada_por: string | null;
  aprovada_em: string | null;
  aplicada_por: string | null;
  aplicada_em: string | null;
  rejeitada_por: string | null;
  rejeitada_em: string | null;
  pedida_a: string | null;
  pedida_em: string | null;
  ajustada_em: string | null;
  desfeita_por: string | null;
  desfeita_em: string | null;
  saiu_com_o_agente_em: string | null;
  erro: string | null;
  resultado: Record<string, unknown> | null;
  expira_em: string;
  created_at: string;
}

export const COLUNAS_DA_PROPOSTA =
  "id, tipo, titulo, mudancas, situacao, risco, chave, criada_por, aprovada_por, aprovada_em, aplicada_por, aplicada_em, " +
  "rejeitada_por, rejeitada_em, pedida_a, pedida_em, ajustada_em, desfeita_por, desfeita_em, saiu_com_o_agente_em, erro, resultado, expira_em, created_at";

/** Um campo do "Ajustar" do cartão, montado no servidor (`ajustar.ts`). */
export interface CampoDeAjuste {
  campo: string;
  rotulo: string;
  tipo: "texto" | "area" | "escolha" | "data_hora" | "numero";
  valor: string;
  opcoes?: Array<{ valor: string; rotulo: string }>;
}

/**
 * A chave como o banco a guarda (9100: uma pendente por tipo e chave). As três
 * da .91 são uma por empresa (chave vazia, como na .91). As nove do dia a dia
 * são por PESSOA: quem não enxerga a pendente de outra pessoa (o atendente, pela
 * RLS) receberia o "já existe" sem cartão nenhum; assim cada um recebe o seu, e
 * pedir de novo a mesma peça devolve o mesmo cartão. Se duas pessoas pedem a
 * mesma peça, a segunda a ser aplicada esbarra no "já existe" da própria tela.
 */
export function chaveNoBanco(tipo: TipoDeProposta, criadaPor: string | null, chave: string | null | undefined): string {
  if ((TIPOS_DA_NOVENTA_E_UM as readonly string[]).includes(tipo) || !chave) return chave ?? "";
  return `${criadaPor ?? "sem-dono"}|${chave}`.slice(0, 300);
}

/** O que trava o desfazer de uma aplicada (`null` = dá para desfazer). */
export interface TravaDoDesfazer {
  motivo: string;
}

/**
 * A proposta como o CARTÃO a mostra: a linha, os nomes de quem pediu, de quem
 * aprovou e de quem desfez, e o que a pessoa que olha pode fazer com ela.
 * Montada no servidor (`leitura.ts`); a tela não decide permissão.
 */
export interface PropostaNoCartao extends PropostaLida {
  quem_pediu: string | null;
  pedida_a_nome: string | null;
  aprovada_por_nome: string | null;
  rejeitada_por_nome: string | null;
  desfeita_por_nome: string | null;
  /** "só o administrador", "gestor ou administrador", "quem pediu, ou gestor e administrador". */
  quem_aprova: string;
  pode_aprovar: boolean;
  /** Recusar: quem aprova, ou quem pediu (retira o próprio pedido). */
  pode_recusar: boolean;
  /** Quem não aprova pode pedir (a pendente que ainda não foi pedida). */
  pode_pedir: boolean;
  /** A quem pedir, na ordem: primeiro quem tem o papel mais baixo que aprova. */
  pedir_a: Array<{ user_id: string; nome: string }>;
  pode_ajustar: boolean;
  /** Os campos do "Ajustar" (só na pendente que a pessoa ajusta). */
  ajustes: CampoDeAjuste[];
  /** O aviso do cartão (o fixo do tipo, ou o do conhecimento com o agente). */
  aviso: string | null;
  pode_desfazer: boolean;
  /** Só na aplicada: o motivo de não dar mais para desfazer. */
  trava_do_desfazer: TravaDoDesfazer | null;
  /** A tela onde a peça mora ("Ver na tela"). */
  href: string;
}

/** A janela do follow-up do modelo: horário comercial, de segunda a sexta. */
export const JANELA_DO_FOLLOWUP_DO_MODELO = { inicio: "08:00", fim: "19:00", dias: [1, 2, 3, 4, 5] } as const;
