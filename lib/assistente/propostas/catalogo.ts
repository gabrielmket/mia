/**
 * FORK MIA (.94) · O CATÁLOGO DAS PEÇAS que o assistente faz com aprovação
 * (protótipo "ensina e faz", tela 3: "O que ele faz com aprovação · 9 novas e
 * as 3 da .91"). Puro: a tela, o servidor, o MCP e os testes leem daqui.
 *
 * Cada peça diz onde mora (a tela do "Ver na tela"), até quando dá para
 * desfazer (a trava é o USO, sem prazo: decisão 4), por qual caminho o aplicar
 * passa (o mesmo da tela e da implantação: o assistente não ganha um jeito
 * próprio de escrever) e o aviso do cartão, quando há.
 *
 * As frases são chaves do dicionário (a tela traduz com `t()`).
 */
import type { TipoDeProposta } from "./tipos";

export interface DescricaoDaPeca {
  /** O nome da peça no cartão e no catálogo. */
  rotulo: string;
  /** Onde a peça mora, como o menu diz. */
  onde: string;
  /** A tela do "Ver na tela" (uma porta do catálogo de navegação). */
  href: string;
  /** Até quando dá para desfazer. */
  desfazer: string;
  /** O caminho que o aplicar usa. */
  caminho: string;
  /** "nova" (.94) ou "da .91". */
  origem: "nova" | "noventa_e_um";
  /** O aviso fixo do cartão (o do conhecimento é montado com o agente). */
  aviso: string | null;
}

export const CATALOGO_DAS_PECAS: Record<TipoDeProposta, DescricaoDaPeca> = {
  etapa_criar: {
    rotulo: "Criar etapa do funil",
    onde: "Etapas do funil",
    href: "/app/settings/tenant/pipelines",
    desfazer: "enquanto a etapa estiver vazia",
    caminho: "Etapas do funil · a mesma função da tela",
    origem: "nova",
    aviso: null,
  },
  etapa_renomear: {
    rotulo: "Renomear etapa do funil",
    onde: "Etapas do funil",
    href: "/app/settings/tenant/pipelines",
    desfazer: "enquanto ninguém mudar o nome de novo: volta o nome antigo",
    caminho: "Etapas do funil · a mesma função da tela",
    origem: "nova",
    aviso: "As automações e o agente que usam esta etapa seguem funcionando: eles olham a etapa, não o nome.",
  },
  resposta: {
    rotulo: "Resposta rápida",
    onde: "Respostas rápidas",
    href: "/app/templates",
    desfazer: "enquanto ninguém editar a resposta",
    caminho: "Respostas rápidas · a mesma gravação da tela",
    origem: "nova",
    aviso: null,
  },
  etiqueta: {
    rotulo: "Etiqueta",
    onde: "Configurações › Etiquetas",
    href: "/app/settings/tags",
    desfazer: "enquanto nenhum contato, negócio ou conversa tiver a etiqueta",
    caminho: "Etiquetas · a mesma função da tela",
    origem: "nova",
    aviso: null,
  },
  tarefa: {
    rotulo: "Tarefa",
    onde: "Tarefas",
    href: "/app/tasks",
    desfazer: "enquanto a tarefa não for concluída",
    caminho: "Tarefas · a mesma gravação da tela",
    origem: "nova",
    aviso: null,
  },
  rascunho_de_followup: {
    rotulo: "Rascunho de follow-up",
    onde: "Agente MIA › Follow-ups",
    href: "/app/ai/followups",
    desfazer: "enquanto o rascunho não for publicado",
    caminho: "Follow-ups · o modelo de retomada, em rascunho",
    origem: "nova",
    aviso: "Nasce em rascunho: nenhuma mensagem sai. Publicar é na tela, clique de quem pode.",
  },
  conhecimento: {
    rotulo: "Item de conhecimento",
    onde: "Agente MIA › Conhecimento",
    href: "/app/ai/knowledge/sources",
    desfazer: "sempre: o item sai na hora",
    caminho: "Conhecimento · garantir_conhecimento",
    origem: "nova",
    aviso: null,
  },
  relatorio: {
    rotulo: "Relatório",
    onde: "Relatórios",
    href: "/app/relatorios",
    desfazer: "enquanto não estiver num painel",
    caminho: "Relatórios · a mesma gravação da tela",
    origem: "nova",
    aviso: null,
  },
  meta: {
    rotulo: "Meta do mês",
    onde: "Desempenho",
    href: "/app/metrics",
    desfazer: "enquanto ninguém mudar a meta pela tela: volta a anterior",
    caminho: "Desempenho · a mesma gravação da tela",
    origem: "nova",
    aviso: "Muda o que a equipe vê em Desempenho e no resumo da manhã. Pelo assistente, só o administrador aprova a meta.",
  },
  agente: {
    rotulo: "Agente do modelo do segmento",
    onde: "Agente MIA › Agentes",
    href: "/app/ai/agents",
    desfazer: "enquanto for rascunho",
    caminho: "Agentes · garantirAgente",
    origem: "noventa_e_um",
    aviso: "Nasce em rascunho: não responde ninguém até alguém publicar.",
  },
  funil: {
    rotulo: "Funil do quadro pronto",
    onde: "Etapas do funil",
    href: "/app/settings/tenant/pipelines",
    desfazer: "enquanto nenhum negócio entrar",
    caminho: "Funis · garantirFunil",
    origem: "noventa_e_um",
    aviso: null,
  },
  followup: {
    rotulo: "Follow-up do modelo",
    onde: "Agente MIA › Follow-ups",
    href: "/app/ai/followups",
    desfazer: "enquanto não sair com o agente publicado",
    caminho: "Follow-ups · garantirFollowup",
    origem: "noventa_e_um",
    aviso: "Nasce em rascunho e sai junto com o agente na próxima publicação.",
  },
};

/** O aviso do item de conhecimento (decisão 3: entra ligado, com o aviso no cartão). */
export function avisoDoConhecimento(p: { agente_usa: boolean; agente_nome: string | null; material_nome: string }): string {
  if (p.agente_usa && p.agente_nome) {
    return `Entra ligado: ${p.agente_nome}, que está no ar, passa a usar isto na próxima conversa. O desfazer tira na hora.`;
  }
  return `Entra ligado no material «${p.material_nome}», mas nenhum agente no ar lê esse material ainda: escolher o material no agente e publicar é na tela de Agentes.`;
}
