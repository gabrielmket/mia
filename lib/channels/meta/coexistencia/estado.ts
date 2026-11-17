/**
 * FORK MIA · coexistência (S2): o ciclo de conexão do número e os dois pedidos
 * de sincronização (migration 9162).
 *
 * Quem ABRE o ciclo é a conexão pelo app (S3, na janela da Meta). Aqui o ciclo
 * só é aberto quando o histórico chega e não há ciclo vivo para o número: a
 * Meta só manda histórico a quem pediu, então é número que conectou por fora
 * do nosso fluxo (pedido feito à mão, por exemplo). O ciclo nasce com
 * `aberta_por = 'historico_sem_pedido'` e o pedido do histórico já
 * `em_andamento`, sem `pedida_em`: a MIA não pediu, e não finge que pediu.
 *
 * Toda consulta filtra a organização que `donoDoEvento` resolveu pela NOSSA
 * tabela; o corpo do webhook nunca escolhe tenant.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../../archived";

type Admin = SupabaseClient;

export const ESTADOS_DO_PEDIDO_EM_ABERTO = ["pedindo", "pedida", "em_andamento", "sem_resposta"] as const;

export interface NumeroDaCoexistencia {
  organizationId: string;
  channelSessionId: string;
  wabaId: string;
  phoneNumberId: string;
}

function erroDe(onde: string, error: { message?: string; code?: string } | null): Error {
  return new Error(`${onde}: ${error?.code ?? "sem_codigo"} ${error?.message ?? ""}`.trim());
}

/** A sessão (não arquivada) do número, dentro da organização. Lança se a consulta falhar. */
export async function sessaoDoNumero(
  admin: Admin,
  organizationId: string,
  phoneNumberId: string,
): Promise<string | null> {
  const base = () =>
    admin
      .from("channel_sessions")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("meta_phone_number_id", phoneNumberId);
  const { data, error } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).limit(1),
    () => base().limit(1),
  );
  if (error) throw erroDe("sessao_do_numero", error);
  return ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
}

async function cicloVivo(admin: Admin, n: NumeroDaCoexistencia): Promise<string | null> {
  const { data, error } = await admin
    .from("mia_coexistencia_conexoes")
    .select("id")
    .eq("organization_id", n.organizationId)
    .eq("channel_session_id", n.channelSessionId)
    .in("estado", ["no_ar", "fora_do_ar"])
    .limit(1);
  if (error) throw erroDe("ciclo_vivo", error);
  return ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
}

/**
 * O pedido do histórico do ciclo vivo do número; abre o ciclo e o pedido se
 * não existirem. Duas entregas ao mesmo tempo não abrem dois: o índice único
 * do ciclo vivo e a `unique (conexao_id, tipo)` seguram, e quem perde lê o do
 * outro.
 */
export async function pedidoDoHistorico(
  admin: Admin,
  n: NumeroDaCoexistencia,
): Promise<{ id: string; estado: string }> {
  let conexaoId = await cicloVivo(admin, n);
  if (!conexaoId) {
    const { data, error } = await admin
      .from("mia_coexistencia_conexoes")
      .insert({
        organization_id: n.organizationId,
        channel_session_id: n.channelSessionId,
        waba_id: n.wabaId,
        phone_number_id: n.phoneNumberId,
        aberta_por: "historico_sem_pedido",
      })
      .select("id");
    if (error && error.code !== "23505") throw erroDe("ciclo_novo", error);
    conexaoId = ((data ?? []) as Array<{ id: string }>)[0]?.id ?? (await cicloVivo(admin, n));
    if (!conexaoId) throw new Error("ciclo_novo: sem id");
  }

  const { error: erroDoPedido } = await admin
    .from("mia_coexistencia_sincronizacoes")
    .upsert(
      { organization_id: n.organizationId, conexao_id: conexaoId, tipo: "historico", estado: "em_andamento" },
      { onConflict: "conexao_id,tipo", ignoreDuplicates: true },
    );
  if (erroDoPedido) throw erroDe("pedido_do_historico", erroDoPedido);

  const { data: pedido, error } = await admin
    .from("mia_coexistencia_sincronizacoes")
    .select("id, estado")
    .eq("organization_id", n.organizationId)
    .eq("conexao_id", conexaoId)
    .eq("tipo", "historico")
    .maybeSingle();
  if (error) throw erroDe("pedido_do_historico", error);
  if (!pedido) throw new Error("pedido_do_historico: sem linha");
  return pedido as { id: string; estado: string };
}

/**
 * O pedido de contatos EM ABERTO do número, para somar o contato que o app
 * mandou. Sem ciclo ou sem pedido aberto: `null`, e nada é contado (o contato
 * entra no CRM do mesmo jeito, pelo caminho do upstream). O contato da agenda
 * continua chegando depois da sincronização, a cada edição no app: esse não é
 * "recebido na sincronização", e o pedido já fechado não o conta.
 */
export async function pedidoDeContatosEmAberto(
  admin: Admin,
  organizationId: string,
  phoneNumberId: string,
): Promise<string | null> {
  const { data: ciclos, error } = await admin
    .from("mia_coexistencia_conexoes")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("phone_number_id", phoneNumberId)
    .in("estado", ["no_ar", "fora_do_ar"])
    .limit(1);
  if (error) throw erroDe("ciclo_do_contato", error);
  const conexaoId = ((ciclos ?? []) as Array<{ id: string }>)[0]?.id;
  if (!conexaoId) return null;
  const { data: pedidos, error: erroDoPedido } = await admin
    .from("mia_coexistencia_sincronizacoes")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("conexao_id", conexaoId)
    .eq("tipo", "contatos")
    .in("estado", [...ESTADOS_DO_PEDIDO_EM_ABERTO])
    .limit(1);
  if (erroDoPedido) throw erroDe("pedido_de_contatos", erroDoPedido);
  return ((pedidos ?? []) as Array<{ id: string }>)[0]?.id ?? null;
}
