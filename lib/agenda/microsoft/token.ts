/**
 * As duas chamadas de rede do token da Microsoft: trocar o código e renovar.
 *
 * Nenhuma lança (a rota precisa redirecionar com motivo legível, e a rotina de
 * renovação não pode parar no primeiro timeout). Nenhuma grava nem funde: quem
 * chama passa por `fundirTokens` antes de persistir.
 *
 * A leitura da resposta é a do Google (`lerRespostaDeToken`): o formato do
 * endpoint de token é o do OAuth 2.0 nos dois (`access_token`, `refresh_token`,
 * `expires_in` relativo, `scope` separado por espaço, `error`/`error_description`).
 */

import { lerRespostaDeToken, type LeituraDeToken } from "@/lib/agenda/google/oauth";

import { ESCOPOS_DA_MICROSOFT, codigoDoEntra, enderecoDeToken } from "./oauth";

const PRAZO_MS = 10_000;

export type LeituraDeTokenMicrosoft = LeituraDeToken & {
  /** O `id_token` cru da troca do código (só nela). */
  idToken?: string | null;
  /** `error` do Entra, quando houve. */
  erro?: string | null;
  /** `AADSTSnnnnn` da descrição, quando houve. Nunca a descrição inteira. */
  codigoDoEntra?: string | null;
};

async function pedirToken(tenant: string, corpo: URLSearchParams, agora: Date): Promise<LeituraDeTokenMicrosoft> {
  let resposta: Response;
  try {
    resposta = await fetch(enderecoDeToken(tenant), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: corpo.toString(),
      signal: AbortSignal.timeout(PRAZO_MS),
      cache: "no-store",
    });
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    return { ok: false, motivo: "resposta_invalida", detalhe: `sem resposta da Microsoft: ${motivo}`, erro: null };
  }

  let bruto: unknown;
  try {
    bruto = await resposta.json();
  } catch {
    return { ok: false, motivo: "resposta_invalida", detalhe: `HTTP ${resposta.status} com corpo ilegível`, erro: null };
  }

  const corpoLido = typeof bruto === "object" && bruto !== null ? (bruto as Record<string, unknown>) : {};
  const erro = typeof corpoLido.error === "string" ? corpoLido.error : null;
  const codigo = codigoDoEntra(typeof corpoLido.error_description === "string" ? corpoLido.error_description : null);
  const leitura = lerRespostaDeToken(
    // A descrição do Entra carrega texto livre: só o erro e o código seguem.
    erro ? { error: codigo ? `${erro} ${codigo}` : erro } : bruto,
    { agora },
  );
  return {
    ...leitura,
    idToken: typeof corpoLido.id_token === "string" ? corpoLido.id_token : null,
    erro,
    codigoDoEntra: codigo,
  };
}

export async function trocarCodigoPorTokenMicrosoft(
  app: { clientId: string; clientSecret: string; tenant: string },
  opcoes: { code: string; redirectUri: string; verificador: string; agora: Date },
): Promise<LeituraDeTokenMicrosoft> {
  return pedirToken(
    app.tenant,
    new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: "authorization_code",
      code: opcoes.code,
      // O MESMO endereço da ida, byte a byte.
      redirect_uri: opcoes.redirectUri,
      code_verifier: opcoes.verificador,
      scope: ESCOPOS_DA_MICROSOFT.join(" "),
    }),
    opcoes.agora,
  );
}

/** ⚠️ A resposta traz um `refresh_token` NOVO: grave-o (via `fundirTokens`). */
export async function renovarTokenMicrosoft(
  app: { clientId: string; clientSecret: string; tenant: string },
  refreshToken: string,
  opcoes: { agora: Date },
): Promise<LeituraDeTokenMicrosoft> {
  return pedirToken(
    app.tenant,
    new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: ESCOPOS_DA_MICROSOFT.join(" "),
    }),
    opcoes.agora,
  );
}
