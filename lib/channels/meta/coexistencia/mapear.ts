/**
 * FORK MIA · coexistência (S2): da mensagem do histórico da Meta à linha de
 * `messages`. Função pura: não toca em banco nem em rede.
 *
 * A linha leva `metadata.historico_importado = 'true'` (TEXTO, letra por letra a
 * condição da 0760 e da 0686), a mesma chave da importação do canal não oficial
 * (`lib/channels/historico/mapear.ts`). É ela que faz os gatilhos de `messages`
 * não tratarem o passado como fala de agora: sem evento de mensagem (IA, push,
 * webhook de saída, campanha, follow-up, automação), sem demanda nem SLA, sem
 * revisão de contexto, sem atividade do vendedor. Caminho paralelo não existe:
 * o corte é o mesmo.
 *
 * `historico_origem = 'coexistencia'` diz de onde veio (a tela conta), e
 * `coexistencia_lote_id` diz qual lote gravou a linha: o lote refeito depois de
 * uma falha no meio reconhece o que ele mesmo já gravou.
 *
 * O `external_id` é o `wamid`, o mesmo que a mensagem ao vivo grava: a unique
 * `(organization_id, external_id)` recusa a que já entrou por outro caminho.
 */
import { soDigitos } from "./historico";

export interface ContextoDaMensagemDoHistorico {
  organizationId: string;
  channelSessionId: string;
  contactId: string;
  conversationId: string;
  loteId: string;
  /** Só dígitos. `null` quando a Meta não mandou o número da empresa. */
  numeroDaEmpresa: string | null;
  /** O `wa_id` do cliente da thread, só dígitos. */
  waIdDoCliente: string;
  /** Epoch em ms de quando o lote chegou: decide se a mídia ainda vem. */
  recebidoEm: number;
}

export type StatusDaMidiaDoHistorico = "pendente" | "indisponivel";

export interface LinhaDoHistoricoDaMeta {
  organization_id: string;
  conversation_id: string;
  channel_session_id: string;
  contact_id: string;
  external_id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  sent_at: string;
  status: "delivered" | "sent" | "read" | "failed";
  sent_via: "external_device";
  media_url: string | null;
  media_mime: string | null;
  metadata: {
    historico_importado: "true";
    historico_origem: "coexistencia";
    coexistencia_lote_id: string;
    meta_media_id?: string;
    voice?: boolean;
    media_filename?: string;
    meta_media_placeholder?: "true";
    media_status?: StatusDaMidiaDoHistorico;
  };
}

/** A Meta só manda o arquivo da mídia dos últimos 14 dias. */
export const DIAS_DA_MIDIA_DO_HISTORICO = 14;

const TIPOS_DE_MIDIA = new Set(["image", "video", "audio", "document", "sticker"]);

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * Saída ou entrada. O lote não tem `to`: `from` é o número da empresa quando ela
 * enviou e o do cliente quando ele enviou; `from_user_id` só vem na do cliente,
 * e `from` some quando o número dele não está disponível.
 */
export function direcaoDaMensagemDoHistorico(
  raw: Record<string, unknown>,
  numeroDaEmpresa: string | null,
  waIdDoCliente: string,
): "inbound" | "outbound" {
  if (texto(raw.from_user_id)) return "inbound";
  const de = soDigitos(raw.from);
  if (!de) return "inbound";
  if (numeroDaEmpresa) return de === numeroDaEmpresa ? "outbound" : "inbound";
  return de === waIdDoCliente ? "inbound" : "outbound";
}

function statusDaMensagem(
  raw: Record<string, unknown>,
  direcao: "inbound" | "outbound",
): LinhaDoHistoricoDaMeta["status"] {
  const s = (texto(objeto(raw.history_context)?.status) ?? "").toUpperCase();
  if (direcao === "inbound") return s === "READ" || s === "PLAYED" ? "read" : "delivered";
  if (s === "READ" || s === "PLAYED") return "read";
  if (s === "DELIVERED") return "delivered";
  if (s === "ERROR") return "failed";
  return "sent";
}

