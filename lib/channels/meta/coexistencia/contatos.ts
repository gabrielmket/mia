/**
 * FORK MIA · coexistência (S2): o contato da agenda do app (`smb_app_state_sync`)
 * passa a somar no pedido de contatos da sincronização.
 *
 * QUEM GRAVA continua sendo o upstream: `ingestMetaAppContactSync`, sem uma
 * linha mudada (nome da agenda em `address_book_name`, número interno de aviso
 * e titular apagado a pedido de fora). Este embrulho só pergunta, antes e
 * depois, se a ficha NASCEU ou MUDOU DE NOME. É isso que conta: a Meta
 * reentrega o mesmo contato, e o mesmo nome de novo não é contato recebido.
 *
 * Só conta com um pedido de contatos EM ABERTO no ciclo vivo do número
 * (`pedidoDeContatosEmAberto`); sem ele, o embrulho é só o upstream, mais uma
 * consulta. Falha na contagem nunca derruba a ingestão: vira log.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { phoneLookupVariants } from "../../phone-variants";
import type { ChannelTenantScope } from "../../types";
import { ingestMetaAppContactSync, type IngestOutcome } from "../ingest";
import type { ApagadosNoLote } from "../titular-apagado";
import type { AppContactSyncEvent } from "../webhook";
import { pedidoDeContatosEmAberto } from "./estado";

type Admin = SupabaseClient;

async function nomesDaAgenda(admin: Admin, organizationId: string, phone: string): Promise<Map<string, string | null>> {
  const variantes = phoneLookupVariants(`+${phone.replace(/\D/g, "")}`);
  if (variantes.length === 0) return new Map();
  const { data, error } = await admin
    .from("contacts")
    .select("id, address_book_name")
    .eq("organization_id", organizationId)
    .in("phone_number", variantes)
    .limit(4);
  if (error) throw new Error(`nome_da_agenda: ${error.message}`);
  return new Map(
    ((data ?? []) as Array<{ id: string; address_book_name: string | null }>).map((c) => [c.id, c.address_book_name]),
  );
}

export async function ingerirContatoDoAppContando(
  admin: Admin,
  e: AppContactSyncEvent,
  dono: ChannelTenantScope,
  apagadosNoLote?: ApagadosNoLote,
): Promise<IngestOutcome> {
  let pedidoId: string | null = null;
  let antes: Map<string, string | null> | null = null;
  try {
    pedidoId = await pedidoDeContatosEmAberto(admin, dono.organizationId, e.phoneNumberId);
    if (pedidoId) antes = await nomesDaAgenda(admin, dono.organizationId, e.phone);
  } catch (err) {
    logger.error("[meta.coexistencia] contagem do contato do app não preparada", {
      erro: err instanceof Error ? err.message : String(err),
    });
    pedidoId = null;
  }

  const r = await ingestMetaAppContactSync(admin, e, dono, apagadosNoLote);
  if (!pedidoId || !antes || r.status !== "synced") return r;

  try {
    const nomeAntes = antes.get(r.contactId);
    const nomeAgora = (e.name ?? "").trim().slice(0, 200);
    const mudou = !antes.has(r.contactId) || (nomeAntes ?? "") !== nomeAgora;
    if (mudou) {
      const { error } = await admin.rpc("fn_mia_coexistencia_somar_contato" as never, {
        p_sincronizacao: pedidoId,
      } as never);
      if (error) throw new Error(error.message);
    }
  } catch (err) {
    logger.error("[meta.coexistencia] contato do app não contado", {
      sincronizacao_id: pedidoId,
      erro: err instanceof Error ? err.message : String(err),
    });
  }
  return r;
}
