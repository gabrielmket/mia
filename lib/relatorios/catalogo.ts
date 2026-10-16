/**
 * FORK MIA (item 9) — O CATÁLOGO DO MONTADOR DE RELATÓRIOS.
 *
 * O que cada fonte mede, agrupa e filtra JÁ está em `lib/paineis/catalogo.ts`
 * (`CATALOGO_DO_MOTOR`, o espelho de `fn_mia_relatorio_catalogo()`, conferido
 * pelo invariante). Aqui mora o que a TELA precisa a mais para falar com quem
 * monta o relatório: o nome de cada fonte, a frase do que ela mede, a regra de
 * data escrita, o rótulo e o formato de cada medida e de cada agrupamento, e as
 * seis visualizações.
 *
 * Nada aqui decide número: a conta é do banco. As listas de medidas e de
 * agrupamentos de cada fonte são DERIVADAS do catálogo do motor, para nunca
 * oferecer o que o banco recusaria.
 *
 * ⚠️ Módulo PURO: nada de cliente de banco, sessão ou `next/*`. O editor do
 * navegador, as rotas, o MCP e as cercas importam daqui. Todo texto daqui
 * passa por `t()` na tela (o espanhol está em `lib/i18n/dicionario-mia-relatorios.ts`).
 */
import { CATALOGO_DO_MOTOR, DIMENSOES_DE_TEMPO, FONTES, type Dimensao, type Fonte, type Medida } from "@/lib/paineis/catalogo";

export { FONTES };
export type { Dimensao, Fonte, Medida };

// ─── As fontes ──────────────────────────────────────────────────────────────

export interface FonteDoMontador {
  nome: string;
  /** O que aparece entre parênteses no cartão ("conversas"). */
  sub: string | null;
  um: string;
  varios: string;
  /** A frase do cartão de "Novo relatório". */
  frase: string;
  /** A regra de data, escrita embaixo do período no editor. */
  regraDeData: string;
  padrao: { medida: MedidaDoMontador; dim1: Dimensao };
  /** O que "Abrir no CRM" abre. */
  abrir: string;
  /** Só gestor e administrador veem esta fonte (o piso da tela de Conversões). */
  soGestor: boolean;
}

export const FONTES_DO_MONTADOR: Record<Fonte, FonteDoMontador> = {
  negocios: {
    nome: "Negócios",
    sub: null,
    um: "negócio",
    varios: "negócios",
    frase: "O funil: quanto entrou, quanto fechou, por quê e em quanto tempo.",
    regraDeData: "Ganhos e perdidos contam pela data em que fecharam; abertos, pela data em que entraram.",
    padrao: { medida: "qtd", dim1: "etapa" },
    abrir: "o cartão do negócio",
    soGestor: false,
  },
  conversas: {
    nome: "Atendimento",
    sub: "conversas",
    um: "conversa",
    varios: "conversas",
    frase: "As conversas do WhatsApp, do Instagram e do Facebook: quantas, quem atendeu e quanto o cliente esperou.",
    regraDeData: "Cada conversa conta pelo dia em que o cliente escreveu no período.",
    padrao: { medida: "qtd", dim1: "quem" },
    abrir: "a conversa",
    soGestor: false,
  },
  contatos: {
    nome: "Contatos",
    sub: null,
    um: "contato",
    varios: "contatos",
    frase: "Quem entrou na base: de onde veio, por qual canal e com quais etiquetas.",
    regraDeData: "Cada contato conta pelo dia em que entrou.",
    padrao: { medida: "qtd", dim1: "origem" },
    abrir: "a ficha do contato",
    soGestor: false,
  },
  agenda: {
    nome: "Agenda",
    sub: "compromissos",
    um: "compromisso",
    varios: "compromissos",
    frase: "Os compromissos marcados: marcou, confirmou, veio ou faltou.",
    regraDeData: 'Cada compromisso conta pelo dia marcado. "Este mês" inclui os dias que ainda vêm.',
    padrao: { medida: "qtd", dim1: "situacao" },
    abrir: "o contato do compromisso",
    soGestor: false,
  },
  followup: {
    nome: "Follow-up",
    sub: "mensagens da régua",
    um: "pessoa na régua",
    varios: "pessoas na régua",
    frase: "As mensagens automáticas para quem parou de responder: quantas pessoas receberam e quantas voltaram.",
    regraDeData: "Cada pessoa conta pelo dia em que entrou na régua.",
    padrao: { medida: "qtd", dim1: "resultado" },
    abrir: "a conversa",
    soGestor: false,
  },
  obrigacoes: {
    nome: "Obrigações",
    sub: "documentos e prazos",
    um: "obrigação",
    varios: "obrigações",
    frase: "Documentos e prazos de cada cliente: o que chegou, o que vence e o que atrasou.",
    regraDeData: 'Cada obrigação conta pela data de vencimento. "Este mês" inclui os dias que ainda vêm.',
    padrao: { medida: "qtd", dim1: "situacao" },
    abrir: "o negócio da obrigação",
    soGestor: false,
  },
  anuncios: {
    nome: "Anúncios",
    sub: "o que foi informado",
    um: "evento",
    varios: "eventos",
    frase: "O que o sistema informou à Meta e ao Google (lead qualificado, etapas e venda) e quanto foi aceito.",
    regraDeData: "Cada evento conta pelo dia em que foi informado.",
    padrao: { medida: "qtd", dim1: "evento" },
    abrir: "o negócio de origem",
    soGestor: true,
  },
};

