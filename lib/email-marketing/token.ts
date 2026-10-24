/**
 * FORK MIA (.89) — o TOKEN dos links que vivem fora da sessão: descadastro de um
 * clique, página de preferências, link de passagem do clique e pixel de abertura.
 *
 * Mesmo formato de `lib/auth/invite-token.ts` e do token das cadências do PR
 * #1738 do upstream (HMAC-SHA256, `timingSafeEqual`, `<corpo>.<assinatura>` em
 * base64url): sem linha no banco para existir, e o segredo no mesmo degrau
 * (`EMAIL_MARKETING_TOKEN_SECRET` → `INTERNAL_SECRET` → "dev-fallback"), para não
 * crescer o `.env` de quem já tem um dos dois. Quando o #1738 entrar, o
 * descadastro e a supressão passam a ser os mesmos para os dois.
 *
 * Sem validade: o link precisa valer enquanto o e-mail existir na caixa da
 * pessoa, que pode ser anos.
 *
 * O corpo é CURTO de propósito (chaves de uma letra): o link do clique vai em
 * cada botão do e-mail, e o Gmail corta e-mail grande.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

const SEGREDO = (): string =>
  process.env.EMAIL_MARKETING_TOKEN_SECRET || process.env.INTERNAL_SECRET || "dev-fallback";

/**
 * `d` = um destinatário de campanha (descadastro, preferências, abertura).
 * `c` = um clique: destinatário + link.
 * `t` = um e-mail de TESTE: os links abrem, mostram a página e não mudam nada.
 */
export type TipoDoToken = "d" | "c" | "t";

export interface ConteudoDoToken {
  k: TipoDoToken;
  /** A empresa. */
  o: string;
  /** O destinatário (`d`, `c`) ou a campanha (`t`). */
  r: string;
  /** O link (`c`). */
  l?: string;
}

const UUID = z.string().uuid();
const esquema = z
  .object({ k: z.enum(["d", "c", "t"]), o: UUID, r: UUID, l: UUID.optional() })
  .strict()
  .refine((c) => (c.k === "c") === !!c.l, { message: "o link é só do clique" });

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function assinarToken(conteudo: ConteudoDoToken): string {
  const corpo = b64url(Buffer.from(JSON.stringify(conteudo), "utf8"));
  const assinatura = b64url(createHmac("sha256", SEGREDO()).update(corpo).digest());
  return `${corpo}.${assinatura}`;
}

export function verificarToken(token: string | null | undefined): ConteudoDoToken | null {
  if (!token || token.length > 600) return null;
  const partes = token.split(".");
  if (partes.length !== 2) return null;
  const [corpo, assinatura] = partes;
  if (!corpo || !assinatura) return null;
  const esperada = b64url(createHmac("sha256", SEGREDO()).update(corpo).digest());
  if (assinatura.length !== esperada.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada))) return null;
  } catch {
    return null;
  }
  try {
    const r = esquema.safeParse(JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")));
    return r.success ? (r.data as ConteudoDoToken) : null;
  } catch {
    return null;
  }
}

/** O formato do token na URL (`lib/auth/public-paths.ts` âncora por ele). */
export const FORMA_DO_TOKEN = "[A-Za-z0-9_-]{20,400}\\.[A-Za-z0-9_-]{43}";

/** Os endereços públicos, a partir da origem do sistema. */
export function linksDoDestinatario(
  origem: string,
  conteudo: Omit<ConteudoDoToken, "k" | "l"> & { teste?: boolean },
) {
  const base = origem.replace(/\/+$/, "");
  const k: TipoDoToken = conteudo.teste ? "t" : "d";
  const token = assinarToken({ k, o: conteudo.o, r: conteudo.r });
  return {
    token,
    descadastroDeUmClique: `${base}/api/v1/webhooks/email-marketing/descadastro/${token}`,
    preferencias: `${base}/preferencias/${token}`,
    descadastroPelaPagina: `${base}/preferencias/${token}?sair=1`,
    privacidadePadrao: `${base}/preferencias/${token}?aba=privacidade`,
    abertura: `${base}/api/v1/webhooks/email-marketing/abertura/${token}`,
  };
}

/**
 * O link de passagem medido de um botão. No e-mail de TESTE o botão leva direto
 * ao destino: os links da campanha só são congelados na confirmação, e não há
 * destinatário para medir.
 */
export function linkDoClique(
  origem: string,
  conteudo: { o: string; r: string; l: string },
): string {
  const base = origem.replace(/\/+$/, "");
  return `${base}/api/v1/webhooks/email-marketing/clique/${assinarToken({ k: "c", o: conteudo.o, r: conteudo.r, l: conteudo.l })}`;
}
