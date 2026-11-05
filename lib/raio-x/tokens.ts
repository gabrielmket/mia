/**
 * FORK MIA (.101) · OS ENDEREÇOS E AS MARCAS DO RAIO-X, todos por HMAC com o
 * segredo do servidor (o molde do link dos painéis, `lib/paineis/link.ts`).
 *
 *   código do link de conexão  8 letras do base32 de Crockford, MAIÚSCULAS
 *                              (/raio-x/K7PQ2M9X); derivado do id e da versão
 *                              do link, então "copiar de novo" devolve o
 *                              mesmo e "gerar outro" muda. 40 bits, vale 48 h,
 *                              com teto de tentativas por IP na página.
 *   token do link do dono      24 letras minúsculas (120 bits), derivado do id
 *                              do link (/raio-x/relatorio/<token>).
 *   marca da conversa          HMAC do id do chat: o relatório nunca guarda o
 *                              telefone, e o mesmo cliente tem a mesma marca
 *                              nas leituras do mesmo raio-X.
 *   marca da mensagem          HMAC do id da mensagem: a leitura refeita não
 *                              grava a mesma mensagem duas vezes.
 *
 * No banco fica só o HASH do código e do token (outro HMAC, com outro rótulo).
 * Trocar `INTERNAL_SECRET` invalida os links (como já invalida os convites e os
 * links dos painéis) e muda as marcas: uma leitura nova de um raio-X antigo
 * numeraria os clientes de novo.
 */
import { createHmac } from "node:crypto";

import { env } from "@/lib/env";

export const ALFABETO = "0123456789abcdefghjkmnpqrstvwxyz";
export const TAMANHO_DO_CODIGO = 8;
export const TAMANHO_DO_TOKEN_DO_DONO = 24;
export const CAMINHO_DA_CONEXAO = "/raio-x/";
export const CAMINHO_DO_DONO = "/raio-x/relatorio/";

const FORMA_DO_CODIGO = new RegExp(`^[${ALFABETO}]{${TAMANHO_DO_CODIGO}}$`);
const FORMA_DO_TOKEN = new RegExp(`^[${ALFABETO}]{${TAMANHO_DO_TOKEN_DO_DONO}}$`);

function segredo(): string {
  const s = process.env.INTERNAL_SECRET;
  if (s && s.trim()) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("INTERNAL_SECRET ausente: o raio-X não pode assinar os links");
  }
  return "dev-fallback-raio-x";
}

function mac(rotulo: string, valor: string): Buffer {
  return createHmac("sha256", segredo()).update(`raio-x:${rotulo}:v1:${valor}`).digest();
}

function base32(bytes: Buffer, tamanho: number): string {
  let bits = 0;
  let valor = 0;
  let saida = "";
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5 && saida.length < tamanho) {
      saida += ALFABETO.charAt((valor >>> (bits - 5)) & 31);
      bits -= 5;
    }
    if (saida.length >= tamanho) break;
  }
  return saida;
}

/** O código do link de conexão (maiúsculo, como o dono lê). */
export function codigoDaConexao(raioXId: string, versao: number): string {
  return base32(mac("conexao", `${raioXId}:${versao}`), TAMANHO_DO_CODIGO).toUpperCase();
}

/** Aceita o que veio na URL em qualquer caixa; `null` sem a forma de um código. */
export function normalizarCodigo(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const c = bruto.trim().toLowerCase().replace(/-/g, "");
  return FORMA_DO_CODIGO.test(c) ? c.toUpperCase() : null;
}

export function hashDoCodigo(codigo: string): string {
  return mac("busca-conexao", codigo.toUpperCase()).toString("hex");
}

export function tokenDoDono(linkId: string): string {
  return base32(mac("dono", linkId), TAMANHO_DO_TOKEN_DO_DONO);
}

export function normalizarTokenDoDono(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const t = bruto.trim().toLowerCase();
  return FORMA_DO_TOKEN.test(t) ? t : null;
}

export function hashDoTokenDoDono(token: string): string {
  return mac("busca-dono", token).toString("hex");
}

/** A marca da conversa: o id do chat nunca entra cru nas tabelas do relatório. */
export function marcaDaConversa(raioXId: string, chatId: string): string {
  return mac("conversa", `${raioXId}:${chatId}`).toString("hex");
}

export function marcaDaMensagem(raioXId: string, mensagemId: string): string {
  return mac("mensagem", `${raioXId}:${mensagemId}`).toString("hex");
}

function base(): string {
  return (env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
}

export function enderecoDaConexao(codigo: string): string {
  return `${base()}${CAMINHO_DA_CONEXAO}${codigo}`;
}

export function enderecoDoDono(token: string): string {
  return `${base()}${CAMINHO_DO_DONO}${token}`;
}