// ─── As medidas ─────────────────────────────────────────────────────────────

/** As medidas de relatório: `chegaram` (o funil pede sozinho) e `sem_prob` (conta auxiliar) ficam de fora. */
export type MedidaDoMontador = Exclude<Medida, "chegaram" | "sem_prob">;

/**
 * O formato do número que o banco devolve: `n` inteiro, `r` dinheiro em
 * CENTAVOS, `%` pontos percentuais (0 a 100), `d` dias com uma casa, `t`
 * SEGUNDOS de espera.
 */
export type FormatoDaMedida = "n" | "r" | "%" | "d" | "t";

export interface DefinicaoDaMedida {
  /** O rótulo. `{varios}` vira o plural da fonte ("Quantidade de negócios"). */
  rotulo: string;
  formato: FormatoDaMedida;
  /** Soma entre grupos (rosca e barra empilhada fazem sentido). */
  aditiva: boolean;
  /** É dinheiro: some para quem não vê valor. */
  valor: boolean;
  /** Menor é melhor (tempo): a comparação pinta a queda de verde. */
  menor: boolean;
  /** A medida já escolhe a situação sozinha: o filtro de situação não vale para ela. */
  ignoraSituacao: boolean;
}

export const MEDIDAS_DO_MONTADOR: Record<MedidaDoMontador, DefinicaoDaMedida> = {
  qtd: { rotulo: "Quantidade de {varios}", formato: "n", aditiva: true, valor: false, menor: false, ignoraSituacao: false },
  soma: { rotulo: "Soma do valor", formato: "r", aditiva: true, valor: true, menor: false, ignoraSituacao: false },
  media: { rotulo: "Média do valor", formato: "r", aditiva: false, valor: true, menor: false, ignoraSituacao: false },
  conv: { rotulo: "Taxa de conversão (ganhos ÷ fechados)", formato: "%", aditiva: false, valor: false, menor: false, ignoraSituacao: true },
  tetapa: { rotulo: "Tempo médio na etapa", formato: "d", aditiva: false, valor: false, menor: true, ignoraSituacao: false },
  tfechar: { rotulo: "Tempo até fechar (ganhos)", formato: "d", aditiva: false, valor: false, menor: true, ignoraSituacao: true },
  prev: { rotulo: "Valor previsto (pela chance da etapa)", formato: "r", aditiva: true, valor: true, menor: false, ignoraSituacao: true },
  tresp: { rotulo: "Tempo até a primeira resposta (metade esperou até)", formato: "t", aditiva: false, valor: false, menor: true, ignoraSituacao: false },
  tresp90: { rotulo: "Tempo até a primeira resposta (9 em cada 10 esperaram até)", formato: "t", aditiva: false, valor: false, menor: true, ignoraSituacao: false },
  resolv: { rotulo: "Resolvidas pelo agente (%)", formato: "%", aditiva: false, valor: false, menor: false, ignoraSituacao: false },
  comp: { rotulo: "Taxa de comparecimento", formato: "%", aditiva: false, valor: false, menor: false, ignoraSituacao: true },
  taxa: { rotulo: "Taxa de resposta", formato: "%", aditiva: false, valor: false, menor: false, ignoraSituacao: false },
  emdia: { rotulo: "Em dia ou recebidas (%)", formato: "%", aditiva: false, valor: false, menor: false, ignoraSituacao: true },
  aceito: { rotulo: "Aceitos pela plataforma (%)", formato: "%", aditiva: false, valor: false, menor: false, ignoraSituacao: false },
};

