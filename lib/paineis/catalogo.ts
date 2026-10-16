/**
 * FORK MIA (9030) — O CATÁLOGO DOS PAINÉIS PRONTOS E DO MOTOR DE CONTA.
 *
 * ── O que mora aqui ───────────────────────────────────────────────────────
 *
 * 1. O que cada FONTE do motor mede, agrupa e filtra. É o espelho de
 *    `fn_mia_relatorio_catalogo()` (migration 9030): o banco recusa o pedido
 *    fora da lista, e esta cópia existe para a tela (o montador do item 9) e o
 *    MCP oferecerem só o que o banco aceita. O invariante
 *    `tests/invariants/motor-de-conta-dos-relatorios.test.ts` compara as duas e
 *    reprova se divergirem.
 * 2. Os DOZE painéis prontos do protótipo aprovado (item 8), com o título e a
 *    pergunta que cada um responde.
 * 3. Os rótulos em português das chaves que o banco devolve codificadas
 *    (`ganho`, `meta_ads`, `compareceu`…). A tela passa cada um por `t()`.
 *
 * ⚠️ Módulo PURO: nada de cliente de banco, sessão ou `next/*`. A tela do
 * navegador, a página pública e as cercas importam daqui.
 */

// ─── As fontes do motor ─────────────────────────────────────────────────────

export const FONTES = [
  "negocios",
  "conversas",
  "contatos",
  "agenda",
  "followup",
  "obrigacoes",
  "anuncios",
] as const;
export type Fonte = (typeof FONTES)[number];

export const MEDIDAS = [
  "qtd",
  "soma",
  "media",
  "conv",
  "tetapa",
  "tfechar",
  "prev",
  "sem_prob",
  "chegaram",
  "tresp",
  "tresp90",
  "resolv",
  "comp",
  "taxa",
  "emdia",
  "aceito",
] as const;
export type Medida = (typeof MEDIDAS)[number];

export const DIMENSOES = [
  "etapa",
  "situacao",
  "resp",
  "origem",
  "etiqueta",
  "produto",
  "motivo",
  "previsto",
  "funil",
  "quem",
  "canal",
  "tipo",
  "prof",
  "resultado",
  "fluxo",
  "categoria",
  "evento",
  "plataforma",
  "campanha",
  "mes",
  "semana",
  "dia",
] as const;
export type Dimensao = (typeof DIMENSOES)[number];

export interface DefinicaoDaFonte {
  medidas: readonly Medida[];
  dims: readonly Dimensao[];
  filtros: readonly string[];
  /** "Este mês" inclui os dias que ainda vêm (data marcada). */
  futuro: boolean;
}

/**
 * O espelho de `fn_mia_relatorio_catalogo()`. Mude os dois juntos. A 9041 (o
 * montador, item 9) acrescentou o produto nos negócios e o responsável no
 * follow-up.
 */
export const CATALOGO_DO_MOTOR: Record<Fonte, DefinicaoDaFonte> = {
  negocios: {
    medidas: ["qtd", "soma", "media", "conv", "tetapa", "tfechar", "prev", "sem_prob", "chegaram"],
    dims: ["etapa", "situacao", "resp", "origem", "etiqueta", "produto", "motivo", "previsto", "funil", "mes", "semana", "dia"],
    filtros: ["funil", "resp", "etiqueta", "situacao", "origem", "produto", "motivo", "so_receita"],
    futuro: false,
  },
  conversas: {
    medidas: ["qtd", "tresp", "tresp90", "resolv"],
    dims: ["quem", "canal", "resp", "etiqueta", "mes", "semana", "dia"],
    filtros: ["resp", "etiqueta", "canal", "quem"],
    futuro: false,
  },
  contatos: {
    medidas: ["qtd"],
    dims: ["origem", "canal", "etiqueta", "resp", "mes", "semana", "dia"],
    filtros: ["resp", "etiqueta", "origem", "canal"],
    futuro: false,
  },
  agenda: {
    medidas: ["qtd", "comp"],
    dims: ["situacao", "tipo", "prof", "resp", "mes", "semana", "dia"],
    filtros: ["resp", "situacao", "prof", "tipo"],
    futuro: true,
  },
  followup: {
    medidas: ["qtd", "taxa"],
    dims: ["resultado", "fluxo", "resp", "mes", "semana", "dia"],
    filtros: ["fluxo", "resultado", "resp"],
    futuro: false,
  },
  obrigacoes: {
    medidas: ["qtd", "emdia"],
    dims: ["situacao", "tipo", "resp", "categoria", "mes", "semana"],
    filtros: ["resp", "situacao", "tipo", "categoria"],
    futuro: true,
  },
  anuncios: {
    medidas: ["qtd", "aceito"],
    dims: ["evento", "plataforma", "campanha", "mes", "semana", "dia"],
    filtros: ["plataforma", "evento"],
    futuro: false,
  },
};

