/**
 * O consentimento e o token da Microsoft (Entra), a parte pura.
 *
 * Sem rede, sem ambiente e sem relógio próprio, como `lib/agenda/google/oauth.ts`
 * do upstream. O que a Microsoft faz diferente do Google, e que muda código:
 *
 *  1. **PKCE.** Recomendado pela Microsoft também para cliente confidencial. O
 *     `code_verifier` é DERIVADO do nonce do `state` com o segredo do servidor
 *     (HMAC), então nada novo é guardado e a volta o recalcula. Fecha, do nosso
 *     lado, a dívida que o callback do Google declara ("o caminho real é PKCE").
 *  2. **O `refresh_token` vem sempre** que `offline_access` é pedido: não há a
 *     armadilha 1 do Google, e `prompt=consent` não é usado (pedir consentimento
 *     toda vez irrita e, em empresa que exige aprovação do TI, reabre o bloqueio).
 *  3. **A renovação devolve um `refresh_token` NOVO**, que substitui o velho. O
 *     contrário da armadilha 2 do Google; `fundirTokens` (reaproveitado) cobre
 *     as duas: fica o novo quando vem, o velho quando não vem.
 *  4. **Escopo com endereço.** A resposta traz `https://graph.microsoft.com/Calendars.ReadWrite`,
 *     e a conferência compara pelo nome curto, sem caixa.
 */

import { createHash, createHmac } from "node:crypto";

import type { TokenDoGoogle } from "@/lib/agenda/google/oauth";

import { enderecoDeAutorizacao, enderecoDeToken } from "./enderecos";

/**
 * Os escopos, e por que são estes quatro.
 *
 * - `Calendars.ReadWrite`: ler, criar, alterar e cancelar evento, e criar a
 *   reunião do Teams no próprio evento. `OnlineMeetings.ReadWrite` fica de fora:
 *   cria reunião avulsa, fora da agenda, e não existe para conta pessoal.
 * - `User.Read`: o id e o e-mail da conta, que são a chave da conexão.
 * - `offline_access`: sem ele não vem `refresh_token`, e a conexão morre em 1 h.
 * - `openid`: devolve o `id_token`, de onde sai o tenant (conta de trabalho ou
 *   pessoal). Não acrescenta linha nova na tela de consentimento.
 *
 * Nenhuma permissão de APLICATIVO: só delegadas, cada pessoa autoriza a dela.
 */
export const ESCOPOS_DA_MICROSOFT: readonly string[] = [
  "openid",
  "offline_access",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Calendars.ReadWrite",
];

/** Os que não podem faltar na resposta (o `openid` e o `offline_access` não voltam em `scope`). */
export const ESCOPOS_OBRIGATORIOS_DA_MICROSOFT: readonly string[] = ["user.read", "calendars.readwrite"];

/** O tenant das contas pessoais da Microsoft (outlook.com, hotmail, live). */
export const TENANT_DAS_CONTAS_PESSOAIS = "9188040d-6c67-4c5b-b112-36a304b66dad";

export const FOLGA_DE_RENOVACAO_MS = 5 * 60_000;

// Os endereços (com o número de versão no caminho) moram em `./enderecos`.
export { enderecoDeAutorizacao, enderecoDeToken };

/** O `code_verifier` do PKCE, derivado do nonce: 43 caracteres base64url. */
export function verificadorPkce(nonce: string, segredo: string): string {
  if (!nonce || !segredo) throw new Error("PKCE sem nonce ou sem segredo do servidor");
  return createHmac("sha256", segredo).update(`pkce-microsoft:${nonce}`, "utf8").digest("base64url");
}

export function desafioPkce(verificador: string): string {
  return createHash("sha256").update(verificador, "ascii").digest("base64url");
}

