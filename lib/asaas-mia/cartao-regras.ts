/**
 * FORK MIA (.96) · O CARTÃO DIGITADO NA TELA, AS REGRAS PURAS (sem servidor).
 *
 * A tela confere enquanto a pessoa digita e o servidor confere de novo antes de
 * chamar o Asaas. Nenhuma função daqui guarda, registra ou devolve o número
 * inteiro nem o código de segurança: a única saída "visível" é o final de 4
 * números (`finalDigitado`), que a tela já mostra a quem digitou.
 */
import { z } from "zod";

/** O cartão como chega na requisição. Vive só na memória da requisição. */
export interface CartaoDigitado {
  numero: string;
  nome: string;
  /** MM. */
  mes: string;
  /** AAAA. */
  ano: string;
  cvv: string;
}

const soDigitos = (s: string) => s.replace(/\D/g, "");

/** Luhn (mod 10), o dígito de controle de todo número de cartão. */
export function luhnOk(numero: string): boolean {
  const d = soDigitos(numero);
  if (d.length < 13 || d.length > 19) return false;
  let soma = 0;
  for (let i = 0; i < d.length; i += 1) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    soma += n;
  }
  return soma % 10 === 0;
}

/** "MM/AA", "MM/AAAA" ou "MMAA" → { mes: "MM", ano: "AAAA" }, ou `null`. */
export function validadeLida(bruta: string): { mes: string; ano: string } | null {
  const m = /^\s*(\d{1,2})\s*\/?\s*(\d{2}|\d{4})\s*$/.exec(bruta);
  if (!m) return null;
  const mes = Number(m[1]);
  if (mes < 1 || mes > 12) return null;
  const ano = m[2]!.length === 2 ? `20${m[2]}` : m[2]!;
  return { mes: String(mes).padStart(2, "0"), ano };
}

/** A validade ainda vale no mês de `agora` (o cartão vale até o último dia do mês). */
export function validadeEmDia(v: { mes: string; ano: string }, agora: Date): boolean {
  const fim = Date.UTC(Number(v.ano), Number(v.mes), 1);
  return fim > agora.getTime() && Number(v.ano) <= agora.getUTCFullYear() + 25;
}

/** O que a tela manda. Sem `.describe`, sem mensagens que ecoem o valor. */
export const cartaoDaTelaSchema = z.object({
  numero: z.string().max(40),
  nome: z.string().max(80),
  validade: z.string().max(10),
  cvv: z.string().max(8),
});

export type MotivoDoCartaoRecusado = "numero_invalido" | "nome_obrigatorio" | "validade_invalida" | "cvv_invalido";

/**
 * Confere e normaliza. A falha diz SÓ o campo, nunca o valor. `agora` é
 * injetado (o teste fixa o mês).
 */
export function conferirCartao(
  entrada: unknown,
  agora: Date,
): { ok: true; cartao: CartaoDigitado } | { ok: false; motivo: MotivoDoCartaoRecusado } {
  const lido = cartaoDaTelaSchema.safeParse(entrada);
  if (!lido.success) return { ok: false, motivo: "numero_invalido" };
  const numero = soDigitos(lido.data.numero);
  if (!luhnOk(numero)) return { ok: false, motivo: "numero_invalido" };
  const nome = lido.data.nome.trim().replace(/\s+/g, " ");
  if (nome.length < 2) return { ok: false, motivo: "nome_obrigatorio" };
  const validade = validadeLida(lido.data.validade);
  if (validade === null || !validadeEmDia(validade, agora)) return { ok: false, motivo: "validade_invalida" };
  const cvv = soDigitos(lido.data.cvv);
  if (!/^\d{3,4}$/.test(cvv)) return { ok: false, motivo: "cvv_invalido" };
  return { ok: true, cartao: { numero, nome, mes: validade.mes, ano: validade.ano, cvv } };
}

/** Os 4 últimos números do que foi digitado (o que a tela já mostra a quem digitou). */
export function finalDigitado(numero: string): string {
  return soDigitos(numero).slice(-4);
}

/** A frase de cada recusa da tela, sem eco do valor. */
export const FRASE_DO_CARTAO: Record<MotivoDoCartaoRecusado, string> = {
  numero_invalido: "Confira o número do cartão.",
  nome_obrigatorio: "Escreva o nome como está impresso no cartão.",
  validade_invalida: "Confira a validade do cartão (MM/AA).",
  cvv_invalido: "O código de segurança tem 3 ou 4 números.",
};
