/**
 * Tipos de `scripts/assinaturas-do-upstream.mjs`, para o teste em TypeScript
 * importar o script (o `tsconfig` tem `allowJs: false`). FORK: só do fork.
 */
import type * as TS from "typescript";

export interface Parametro {
  nome: string;
  tipo: string;
  opcional: boolean;
  resto: boolean;
  membros: Record<string, { opcional: boolean; texto: string }> | null;
}

export type Assinatura =
  | {
      tipo: "funcao";
      assinaturas: Array<{ genericos: string; parametros: Parametro[]; retorno: string | null; declarado?: string | null }>;
      linha: number;
    }
  | {
      tipo: "tipo";
      texto: string;
      membros: Record<string, { opcional: boolean; texto: string }> | null;
      linha: number;
    };

export interface Mudanca {
  nome: string;
  tipo: "funcao" | "tipo";
  motivos: string[];
  antes: string;
  depois: string;
  renomeadaPara?: string;
}

export interface MudancaMedida extends Mudanca {
  arquivo: string;
  arquivoAntes?: string;
  provavelQuebra: boolean;
  chamadores: string[];
}

export interface Divergencia {
  arquivo: string;
  nome: string;
  tipo: "funcao" | "tipo";
  motivos: string[];
  upstream: string;
  fork: string;
  chamadores: string[];
}

export interface ResultadoDaMedicao {
  arquivosLidos: number;
  mudancas: MudancaMedida[];
  divergencias: Divergencia[];
}

export function carregarTypescript(raiz?: string): Promise<typeof TS | null>;
export function assinaturasDoArquivo(ts: typeof TS, texto: string, arquivo?: string): Record<string, Assinatura>;
export function escreverAssinatura(item: Assinatura | undefined): string;
export function trocou(a: string, b: string, contexto?: number): string;
export function compararAssinaturas(
  antes: Record<string, Assinatura>,
  depois: Record<string, Assinatura>,
  outrosArquivos?: Map<string, string>,
): Mudanca[];
export function acrescimoInofensivo(motivo: string, totalDeParametrosAntes: number): boolean;
export function resolverImportacao(especificador: string, deArquivo: string): string | null;
export function semExtensao(arquivo: string): string;
export function usosNoArquivo(
  ts: typeof TS,
  texto: string,
  arquivo: string,
  vigiados: Map<string, Set<string>>,
): Array<{ modulo: string; nome: string; linhas: number[] }>;
export function lerObjetos(especificacoes: string[], cwd?: string): Map<string, string>;
export function medirAssinaturas(opcoes: {
  ts: typeof TS;
  antes: string;
  depois: string;
  cabeca?: string;
  cwd?: string;
}): ResultadoDaMedicao;
export function linhasDaSecao(resultado: ResultadoDaMedicao, opcoes?: { maxSemChamador?: number }): string[];
