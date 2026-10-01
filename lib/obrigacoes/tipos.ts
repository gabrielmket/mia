/**
 * FORK MIA — OBRIGAÇÕES · o vocabulário e as formas.
 *
 * "Obrigação" é um item só, com dois tipos: DOCUMENTO (algo que o cliente
 * entrega, ou que tem validade: alvará, AVCB, CNH, contrato assinado) e
 * ATIVIDADE RECORRENTE (algo que se repete e precisa ser lembrado: relatório
 * mensal, renovação anual, revisão semestral). A regra está em
 * docs/fork/obrigacoes.md.
 *
 * ⚠️ Módulo PURO: só `import type`. Os vocabulários daqui são os dos CHECKs da
 * migration 9018; mudar um lado pede mudar o outro.
 */
import type { Dia } from "./datas";

export const CATEGORIAS = ["documento", "atividade"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const QUEM_ENTREGA = ["cliente", "nos"] as const;
export type QuemEntrega = (typeof QUEM_ENTREGA)[number];

export const RECORRENCIAS = ["unica", "mensal", "anual", "n_meses"] as const;
export type Recorrencia = (typeof RECORRENCIAS)[number];

/** A quem um TIPO costuma se ligar. No item, o vínculo é escolhido um a um. */
export const LIGA_A = ["negocio", "empresa", "contato"] as const;
export type LigaA = (typeof LIGA_A)[number];

/** Até três antecedências de aviso por item, em dias. */
export const TETO_DE_AVISOS = 3;
export const AVISOS_PADRAO: readonly number[] = [30, 15, 7];
export const DIAS_SEM_RESPOSTA_PADRAO = 5;
/** "Marcar pedido" põe prazo de 7 dias para o cliente entregar. */
export const PRAZO_DO_PEDIDO_EM_DIAS = 7;

export const ROTULO_DA_CATEGORIA = {
  documento: "Documento",
  atividade: "Atividade recorrente",
} as const satisfies Record<Categoria, string>;

export const ROTULO_DE_QUEM_ENTREGA = {
  cliente: "O cliente (nós pedimos)",
  nos: "Nós (entregamos ao cliente)",
} as const satisfies Record<QuemEntrega, string>;

export const ROTULO_CURTO_DE_QUEM_ENTREGA = {
  cliente: "Cliente",
  nos: "Nós",
} as const satisfies Record<QuemEntrega, string>;

export const ROTULO_DA_RECORRENCIA = {
  unica: "Única",
  mensal: "Mensal",
  anual: "Anual",
  n_meses: "A cada N meses",
} as const satisfies Record<Recorrencia, string>;

export const ROTULO_DE_LIGA_A = {
  negocio: "Negócio",
  empresa: "Empresa",
  contato: "Contato",
} as const satisfies Record<LigaA, string>;

/** O que a função da situação precisa de um item: as datas e as regras dele. */
export interface ItemParaSituacao {
  categoria: Categoria;
  recorrencia: Recorrencia;
  recorrencia_meses: number | null;
  validade_meses: number;
  avisos_dias: readonly number[];
  dias_sem_resposta: number;
  pedido_em: Dia | null;
  prazo_em: Dia | null;
  cobrado_em: Dia | null;
  recebido_em: Dia | null;
  valido_ate: Dia | null;
  renovado_em: Dia | null;
  proxima_em: Dia | null;
  feita_em: Dia | null;
}

/** A linha de `mia_obrigacoes`, como o banco a devolve. */
export interface Obrigacao extends ItemParaSituacao {
  id: string;
  organization_id: string;
  tipo_id: string | null;
  nome: string;
  nome_curto: string | null;
  lead_id: string | null;
  empresa_id: string | null;
  contact_id: string | null;
  quem_entrega: QuemEntrega;
  ciclo: number;
  arquivo_path: string | null;
  arquivo_nome: string | null;
  arquivo_mime: string | null;
  arquivo_bytes: number | null;
  responsavel_user_id: string | null;
  observacao: string | null;
  origem: string;
  chave_natural: string | null;
  sem_aviso_antes_de: Dia;
  arquivado_em: string | null;
  created_at: string;
  updated_at: string;
}

/** As colunas lidas de `mia_obrigacoes`, num lugar só. */
export const COLUNAS_DA_OBRIGACAO =
  "id, organization_id, tipo_id, nome, nome_curto, categoria, lead_id, empresa_id, contact_id, quem_entrega, " +
  "recorrencia, recorrencia_meses, validade_meses, avisos_dias, dias_sem_resposta, pedido_em, prazo_em, cobrado_em, " +
  "recebido_em, valido_ate, renovado_em, proxima_em, feita_em, ciclo, arquivo_path, arquivo_nome, arquivo_mime, " +
  "arquivo_bytes, responsavel_user_id, observacao, origem, chave_natural, sem_aviso_antes_de, arquivado_em, created_at, updated_at";

/** A proposta do agente que espera a decisão de uma pessoa. */
export interface PropostaPendente {
  id: string;
  obrigacao_id: string;
  arquivo_nome: string | null;
  conversation_id: string | null;
  /** Quem mandou o arquivo, pelo nome que a tela mostra. */
  de: string | null;
  criada_em: string;
}

/** A quem o item está ligado, com o nome para a tela. */
export interface VinculosDaObrigacao {
  negocio: { id: string; titulo: string } | null;
  empresa: { id: string; nome: string } | null;
  contato: { id: string; nome: string } | null;
}

/**
 * O item como a TELA o recebe: sem o caminho do arquivo (a tela pede o link
 * assinado pela rota), com os nomes de quem ele é e a proposta pendente.
 */
export interface ObrigacaoNaTela extends Omit<Obrigacao, "arquivo_path" | "chave_natural"> {
  tem_arquivo: boolean;
  vinculos: VinculosDaObrigacao;
  proposta: PropostaPendente | null;
}

/** Um ciclo que terminou, para o histórico do item. */
export interface CicloEncerrado {
  id: string;
  ciclo: number;
  como: "recebido" | "feita";
  pedido_em: Dia | null;
  recebido_em: Dia | null;
  valido_ate: Dia | null;
  proxima_em: Dia | null;
  feita_em: Dia | null;
  arquivo_nome: string | null;
  tem_arquivo: boolean;
  encerrado_em: string;
}

/** Um aviso que uma regra de automação disparou (ou segurou) para o item. */
export interface AvisoDisparado {
  id: string;
  gatilho: string;
  regra: string | null;
  ciclo: number;
  ancora: Dia;
  segurado: boolean;
  disparado_em: string | null;
}

/** Uma proposta do agente já decidida, para o histórico. */
export interface PropostaDecidida {
  id: string;
  arquivo_nome: string | null;
  situacao: "confirmada" | "recusada" | "superada";
  decidida_em: string | null;
  criada_em: string;
}

/** O detalhe de um item: ele, o histórico e os avisos. */
export interface DetalheDaObrigacao {
  item: ObrigacaoNaTela;
  ciclos: CicloEncerrado[];
  avisos: AvisoDisparado[];
  propostas: PropostaDecidida[];
}

/** O tipo do catálogo (linha de `mia_obrigacoes_tipos`). */
export interface TipoDeObrigacao {
  id: string;
  pipeline_id: string | null;
  nome: string;
  nome_curto: string | null;
  categoria: Categoria;
  quem_entrega: QuemEntrega;
  recorrencia: Recorrencia;
  recorrencia_meses: number | null;
  validade_meses: number;
  avisos_dias: number[];
  dias_sem_resposta: number;
  liga_a: LigaA;
  pede_arquivo: boolean;
  segmento: string | null;
  posicao: number;
}

export const COLUNAS_DO_TIPO =
  "id, pipeline_id, nome, nome_curto, categoria, quem_entrega, recorrencia, recorrencia_meses, validade_meses, " +
  "avisos_dias, dias_sem_resposta, liga_a, pede_arquivo, segmento, posicao";

/** O escopo de uma leitura: de onde a tela está olhando. */
export type EscopoDaLeitura =
  | { tipo: "negocio"; id: string }
  | { tipo: "empresa"; id: string }
  | { tipo: "contato"; id: string }
  | { tipo: "lista" };

/** Minúsculas, sem acento e sem espaço sobrando: "o mesmo nome" para uma pessoa. */
export function chaveDoNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** As antecedências como o item as guarda: positivas, sem repetir, da maior para a menor, até três. */
export function normalizarAvisos(bruto: readonly unknown[] | null | undefined): number[] {
  const numeros = (bruto ?? [])
    .map((n) => (typeof n === "number" ? n : Number(n)))
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 3650);
  return [...new Set(numeros)].sort((a, b) => b - a).slice(0, TETO_DE_AVISOS);
}
