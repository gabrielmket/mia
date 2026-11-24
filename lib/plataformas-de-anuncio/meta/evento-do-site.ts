/**
 * FORK MIA (MIA-169) — o EVENTO DE SITE na Meta (docs/fork/conversoes-da-meta.md,
 * seção "Conversões do site").
 *
 * O ramo do transporte (`./conversions.ts` delega para cá quando a conversão traz
 * `site`). O transporte do upstream manda `business_messaging` ou
 * `system_generated`, e escolheu de propósito não usar `website`: a venda dele é
 * registrada no CRM depois, e não aconteceu no navegador. O cadastro da MIA
 * aconteceu: a pessoa preencheu o /signup, e o navegador dela (IP, agente,
 * página, `fbp`/`fbc` com o aviso de cookies aceito) foi guardado na hora pela
 * parte A (`mia_cadastro_na_time`). É isso que este arquivo leva à Meta.
 *
 * As regras do fio:
 *  - `action_source: "website"` exige `event_source_url` e `client_user_agent`.
 *    Sem navegador ou sem página guardados (o prazo de guarda passou, ou o
 *    cadastro foi pelo Google), ou sem o consentimento `medicao`, sai
 *    `system_generated`, como o upstream, e nunca com navegador inventado;
 *  - IP e agente só com o consentimento `medicao`, como `fbp` e `fbc`: a parte A
 *    guarda os dois também com `necessario`, mas a medição não os usa;
 *  - `em`, `ph`, `fn`, `ln` e `external_id` vão em SHA-256 do valor normalizado
 *    (minúsculo; telefone só dígitos). IP, agente, `fbp` e `fbc` vão em claro,
 *    como a Meta pede;
 *  - `fbp` e `fbc` só com o consentimento `medicao` (conferido aqui de novo);
 *  - `Purchase` e `Subscribe` levam `value`, `currency` e `order_id`; os outros
 *    dois não levam valor;
 *  - `event_id` é o do livro-razão (`<negócio>:<chave da regra>`), único por evento;
 *  - o teto de 7 dias da Meta vale igual;
 *  - o endereço da Graph vem de `graph-base.ts`, o arquivo de sempre.
 */
import { createHash } from "node:crypto";

import { logger } from "@/lib/logger";

import { baseDaGraphDeAnuncio } from "./graph-base";
import type { ConversaoOffline, CredencialDeConversao, ResultadoDeEnvio } from "../types";

/** Os 4 eventos de site (o CHECK da 9170 repete a lista). */
export const EVENTOS_DE_SITE_DA_META = ["CompleteRegistration", "StartTrial", "Subscribe", "Purchase"] as const;
export type EventoDeSiteDaMeta = (typeof EVENTOS_DE_SITE_DA_META)[number];

/** Os que levam valor, moeda e o id do pedido. */
export const EVENTOS_DE_SITE_COM_VALOR: readonly EventoDeSiteDaMeta[] = ["Purchase", "Subscribe"];

export function ehEventoDeSiteDaMeta(v: unknown): v is EventoDeSiteDaMeta {
  return typeof v === "string" && (EVENTOS_DE_SITE_DA_META as readonly string[]).includes(v);
}

const IDADE_MAXIMA_MS = 7 * 24 * 60 * 60 * 1000;
const TEMPO_LIMITE_MS = 10_000;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Minúsculo, sem espaço nas pontas. */
const normal = (v: string) => v.trim().toLowerCase();

