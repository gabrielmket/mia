/**
 * FORK MIA (.65) — A VOLTA DO GOOGLE CAI NO MESMO DOMÍNIO EM QUE A PESSOA CLICOU.
 *
 * ─── O defeito ─────────────────────────────────────────────────────────────
 *
 * A instalação da MIA responde por mais de um domínio (crm.timecompany.com.br
 * e app.iamia.com.br, o mesmo app). A ida do OAuth (`signInWithGoogle`) grava o
 * verificador de PKCE num cookie do domínio EM QUE A PESSOA ESTÁ, e mandava o
 * GoTrue devolver sempre para `NEXT_PUBLIC_APP_URL`. Quem clicava em
 * "Entrar com Google" no outro domínio voltava para um `/auth/callback` sem o
 * cookie: a troca do `code` falhava ("PKCE code verifier not found") e a tela
 * dizia que a entrada com Google não deu certo.
 *
 * ─── A regra ───────────────────────────────────────────────────────────────
 *
 * O retorno usa o `Origin` do pedido, que o NAVEGADOR escreve (a action é um
 * POST, e o Next confere o Origin contra o Host antes de rodar a action). Não é
 * o `Host`, que pode chegar com o bind interno do contêiner (o motivo de
 * `entrada-com-google.ts` e do `/auth/callback` usarem `NEXT_PUBLIC_APP_URL`).
 * É o mesmo critério que `signUp.ts` e `requestPasswordReset.ts` do upstream já
 * usam para o link do e-mail: `origin ?? NEXT_PUBLIC_APP_URL`.
 *
 * Quem decide se o domínio vale é o GoTrue: `redirect_to` fora da lista
 * `ADDITIONAL_REDIRECT_URLS` é ignorado e a volta cai no `SITE_URL`. Por isso
 * cada domínio público do app tem de estar lá (infra/supabase-sistema-mia/GOOGLE.md).
 *
 * Sem `Origin`, ou com um que não é http(s) (o `null` de contexto opaco), vale o
 * de sempre: `NEXT_PUBLIC_APP_URL`.
 */
export function origemDoRetornoDoGoogle(
  origin: string | null | undefined,
  appUrl: string,
): string {
  if (!origin) return appUrl;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return appUrl;
    return url.origin;
  } catch {
    return appUrl;
  }
}