const FORA_DO_MONTADOR: ReadonlySet<string> = new Set(["chegaram", "sem_prob"]);

/** As medidas que o montador oferece para a fonte: as do motor, menos as auxiliares. */
export function medidasDaFonte(fonte: Fonte): MedidaDoMontador[] {
  return CATALOGO_DO_MOTOR[fonte].medidas.filter((m): m is MedidaDoMontador => !FORA_DO_MONTADOR.has(m));
}

export function ehMedidaDoMontador(valor: unknown): valor is MedidaDoMontador {
  return typeof valor === "string" && valor in MEDIDAS_DO_MONTADOR;
}

// ─── Os agrupamentos ────────────────────────────────────────────────────────

export interface DefinicaoDaDimensao {
  rotulo: string;
  /** Agrupa por tempo: linha faz sentido, "Outros" não existe, o gráfico rola de lado. */
  tempo: boolean;
  /** Um registro pode cair em mais de um grupo (etiquetas, produtos): a rosca não serve. */
  multi: boolean;
  /** O grupo é uma pessoa da equipe: fica fora do link para o dono. */
  pessoa: boolean;
}

export const DIMENSOES_DO_MONTADOR: Record<Dimensao, DefinicaoDaDimensao> = {
  etapa: { rotulo: "Etapa", tempo: false, multi: false, pessoa: false },
  situacao: { rotulo: "Situação", tempo: false, multi: false, pessoa: false },
  resp: { rotulo: "Responsável", tempo: false, multi: false, pessoa: true },
  origem: { rotulo: "Origem", tempo: false, multi: false, pessoa: false },
  etiqueta: { rotulo: "Etiqueta", tempo: false, multi: true, pessoa: false },
  produto: { rotulo: "Produto", tempo: false, multi: true, pessoa: false },
  motivo: { rotulo: "Motivo de perda", tempo: false, multi: false, pessoa: false },
  previsto: { rotulo: "Mês previsto para fechar", tempo: false, multi: false, pessoa: false },
  funil: { rotulo: "Funil", tempo: false, multi: false, pessoa: false },
  quem: { rotulo: "Agente ou equipe", tempo: false, multi: false, pessoa: false },
  canal: { rotulo: "Canal", tempo: false, multi: false, pessoa: false },
  tipo: { rotulo: "Tipo", tempo: false, multi: false, pessoa: false },
  prof: { rotulo: "Profissional", tempo: false, multi: false, pessoa: true },
  resultado: { rotulo: "Resultado", tempo: false, multi: false, pessoa: false },
  fluxo: { rotulo: "Régua", tempo: false, multi: false, pessoa: false },
  categoria: { rotulo: "Categoria", tempo: false, multi: false, pessoa: false },
  evento: { rotulo: "Evento", tempo: false, multi: false, pessoa: false },
  plataforma: { rotulo: "Plataforma", tempo: false, multi: false, pessoa: false },
  campanha: { rotulo: "Campanha", tempo: false, multi: false, pessoa: false },
  mes: { rotulo: "Mês", tempo: true, multi: false, pessoa: false },
  semana: { rotulo: "Semana", tempo: true, multi: false, pessoa: false },
  dia: { rotulo: "Dia", tempo: true, multi: false, pessoa: false },
};

/** O rótulo que muda de fonte para fonte (o "responsável" da conversa é quem atendeu). */
const ROTULO_NA_FONTE: Partial<Record<Fonte, Partial<Record<Dimensao, string>>>> = {
  conversas: { resp: "Quem atendeu (nome)", etiqueta: "Assunto (etiqueta)" },
  contatos: { resp: "Dono do contato" },
  agenda: { resp: "Quem marcou", tipo: "Tipo de compromisso" },
  followup: { resp: "Dono do contato" },
  obrigacoes: { tipo: "Documento ou atividade" },
};

export function rotuloDaDimensao(fonte: Fonte, dim: Dimensao): string {
  return ROTULO_NA_FONTE[fonte]?.[dim] ?? DIMENSOES_DO_MONTADOR[dim].rotulo;
}

