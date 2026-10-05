/**
 * FORK MIA — a etiqueta posta pela FERRAMENTA dispara a automação, igual à da tela.
 *
 * ─── O defeito ───────────────────────────────────────────────────────────────
 *
 * `crm_manage_tags` gravava a etiqueta e só auditava (`*.tags_changed`). Quem
 * emite `contact.tag_added`/`lead.tag_added` — o gatilho "Quando um contato
 * ganhar uma tag" das regras — eram só a tela (`app/api/v1/contacts/_handler.ts`,
 * `app/api/v1/leads/_handler.ts`) e a ação `add_tag` do próprio motor. Então a
 * MESMA etiqueta, posta pelo agente de IA, não disparava regra nenhuma: o card
 * andava pela tela e ficava parado pela IA, sem erro e sem log. Na Vita
 * Odonto, a unidade marcada no contato pela Sofia é o que deveria encaminhar o
 * lead; o agente marcava e ninguém reagia.
 *
 * ─── O contrato é o das rotas, campo a campo ────────────────────────────────
 *
 *  - só o que foi ACRESCENTADO dispara (`added_tags`), e só se houver algo novo:
 *    repetir a mesma etiqueta não reemite;
 *  - `tags` é a lista inteira depois da gravação; `service_origin` é o rastro do
 *    atendimento, pela mesma `observeServiceOrigin` das rotas;
 *  - `entity_kind` é `contact` ou `crm_lead` — o motor FILTRA por ele;
 *  - etiqueta de CONVERSA não emite nada, como nas rotas: não existe gatilho
 *    de conversa ganhando etiqueta.
 *
 * ─── Sem laço ────────────────────────────────────────────────────────────────
 *
 * O `request_id` do contexto vai no metadata, como nas rotas. Chamada feita a
 * partir de uma regra carrega `rule:<id>`, e o motor
 * (`lib/automation/engine.ts`) não reprocessa evento com esse prefixo — a regra
 * que põe etiqueta não redispara a si mesma. E "só o novo dispara" fecha o resto:
 * a mesma etiqueta reposta não gera evento.
 *
 * Nunca lança: a etiqueta JÁ foi gravada, e perder o rastro não pode desfazer o
 * que a ferramenta fez. Falha vira `logger.error` — nunca silêncio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { observeServiceOrigin } from "@/lib/atendimento/origem";
import { logger } from "@/lib/logger";

import type { McpContext } from "../types";

export type AlvoDaEtiqueta = "conversation" | "contact" | "lead";

/** O evento de cada alvo — `null` = não há gatilho para este alvo. */
const EVENTO: Record<AlvoDaEtiqueta, { tipo: string; entidade: string } | null> = {
  conversation: null,
  contact: { tipo: "contact.tag_added", entidade: "contact" },
  lead: { tipo: "lead.tag_added", entidade: "crm_lead" },
};

/**
 * O ator no metadata, com a MESMA forma de `actorAuditPayload` nas rotas de
 * contato e de negócio — quem depura a regra lê os dois eventos do mesmo jeito.
 */
function metadataDoAtor(ctx: McpContext): Record<string, unknown> {
  const actor = ctx.actor;
  if (actor.type === "user") return { actor_type: "user" };
  return {
    actor_type: actor.type,
    actor_id: actor.id,
    ...(actor.type === "ai_agent" && actor.api_token_id
      ? { actor_api_token_id: actor.api_token_id }
      : {}),
  };
}

export async function emitirEtiquetaAdicionada(
  supabase: SupabaseClient,
  ctx: McpContext,
  input: {
    alvo: AlvoDaEtiqueta;
    alvoId: string;
    /** O que estava gravado ANTES, já normalizado. */
    antes: readonly string[];
    /** O que ficou gravado DEPOIS. */
    depois: readonly string[];
  },
): Promise<{ emitido: boolean; adicionadas: string[] }> {
  const evento = EVENTO[input.alvo];
  const adicionadas = input.depois.filter((t) => !input.antes.includes(t));
  if (!evento || adicionadas.length === 0) return { emitido: false, adicionadas };

  try {
    // O contato é de onde sai o rastro do atendimento. No negócio, ele é lido
    // aqui (uma ida a mais), e não pedido a quem chama: a ferramenta do upstream
    // lê só `id, tags`, e mexer no select dela é diferença a mais no arquivo dele.
    let contatoId: string | null = input.alvo === "contact" ? input.alvoId : null;
    if (input.alvo === "lead") {
      const { data } = await supabase
        .from("crm_leads")
        .select("contact_id")
        .eq("id", input.alvoId)
        .eq("organization_id", ctx.organizationId)
        .maybeSingle();
      contatoId = (data as { contact_id?: string | null } | null)?.contact_id ?? null;
    }
    const serviceOrigin = await observeServiceOrigin(supabase, ctx.organizationId, contatoId);

    const { error } = await supabase.rpc("emit_event", {
      p_event_type: evento.tipo,
      p_entity_kind: evento.entidade,
      p_entity_id: input.alvoId,
      p_payload: { added_tags: adicionadas, tags: [...input.depois], service_origin: serviceOrigin },
      p_metadata: { request_id: ctx.requestId, ...metadataDoAtor(ctx), via: "mcp" },
      p_organization_id: ctx.organizationId,
    });
    if (error) {
      logger.error("[crm_manage_tags] emit_event falhou — a etiqueta ficou, a automação não soube", {
        organization_id: ctx.organizationId,
        evento: evento.tipo,
        error: error.message,
      });
      return { emitido: false, adicionadas };
    }
    return { emitido: true, adicionadas };
  } catch (err) {
    logger.error("[crm_manage_tags] emit_event lançou — a etiqueta ficou, a automação não soube", {
      organization_id: ctx.organizationId,
      evento: evento.tipo,
      error: err instanceof Error ? err.message : String(err),
    });
    return { emitido: false, adicionadas };
  }
}