/** Nome para `fn`/`ln`: minúsculo, sem pontuação (a acentuação fica, em UTF-8). */
function partesDoNome(nome: string | null): { fn: string | null; ln: string | null } {
  const partes = normal(nome ?? "")
    .replace(/[^\p{L}\p{M}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  if (partes.length === 0) return { fn: null, ln: null };
  return { fn: partes[0]!, ln: partes.length > 1 ? partes[partes.length - 1]! : null };
}

/** `inet` do Postgres pode vir com a máscara de host. */
function ipLimpo(ip: string | null): string | null {
  const v = (ip ?? "").trim().replace(/\/(32|128)$/, "");
  return v === "" ? null : v;
}

export type CorpoDoEventoDoSite =
  | { ok: true; corpo: Record<string, unknown>; origem: "website" | "system_generated" }
  | { ok: false; detalhe: string };

/** O corpo do envio, sem rede. Exportado para o teste ler o fio. */
export function corpoDoEventoDoSite(
  conversao: ConversaoOffline,
  testEventCode: string | null,
  agora: number = Date.now(),
): CorpoDoEventoDoSite {
  const site = conversao.site;
  const nome = conversao.eventoNaPlataforma?.trim();
  if (!site || !ehEventoDeSiteDaMeta(nome)) {
    return { ok: false, detalhe: `Evento de site fora da lista: ${nome ?? "(vazio)"}.` };
  }
  const comValor = EVENTOS_DE_SITE_COM_VALOR.includes(nome);
  if (comValor && (conversao.valorCentavos === null || conversao.valorCentavos <= 0)) {
    return { ok: false, detalhe: `${nome} exige o valor do pagamento.` };
  }
  const idadeMs = agora - conversao.ocorridoEm.getTime();
  if (idadeMs > IDADE_MAXIMA_MS) {
    const dias = Math.floor(idadeMs / (24 * 60 * 60 * 1000));
    return {
      ok: false,
      detalhe: `evento com ${dias} dias — a plataforma recusa acima de 7. Aconteceu em ${conversao.ocorridoEm.toISOString()}.`,
    };
  }

  const userData: Record<string, unknown> = {};
  const email = normal(site.email ?? "");
  if (email) userData.em = [sha256(email)];
  const telefone = (conversao.telefone ?? "").replace(/\D/g, "");
  if (telefone) userData.ph = [sha256(telefone)];
  const { fn, ln } = partesDoNome(site.nome);
  if (fn) userData.fn = [sha256(fn)];
  if (ln) userData.ln = [sha256(ln)];
  const idExterno = normal(site.idExterno ?? "");
  if (idExterno) userData.external_id = [sha256(idExterno)];
  if (Object.keys(userData).length === 0) {
    return { ok: false, detalhe: "Sem e-mail, telefone nem id da empresa, a Meta não tem como reconhecer a pessoa." };
  }

  // Tudo o que é do navegador (IP, agente, `fbp`, `fbc`) só sai com o aviso de
  // cookies aceito (`medicao`). A parte A guarda IP e agente mesmo com
  // `necessario`, mas a medição não os usa: sem `medicao`, o evento sai
  // `system_generated`, só com os hashes.
  const comMedicao = site.consentimento === "medicao";
  const navegador = (site.navegador ?? "").trim();
  const pagina = (site.pagina ?? "").trim();
  const doNavegador = comMedicao && navegador !== "" && pagina !== "";
  if (doNavegador) {
    const ip = ipLimpo(site.ip);
    if (ip) userData.client_ip_address = ip;
    userData.client_user_agent = navegador;
  }
  if (comMedicao) {
    if (site.fbp?.trim()) userData.fbp = site.fbp.trim();
    if (site.fbc?.trim()) userData.fbc = site.fbc.trim();
  }

  const customData: Record<string, unknown> = {};
  if (comValor) {
    customData.value = (conversao.valorCentavos as number) / 100;
    customData.currency = (conversao.moeda || "BRL").toUpperCase();
    if (site.pedidoId?.trim()) customData.order_id = site.pedidoId.trim();
  }

  const corpo: Record<string, unknown> = {
    data: [
      {
        event_name: nome,
        event_time: Math.floor(conversao.ocorridoEm.getTime() / 1000),
        event_id: conversao.eventoId,
        action_source: doNavegador ? "website" : "system_generated",
        ...(doNavegador ? { event_source_url: pagina } : {}),
        user_data: userData,
        ...(Object.keys(customData).length > 0 ? { custom_data: customData } : {}),
      },
    ],
  };
  if (testEventCode) corpo.test_event_code = testEventCode;
  return { ok: true, corpo, origem: doNavegador ? "website" : "system_generated" };
}

/** O envio. Mesma classificação de falha do transporte do upstream. */
export async function enviarEventoDoSite(
  credencial: CredencialDeConversao,
  conversao: ConversaoOffline,
): Promise<ResultadoDeEnvio> {
  const montado = corpoDoEventoDoSite(conversao, credencial.testEventCode);
  if (!montado.ok) return { tipo: "permanente", detalhe: montado.detalhe };

  let resposta: Response;
  try {
    resposta = await fetch(`${baseDaGraphDeAnuncio()}/${encodeURIComponent(credencial.datasetId)}/events`, {
      method: "POST",
      // O token no cabeçalho, nunca na URL (log de proxy).
      headers: { "content-type": "application/json", authorization: `Bearer ${credencial.accessToken}` },
      body: JSON.stringify(montado.corpo),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (erro) {
    return { tipo: "transitorio", detalhe: erro instanceof Error ? erro.message : "falha de rede" };
  }

  if (resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as { events_received?: unknown } | null;
    if (corpo && corpo.events_received === 1) return { tipo: "ok" };
    return { tipo: "transitorio", detalhe: "A plataforma não confirmou o recebimento do evento." };
  }

  const texto = await resposta.text().catch(() => "");
  let codigo: number | null = null;
  let mensagem = texto.slice(0, 400);
  try {
    const json = JSON.parse(texto) as {
      error?: { code?: number; message?: string; error_user_title?: string; error_user_msg?: string };
    };
    if (typeof json.error?.code === "number") codigo = json.error.code;
    if (json.error?.message) mensagem = json.error.message;
    const extra = [json.error?.error_user_title?.trim(), json.error?.error_user_msg?.trim()].filter(Boolean);
    if (extra.length > 0) mensagem = [mensagem, ...extra].join(" — ").slice(0, 400);
  } catch {
    // Corpo que não é JSON (gateway no meio): fica o texto cru.
  }

  logger.warn("[conversoes.site.meta] envio recusado", {
    status: resposta.status,
    codigo,
    leadId: conversao.leadId,
  });

  if (resposta.status === 429 || resposta.status >= 500) {
    return { tipo: "transitorio", detalhe: `${resposta.status}: ${mensagem}` };
  }
  if (codigo === 613 || codigo === 80004) {
    return { tipo: "transitorio", detalhe: `limite de chamadas (${codigo}): ${mensagem}` };
  }
  return { tipo: "permanente", detalhe: mensagem };
}