/** O rótulo que a pessoa tocou (`button` ou resposta `interactive`). */
function textoDoClique(raw: Record<string, unknown>, tipo: string): string | null {
  if (tipo === "button") return texto(objeto(raw.button)?.text);
  const interativo = objeto(raw.interactive);
  return (
    texto(objeto(interativo?.button_reply)?.title) ?? texto(objeto(interativo?.list_reply)?.title)
  );
}

/**
 * A linha, ou `null` para o que não é mensagem de conversa (reação, edição,
 * apagamento, sistema, tipo que não sabemos ler) ou vem sem id ou sem hora.
 * Quem chama conta o `null` como ignorada.
 */
export function mapearMensagemDoHistorico(
  raw: Record<string, unknown>,
  ctx: ContextoDaMensagemDoHistorico,
): LinhaDoHistoricoDaMeta | null {
  const externalId = texto(raw.id);
  const segundos = Number(texto(raw.timestamp) ?? raw.timestamp);
  if (!externalId || !Number.isFinite(segundos) || segundos <= 0) return null;
  const tipo = texto(raw.type) ?? "";
  const direction = direcaoDaMensagemDoHistorico(raw, ctx.numeroDaEmpresa, ctx.waIdDoCliente);
  const sentAt = new Date(segundos * 1000);

  const base = {
    organization_id: ctx.organizationId,
    conversation_id: ctx.conversationId,
    channel_session_id: ctx.channelSessionId,
    contact_id: ctx.contactId,
    external_id: externalId,
    direction,
    sent_at: sentAt.toISOString(),
    status: statusDaMensagem(raw, direction),
    sent_via: "external_device" as const,
  };
  const metadata: LinhaDoHistoricoDaMeta["metadata"] = {
    historico_importado: "true",
    historico_origem: "coexistencia",
    coexistencia_lote_id: ctx.loteId,
  };

  if (tipo === "text") {
    return { ...base, type: "text", body: texto(objeto(raw.text)?.body), media_url: null, media_mime: null, metadata };
  }
  if (tipo === "button" || tipo === "interactive") {
    return { ...base, type: "text", body: textoDoClique(raw, tipo), media_url: null, media_mime: null, metadata };
  }
  if (tipo === "contacts") {
    const primeiro = Array.isArray(raw.contacts) ? objeto(raw.contacts[0]) : null;
    return {
      ...base,
      type: "contact",
      body: texto(objeto(primeiro?.name)?.formatted_name),
      media_url: null,
      media_mime: null,
      metadata,
    };
  }
  if (tipo === "location") {
    const local = objeto(raw.location);
    return {
      ...base,
      type: "location",
      body: texto(local?.name) ?? texto(local?.address),
      media_url: null,
      media_mime: null,
      metadata,
    };
  }
  if (TIPOS_DE_MIDIA.has(tipo)) {
    const corpo = objeto(raw[tipo]);
    const mediaId = texto(corpo?.id);
    const nome = texto(corpo?.filename);
    return {
      ...base,
      type: tipo,
      body: texto(corpo?.caption),
      // O mesmo ponteiro opaco da ingestão ao vivo: quem resolve é a Graph.
      media_url: mediaId ? `meta-media:${mediaId}` : null,
      media_mime: texto(corpo?.mime_type),
      metadata: {
        ...metadata,
        ...(mediaId ? { meta_media_id: mediaId, voice: corpo?.voice === true } : {}),
        ...(nome ? { media_filename: nome.slice(0, 200) } : {}),
      },
    };
  }
  if (tipo === "media_placeholder") {
    // O conteúdo vem depois, num webhook à parte, só para os últimos 14 dias.
    // Até lá a linha existe (a conversa não fica com buraco) e diz que a mídia
    // está pendente; a mais velha já nasce indisponível.
    const idadeEmDias = (ctx.recebidoEm - sentAt.getTime()) / 86_400_000;
    return {
      ...base,
      type: "text",
      body: null,
      media_url: null,
      media_mime: null,
      metadata: {
        ...metadata,
        meta_media_placeholder: "true",
        media_status: idadeEmDias <= DIAS_DA_MIDIA_DO_HISTORICO ? "pendente" : "indisponivel",
      },
    };
  }
  return null;
}
