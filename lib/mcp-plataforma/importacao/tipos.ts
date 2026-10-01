/**
 * Os tipos das ferramentas de IMPORTAÇÃO do MCP de plataforma.
 *
 * `ContextoDaFerramenta` e `FerramentaDePlataforma` são os do catálogo. Entram
 * por aqui, e só por aqui, para o resto da pasta não depender de onde eles
 * moram: se o catálogo mudar de arquivo, muda esta linha.
 */
import type { ContextoDaFerramenta, FerramentaDePlataforma } from "../tipos";

export type { ContextoDaFerramenta, FerramentaDePlataforma };

/** O que aconteceu com UM item de um lote. */
export type Desfecho = "criou" | "atualizou" | "ja_estava" | "recusou";

/**
 * O que fazer quando o item JÁ existe na base.
 *
 * `completar` (o padrão) só preenche o que está vazio e soma etiquetas: nunca
 * troca um valor que já estava lá. `atualizar` deixa o que veio preenchido na
 * importação substituir o que havia. Nos dois modos, campo que não veio fica
 * como está: importar nunca apaga.
 */
export type QuandoJaExiste = "completar" | "atualizar";

export interface ItemDoResultado {
  /** A posição do item na lista enviada, começando em 1. */
  posicao: number;
  desfecho: Desfecho;
  /** O id do registro na plataforma, quando ele existe. */
  id?: string;
  /** Só na recusa: o campo, o que era esperado e um exemplo que passa. */
  motivo?: string;
  /** O item entrou, e algo dele ficou de fora ou merece conferência. */
  avisos?: string[];
}

export interface ResultadoDoLote {
  organizacao: { id: string; nome: string; demonstracao: boolean };
  total: number;
  criou: number;
  atualizou: number;
  ja_estava: number;
  recusou: number;
  itens: ItemDoResultado[];
  /** O que a importação NÃO fez, dito a cada resposta. */
  nada_foi_enviado: string;
}

/**
 * A ferramenta do catálogo, com uma chamada VÁLIDA de exemplo, em dados
 * fictícios. É o que um agente copia quando a primeira tentativa não passa, e é
 * conferida em `tests/unit/mcp-de-migracao-base.test.ts`: exemplo que deixa de
 * valer reprova o teste em vez de ensinar errado.
 */
export interface FerramentaComExemplo extends FerramentaDePlataforma {
  exemplo: Record<string, unknown>;
}

/**
 * Uma ferramenta de importação: a do catálogo, mais a redação dos argumentos
 * para a auditoria.
 *
 * A redação é OBRIGATÓRIA aqui, e não opcional como no MCP por empresa: os
 * argumentos destas ferramentas são a lista de pessoas de um cliente. Sem ela,
 * a linha `plataforma.mcp_executado` guardaria nome, telefone e e-mail de cada
 * contato importado.
 */
export interface FerramentaDeImportacao extends FerramentaComExemplo {
  redigirParaAuditoria: (args: Record<string, unknown>) => Record<string, unknown>;
}

/** A situação de UMA área da importação, para o checklist da implantação. */
export interface SituacaoDaArea {
  chave: string;
  rotulo: string;
  /** O que já está feito, em frases. */
  pronto: string[];
  /** O que falta, com a ferramenta que resolve. */
  falta: string[];
  /** O que nenhuma ferramenta faz: é de uma pessoa, na tela. */
  so_pela_tela: string[];
  /** Os números por trás das frases. */
  numeros: Record<string, unknown>;
}

export interface AreaDeImportacao {
  chave: string;
  rotulo: string;
  situacao: (ctx: ContextoDaFerramenta, organizationId: string) => Promise<SituacaoDaArea>;
}
