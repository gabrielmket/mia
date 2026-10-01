/**
 * O app da Microsoft (Entra) desta INSTALAÇÃO, e o único lugar que monta os
 * endereços que a Microsoft exige registrados.
 *
 * Espelha `lib/agenda/google/config.ts` do upstream, com a mesma ordem: banco
 * primeiro (`mia_microsoft_oauth_da_plataforma`, tela `/admin/microsoft`), e o
 * `.env` como piso (`MICROSOFT_CALENDAR_CLIENT_ID` / `_SECRET` / `_TENANT`).
 * Sem nenhum dos dois, a agenda funciona inteira e só o cartão do Outlook
 * explica o que falta: `configuracaoDaMicrosoft()` devolve `null`, nunca lança.
 *
 * ─── O domínio da volta é o domínio em que a pessoa está ────────────────────
 *
 * A instalação da MIA responde por mais de um domínio (crm.timecompany.com.br e
 * app.iamia.com.br). O cookie de vínculo do consentimento fica no domínio da
 * tela; se a Microsoft devolvesse sempre para `NEXT_PUBLIC_APP_URL`, quem
 * conectasse pelo outro domínio voltaria sem o cookie e a conexão seria
 * recusada. Por isso a volta é montada a partir do domínio PÚBLICO do pedido.
 *
 * Isso não abre porta: a Microsoft só devolve para endereço registrado no app,
 * byte a byte. Um cabeçalho `Host` forjado produz uma URL que ela recusa. E o
 * endereço é o mesmo nas duas pontas (ida e troca do código) porque as duas o
 * derivam do mesmo domínio.
 */

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

/** O caminho da volta do consentimento. Tem de estar registrado no app da Microsoft. */
export const CAMINHO_DO_CALLBACK_MICROSOFT = "/api/v1/agenda/microsoft/callback";

/** Para onde a Graph manda as notificações de mudança (não precisa registrar). */
export const CAMINHO_DAS_NOTIFICACOES_MICROSOFT = "/api/v1/agenda/microsoft/notificacoes";

export const VARIAVEIS_DA_MICROSOFT = ["MICROSOFT_CALENDAR_CLIENT_ID", "MICROSOFT_CALENDAR_CLIENT_SECRET"] as const;

/** O tenant que aceita conta de trabalho e conta pessoal. */
export const TENANT_PADRAO = "common";

