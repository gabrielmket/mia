/**
 * FORK MIA (.101) · A REFERÊNCIA CIFRADA DA CONVERSA.
 *
 * Para pedir o áudio de uma mensagem ao leitor é preciso o id do chat (que, no
 * WhatsApp, é o telefone ou o identificador do cliente). Ele NÃO vai cru para o
 * banco: a conversa guarda só a marca (HMAC, `tokens.ts`) e esta referência
 * cifrada (AES-256-GCM, a chave das credenciais de IA), com o id do chat e o
 * nome de perfil, que serve só para tirar o nome dos trechos do relatório.
 *
 * A referência some junto com as conversas (30 dias depois do relatório). O
 * relatório nunca a lê.
 */
import { decryptKey, encryptKey } from "@/lib/crypto/aes_gcm";

export interface ReferenciaDaConversa {
  chatId: string;
  nome: string | null;
}

/** Um texto curto cifrado (o id de uma mensagem de áudio, para pedir o arquivo). */
export function cifrarTexto(texto: string): string {
  return cifrarReferencia({ chatId: texto, nome: null });
}

export function decifrarTexto(cifrado: string | null | undefined): string | null {
  return decifrarReferencia(cifrado)?.chatId ?? null;
}

export function cifrarReferencia(ref: ReferenciaDaConversa): string {
  const r = encryptKey(JSON.stringify({ c: ref.chatId, n: ref.nome ?? null }));
  return ["v1", r.iv.toString("base64"), r.tag.toString("base64"), r.ciphertext.toString("base64")].join(".");
}

export function decifrarReferencia(texto: string | null | undefined): ReferenciaDaConversa | null {
  if (!texto) return null;
  const [versao, iv, tag, ct] = texto.split(".");
  if (versao !== "v1" || !iv || !tag || !ct) return null;
  try {
    const bruto = JSON.parse(
      decryptKey({ iv: Buffer.from(iv, "base64"), tag: Buffer.from(tag, "base64"), ciphertext: Buffer.from(ct, "base64") }),
    ) as { c?: unknown; n?: unknown };
    if (typeof bruto.c !== "string") return null;
    return { chatId: bruto.c, nome: typeof bruto.n === "string" ? bruto.n : null };
  } catch {
    return null;
  }
}
