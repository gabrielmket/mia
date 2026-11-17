/**
 * FORK MIA · coexistência (S2): o campo `history` do webhook da Meta, na ROTA.
 *
 * A rota só GUARDA: cada lote vira uma linha em `mia_coexistencia_lotes` e um
 * pedido `coexistencia.lote_requested` no `event_log`, e quem grava as
 * mensagens é o worker (`gravar-lote.ts`). 180 dias de conversa podem ser
 * milhares de mensagens, e a Meta dá por falhada a entrega que demora; pelo
 * mesmo endereço chegam as mensagens dos clientes.
 *
 * O mesmo lote reentregue não vira segundo pedido: a `unique (sincronizacao_id,
 * chave)` recusa a linha, e sem linha nova não há evento. O erro da Meta
 * (`2593109`, o dono desligou o compartilhamento) fecha o pedido do histórico
 * em `recusada_pelo_dono`; outro erro, em `falhou`, com o código e o título que
 * a Meta mandou (nunca o corpo).
 *
 * NUNCA LANÇA: falha vira desfecho e log, e a rota responde 200 (a Meta
 * reentrega em backoff tudo que não recebe 2xx). Tenant pela nossa tabela
 * (`donoDoEvento`), nunca pelo corpo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { donoDoEvento, type DonoDeEvento } from "../dono-do-evento";
import type { MetaWebhookEnvelope } from "../envelope";
import { pedidoDoHistorico, sessaoDoNumero } from "./estado";
import {
  chaveDoLote,
  ERRO_HISTORICO_RECUSADO_PELO_DONO,
  lerHistorico,
  type LeituraDoHistorico,
} from "./historico";

type Admin = SupabaseClient;

export const EVENTO_DO_LOTE = "coexistencia.lote_requested";

/** Estados de que o erro da Meta não tira o pedido. */
const PEDIDO_JA_FECHADO = ["concluida", "falhou", "recusada_pelo_dono", "prazo_vencido"];

export interface OpcoesDoHistorico<T extends DonoDeEvento> {
  requestId: string;
  sessionDoToken: T | null;
  porWaba: (wabaId: string) => Promise<T | null>;
}

export async function receberHistoricoDaMeta<T extends DonoDeEvento>(
  admin: Admin,
  envelope: MetaWebhookEnvelope,
  opcoes: OpcoesDoHistorico<T>,
): Promise<string[]> {
  const desfechos: string[] = [];
  for (const entry of envelope.entry ?? []) {
    const wabaId = String(entry.id ?? "");
    for (const change of entry.changes ?? []) {
      const leituras = lerHistorico(
        String(change.field ?? ""),
        wabaId,
        (change.value ?? {}) as Record<string, unknown>,
      );
      if (leituras.length === 0) continue;
      try {
        const dono = await donoDoEvento({
          sessionDoToken: opcoes.sessionDoToken,
          wabaDoEvento: wabaId || null,
          porWaba: opcoes.porWaba,
        });
        if (!dono) {
          desfechos.push("historico:waba_desconhecida");
          continue;
        }
        for (const leitura of leituras) {
          desfechos.push(await receberUm(admin, dono.organizationId, leitura, opcoes.requestId));
        }
      } catch (err) {
        logger.error("[meta.coexistencia] histórico não recebido", {
          request_id: opcoes.requestId,
          waba_id: wabaId,
          erro: err instanceof Error ? err.message : String(err),
        });
        desfechos.push("historico:failed");
      }
    }
  }
  return desfechos;
}

async function receberUm(
  admin: Admin,
  organizationId: string,
  leitura: LeituraDoHistorico,
  requestId: string,
): Promise<string> {
  const channelSessionId = await sessaoDoNumero(admin, organizationId, leitura.phoneNumberId);
  if (!channelSessionId) return "historico:no_session";
  const pedido = await pedidoDoHistorico(admin, {
    organizationId,
    channelSessionId,
    wabaId: leitura.wabaId,
    phoneNumberId: leitura.phoneNumberId,
  });

  if (leitura.tipo === "erro") {
    const recusado = leitura.codigo === String(ERRO_HISTORICO_RECUSADO_PELO_DONO);
    const { error } = await admin
      .from("mia_coexistencia_sincronizacoes")
      .update({
        estado: recusado ? "recusada_pelo_dono" : "falhou",
        erro_codigo: leitura.codigo,
        erro_titulo: leitura.titulo,
        respondida_em: new Date().toISOString(),
      })
      .eq("id", pedido.id)
      .eq("organization_id", organizationId)
      .not("estado", "in", `(${PEDIDO_JA_FECHADO.join(",")})`);
    if (error) throw new Error(`erro_do_historico: ${error.message}`);
    logger.warn("[meta.coexistencia] a Meta recusou o histórico", {
      request_id: requestId,
      sincronizacao_id: pedido.id,
      erro_codigo: leitura.codigo,
    });
    return recusado ? "historico:recusado_pelo_dono" : "historico:erro_da_meta";
  }

  const { data, error } = await admin
    .from("mia_coexistencia_lotes")
    .upsert(
      {
        organization_id: organizationId,
        sincronizacao_id: pedido.id,
        tipo: leitura.tipo === "lote" ? "mensagens" : "midia",
        chave: chaveDoLote(leitura),
        fase: leitura.tipo === "lote" ? leitura.fase : null,
        ordem: leitura.tipo === "lote" ? leitura.ordem : null,
        progresso: leitura.tipo === "lote" ? leitura.progresso : null,
        payload:
          leitura.tipo === "lote"
            ? { numero_da_empresa: leitura.numeroDaEmpresa, item: leitura.item }
            : { mensagem: leitura.mensagem },
      },
      { onConflict: "sincronizacao_id,chave", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(`lote: ${error.message}`);
  const loteId = ((data ?? []) as Array<{ id: string }>)[0]?.id;
  // Sem linha nova = a Meta reentregou o mesmo lote: nada a pedir de novo.
  if (!loteId) return "historico:lote_repetido";

  const { error: erroDoEvento } = await admin.rpc("emit_event" as never, {
    p_event_type: "coexistencia.lote_requested",
    p_entity_kind: "mia_coexistencia_lote",
    p_entity_id: loteId,
    p_payload: { lote_id: loteId, sincronizacao_id: pedido.id },
    p_metadata: { source: "meta_webhook" },
    p_organization_id: organizationId,
  } as never);
  if (erroDoEvento) {
    // O lote fica guardado em `recebido`; sem o pedido ninguém o grava agora.
    // Vai ao log com o id, para a varredura (S3) ou o suporte o retomarem.
    logger.error("[meta.coexistencia] lote guardado sem o pedido ao worker", {
      request_id: requestId,
      lote_id: loteId,
      erro: erroDoEvento.message,
    });
    return "historico:lote_sem_pedido";
  }
  return leitura.tipo === "lote" ? "historico:lote_recebido" : "historico:midia_recebida";
}
