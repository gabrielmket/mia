/**
 * FORK MIA — quem pede, para a trava da IA (`lib/ai/trava-da-ia.ts`), numa rota
 * que aceita sessão OU token (`lib/api/auth-dual.ts`).
 *
 * A 1.70 do upstream passou as rotas de agente (`/api/v1/ai/agents`, versões)
 * de `requireRole` para `resolveAuthDual`: o token `dsk_` de papel admin cria e
 * altera agente pela API. A resposta de `resolveAuthDual` não traz o usuário,
 * e a trava precisa saber se quem pede é da plataforma.
 *
 *   · token: nunca é da plataforma. Um token é da EMPRESA (a linha dele diz a
 *     organização), e quem escolhe a IA do agente é a plataforma. A versão nova
 *     herda a IA atual do agente, como para o admin da empresa pela tela.
 *   · sessão: o usuário da sessão (`loadAuthUser`, memoizado na requisição).
 */
import type { AuthDual } from "@/lib/api/auth-dual";
import { loadAuthUser } from "@/lib/auth/server";
import type { AuthUser } from "@/lib/auth/types";

export type QuemPedeIa = Pick<AuthUser, "is_platform_admin" | "platform_admin_scope" | "support">;

/** O token nunca escolhe IA. */
export const TOKEN_NAO_ESCOLHE_IA: QuemPedeIa = {
  is_platform_admin: false,
  platform_admin_scope: null,
  support: null,
};

export async function quemPedeNaRota(authz: Extract<AuthDual, { ok: true }>): Promise<QuemPedeIa> {
  if (authz.via === "token") return TOKEN_NAO_ESCOLHE_IA;
  // Falha FECHADA: sem conseguir ler a sessão, quem pede é tratado como quem não
  // escolhe IA nem vê custo (a resposta mais restritiva), em vez de derrubar a
  // rota inteira com 500. A autorização em si já passou em `resolveAuthDual`.
  let usuario: Awaited<ReturnType<typeof loadAuthUser>>;
  try {
    usuario = await loadAuthUser();
  } catch {
    return TOKEN_NAO_ESCOLHE_IA;
  }
  if (!usuario) return TOKEN_NAO_ESCOLHE_IA;
  return {
    is_platform_admin: usuario.is_platform_admin,
    platform_admin_scope: usuario.platform_admin_scope,
    support: usuario.support,
  };
}