/** As medidas de dinheiro: nulas quando a pessoa (ou o link) não vê valor. */
export const MEDIDAS_DE_VALOR: readonly Medida[] = ["soma", "media", "prev"];

/** Os agrupamentos de tempo (o banco preenche os períodos vazios com zero). */
export const DIMENSOES_DE_TEMPO: readonly Dimensao[] = ["mes", "semana", "dia"];

/** Chaves especiais que o banco devolve no lugar de um valor. */
export const CHAVE_SEM = "__sem";
export const CHAVE_OUTROS = "__outros";
export const CHAVE_TUDO = "__tudo";

// ─── Os períodos ────────────────────────────────────────────────────────────

/** Todos os que o motor entende (`fn_mia_relatorio_janela`). */
export const PERIODOS_DO_MOTOR = ["hoje", "7", "30", "90", "mes", "mesp", "pers", "tudo"] as const;
export type PeriodoDoMotor = (typeof PERIODOS_DO_MOTOR)[number];

/** Os que a tela dos painéis e o link do dono oferecem (protótipo, tela 6). */
export const PERIODOS_DOS_PAINEIS = ["7", "30", "mes", "90"] as const;
export type PeriodoDosPaineis = (typeof PERIODOS_DOS_PAINEIS)[number];
export const PERIODO_PADRAO: PeriodoDosPaineis = "30";

export const ROTULO_DO_PERIODO: Record<PeriodoDosPaineis, string> = {
  "7": "7 dias",
  "30": "30 dias",
  mes: "Este mês",
  "90": "90 dias",
};

/** A frase do período, como a página pública a escreve no topo. */
export const FRASE_DO_PERIODO: Record<PeriodoDosPaineis, string> = {
  "7": "últimos 7 dias",
  "30": "últimos 30 dias",
  mes: "este mês, até hoje",
  "90": "últimos 90 dias",
};

export function ehPeriodoDosPaineis(valor: unknown): valor is PeriodoDosPaineis {
  return typeof valor === "string" && (PERIODOS_DOS_PAINEIS as readonly string[]).includes(valor);
}

// ─── O link para o dono ─────────────────────────────────────────────────────

/** O período do link: a pessoa escolhe, ou um dos quatro fixo. */
export type PeriodoDoLink = "escolhe" | PeriodoDosPaineis;

export function ehPeriodoDoLink(valor: unknown): valor is PeriodoDoLink {
  return valor === "escolhe" || ehPeriodoDosPaineis(valor);
}

/** As validades que a tela oferece; 90 dias é o padrão do protótipo. */
export const VALIDADES_EM_DIAS = [30, 90, 365] as const;
export type ValidadeEmDias = (typeof VALIDADES_EM_DIAS)[number];
export const VALIDADE_PADRAO: ValidadeEmDias = 90;

// ─── Os doze painéis prontos ────────────────────────────────────────────────

export const PAINEIS_PRONTOS = [
  "resultado",
  "meta",
  "funil",
  "origem",
  "perdas",
  "atendimento",
  "resposta",
  "agenda",
  "followup",
  "anuncios",
  "previsao",
  "assuntos",
] as const;
export type ChaveDoPainel = (typeof PAINEIS_PRONTOS)[number];

export function ehChaveDoPainel(valor: unknown): valor is ChaveDoPainel {
  return typeof valor === "string" && (PAINEIS_PRONTOS as readonly string[]).includes(valor);
}

