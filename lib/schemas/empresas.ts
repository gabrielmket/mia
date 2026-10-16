/**
 * A ficha da EMPRESA — o cliente que é uma organização, não uma pessoa.
 *
 * Quase tudo é opcional de propósito. Quem cadastra costuma estar com o cliente
 * na linha e sabe o nome; o resto chega depois. Exigir CNPJ, site e telefone
 * para salvar transformaria "anotar o cliente novo" numa tarefa para depois — e
 * o cadastro que fica para depois não acontece.
 */
import { z } from "zod";

/**
 * Só dígitos, e sem conferir o dígito verificador.
 *
 * Guardar sem máscara é o que faz `12.345.678/0001-90` e `12345678000190`
 * pararem de ser duas empresas diferentes no índice único. Não validar o DV é
 * decisão: recusar um CNPJ com um número trocado pararia o cadastro inteiro por
 * causa do campo menos urgente da ficha, e um CNPJ errado se conserta depois —
 * um cliente não cadastrado se perde.
 */
export function apenasDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

const textoCurto = z.string().trim().max(200);

export const empresaCreateSchema = z.object({
  nome: z.string().trim().min(1, "A empresa precisa de um nome.").max(200),
  /** FORK MIA (.79): a razão social (`companies.legal_name`), opcional. */
  razao_social: z.string().trim().max(500).optional(),
  cnpj: z
    .string()
    .trim()
    .max(30)
    .transform(apenasDigitos)
    .refine((v) => v === "" || v.length === 14, "CNPJ tem 14 dígitos.")
    .optional(),
  site: textoCurto.optional(),
  telefone: textoCurto.optional(),
  email: z.string().trim().max(200).email("E-mail inválido.").optional().or(z.literal("")),
  endereco: z.string().trim().max(400).optional(),
  observacoes: z.string().trim().max(4000).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  /**
   * Campos adicionais. As DEFINIÇÕES (quais existem, com que rótulo) moram em
   * `crm_pipelines.settings.fields` — o mesmo lugar do contato e do lead.
   */
  custom_fields: z.record(z.string(), z.unknown()).optional(),
  /**
   * FORK MIA (.79, empresa única): os campos que a consulta à Receita devolveu
   * NA TELA (`mapBrasilApiToCompanyFields`), revisados por quem salva. Só a tela
   * consulta: nem o agente nem o MCP mandam isto.
   */
  receita: z.record(z.string(), z.unknown()).optional(),
  receita_bruta: z.record(z.string(), z.unknown()).nullable().optional(),
  /** O nome parece o de outra empresa, e a pessoa escolheu criar mesmo assim. */
  criar_mesmo_assim: z.boolean().optional(),
});

/** No PATCH todo campo é opcional — inclusive o nome, que só não pode virar vazio. */
export const empresaUpdateSchema = empresaCreateSchema.partial();

export type EmpresaCreate = z.infer<typeof empresaCreateSchema>;
export type EmpresaUpdate = z.infer<typeof empresaUpdateSchema>;

export const empresaListQuerySchema = z.object({
  /** Busca por trecho do nome ou do CNPJ. */
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  /** FORK MIA (.79): os filtros da tela (protótipo, tela 1). */
  filtro: z.enum(["todas", "abertos", "semcnpj", "dup"]).optional().default("todas"),
  /** Só id e nome, sem os números de cada linha (o seletor de empresa). */
  simples: z
    .enum(["1", "true", "0", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});
