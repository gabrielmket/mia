/**
 * FORK MIA · coexistência (S4; docs/fork/coexistencia.md): a EDIÇÃO e o APAGAR
 * feitos no WhatsApp aparecem na mensagem que a MIA já tem.
 *
 * Vale para os dois lados do canal oficial: o cliente que edita ou apaga
 * (campo `messages`) e o dono que edita ou apaga pelo app WhatsApp Business num
 * número em coexistência (campo `smb_message_echoes`). O evento é
 * `MessageEditEvent` (`lib/channels/meta/webhook.ts`).
 *
 * O molde é o do canal por QR (`handleMessageEdited`/`handleMessageRevoked` em
 * `lib/waha/ingest.ts`) e o de `aplicarEdicaoZernio`, sem mexer em nenhum deles:
 *
 *  - EDITAR sobrescreve o corpo e carimba `edited_at` com a hora do EVENTO. É
 *    essa hora que segura a ordem: a edição mais velha que a já aplicada não
 *    volta o texto (a Meta reentrega e entrega fora de ordem). Edição sem texto
 *    (só a legenda tirada, tipo que não sabemos ler) carimba e não zera o corpo.
 *    Mensagem já apagada não é editada.
 *  - APAGAR carimba `revoked_at` e NÃO remove a linha nem limpa o corpo: quem
 *    decide o que a tela mostra é `lib/messaging/apagada.ts` (a do cliente some
 *    da bolha; a da empresa segue visível à equipe, marcada). Só a linha que
 *    ainda não estava apagada é carimbada, então a reentrega não muda nada nem
 *    grava uma segunda trilha. A trilha vai à auditoria SEM o corpo, como no QR.
 *    A prévia da conversa sai do texto apagado pelo cliente quando ele era a
 *    última mensagem (o mesmo cuidado do QR, #4500).
 *
 * Nada aqui dispara IA, automação, carimbo da conversa nem janela de 24 h: não
 * há evento de mensagem, só a alteração da linha. Tenant pela nossa tabela
 * (`donoDoEvento`, na rota), e o alvo é `(organization_id, external_id)`.
 *
 * NUNCA LANÇA: falha vira desfecho e log; a rota responde 200.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { PREVIA_DA_APAGADA_PELO_CONTATO } from "@/lib/messaging/texto-retido";

import type { MessageEditEvent } from "../webhook";

type Admin = SupabaseClient;

export type DesfechoDaEdicao =
  | "editada"
  | "apagada"
  /** A mensagem existe, mas já estava assim (reentrega, edição mais velha, ou já apagada). */
  | "sem_mudanca"
  /** A MIA não tem a mensagem original (anterior à conexão, ou de outra conta). */
  | "sem_alvo"
  | "falhou";

interface Alvo {
  id: string;
  conversation_id: string | null;
  direction: "inbound" | "outbound";
  sent_at: string | null;
}

async function alvoExiste(admin: Admin, organizationId: string, externalId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("messages")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("external_id", externalId)
    .limit(1);
  if (error) throw new Error(`alvo: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function aplicarEdicaoDaMeta(
  admin: Admin,
  e: MessageEditEvent,
  ctx: { organizationId: string; requestId: string },
): Promise<DesfechoDaEdicao> {
  // Hora inválida (payload sem `timestamp`) não pode virar 1970 e travar toda
  // edição futura: cai na hora da chegada.
  const quando = Number.isFinite(e.sentAt.getTime()) && e.sentAt.getTime() > 0 ? e.sentAt : new Date();
  const hora = quando.toISOString();
  try {
    if (e.acao === "edit") {
      const patch = e.text !== null ? { body: e.text, edited_at: hora } : { edited_at: hora };
      const { data, error } = await admin
        .from("messages")
        .update(patch)
        .eq("organization_id", ctx.organizationId)
        .eq("external_id", e.targetExternalId)
        .is("revoked_at", null)
        .or(`edited_at.is.null,edited_at.lt.${hora}`)
        .select("id");
      if (error) throw new Error(`editar: ${error.message}`);
      if ((data ?? []).length > 0) return "editada";
      return (await alvoExiste(admin, ctx.organizationId, e.targetExternalId)) ? "sem_mudanca" : "sem_alvo";
    }

    const { data, error } = await admin
      .from("messages")
      .update({ revoked_at: hora })
      .eq("organization_id", ctx.organizationId)
      .eq("external_id", e.targetExternalId)
      .is("revoked_at", null)
      .select("id, conversation_id, direction, sent_at");
    if (error) throw new Error(`apagar: ${error.message}`);
    const apagadas = (data ?? []) as Alvo[];
    if (apagadas.length === 0) {
      return (await alvoExiste(admin, ctx.organizationId, e.targetExternalId)) ? "sem_mudanca" : "sem_alvo";
    }
    for (const linha of apagadas) {
      await audit({
        action: "message.revoked_in_channel",
        organizationId: ctx.organizationId,
        resourceType: "message",
        resourceId: linha.id,
        requestId: ctx.requestId,
        metadata: {
          conversation_id: linha.conversation_id,
          direction: linha.direction,
          external_id: e.targetExternalId,
          // Quem apagou: o cliente, ou o dono pelo app WhatsApp Business.
          origem: e.origem === "app" ? "app_whatsapp_business" : "contato",
          conteudo_preservado: true,
        },
      });
      if (linha.direction === "inbound" && linha.conversation_id && linha.sent_at) {
        const { error: erroDaPrevia } = await admin
          .from("conversations")
          .update({ last_message_preview: PREVIA_DA_APAGADA_PELO_CONTATO })
          .eq("id", linha.conversation_id)
          .eq("organization_id", ctx.organizationId)
          .lte("last_message_at", linha.sent_at);
        if (erroDaPrevia) {
          logger.warn("[meta.coexistencia] a prévia da conversa não acompanhou o apagamento", {
            request_id: ctx.requestId,
            conversation_id: linha.conversation_id,
            erro: erroDaPrevia.message,
          });
        }
      }
    }
    return "apagada";
  } catch (err) {
    logger.error("[meta.coexistencia] edição ou apagamento não aplicado", {
      request_id: ctx.requestId,
      acao: e.acao,
      origem: e.origem,
      external_id: e.targetExternalId,
      erro: err instanceof Error ? err.message : String(err),
    });
    return "falhou";
  }
}