export function dimensoesDaFonte(fonte: Fonte): Dimensao[] {
  return [...CATALOGO_DO_MOTOR[fonte].dims];
}

export function ehDimensaoDeTempo(dim: Dimensao | null | undefined): boolean {
  return Boolean(dim && (DIMENSOES_DE_TEMPO as readonly string[]).includes(dim));
}

// ─── Os filtros ─────────────────────────────────────────────────────────────

/** Os filtros internos: o pronto da meta usa, a tela não oferece. */
export const FILTROS_INTERNOS: ReadonlySet<string> = new Set(["so_receita"]);

/** Os filtros que a tela oferece, na ordem do catálogo. */
export function filtrosDaFonte(fonte: Fonte): Dimensao[] {
  return CATALOGO_DO_MOTOR[fonte].filtros.filter((f): f is Dimensao => !FILTROS_INTERNOS.has(f) && f in DIMENSOES_DO_MONTADOR);
}

/** Filtro de um valor só: o funil (a etapa depende dele). */
export const FILTROS_DE_UM_VALOR: ReadonlySet<string> = new Set(["funil", "so_receita"]);

// ─── Os períodos ────────────────────────────────────────────────────────────

export const PERIODOS_DO_MONTADOR = ["hoje", "7", "30", "90", "mes", "mesp", "pers"] as const;
export type PeriodoDoMontador = (typeof PERIODOS_DO_MONTADOR)[number];

export const ROTULO_DO_PERIODO_DO_MONTADOR: Record<PeriodoDoMontador, string> = {
  hoje: "Hoje",
  "7": "7 dias",
  "30": "30 dias",
  "90": "90 dias",
  mes: "Este mês",
  mesp: "Mês passado",
  pers: "Personalizado",
};

/** Decisão do protótipo: o período padrão é de 30 dias. */
export const PERIODO_PADRAO_DO_MONTADOR: PeriodoDoMontador = "30";

export function ehPeriodoDoMontador(valor: unknown): valor is PeriodoDoMontador {
  return typeof valor === "string" && (PERIODOS_DO_MONTADOR as readonly string[]).includes(valor);
}

/** Os períodos do painel (tela 5 do protótipo). */
export const PERIODOS_DO_PAINEL = ["7", "30", "90", "mes", "mesp"] as const;
export type PeriodoDoPainel = (typeof PERIODOS_DO_PAINEL)[number];

export function ehPeriodoDoPainel(valor: unknown): valor is PeriodoDoPainel {
  return typeof valor === "string" && (PERIODOS_DO_PAINEL as readonly string[]).includes(valor);
}

// ─── As visualizações ───────────────────────────────────────────────────────

export const VISUALIZACOES = ["barras", "linha", "rosca", "numero", "funil", "tabela"] as const;
export type Visualizacao = (typeof VISUALIZACOES)[number];

export const ROTULO_DA_VISUALIZACAO: Record<Visualizacao, string> = {
  barras: "Barras",
  linha: "Linha",
  rosca: "Rosca",
  numero: "Número grande",
  funil: "Funil",
  tabela: "Tabela",
};

export function ehVisualizacao(valor: unknown): valor is Visualizacao {
  return typeof valor === "string" && (VISUALIZACOES as readonly string[]).includes(valor);
}

// ─── O painel ───────────────────────────────────────────────────────────────

export const TAMANHOS = ["P", "M", "G"] as const;
export type Tamanho = (typeof TAMANHOS)[number];

export const ROTULO_DO_TAMANHO: Record<Tamanho, string> = { P: "Pequeno", M: "Médio", G: "Grande" };

// ─── Os limites ─────────────────────────────────────────────────────────────

/** Decisão do protótipo: mais de 12 grupos dobram em "Outros" (o banco faz). */
export const GRUPOS_ANTES_DE_OUTROS = 12;
/** A rosca não passa de 8 fatias com valor. */
export const FATIAS_DA_ROSCA = 8;
/** A atualização: ao abrir e a cada 5 minutos (decisão do protótipo). */
export const ATUALIZAR_A_CADA_MS = 5 * 60 * 1000;
/** A lista por trás do número, na tela: página de 50. */
export const PAGINA_DA_LISTA = 50;
/** A planilha da lista: até 20.000 linhas (o teto do banco por chamada). */
export const TETO_DA_PLANILHA = 20_000;