export function montarUrlDeConsentimentoMicrosoft(
  app: { clientId: string; tenant: string; redirectUri: string },
  opcoes: { state: string; verificador: string; contaSugerida?: string | null },
): string {
  const clientId = app.clientId?.trim();
  if (!clientId) throw new Error("MICROSOFT_CALENDAR_CLIENT_ID ausente: não há app para pedir consentimento");
  if (!app.redirectUri?.trim()) throw new Error("redirect_uri ausente");
  if (!opcoes.state?.trim()) throw new Error("state ausente: sem ele a volta não é verificável");

  const parametros = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: app.redirectUri,
    response_mode: "query",
    scope: ESCOPOS_DA_MICROSOFT.join(" "),
    state: opcoes.state,
    code_challenge: desafioPkce(opcoes.verificador),
    code_challenge_method: "S256",
    // O seletor de contas sempre aparece: quem tem a agenda de trabalho num
    // e-mail diferente do login do CRM precisa conseguir escolher.
    prompt: "select_account",
  });
  const conta = opcoes.contaSugerida?.trim();
  if (conta) parametros.set("login_hint", conta);
  return `${enderecoDeAutorizacao(app.tenant)}?${parametros.toString()}`;
}

/** O escopo curto e sem caixa: `https://graph.microsoft.com/Calendars.ReadWrite` → `calendars.readwrite`. */
export function escopoCurto(escopo: string): string {
  return escopo.trim().replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase();
}

/** Quais obrigatórios NÃO vieram. Confira DEPOIS de `fundirTokens` (a renovação pode vir sem `scope`). */
export function escoposFaltandoMicrosoft(concedidos: string[] | string | null | undefined): string[] {
  const lista =
    typeof concedidos === "string"
      ? concedidos.split(/\s+/)
      : Array.isArray(concedidos)
        ? concedidos
        : [];
  const tem = new Set(lista.filter((s) => typeof s === "string" && s.trim()).map(escopoCurto));
  return ESCOPOS_OBRIGATORIOS_DA_MICROSOFT.filter((e) => !tem.has(e));
}

export type TokenDaMicrosoft = TokenDoGoogle;

export interface IdentidadeDoIdToken {
  tenantId: string | null;
  oid: string | null;
  emailPreferido: string | null;
}

/**
 * Lê o `id_token` SEM validar assinatura, e é de propósito: ele chegou agora,
 * pela troca do código, do endereço de token da Microsoft sobre TLS, e só
 * serve para classificar a conta (tenant) e sugerir o e-mail. Nenhuma decisão
 * de acesso sai dele; a identidade da conexão vem do `/me` da Graph.
 */
export function lerIdToken(idToken: unknown): IdentidadeDoIdToken {
  const vazio = { tenantId: null, oid: null, emailPreferido: null };
  if (typeof idToken !== "string") return vazio;
  const partes = idToken.split(".");
  if (partes.length < 2 || !partes[1]) return vazio;
  try {
    const carga = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return {
      tenantId: texto(carga.tid),
      oid: texto(carga.oid),
      emailPreferido: texto(carga.preferred_username) ?? texto(carga.email),
    };
  } catch {
    return vazio;
  }
}

export function tipoDeConta(tenantId: string | null): "trabalho" | "pessoal" {
  return tenantId?.toLowerCase() === TENANT_DAS_CONTAS_PESSOAIS ? "pessoal" : "trabalho";
}

/**
 * O código de erro do Entra (`AADSTS65001`...) que interessa para decidir a tela.
 *
 * O Entra devolve `error` genérico e o motivo real em `error_description`, que
 * começa com `AADSTSnnnnn:`. Só o CÓDIGO sai daqui: a descrição carrega texto
 * livre (às vezes o e-mail), e o que se guarda e mostra é o código.
 */
export function codigoDoEntra(descricao: string | null | undefined): string | null {
  const m = /AADSTS(\d{5,7})/.exec(descricao ?? "");
  return m ? `AADSTS${m[1]}` : null;
}

/**
 * A empresa da pessoa exige que o TI aprove o app?
 *
 * É o erro raro (a política da empresa bloqueia o consentimento do funcionário)
 * e o único que pede ação de OUTRA pessoa. `AADSTS65001` (consentimento
 * pendente), `AADSTS90094` e `AADSTS90008` (aprovação do administrador) e
 * `consent_required` são as formas em que ele volta.
 */
export function empresaPrecisaAprovar(erro: string | null | undefined, descricao: string | null | undefined): boolean {
  const e = (erro ?? "").toLowerCase();
  if (e === "consent_required" || e === "admin_consent_required") return true;
  const codigo = codigoDoEntra(descricao);
  return codigo === "AADSTS65001" || codigo === "AADSTS90094" || codigo === "AADSTS90008" || codigo === "AADSTS900941";
}
