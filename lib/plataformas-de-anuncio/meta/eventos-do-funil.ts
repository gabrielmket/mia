/**
 * FORK MIA — o transporte dos EVENTOS DO FUNIL para a Meta: os eventos de etapa
 * e a venda do lead que veio de formulário.
 *
 * ── Por que ao lado de `conversions.ts`, e não dentro ───────────────────────
 *
 * `conversions.ts` é do upstream e só sabe mandar a COMPRA de quem veio de
 * clique em anúncio para o WhatsApp ("Este transporte aceita apenas compras com
 * valor"). Abrir aquele `enviar` para mais eventos e mais uma identidade seria
 * reescrever o miolo dele, e a próxima mudança do upstream no arquivo viraria
 * conflito (docs/FORK-MIA.md, regra 1). Este arquivo mora ao lado, na MESMA
 * fronteira (`lib/plataformas-de-anuncio/`, a única que pode escrever o formato
 * do fio), e reusa dele o que é regra da plataforma e não pode divergir: o hash,
 * o teto de 7 dias e a classificação do 4xx (`INTERNOS`).
 *
 * ── As duas portas da Meta, conferidas na documentação em 01/10/2026 ────────
 *
 * 1. CLIQUE EM ANÚNCIO PARA O WHATSAPP → API de conversões para mensagens de
 *    negócio. `action_source: business_messaging`, `messaging_channel:
 *    whatsapp`, identidade pelo `ctwa_clid` (o telefone com hash só reforça).
 *    A lista de eventos dessa porta é fechada (ver `lib/conversoes-meta/eventos.ts`).
 *    Só a compra exige valor e moeda; evento de etapa pode ir sem `custom_data`.
 *
 * 2. LEAD DE FORMULÁRIO → API de conversões para CRM. `action_source:
 *    system_generated`, `custom_data.event_source: crm`,
 *    `custom_data.lead_event_source: <nome do CRM>`, identidade pelo `lead_id`
 *    (o `leadgen_id` do formulário, 15 a 17 dígitos, SEM hash). O nome do evento
 *    é texto livre: a etapa do CRM.
 *
 * Nas duas: `event_time` em SEGUNDOS, no máximo 7 dias atrás (mais velho que
 * isso a Meta recusa a requisição inteira); `event_id` estável para a
 * deduplicação; `test_event_code` no corpo marca o envio como teste.
 *
 * ── O `lead_id` vai como TEXTO ──────────────────────────────────────────────
 *
 * O id tem até 17 dígitos e passa de 2^53: como número do JavaScript ele perde
 * os últimos dígitos e a Meta receberia o id de outro lead. Texto preserva.
 */
import { logger } from "@/lib/logger";

import { INTERNOS } from "./conversions";
import { baseDaGraphDeAnuncio } from "./graph-base";
import type { CredencialDeConversao, ResultadoDeEnvio } from "../types";

const TEMPO_LIMITE_MS = 10_000;

/** Como a Meta reconhece de quem é o evento. */
export type IdentidadeNaMeta =
  | { tipo: "clique_no_whatsapp"; clique: string }
  | { tipo: "lead_de_formulario"; idDoLead: string };

export interface EventoDoFunilParaAMeta {
  leadId: string;
  /** O `event_name`: vem de `lib/conversoes-meta/eventos.ts`, nunca escrito à mão. */
  nomeTecnico: string;
  /** Deduplicação, determinística: `<leadId>:<evento no livro-razão>`. */
  eventoId: string;
  /** QUANDO o negócio entrou na etapa (ou fechou), nunca quando o worker acordou. */
  ocorridoEm: Date;
  identidade: IdentidadeNaMeta;
  /** E.164 sem `+`, em claro: o hash é daqui para dentro. */
  telefone: string | null;
  /** Em claro: o hash é daqui para dentro. */
  email: string | null;
  /** `null` = o evento sai sem valor. Zero nunca chega aqui. */
  valorCentavos: number | null;
  moeda: string;
  /** O nome do CRM que a Meta mostra como origem dos eventos de lead. */
  nomeDoCrm: string;
}

/** O id de um lead de formulário, do jeito que a Meta o emite. */
export function ehIdDeLeadDaMeta(valor: unknown): valor is string {
  return typeof valor === "string" && /^\d{15,17}$/.test(valor.trim());
}

