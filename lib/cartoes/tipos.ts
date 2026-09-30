/**
 * FORK MIA — o que o cartão fechado sabe ALÉM do que o upstream já traz.
 *
 * Viaja no lead como `lead.cartao`, anexado pela rota do quadro
 * (`comSinaisDoCartao`, em `sinais-do-quadro.ts`). Não é coluna: é leitura de
 * outras áreas (conversa, agenda, IA, tarefas, compras) resolvida uma vez por
 * quadro, para o cartão não disparar uma requisição por negócio.
 *
 * Tudo aqui é OPCIONAL no sentido de "pode faltar": negócio sem contato não tem
 * bola nem objeção; contato sem compromisso não tem compromisso. A tela trata a
 * ausência como estado normal, nunca como erro.
 */
import type { Bola } from "@/lib/cartoes/bola";
import type { CompromissoDoCartao } from "@/lib/cartoes/compromisso";

/**
 * As siglas do canal de origem, na ordem em que o filtro as oferece.
 *
 * ⚠️ Vocabulário da TELA, não do banco: `crm_leads.source` e
 * `contacts.source_metadata` têm vocabulário aberto, e quem traduz um para o
 * outro é `canalDoNegocio` (`canal.ts`). Sigla nova entra aqui E no rótulo.
 */
export const SIGLAS_DE_CANAL = [
  "META",
  "FORM",
  "GOOGLE",
  "SITE",
  "INDIC",
  "ATIVO",
  "CAMPANHA",
  "IMPORT",
  "SOCIAL",
  "LIGACAO",
  "DIRETO",
  "MANUAL",
] as const;
export type SiglaDoCanal = (typeof SIGLAS_DE_CANAL)[number];

export const ROTULO_DO_CANAL = {
  META: "Anúncio Meta",
  FORM: "Formulário Meta",
  GOOGLE: "Google Ads",
  SITE: "Site",
  INDIC: "Indicação",
  ATIVO: "Prospecção ativa",
  CAMPANHA: "Campanha de mensagens",
  IMPORT: "Importação",
  SOCIAL: "Redes sociais",
  LIGACAO: "Ligação recebida",
  DIRETO: "WhatsApp direto",
  MANUAL: "Cadastro manual",
} as const satisfies Record<SiglaDoCanal, string>;

/** O texto curto do selo no cartão — a sigla, exceto onde ela não se lê sozinha. */
export const SELO_DO_CANAL = {
  META: "META",
  FORM: "FORM",
  GOOGLE: "GOOGLE",
  SITE: "SITE",
  INDIC: "INDIC",
  ATIVO: "ATIVO",
  CAMPANHA: "CAMP",
  IMPORT: "IMPORT",
  SOCIAL: "SOCIAL",
  LIGACAO: "LIGAÇÃO",
  DIRETO: "DIRETO",
  MANUAL: "MANUAL",
} as const satisfies Record<SiglaDoCanal, string>;

export interface CanalDoCartao {
  sigla: SiglaDoCanal;
  /** Campanha curta, quando a origem a conhece (anúncio, formulário, UTM, broadcast). */
  campanha: string | null;
}

export interface SinaisDoCartao {
  canal: CanalDoCartao;
  bola: Bola | null;
  /**
   * O próximo compromisso, cru: quem desenha é `textoDoProximoCompromisso`
   * (compromisso.ts), no cliente — o "hoje"/"amanhã" é relativo ao relógio de
   * quem olha, e o rótulo do local passa pela tradução da tela.
   */
  compromisso: CompromissoDoCartao | null;
  /** A objeção mais recente do retrato atual da IA (último checkpoint). */
  objecao: string | null;
  tarefasAtrasadas: number;
  /** Há tarefa aberta com prazo no futuro — um "próximo passo" marcado. */
  temTarefaFutura: boolean;
  /** Compras anteriores da pessoa (ou da empresa, em negócio B2B). */
  compras: { quantidade: number; totalCents: number; moeda: string } | null;
  /** B2B: a pessoa principal, o cargo/papel dela e quantos outros contatos há. */
  pessoa: { nome: string; cargo: string | null; papel: string | null; outros: number } | null;
  /** O nome do contato, para compor "Mariana C. · interesse" em venda a pessoas. */
  contatoNome: string | null;
  /** A chance calibrada da etapa (0–100), quando a IA ainda não calculou a do negócio. */
  chanceDaEtapa: number | null;
}
