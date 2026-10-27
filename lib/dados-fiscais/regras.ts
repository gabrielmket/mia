/**
 * FORK MIA (.96) · OS DADOS FISCAIS DA EMPRESA, AS REGRAS PURAS.
 *
 * Em nome de quem sai a cobrança e a nota fiscal do Asaas (protótipo "Pagamento
 * no início", aprovado em 27/10/2026, decisões 4 e 8). Puro e sem servidor: o
 * cadastro e o passo do pagamento conferem enquanto a pessoa digita, a action e
 * as rotas conferem de novo, e o banco tem os mesmos limites em CHECK
 * (migration 9120). Uma regra só nos três lugares: esta.
 *
 *   - empresa (CNPJ, inclusive o alfanumérico da Receita) ou pessoa física (CPF),
 *     com o dígito verificador conferido (`documentoDoPagador`, o mesmo do Asaas
 *     do upstream);
 *   - razão social (PJ) ou nome completo (PF), que é o nome que sai na nota;
 *   - endereço com CEP de 8 números, rua, número, bairro, cidade e UF;
 *     complemento opcional;
 *   - inscrições municipal e estadual, opcionais (só fazem sentido na PJ);
 *   - o WhatsApp de quem assina, só números com o país (o Asaas pede um telefone
 *     no pagamento com cartão).
 */
import { z } from "zod";

import { documentoDoPagador } from "@/lib/cobranca/documento";

export type TipoFiscal = "pj" | "pf";

export interface DadosFiscais {
  tipo: TipoFiscal;
  /** Só os caracteres do documento (CPF 11 dígitos; CNPJ 14). */
  documento: string;
  /** PJ: razão social. PF: nome completo. */
  razao_social: string;
  /** 8 dígitos. */
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  /** Duas letras maiúsculas. */
  uf: string;
  inscricao_municipal: string | null;
  inscricao_estadual: string | null;
  /** Só dígitos, com o país (55...). */
  telefone: string | null;
}

/** As 27 unidades da federação. */
export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE",
  "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

const soDigitos = (s: string) => s.replace(/\D/g, "");

/** O documento sem máscara, se o dígito confere E o tamanho é o do tipo; senão `null`. */
export function documentoDoTipo(tipo: TipoFiscal, bruto: string): string | null {
  const doc = documentoDoPagador(bruto);
  if (doc === null) return null;
  if (tipo === "pf") return /^\d{11}$/.test(doc) ? doc : null;
  return doc.length === 14 ? doc : null;
}

/**
 * O WhatsApp em dígitos com o país. Aceita "(31) 98888-0000", "31988880000",
 * "+55 31 98888-0000". Número brasileiro sem o 55 ganha o 55. `null` = vazio;
 * `undefined` = não é um telefone que dê para usar.
 */
export function telefoneNormalizado(bruto: string | null | undefined): string | null | undefined {
  const d = soDigitos(bruto ?? "");
  if (d === "") return null;
  const comPais = d.length === 10 || d.length === 11 ? `55${d}` : d;
  return /^\d{12,15}$/.test(comPais) ? comPais : undefined;
}

const textoObrigatorio = (max: number) => z.string().trim().min(1).max(max);
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** A entrada crua (da tela, com máscara): o que o formulário manda. */
export const entradaFiscalSchema = z.object({
  tipo: z.enum(["pj", "pf"]),
  documento: z.string().max(32),
  razao_social: z.string().trim().min(2).max(120),
  cep: z.string().max(12),
  logradouro: textoObrigatorio(120),
  numero: textoObrigatorio(20),
  complemento: textoOpcional(80),
  bairro: textoObrigatorio(80),
  cidade: textoObrigatorio(80),
  uf: z.string().trim().max(2),
  inscricao_municipal: textoOpcional(30),
  inscricao_estadual: textoOpcional(30),
  telefone: z.string().max(32).nullish(),
});

export type EntradaFiscal = z.input<typeof entradaFiscalSchema>;

export type ResultadoFiscal =
  | { ok: true; dados: DadosFiscais }
  | { ok: false; campos: Partial<Record<keyof DadosFiscais, string>> };

/** O nome do campo como a pessoa lê, para "Falta preencher: ...". */
export const ROTULO_DO_CAMPO: Record<keyof DadosFiscais, string> = {
  tipo: "empresa ou pessoa física",
  documento: "CPF ou CNPJ válido",
  razao_social: "razão social ou nome completo",
  cep: "CEP",
  logradouro: "rua",
  numero: "número",
  complemento: "complemento",
  bairro: "bairro",
  cidade: "cidade",
  uf: "UF",
  inscricao_municipal: "inscrição municipal",
  inscricao_estadual: "inscrição estadual",
  telefone: "WhatsApp",
};

