/**
 * FORK MIA (.107) · A ENTRADA SEM SENHA NA ÁREA DO RAIO-X: o código de 6
 * números e o cookie da sessão. Servidor (`node:crypto`).
 *
 * Por que não o login do produto: quem pede o raio-X grátis NÃO é usuário da
 * MIA. Criar uma conta no Supabase Auth para ela abriria `/app` e o resto do
 * produto para alguém que só precisa ver o próprio relatório. Conferido antes
 * de construir (06/11/2026): o upstream não tem entrada por código no e-mail
 * (o CHANGELOG fala do código do APLICATIVO autenticador e do "entrar com o
 * Google"), e o que o fork já tinha de parecido são os links assinados por
 * HMAC do raio-X (`tokens.ts`) e dos painéis (`lib/paineis/link.ts`). Esta
 * peça usa o mesmo segredo de servidor (`INTERNAL_SECRET`) e o mesmo jeito,
 * com rótulos próprios: trocar o segredo derruba as sessões e os códigos.
 *
 *   o código     6 números ao acaso (`randomInt`), vale 15 minutos e aceita 5
 *                tentativas; no banco fica só o HMAC (`mia_raio_x_codigos_de_acesso`)
 *   o cookie     `v1.<conta>.<expira em segundos>.<HMAC>`, HttpOnly, Secure,
 *                SameSite=Lax, 30 dias; adulterado ou vencido não vale nada
 *   a origem     todo POST da área confere o Origin (ou o Referer) do próprio app
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

export const DIGITOS_DO_CODIGO = 6;
export const VALIDADE_DO_CODIGO_MS = 15 * 60_000;
export const TENTATIVAS_DO_CODIGO = 5;
export const DIAS_DA_SESSAO = 30;
export const NOME_DO_COOKIE = "mia_raio_x_area";

/** As cercas da entrada: pedir o código e conferir o código (por IP e por e-mail). */
export const ROTULO_DO_LIMITE_DO_PEDIDO = "raio_x_entrar";
export const LIMITE_DO_PEDIDO = { ip: 20, id: 5, windowSec: 3600 } as const;
export const ROTULO_DO_LIMITE_DA_CONFIRMACAO = "raio_x_entrar_confirmar";
export const LIMITE_DA_CONFIRMACAO = { ip: 30, id: 10, windowSec: 600 } as const;

function segredo(): string {
  const s = process.env.INTERNAL_SECRET;
  if (s && s.trim()) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("INTERNAL_SECRET ausente: a área do raio-X não pode assinar a sessão");
  }
  return "dev-fallback-raio-x";
}

function mac(rotulo: string, valor: string): Buffer {
  return createHmac("sha256", segredo()).update(`raio-x:${rotulo}:v1:${valor}`).digest();
}

// ─── O código de 6 números ──────────────────────────────────────────────────

/** "048213": seis números ao acaso, com o zero à esquerda. */
export function gerarCodigoDeAcesso(): string {
  return String(randomInt(0, 10 ** DIGITOS_DO_CODIGO)).padStart(DIGITOS_DO_CODIGO, "0");
}

/** Só os números do que a pessoa digitou ("482 913" vale), ou `null`. */
export function normalizarCodigoDeAcesso(bruto: unknown): string | null {
  if (typeof bruto !== "string" && typeof bruto !== "number") return null;
  const s = String(bruto).replace(/[\s.-]/g, "");
  return new RegExp(`^\\d{${DIGITOS_DO_CODIGO}}$`).test(s) ? s : null;
}

/** O hash do código, amarrado à conta: o mesmo código em outra conta tem outro hash. */
export function hashDoCodigoDeAcesso(contaId: string, codigo: string): string {
  return mac("acesso", `${contaId}:${codigo}`).toString("hex");
}

/** Compara o hash guardado com o do que foi digitado, em tempo constante. */
export function codigoConfere(hashGuardado: string, contaId: string, codigo: string): boolean {
  const a = Buffer.from(hashGuardado, "hex");
  const b = Buffer.from(hashDoCodigoDeAcesso(contaId, codigo), "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

// ─── O cookie da sessão ─────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** O valor do cookie: a conta e a validade, assinadas. */
export function assinarSessao(contaId: string, agora: Date = new Date()): { valor: string; expiraEm: Date } {
  const expiraEm = new Date(agora.getTime() + DIAS_DA_SESSAO * 86_400_000);
  const exp = Math.floor(expiraEm.getTime() / 1000);
  const corpo = `v1.${contaId}.${exp}`;
  return { valor: `${corpo}.${mac("sessao", corpo).toString("hex")}`, expiraEm };
}

/** A conta da sessão, ou `null` (sem cookie, adulterado, de outra versão ou vencido). */
export function lerSessao(bruto: string | null | undefined, agora: Date = new Date()): string | null {
  if (!bruto || bruto.length > 200) return null;
  const partes = bruto.split(".");
  if (partes.length !== 4 || partes[0] !== "v1") return null;
  const [versao, contaId, exp, assinatura] = partes as [string, string, string, string];
  if (!UUID.test(contaId) || !/^\d{1,12}$/.test(exp) || !/^[0-9a-f]{64}$/.test(assinatura)) return null;
  const esperado = mac("sessao", `${versao}.${contaId}.${exp}`);
  const recebido = Buffer.from(assinatura, "hex");
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return null;
  if (Number(exp) * 1000 <= agora.getTime()) return null;
  return contaId;
}

/** As opções do cookie: só o servidor lê, só por HTTPS, e não vai em pedido de outro site. */
export function opcoesDoCookie(expiraEm: Date) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    expires: expiraEm,
  };
}

/** Apagar a sessão: o mesmo cookie, vazio e vencido. */
export function opcoesDoCookieApagado() {
  return { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 0 };
}

// ─── A origem dos POST da área ──────────────────────────────────────────────

/** A origem do próprio app (`NEXT_PUBLIC_APP_URL`). */
export function origemDoApp(): string | null {
  const base = env.NEXT_PUBLIC_APP_URL;
  return base && URL.canParse(base) ? new URL(base).origin : null;
}

/**
 * O POST veio de uma página do próprio app? Confere o `Origin` e, sem ele, o
 * `Referer`. Sem nenhum dos dois, recusa: o navegador manda o `Origin` em todo
 * POST de formulário e de `fetch`.
 */
export function veioDoProprioApp(headers: Headers, origem: string | null = origemDoApp()): boolean {
  if (!origem) return false;
  const declarada = headers.get("origin");
  if (declarada) return declarada === origem;
  const referer = headers.get("referer");
  if (referer && URL.canParse(referer)) return new URL(referer).origin === origem;
  return false;
}
