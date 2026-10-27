/**
 * FORK MIA (.96) · A ÁREA DE COBRANÇA, AS REGRAS PURAS (protótipo "Pagamento no
 * início", aprovado em 27/10/2026: tela 3 e decisões 9, 10 e 11;
 * docs/fork/area-de-cobranca.md).
 *
 * Sem servidor e sem banco: a leitura (`./leitura.ts`), as rotas, a tela e o MCP
 * falam esta língua.
 *   - a situação de cada cobrança, como a pessoa lê: paga, em aberto, vencida,
 *     cancelada (sem nota), estornada ou em análise;
 *   - a nota fiscal que vale para uma cobrança (a emitida ganha da cancelada: a
 *     Time cancela a errada e emite outra);
 *   - "A nota saiu errada": os motivos, a entrada e o texto do chamado;
 *   - a bandeira do cartão pelos primeiros números (só a bandeira sai daqui).
 */
import { z } from "zod";

import type { CobrancaLida, NotaLida } from "@/lib/asaas-mia/cobrancas";

export type SituacaoNaArea = "paga" | "aberta" | "vencida" | "em_analise" | "estornada" | "cancelada" | "em_andamento";

/** A situação da cobrança do Asaas como a área mostra. */
export function situacaoNaArea(c: Pick<CobrancaLida, "situacao">): SituacaoNaArea {
  switch (c.situacao) {
    case "paga":
    case "aberta":
    case "vencida":
    case "em_analise":
    case "estornada":
    case "cancelada":
      return c.situacao;
    default:
      return "em_andamento";
  }
}

/** Situações em que a cobrança ainda se paga: "Pagar agora" e "Segunda via". */
export function cobrancaEmAberto(s: SituacaoNaArea): boolean {
  return s === "aberta" || s === "vencida";
}

const PESO_DA_NOTA: Record<NotaLida["situacao"], number> = {
  emitida: 5,
  em_andamento: 4,
  agendada: 3,
  com_erro: 2,
  cancelada: 1,
};

/**
 * A nota que vale para a cobrança: a emitida primeiro (a errada a Time cancela e
 * emite outra; as duas ficam no Asaas), depois a que está saindo. `null` = nenhuma.
 */
export function notaDaCobranca(notas: readonly NotaLida[], pagamentoRef: string): NotaLida | null {
  const daCobranca = notas.filter((n) => n.pagamentoRef === pagamentoRef);
  if (daCobranca.length === 0) return null;
  return [...daCobranca].sort(
    (a, b) => PESO_DA_NOTA[b.situacao] - PESO_DA_NOTA[a.situacao] || (b.emitidaEm ?? "").localeCompare(a.emitidaEm ?? ""),
  )[0]!;
}

// ── "A nota saiu errada" (decisão 10) ──────────────────────────────────────

export const MOTIVOS_DA_NOTA_ERRADA = ["razao_social", "documento", "endereco", "valor_ou_servico", "outro"] as const;
export type MotivoDaNotaErrada = (typeof MOTIVOS_DA_NOTA_ERRADA)[number];

/** O nome de cada motivo como a tela mostra (e o chamado leva). */
export const ROTULO_DO_MOTIVO: Record<MotivoDaNotaErrada, string> = {
  razao_social: "Razão social ou nome",
  documento: "CNPJ ou CPF",
  endereco: "Endereço",
  valor_ou_servico: "Valor ou serviço",
  outro: "Outra coisa",
};

/** O que a tela manda. A cobrança é sempre conferida contra o cliente do Asaas da empresa. */
export const notaErradaSchema = z
  .object({
    cobranca_ref: z.string().trim().regex(/^pay_[A-Za-z0-9]{3,60}$/),
    motivo: z.enum(MOTIVOS_DA_NOTA_ERRADA),
    texto: z.string().trim().min(3).max(2000),
  })
  .strict();

export type EntradaDaNotaErrada = z.infer<typeof notaErradaSchema>;

/** "Outubro de 2026" a partir de AAAA-MM-DD, sempre em português (o chamado é lido pela Time). */
export function mesPorExtenso(dataCivil: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(dataCivil);
  if (!m) return dataCivil;
  const nome = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15)),
  );
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${m[1]}`;
}

/**
 * O texto do chamado para a Time. Leva a cobrança, a nota, o motivo e o que a
 * pessoa escreveu, nada mais (sem CPF, CNPJ ou endereço: a Time lê os dados
 * fiscais pela plataforma). Cabe no limite do chamado (4000).
 */
export function textoDoChamadoDaNota(p: {
  vencimento: string;
  valorCents: number;
  numeroDaNota: string | null;
  motivo: MotivoDaNotaErrada;
  texto: string;
}): string {
  const valor = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(p.valorCents / 100);
  const nota = p.numeroDaNota ? `nota nº ${p.numeroDaNota}` : "nota sem número no Asaas";
  return [
    `A nota saiu errada · ${nota} · ${mesPorExtenso(p.vencimento)} · ${valor}`,
    `O que está errado: ${ROTULO_DO_MOTIVO[p.motivo]}`,
    "",
    p.texto.trim(),
    "",
    "Pedido pela área de cobrança (Configurações › Plano e cobrança). Cancele a nota no Asaas e emita outra com os dados certos, dentro do prazo da prefeitura.",
  ]
    .join("\n")
    .slice(0, 4000);
}

// ── o cartão ───────────────────────────────────────────────────────────────

/**
 * A bandeira pelos primeiros números (só para a tela dizer "Visa terminado em
 * 1234" logo depois da troca; o Asaas informa a dele na próxima mensalidade).
 * Recebe o número e devolve SÓ a bandeira: nada do número sai daqui.
 */
export function bandeiraPeloNumero(numero: string): string | null {
  const d = numero.replace(/\D/g, "");
  if (d.length < 13) return null;
  if (/^(606282|3841)/.test(d)) return "HIPERCARD";
  if (/^(4011(78|79)|43(1274|8935)|45(1416|7393|763[12])|50(4175|6699|67[0-7]\d|9\d{3})|627780|636(297|368)|65(0(0[3-9]|[1-9]\d)|16[5-9]|5(0\d|[1-4]\d|5[0-8])))/.test(d)) {
    return "ELO";
  }
  if (/^3[47]/.test(d)) return "AMEX";
  if (/^3(0[0-5]|[68])/.test(d)) return "DINERS";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return "MASTERCARD";
  if (/^4/.test(d)) return "VISA";
  return null;
}

/** "Visa", "Mastercard", "Elo"... para a tela. */
export function nomeDaBandeira(bandeira: string | null): string | null {
  if (!bandeira) return null;
  const nomes: Record<string, string> = {
    VISA: "Visa",
    MASTERCARD: "Mastercard",
    ELO: "Elo",
    AMEX: "American Express",
    DINERS: "Diners",
    HIPERCARD: "Hipercard",
    DISCOVER: "Discover",
    JCB: "JCB",
  };
  return nomes[bandeira] ?? bandeira.charAt(0) + bandeira.slice(1).toLowerCase();
}