export const TITULO_DO_PAINEL: Record<ChaveDoPainel, string> = {
  resultado: "Resultado do mês",
  meta: "Meta do mês",
  funil: "Funil",
  origem: "De onde vêm",
  perdas: "Por que perdemos",
  atendimento: "Atendimento: agente e equipe",
  resposta: "Tempo de resposta",
  agenda: "Agenda",
  followup: "Follow-up",
  anuncios: "Anúncios",
  previsao: "Previsão",
  assuntos: "Assuntos",
};

export const PERGUNTA_DO_PAINEL: Record<ChaveDoPainel, string> = {
  resultado: "Quanto ganhei, quanto perdi e em quanto tempo fecho?",
  meta: "Vou bater a meta?",
  funil: "Onde os negócios param?",
  origem: "Qual canal traz quem fecha?",
  perdas: "Qual o motivo das perdas?",
  atendimento: "Quanto o agente resolveu sozinho?",
  resposta: "Quanto o cliente espera?",
  agenda: "Marcou, confirmou, veio ou faltou?",
  followup: "Quantos voltaram a responder?",
  anuncios: "O que foi informado à Meta e ao Google?",
  previsao: "Quanto deve entrar e quando?",
  assuntos: "O que mais ocupa o atendimento?",
};

// ─── Os rótulos das chaves codificadas ──────────────────────────────────────

export const ROTULO_DA_SITUACAO_DO_NEGOCIO: Record<string, string> = {
  aberto: "Abertos",
  ganho: "Ganhos",
  perdido: "Perdidos",
};

export const ROTULO_DE_QUEM_ATENDEU: Record<string, string> = {
  agente: "Agente resolveu",
  equipe: "Passou para a equipe",
  sem_resposta: "Sem resposta",
};

export const ROTULO_DA_SITUACAO_DA_AGENDA: Record<string, string> = {
  marcado: "Marcados",
  confirmado: "Confirmados",
  compareceu: "Compareceram",
  faltou: "Faltaram",
  desmarcou: "Desmarcados",
};

export const ROTULO_DO_RESULTADO_DO_FOLLOWUP: Record<string, string> = {
  respondeu: "Respondeu",
  fechou: "Respondeu e fechou",
  equipe: "Passou para a equipe",
  parou: "Pediu para parar",
  sem_resposta: "Sem resposta",
  andamento: "Em andamento",
  encerrado: "Encerrado",
};

export const ROTULO_DA_PLATAFORMA: Record<string, string> = {
  meta_ads: "Meta",
  google_ads: "Google Ads",
};

export const ROTULO_DO_EVENTO: Record<string, string> = {
  compra: "Venda",
  qualificado: "Lead qualificado",
};

export const ROTULO_DO_CANAL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
};

/**
 * As origens que o produto grava em `crm_leads.source` e `contacts.source`. O
 * que não está aqui sai como foi gravado: é texto livre, vindo de integração.
 */
export const ROTULO_DA_ORIGEM: Record<string, string> = {
  meta_ads: "Anúncio da Meta",
  google_ads: "Google Ads",
  site: "Site",
  indicacao: "Indicação",
  manual: "Cadastro manual",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  ig: "Instagram",
  webhook: "Formulário",
  import: "Importação",
  importacao: "Importação",
  api: "Integração",
  mcp: "Agente de IA",
  ai: "Agente de IA",
  prospecting: "Prospecção",
  prospeccao: "Prospecção",
  campaign: "Campanha",
  sem_funil: "Sem funil",
};

/** O texto de cada grupo "Sem …", por agrupamento. */
export const ROTULO_DO_SEM: Record<string, string> = {
  resp: "Sem responsável",
  prof: "Sem profissional",
  origem: "Sem origem",
  etiqueta: "Sem etiqueta",
  produto: "Sem produto",
  motivo: "Sem motivo",
  previsto: "Sem data prevista",
  tipo: "Sem tipo",
  campanha: "Sem campanha",
  canal: "Sem canal",
  mes: "Sem data",
  semana: "Sem data",
  dia: "Sem data",
};

export const ROTULO_DE_OUTROS = "Outros";
