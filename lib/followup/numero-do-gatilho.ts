/**
 * FORK MIA — O NÚMERO DA ABORDAGEM NO GATILHO "LEAD CRIADO".
 *
 * ─── O defeito que isto fecha ───────────────────────────────────────────────
 *
 * Sem escolha, quem decide o número é o banco: `fn_service_observe_command`
 * grava no evento o `default_session_id` (a conversa mais recente com o contato
 * ou, sem conversa, o número conectado mais antigo da empresa). Uma empresa com
 * um número oficial e dois por QR tinha o primeiro contato saindo por onde a
 * ordenação caísse; e, com o oficial fora do ar, por um número QR sem modelo
 * aprovado. Ninguém escolhia, e ninguém via.
 *
 * ─── A regra ────────────────────────────────────────────────────────────────
 *
 *  - SEM o campo (`params.channel_session_id` ausente): tudo como sempre foi.
 *  - COM o campo: o lead é inscrito SÓ por esse número. Número arquivado,
 *    desconectado (status diferente de `WORKING`, o único estado em que o canal
 *    entrega) ou que não é mais da empresa: o lead NÃO é inscrito, e o motivo
 *    fica registrado. Trocar calado por outro número é exatamente o que o campo
 *    existe para impedir.
 *
 * O caminho até o banco já aceitava a sessão: `serviceForEvent` repassa o
 * `p_session` a `fn_service_event_origin`, que escolhe a fotografia daquele
 * número entre as `destinations` do evento e abre (ou reaproveita) a conversa
 * NESSE número. O que o banco não confere é se o número está conectado: com o
 * `p_session`, `fn_service_begin` usa aquele id e só ordena por `WORKING` quando
 * não recebe nenhum. Por isso o estado é conferido aqui, antes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { PROVIDERS_DE_MENSAGEM } from "@/lib/channels/capabilities";
import type { TriggerConfig } from "./api-schemas";

/** O único status em que o canal entrega (`channel_sessions_status_check`). */
export const STATUS_CONECTADO = "WORKING";

/**
 * Por que o número escolhido não pôde ser usado.
 *
 *  - `arquivado`: excluído pela tela (`archived_at`).
 *  - `desconectado`: `STARTING`, `SCAN_QR_CODE`, `STOPPED` ou `FAILED`.
 *  - `nao_encontrado`: o id não é mais um canal desta empresa.
 *  - `divergente`: o banco recusou abrir o atendimento nesse número
 *    (`service_channel_mismatch`). Acontece quando o evento nasceu DENTRO de
 *    uma conversa em outro número (origem de continuação) ou quando o número
 *    foi arquivado entre a conferência e a abertura.
 */
export type MotivoDoNumero = "arquivado" | "desconectado" | "nao_encontrado" | "divergente";

/** Como o número estava no instante do evento. */
export interface EstadoDoNumero {
  status: string;
  archived_at: string | null;
}

/** O número escolhido no gatilho, ou `null` = automático (o comportamento de sempre). */
export function numeroEscolhidoDoGatilho(cfg: TriggerConfig | null | undefined): string | null {
  if (!cfg || cfg.kind !== "lead_created") return null;
  return cfg.params?.channel_session_id ?? null;
}

/** `null` = pode sair por ele. Qualquer outra resposta = não inscrever, com este motivo. */
export function motivoParaNaoUsar(estado: EstadoDoNumero | null | undefined): MotivoDoNumero | null {
  if (!estado) return "nao_encontrado";
  if (estado.archived_at) return "arquivado";
  if (estado.status !== STATUS_CONECTADO) return "desconectado";
  return null;
}

/** A frase que acompanha o motivo no log e no detalhe do evento. */
export const MOTIVO_LEGIVEL: Record<MotivoDoNumero, string> = {
  arquivado: "o número escolhido no gatilho foi excluído",
  desconectado: "o número escolhido no gatilho está desconectado",
  nao_encontrado: "o número escolhido no gatilho não é mais desta empresa",
  divergente: "o atendimento deste lead já está em outro número",
};

/** O banco recusou a sessão pedida (`fn_service_event_origin`, errcode 23503). */
export function ehRecusaDoNumero(err: unknown): boolean {
  const msg = (err as { message?: unknown } | null)?.message;
  return typeof msg === "string" && msg.includes("service_channel_mismatch");
}

/**
 * O canal é desta organização, está ativo (não arquivado) e conversa?
 *
 * A organização vem SEMPRE da sessão de quem grava, nunca do corpo: um id de
 * canal de outra empresa colado no `trigger_config` faria o gatilho abrir
 * atendimento pelo número de outra conta. Arquivado também é recusado aqui:
 * escolher agora um número excluído é armar um gatilho que nunca inscreve.
 * Desconectado NÃO é recusado: o número pode voltar, e a tela avisa o estado.
 */
export async function numeroEhDaOrganizacao(
  db: SupabaseClient,
  orgId: string,
  channelSessionId: string,
): Promise<{ ok: true } | { ok: false; erro: string | null }> {
  const { data, error } = await db
    .from("channel_sessions")
    .select("id")
    .eq("id", channelSessionId)
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .in("provider", [...PROVIDERS_DE_MENSAGEM])
    .maybeSingle();
  if (error) return { ok: false, erro: error.message };
  return data ? { ok: true } : { ok: false, erro: null };
}