/** O corpo da requisição. Exportado para o teste conferir o fio sem falar com a rede. */
export function corpoDoEvento(
  evento: EventoDoFunilParaAMeta,
  codigoDeTeste: string | null,
): Record<string, unknown> {
  const userData: Record<string, unknown> = {};
  if (evento.telefone) userData.ph = [INTERNOS.hash(evento.telefone)];
  if (evento.email) userData.em = [INTERNOS.hash(evento.email)];

  const customData: Record<string, unknown> = {};
  if (evento.valorCentavos !== null) {
    customData.value = evento.valorCentavos / 100;
    customData.currency = evento.moeda.toUpperCase();
  }

  const item: Record<string, unknown> = {
    event_name: evento.nomeTecnico,
    // Segundos, não milissegundos (em ms o evento cai milhares de anos no futuro).
    event_time: Math.floor(evento.ocorridoEm.getTime() / 1000),
    event_id: evento.eventoId,
  };

  if (evento.identidade.tipo === "clique_no_whatsapp") {
    userData.ctwa_clid = evento.identidade.clique;
    item.action_source = "business_messaging";
    item.messaging_channel = "whatsapp";
  } else {
    userData.lead_id = evento.identidade.idDoLead;
    item.action_source = "system_generated";
    customData.event_source = "crm";
    customData.lead_event_source = evento.nomeDoCrm;
  }

  item.user_data = userData;
  if (Object.keys(customData).length > 0) item.custom_data = customData;

  const corpo: Record<string, unknown> = { data: [item] };
  if (codigoDeTeste) corpo.test_event_code = codigoDeTeste;
  return corpo;
}

/**
 * Envia UM evento do funil. O desfecho usa o vocabulário do eixo
 * (`ResultadoDeEnvio`): `ok`, `transitorio` (o consumidor reagenda) ou
 * `permanente` (vira "recusado pela plataforma" no histórico, com o motivo).
 */
export async function enviarEventoDoFunil(
  credencial: Pick<CredencialDeConversao, "datasetId" | "accessToken" | "testEventCode">,
  evento: EventoDoFunilParaAMeta,
): Promise<ResultadoDeEnvio> {
  const idadeMs = Date.now() - evento.ocorridoEm.getTime();
  if (idadeMs > INTERNOS.IDADE_MAXIMA_MS) {
    const dias = Math.floor(idadeMs / (24 * 60 * 60 * 1000));
    return {
      tipo: "permanente",
      detalhe:
        `evento com ${dias} dias: a plataforma recusa acima de 7. ` +
        `Aconteceu em ${evento.ocorridoEm.toISOString()} e não pode mais ser informado.`,
    };
  }
  if (evento.identidade.tipo === "lead_de_formulario" && !ehIdDeLeadDaMeta(evento.identidade.idDoLead)) {
    return { tipo: "permanente", detalhe: "o identificador do lead do formulário não tem o formato da plataforma." };
  }

  const url = `${baseDaGraphDeAnuncio()}/${encodeURIComponent(credencial.datasetId)}/events`;

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // No cabeçalho, nunca na URL: token em URL vai para log de proxy.
        authorization: `Bearer ${credencial.accessToken}`,
      },
      body: JSON.stringify(corpoDoEvento(evento, credencial.testEventCode)),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (erro) {
    return { tipo: "transitorio", detalhe: erro instanceof Error ? erro.message : "falha de rede" };
  }

  if (resposta.ok) {
    const corpo: unknown = await resposta.json().catch(() => null);
    if (corpo && typeof corpo === "object" && "events_received" in corpo && corpo.events_received === 1) {
      return { tipo: "ok" };
    }
    return { tipo: "transitorio", detalhe: "A plataforma não confirmou o recebimento do evento." };
  }

  const texto = await resposta.text().catch(() => "");
  let codigo: number | null = null;
  let mensagem = texto.slice(0, 400);
  try {
    const json = JSON.parse(texto) as {
      error?: { code?: number; message?: string; error_user_msg?: string };
    };
    if (typeof json.error?.code === "number") codigo = json.error.code;
    // A frase escrita para gente (`error_user_msg`) diz mais que o "Invalid parameter".
    const frase = json.error?.error_user_msg ?? json.error?.message;
    if (frase) mensagem = frase.slice(0, 400);
  } catch {
    // Corpo que não é JSON num erro é gateway no meio. Fica o texto cru.
  }

  logger.warn("[conversoes.meta] evento do funil recusado", {
    status: resposta.status,
    codigo,
    leadId: evento.leadId,
    evento: evento.nomeTecnico,
  });

  if (resposta.status === 429 || resposta.status >= 500) {
    return { tipo: "transitorio", detalhe: `${resposta.status}: ${mensagem}` };
  }
  return INTERNOS.classifica4xx(codigo, mensagem);
}