/**
 * Confere e normaliza. Cada campo ruim volta com o motivo, para a tela marcar o
 * campo e escrever "Falta preencher: CNPJ válido, CEP". `exigeTelefone`: no
 * cadastro da entrada paga o WhatsApp é obrigatório; na edição, não.
 */
export function conferirDadosFiscais(
  entrada: unknown,
  opcoes: { exigeTelefone?: boolean } = {},
): ResultadoFiscal {
  const bruto = (entrada ?? {}) as Record<string, unknown>;
  const campos: Partial<Record<keyof DadosFiscais, string>> = {};
  const texto = (k: string) => (typeof bruto[k] === "string" ? (bruto[k] as string) : "");

  const tipo: TipoFiscal | null = bruto.tipo === "pj" || bruto.tipo === "pf" ? bruto.tipo : null;
  if (tipo === null) campos.tipo = "obrigatorio";
  const documento = tipo === null ? null : documentoDoTipo(tipo, texto("documento"));
  if (documento === null) campos.documento = texto("documento").trim() === "" ? "obrigatorio" : "invalido";

  const lido = entradaFiscalSchema.safeParse({ ...bruto, tipo: tipo ?? "pj" });
  if (!lido.success) {
    for (const issue of lido.error.issues) {
      const k = issue.path[0] as keyof DadosFiscais | undefined;
      if (k && k !== "documento" && k !== "tipo" && !campos[k]) campos[k] = "obrigatorio";
    }
  }
  const cep = soDigitos(texto("cep"));
  if (cep.length !== 8) campos.cep = cep === "" ? "obrigatorio" : "invalido";
  const uf = texto("uf").trim().toUpperCase();
  if (!(UFS as readonly string[]).includes(uf)) campos.uf = uf === "" ? "obrigatorio" : "invalido";
  const telefone = telefoneNormalizado(typeof bruto.telefone === "string" ? bruto.telefone : null);
  if (telefone === undefined) campos.telefone = "invalido";
  else if (telefone === null && opcoes.exigeTelefone) campos.telefone = "obrigatorio";

  if (Object.keys(campos).length > 0 || !lido.success || tipo === null || documento === null) {
    return { ok: false, campos };
  }
  const d = lido.data;
  return {
    ok: true,
    dados: {
      tipo,
      documento,
      razao_social: d.razao_social,
      cep,
      logradouro: d.logradouro,
      numero: d.numero,
      complemento: d.complemento,
      bairro: d.bairro,
      cidade: d.cidade,
      uf,
      // A pessoa física não tem inscrição: o que a tela mandou não vale.
      inscricao_municipal: tipo === "pj" ? d.inscricao_municipal : null,
      inscricao_estadual: tipo === "pj" ? d.inscricao_estadual : null,
      telefone: telefone ?? null,
    },
  };
}

/** "Falta preencher: CNPJ válido, CEP": a lista dos campos ruins, na ordem da tela. */
export function faltasDosDadosFiscais(campos: Partial<Record<keyof DadosFiscais, string>>): string[] {
  const ordem: Array<keyof DadosFiscais> = [
    "tipo", "documento", "razao_social", "cep", "logradouro", "numero", "bairro", "cidade", "uf",
    "complemento", "inscricao_municipal", "inscricao_estadual", "telefone",
  ];
  return ordem.filter((k) => campos[k]).map((k) => ROTULO_DO_CAMPO[k]);
}

/** CPF 000.000.000-00; CNPJ 00.000.000/0000-00 (o alfanumérico também). */
export function formatarDocumento(doc: string): string {
  if (/^\d{11}$/.test(doc)) return `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9)}`;
  if (doc.length === 14) return `${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5, 8)}/${doc.slice(8, 12)}-${doc.slice(12)}`;
  return doc;
}

export function formatarCep(cep: string): string {
  return /^\d{8}$/.test(cep) ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
}

/** "Avenida Afonso Pena, 1500, Sala 803 · Centro · Belo Horizonte/MG · 30130-010". */
export function enderecoEmUmaLinha(d: Pick<DadosFiscais, "logradouro" | "numero" | "complemento" | "bairro" | "cidade" | "uf" | "cep">): string {
  const rua = [d.logradouro, d.numero, d.complemento].filter(Boolean).join(", ");
  return [rua, d.bairro, `${d.cidade}/${d.uf}`, formatarCep(d.cep)].filter(Boolean).join(" · ");
}

/** O documento com o meio escondido, para o MCP e os registros: "11.***.***\/0001-81". */
export function documentoMascarado(doc: string): string {
  const f = formatarDocumento(doc);
  if (/^\d{11}$/.test(doc)) return `***.${f.slice(4, 7)}.***-${f.slice(-2)}`;
  return `${f.slice(0, 2)}.***.***/${f.slice(11)}`;
}
