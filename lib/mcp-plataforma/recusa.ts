/**
 * A RECUSA QUE ENSINA: o texto que o modelo recebe quando uma chamada não passa.
 *
 * Quem chama o MCP de plataforma é um agente (uma sessão do Claude Code
 * implantando um cliente). Ele não tem tela para olhar: a mensagem de erro é a
 * única instrução que recebe para tentar de novo. "Campos inválidos" o deixa
 * com três saídas ruins: repetir a mesma chamada, inventar um formato ou
 * desistir e pedir ao humano que faça pela tela. Por isso toda recusa daqui diz
 * QUAL campo, o que era ESPERADO e mostra um EXEMPLO que passa.
 *
 * Mesmo tom de `lib/mcp/recusa-para-o-modelo.ts`: a recusa não é só "não", é o
 * que fazer em seguida.
 */
import type { z } from "zod";

import { ApiError } from "@/lib/api/types";

import type { FerramentaDePlataforma } from "./tipos";

/**
 * Uma recusa de NEGÓCIO: a chamada estava bem formada e a regra do produto não
 * deixa. O texto vai inteiro para o modelo.
 */
export class Recusa extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "Recusa";
  }
}

export function recusar(mensagem: string): never {
  throw new Recusa(mensagem);
}

function nomeDoTipo(valor: unknown): string {
  const nomes: Record<string, string> = {
    string: "texto",
    number: "número",
    int: "número inteiro",
    boolean: "verdadeiro/falso",
    array: "lista",
    object: "objeto",
    null: "nulo",
    undefined: "ausente",
    nan: "número inválido",
  };
  const chave = String(valor);
  return nomes[chave] ?? chave;
}

function caminho(partes: ReadonlyArray<PropertyKey>): string {
  if (partes.length === 0) return "(argumentos)";
  return partes
    .map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
    .join("");
}

function tipoRecebido(valor: unknown): string {
  if (valor === undefined) return "ausente";
  if (valor === null) return "nulo";
  if (Array.isArray(valor)) return "lista";
  return nomeDoTipo(typeof valor);
}

/** Uma frase por problema, em português, sem vocabulário do validador. */
function explicarProblema(problema: z.core.$ZodIssue): string {
  const onde = caminho(problema.path);
  const p = problema as unknown as Record<string, unknown>;

  switch (problema.code) {
    case "invalid_type": {
      const recebido = tipoRecebido(p.input);
      return recebido === "ausente"
        ? `\`${onde}\` é obrigatório (esperado: ${nomeDoTipo(p.expected)}).`
        : `\`${onde}\` deveria ser ${nomeDoTipo(p.expected)} e chegou ${recebido}.`;
    }
    case "unrecognized_keys": {
      const chaves = (p.keys as string[] | undefined) ?? [];
      const prefixo = problema.path.length === 0 ? "" : `${onde}.`;
      return (
        `Campo desconhecido: ${chaves.map((k) => `\`${prefixo}${k}\``).join(", ")}. ` +
        "Confira o nome do campo na descrição da ferramenta."
      );
    }
    case "invalid_value": {
      const opcoes = (p.values as unknown[] | undefined) ?? [];
      return `\`${onde}\` aceita só: ${opcoes.map((o) => JSON.stringify(o)).join(", ")}.`;
    }
    case "too_small": {
      const minimo = String(p.minimum);
      if (p.origin === "string") return `\`${onde}\` precisa de pelo menos ${minimo} caractere(s).`;
      if (p.origin === "array") return `\`${onde}\` precisa de pelo menos ${minimo} item(ns).`;
      return `\`${onde}\` precisa ser no mínimo ${minimo}.`;
    }
    case "too_big": {
      const maximo = String(p.maximum);
      if (p.origin === "string") return `\`${onde}\` aceita no máximo ${maximo} caracteres.`;
      if (p.origin === "array") {
        return `\`${onde}\` aceita no máximo ${maximo} itens por chamada. Divida em mais de uma chamada.`;
      }
      return `\`${onde}\` pode ser no máximo ${maximo}.`;
    }
    case "invalid_format": {
      const formatos: Record<string, string> = {
        uuid: "um id no formato 00000000-0000-4000-8000-000000000000",
        email: "um e-mail (ex.: pessoa@exemplo.invalid)",
        url: "um endereço completo (ex.: https://exemplo.invalid/pagina)",
      };
      const formato = String(p.format);
      // A frase escrita por nós no schema (o regex com mensagem própria) ensina
      // mais que o nome do formato.
      const propria = problema.message && !/^Invalid/i.test(problema.message) ? problema.message : null;
      if (propria) return `\`${onde}\`: ${propria}`;
      return `\`${onde}\` precisa ser ${formatos[formato] ?? `no formato ${formato}`}.`;
    }
    default:
      // `custom` e os demais: a mensagem do schema já foi escrita em português.
      return /^Invalid/i.test(problema.message)
        ? `\`${onde}\` não foi aceito.`
        : `\`${onde}\`: ${problema.message}`;
  }
}

/** Teto de problemas listados: uma lista de 200 produtos errados não cabe numa resposta. */
const TETO_DE_PROBLEMAS = 12;

/**
 * A recusa de VALIDAÇÃO: campo a campo, com a descrição do campo e um exemplo.
 */
export function explicarValidacao(ferramenta: FerramentaDePlataforma, erro: z.ZodError): string {
  const problemas = erro.issues;
  const linhas = problemas.slice(0, TETO_DE_PROBLEMAS).map((problema) => {
    const frase = explicarProblema(problema);
    const campo = problema.path[0];
    const descricao =
      typeof campo === "string"
        ? (ferramenta.inputSchema[campo] as { description?: string } | undefined)?.description
        : undefined;
    return descricao ? `- ${frase}\n  O que é este campo: ${descricao}` : `- ${frase}`;
  });

  const partes = [
    `A chamada de ${ferramenta.name} não passou na conferência dos argumentos. Nada foi gravado.`,
    linhas.join("\n"),
  ];
  if (problemas.length > TETO_DE_PROBLEMAS) {
    partes.push(`(e mais ${problemas.length - TETO_DE_PROBLEMAS} problema(s) do mesmo tipo)`);
  }
  if (ferramenta.exemplo) {
    partes.push(`Exemplo de chamada válida:\n${JSON.stringify(ferramenta.exemplo, null, 2)}`);
  }
  partes.push("Corrija os campos apontados e chame de novo.");
  return partes.join("\n\n");
}

/**
 * O texto de qualquer falha do handler.
 *
 * `ApiError` é como as operações de domínio compartilhadas com a tela recusam
 * (`lib/leads/stage-operations.ts`, `lib/pipelines/pipeline-operations.ts`): a
 * `message` delas já é a frase escrita para quem usa o produto.
 */
export function textoDaFalha(err: unknown): string {
  if (err instanceof Recusa) return err.message;
  if (err instanceof ApiError) return err.message || err.code;
  if (err instanceof Error) return err.message;
  return "erro desconhecido";
}
