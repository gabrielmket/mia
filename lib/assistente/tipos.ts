/**
 * FORK MIA (.88) — O ASSISTENTE DA MIA: as formas que circulam entre o turno, a
 * rota e a tela.
 *
 * É a fase 1 da spec do upstream (#2860, "agente interno de configuração e
 * rotina"): chat de LEITURA. Nada aqui escreve no CRM. O desenho e os nomes
 * seguem a spec dele, para a peça poder voltar ao sistema-base
 * (docs/fork/assistente.md).
 *
 * Módulo PURO: sem banco, sem `next/*`. A tela importa daqui.
 */

/** Os papéis HUMANOS que usam o assistente (o `ai_operator` não é pessoa). */
export const PAPEIS_DO_ASSISTENTE = ["viewer", "agent", "manager", "admin"] as const;
export type PapelDoAssistente = (typeof PAPEIS_DO_ASSISTENTE)[number];

/** O que o assistente sabe fazer com a pessoa depois de responder: os botões. */
export type AcaoDoAssistente =
  /** "Me leva lá": uma tela do catálogo de navegação que o papel abre. */
  | { tipo: "ir"; rotulo: string; href: string }
  /** "Pedir à pessoa": um aviso na Central para quem pode, com o pedido. */
  | { tipo: "pedir"; rotulo: string; para_user_id: string; para_nome: string; pedido: string }
  /** "Mandar ao suporte": vira chamado do tipo Dúvida. */
  | { tipo: "suporte"; rotulo: string; pergunta: string }
  /** O rascunho do chamado, que a pessoa confere antes de abrir. */
  | {
      tipo: "chamado";
      rotulo: string;
      rascunho: {
        tipo: TipoDeChamado;
        texto: string;
        mensagem_do_sistema: string | null;
        parece_validacao: boolean;
      };
    };

export const TIPOS_DE_CHAMADO = ["erro", "duvida", "pedido"] as const;
export type TipoDeChamado = (typeof TIPOS_DE_CHAMADO)[number];

export const SITUACOES_DE_CHAMADO = ["novo", "em_analise", "resolvido"] as const;
export type SituacaoDeChamado = (typeof SITUACOES_DE_CHAMADO)[number];

export const ROTULO_DO_TIPO_DE_CHAMADO: Record<TipoDeChamado, string> = {
  erro: "Erro",
  duvida: "Dúvida",
  pedido: "Pedido",
};

export const ROTULO_DA_SITUACAO: Record<SituacaoDeChamado, string> = {
  novo: "Novo",
  em_analise: "Em análise",
  resolvido: "Resolvido",
};

/** A tela em que a pessoa estava quando perguntou. */
export interface TelaDaPergunta {
  /** Só o caminho (`/app/kanban/abc`), nunca a query string. */
  caminho: string;
  /** O nome da tela no catálogo de navegação, quando ela é uma porta conhecida. */
  rotulo: string | null;
}

/** O que o turno devolve para a rota gravar e a tela mostrar. */
export interface RespostaDoAssistente {
  texto: string;
  /** "De onde veio": o que as ferramentas de fato leram, sem repetição. */
  fontes: string[];
  acoes: AcaoDoAssistente[];
  /** O assistente disse que não sabe: a pergunta entra na lista do administrador. */
  semResposta: boolean;
  /** Os contatos que as ferramentas leram: a LGPD alcança a mensagem por eles. */
  contatos: string[];
  /** As ferramentas que rodaram, só o nome (vai para a auditoria, nunca o conteúdo). */
  ferramentas: string[];
  llmCallId: string | null;
}

/** Uma mensagem do histórico, como a rota devolve à tela. */
export interface MensagemDoAssistente {
  id: string;
  conversa_id: string;
  tipo: "pergunta" | "resposta" | "resumo_da_manha" | "resposta_do_chamado";
  texto: string;
  tela: string | null;
  fontes: string[];
  acoes: AcaoDoAssistente[];
  sem_resposta: boolean;
  erro: string | null;
  created_at: string;
}

export interface ConversaDoAssistente {
  id: string;
  titulo: string;
  origem: "pergunta" | "resumo_da_manha" | "chamado";
  created_at: string;
  ultima_em: string;
}

/**
 * As fontes do "de onde veio" que as ferramentas anotam, com o rótulo de tela.
 * Mapa de literais para a tela traduzir cada uma (`t(ROTULO_DA_FONTE[f])`);
 * fonte fora dele aparece como veio.
 */
export const ROTULO_DA_FONTE: Record<string, string> = {
  Tarefas: "Tarefas",
  Agenda: "Agenda",
  "Caixa de entrada": "Caixa de entrada",
  Conexões: "Conexões",
  Funis: "Funis",
  Radar: "Radar",
  Metas: "Metas",
  Contatos: "Contatos",
  Chamados: "Chamados",
  "Relatórios: meus negócios": "Relatórios: meus negócios",
  "Relatórios: negócios por responsável": "Relatórios: negócios por responsável",
  "Manual do sistema": "Manual do sistema",
  "Guia de operação": "Guia de operação",
  "Mapa das telas": "Mapa das telas",
  "Como trabalhamos aqui": "Como trabalhamos aqui",
  "Registro do que a IA fez em cada mensagem": "Registro do que a IA fez em cada mensagem",
};

/** O caminho de uma tela, sem query string nem fragmento, e só dentro do app. */
export function caminhoDaTela(bruto: string | null | undefined): string | null {
  if (typeof bruto !== "string") return null;
  const caminho = bruto.split(/[?#]/)[0]?.trim() ?? "";
  if (!caminho.startsWith("/app") && !caminho.startsWith("/admin")) return null;
  if (caminho.length > 300) return caminho.slice(0, 300);
  return caminho;
}

/**
 * O destino de um "Me leva lá" é sempre uma tela do app: nunca um endereço de
 * fora, nunca `javascript:`. A tela confere de novo antes de navegar, porque o
 * histórico é gravado pela sessão da própria pessoa.
 */
export function hrefDoApp(href: unknown): string | null {
  if (typeof href !== "string") return null;
  if (!/^\/app(\/[A-Za-z0-9_\-./]*)?(\?[A-Za-z0-9_\-=&.%]*)?$/.test(href)) return null;
  if (href.includes("..") || href.includes("//")) return null;
  return href;
}
