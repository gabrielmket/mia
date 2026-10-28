/**
 * FORK MIA (.97) · A RÉGUA DOS PARCEIROS, DA COMISSÃO E DO REPASSE, PURA
 * (protótipo "Cupons e parceiros", decisões 1 a 4, 10 e 11; docs/fork/cupons-e-parceiros.md).
 *
 * A comissão é sobre o LÍQUIDO (decisão 1): o valor pago (já com o desconto do
 * cupom), menos o imposto (a alíquota do Simples, um campo só em Admin ›
 * Cobrança), menos a taxa REAL do Asaas daquela cobrança (`value - netValue`).
 * Vale para a mensalidade e para o setup. Sem servidor e sem banco: o extrato,
 * a tela, a planilha e os testes fazem a mesma conta daqui.
 */
import { z } from "zod";

import { documentoDoPagador } from "@/lib/cobranca/documento";

export const MESES_DA_COMISSAO = [6, 12, 24] as const;
export type TipoDeDocumento = "cpf" | "cnpj";

export interface ContaDaComissao {
  valor_pago_cents: number;
  aliquota_pct: number;
  imposto_cents: number;
  taxa_cents: number;
  liquido_cents: number;
  comissao_pct: number;
  comissao_cents: number;
}

/**
 * A conta inteira de uma cobrança paga. `liquidoDoAsaasCents` é o `netValue` da
 * cobrança (o que caiu na conta depois da taxa). Arredonda cada parcela ao
 * centavo, como o extrato mostra.
 */
export function contaDaComissao(p: {
  valorPagoCents: number;
  liquidoDoAsaasCents: number;
  aliquotaPct: number;
  comissaoPct: number;
}): ContaDaComissao {
  const valor = Math.max(0, Math.round(p.valorPagoCents));
  const imposto = Math.round((valor * p.aliquotaPct) / 100);
  const taxa = Math.max(0, valor - Math.max(0, Math.round(p.liquidoDoAsaasCents)));
  const liquido = Math.max(0, valor - imposto - taxa);
  return {
    valor_pago_cents: valor,
    aliquota_pct: p.aliquotaPct,
    imposto_cents: imposto,
    taxa_cents: taxa,
    liquido_cents: liquido,
    comissao_pct: p.comissaoPct,
    comissao_cents: Math.round((liquido * p.comissaoPct) / 100),
  };
}

/** AAAA-MM-01 do mês de um dia civil (AAAA-MM-DD). */
export function competenciaDe(diaCivil: string): string {
  return `${diaCivil.slice(0, 7)}-01`;
}

/** O mês anterior a uma competência (AAAA-MM-01). */
export function mesAnterior(competencia: string): string {
  const [a, m] = competencia.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 2, 1));
  return d.toISOString().slice(0, 10);
}

/** Soma meses a um dia civil; dia 31 num mês menor cai no último dia dele. */
export function somarMeses(diaCivil: string, meses: number): string {
  const [a, m, d] = diaCivil.split("-").map(Number) as [number, number, number];
  const ultimo = new Date(Date.UTC(a, m - 1 + meses + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 + meses, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

/**
 * A mensalidade com este vencimento ainda dá comissão? Pelo prazo fixado no
 * primeiro pagamento: `meses` contados do vencimento da primeira mensalidade
 * paga (`inicio`); `null` = enquanto o cliente pagar. Sem início, é a primeira.
 */
export function mensalidadeNoPrazo(vencimento: string, inicio: string | null, meses: number | null): boolean {
  if (meses === null || inicio === null) return true;
  return vencimento < somarMeses(inicio, meses);
}

/** "Outubro de 2026" a partir de AAAA-MM-01 (o texto do extrato). */
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export function nomeDoMes(competencia: string): string {
  const [a, m] = competencia.split("-").map(Number) as [number, number];
  const nome = MESES[m - 1] ?? "";
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${a}`;
}

/** O documento pelo tamanho: 11 = CPF (recibo), 14 = CNPJ (nota). `null` = não confere. */
export function documentoDoParceiro(bruto: string): { tipo: TipoDeDocumento; documento: string } | null {
  const doc = documentoDoPagador(bruto);
  if (doc === null) return null;
  if (/^\d{11}$/.test(doc)) return { tipo: "cpf", documento: doc };
  if (doc.length === 14) return { tipo: "cnpj", documento: doc };
  return null;
}

const percentual = z.coerce.number().min(0).max(100);

/** O que a tela e o MCP mandam para criar ou mudar um parceiro. */
export const parceiroSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  documento: z.string().trim().min(11).max(20),
  email: z.string().trim().email().max(160),
  chave_pix: z.string().trim().min(1).max(140),
  comissao_pct: percentual,
  comissao_meses: z.union([z.literal(6), z.literal(12), z.literal(24), z.null()]),
  comissao_setup_pct: percentual,
  ativo: z.boolean().optional(),
});
export type EntradaDoParceiro = z.input<typeof parceiroSchema>;

/** A configuração da comissão: a alíquota e os dias do calendário do repasse. */
export interface ConfiguracaoDaComissao {
  /** A alíquota do Simples (%), única para o sistema. `null` = ainda não configurada. */
  aliquota_pct: number | null;
  /** Dia em que o mês fecha e o extrato sai. */
  dia_fechamento: number;
  /** Até quando o parceiro manda a nota ou o recibo. */
  dia_nota: number;
  /** Até quando a Time faz o Pix. */
  dia_pagamento: number;
}

export const CONFIGURACAO_PADRAO: ConfiguracaoDaComissao = {
  aliquota_pct: null,
  dia_fechamento: 1,
  dia_nota: 5,
  dia_pagamento: 10,
};

const dia = z.coerce.number().int().min(1).max(28);
export const configuracaoDaComissaoSchema = z
  .object({
    aliquota_pct: z.coerce.number().min(0).max(100).nullable(),
    dia_fechamento: dia,
    dia_nota: dia,
    dia_pagamento: dia,
  })
  .refine((c) => c.dia_fechamento <= c.dia_nota && c.dia_nota <= c.dia_pagamento, {
    path: ["dia_nota"],
    message: "ordem_dos_dias",
  });

/** A chave Pix com o meio escondido (o MCP e os registros). */
export function pixMascarado(pix: string | null): string | null {
  if (!pix) return null;
  const p = pix.trim();
  if (p.length <= 6) return "***";
  return `${p.slice(0, 3)}***${p.slice(-3)}`;
}