export interface AppDaMicrosoft {
  clientId: string;
  clientSecret: string;
  /** `common`, `organizations`, `consumers` ou o id de um tenant. */
  tenant: string;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function tenantValido(v: string): string {
  return /^[A-Za-z0-9._-]{1,100}$/.test(v) ? v : TENANT_PADRAO;
}

/** A origem canônica da instalação, sem barra no fim. */
export function origemCanonica(urlDaAplicacao: string = env.NEXT_PUBLIC_APP_URL): string {
  try {
    return new URL(texto(urlDaAplicacao)).origin;
  } catch {
    return texto(urlDaAplicacao).replace(/\/+$/, "");
  }
}

/**
 * A origem PÚBLICA do pedido, para a volta cair no domínio da tela.
 *
 * `x-forwarded-host` primeiro (o proxy escreve o domínio que o navegador pediu);
 * `host` depois. Host sem ponto (o bind interno do contêiner, `app:3000`) não é
 * domínio público: cai na origem canônica. Loopback vale, para quem desenvolve.
 */
export function origemPublicaDoPedido(cabecalhos: Pick<Headers, "get">): string {
  const bruto = (cabecalhos.get("x-forwarded-host") ?? cabecalhos.get("host") ?? "").split(",")[0]?.trim() ?? "";
  if (!bruto) return origemCanonica();
  const protoBruto = (cabecalhos.get("x-forwarded-proto") ?? "").split(",")[0]?.trim();
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(bruto);
  const protocolo = protoBruto === "http" || protoBruto === "https" ? protoBruto : loopback ? "http" : "https";
  try {
    const url = new URL(`${protocolo}://${bruto}`);
    const nome = url.hostname.toLowerCase();
    if (!loopback && !nome.includes(".")) return origemCanonica();
    return url.origin;
  } catch {
    return origemCanonica();
  }
}

/** O endereço de retorno para uma origem. Sem barra dupla e sem barra final. */
export function enderecoDeRetornoMicrosoft(origem: string = origemCanonica()): string {
  return `${origem.replace(/\/+$/, "")}${CAMINHO_DO_CALLBACK_MICROSOFT}`;
}

/** O endereço das notificações. Sempre o canônico: a Graph chama o servidor, não o navegador. */
export function enderecoDasNotificacoesMicrosoft(origem: string = origemCanonica()): string {
  return `${origem.replace(/\/+$/, "")}${CAMINHO_DAS_NOTIFICACOES_MICROSOFT}`;
}

/** O que o AMBIENTE traz. Puro e síncrono: é o piso quando o banco falha. */
export function configuracaoDoAmbienteMicrosoft(): AppDaMicrosoft | null {
  const clientId = texto(env.MICROSOFT_CALENDAR_CLIENT_ID);
  const clientSecret = texto(env.MICROSOFT_CALENDAR_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, tenant: tenantValido(texto(env.MICROSOFT_CALENDAR_TENANT) || TENANT_PADRAO) };
}

/** Memo de processo com TTL, no `globalThis` pelo mesmo motivo do irmão do Google. */
const TTL_MS = 30_000;

export interface LinhaDoAppMicrosoft {
  client_id: string | null;
  client_secret_encrypted: string | null;
  segredo_vence_em: string | null;
  tenant: string | null;
  updated_at?: string | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __memoDoAppDaMicrosoft: { readonly valor: LinhaDoAppMicrosoft | null; readonly expiraEm: number } | null | undefined;
}

/** Chamada por quem ESCREVE a credencial (a action do /admin). */
export function invalidarCredencialDaMicrosoft(): void {
  globalThis.__memoDoAppDaMicrosoft = null;
}

export async function linhaDoAppMicrosoft(): Promise<LinhaDoAppMicrosoft | null> {
  const memo = globalThis.__memoDoAppDaMicrosoft;
  if (memo && memo.expiraEm > Date.now()) return memo.valor;

  let valor: LinhaDoAppMicrosoft | null = null;
  try {
    const { data, error } = await createAdminClient()
      .from("mia_microsoft_oauth_da_plataforma")
      .select("client_id, client_secret_encrypted, segredo_vence_em, tenant, updated_at")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      logger.info("[agenda.microsoft.config] sem credencial no banco; vale o .env", { codigo: error.code });
    } else {
      valor = (data as LinhaDoAppMicrosoft | null) ?? null;
    }
  } catch (err) {
    // Nunca lança: é chamada no render da Agenda.
    logger.warn("[agenda.microsoft.config] leitura falhou; vale o .env", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  globalThis.__memoDoAppDaMicrosoft = { valor, expiraEm: Date.now() + TTL_MS };
  return valor;
}

/**
 * A configuração em vigor, ou `null` quando a instalação não tem o app.
 *
 * Banco primeiro, `.env` depois. Segredo do banco que não decifra NÃO se mistura
 * com o id do banco: cai inteiro para o ambiente, senão o par não existe em app
 * nenhum e o erro da Microsoft apontaria para o lugar errado.
 */
export async function configuracaoDaMicrosoft(): Promise<AppDaMicrosoft | null> {
  const linha = await linhaDoAppMicrosoft();
  const clientId = texto(linha?.client_id);
  const cifrado = texto(linha?.client_secret_encrypted);
  if (clientId && cifrado) {
    const segredo = await decryptWebhookSecret(createAdminClient(), cifrado);
    if (segredo) {
      return { clientId, clientSecret: segredo, tenant: tenantValido(texto(linha?.tenant) || TENANT_PADRAO) };
    }
    logger.warn("[agenda.microsoft.config] segredo do banco não decifrou; vale o .env inteiro");
  }
  return configuracaoDoAmbienteMicrosoft();
}

export async function microsoftEstaConfigurada(): Promise<boolean> {
  return (await configuracaoDaMicrosoft()) !== null;
}

/** O que falta, pelo nome. Só quando as DUAS fontes estão vazias. */
export async function faltaParaConectarAMicrosoft(): Promise<string[]> {
  if (await configuracaoDaMicrosoft()) return [];
  const faltando: string[] = [];
  if (!texto(env.MICROSOFT_CALENDAR_CLIENT_ID)) faltando.push("MICROSOFT_CALENDAR_CLIENT_ID");
  if (!texto(env.MICROSOFT_CALENDAR_CLIENT_SECRET)) faltando.push("MICROSOFT_CALENDAR_CLIENT_SECRET");
  return faltando;
}

/**
 * O link que o TI de uma empresa abre para aprovar o app uma vez.
 *
 * `organizations`: o administrador entra com a conta dele, e a Microsoft usa o
 * tenant dele. Depois disso cada funcionário conecta sozinho.
 */
export function linkDeAprovacaoDoTi(clientId: string, origem: string = origemCanonica()): string {
  const parametros = new URLSearchParams({
    client_id: clientId,
    scope: "https://graph.microsoft.com/.default",
    redirect_uri: enderecoDeRetornoMicrosoft(origem),
    state: "aprovacao_do_ti",
  });
  return `https://login.microsoftonline.com/organizations/v2.0/adminconsent?${parametros.toString()}`;
}
