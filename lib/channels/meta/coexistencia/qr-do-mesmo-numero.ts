/**
 * FORK MIA · coexistência (S3, decisão D5 aprovada pelo Gabriel em 17/11/2026):
 * o canal por QR do MESMO número sai do ar quando a Meta confirma a conexão.
 *
 * A empresa pode já usar este número pela conexão por QR (WAHA). Na conexão
 * pelo app a Meta desliga os aparelhos conectados, e o WAHA é um deles; mas
 * dá para parear de novo depois, e aí a mesma mensagem entraria duas vezes
 * (pela Meta e pelo QR): conversa duplicada e a IA respondendo duas vezes.
 * A trava `channel_sessions_phone_per_org_unique` não pega o caso, porque o
 * canal oficial grava `+55…` e o QR grava `55…`: a comparação aqui é só
 * pelos dígitos, e só dentro da MESMA empresa.
 *
 * O que acontece com cada canal por QR do número, o mesmo que "Excluir" em
 * Conexões faz com um canal que tem histórico:
 *
 *  1. sai do aparelho no WAHA (logout + delete), em best-effort: a Meta já
 *     derrubou o aparelho, e o WAHA fora do ar não pode impedir a conexão;
 *  2. a linha é ARQUIVADA (`archived_at`, `STOPPED`), nunca apagada: as
 *     conversas e mensagens dela continuam no histórico;
 *  3. os avisos de saúde e de pausa dela fecham, como na exclusão;
 *  4. fica na auditoria (`channel.coexistencia_qr_desligado`).
 *
 * Nunca lança: falhar aqui não desfaz a conexão pelo app (devolve quantos
 * saíram, e o resto vai ao log).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getWahaClient } from "@/lib/waha/client";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../../archived";
import { CHANNEL_PROVIDER_WAHA } from "../../capabilities";
import { sincronizarAvisoDePausa } from "../../central-de-pausa";
import { resolverSaudeDaConexaoRemovida } from "../../health";

type Admin = SupabaseClient;

interface CanalPorQr {
  id: string;
  waha_session_name: string | null;
  phone_number: string | null;
}

/** Os canais por QR (não arquivados) da empresa cujo número tem estes dígitos. */
export async function canaisPorQrDoNumero(
  admin: Admin,
  organizationId: string,
  digitos: string,
): Promise<CanalPorQr[]> {
  if (digitos.length < 8) return [];
  const consultar = () =>
    admin
      .from("channel_sessions")
      .select("id, waha_session_name, phone_number")
      .eq("organization_id", organizationId)
      .eq("provider", CHANNEL_PROVIDER_WAHA);
  const { data, error } = await queryTolerantToMissingArchived(
    () => consultar().is(ARCHIVED_AT, null),
    () => consultar(),
  );
  if (error) throw new Error(`canais_por_qr: ${error.message ?? ""}`);
  return ((data ?? []) as CanalPorQr[]).filter((c) => (c.phone_number ?? "").replace(/\D/g, "") === digitos);
}

export async function desligarQrDoMesmoNumero(
  admin: Admin,
  input: { organizationId: string; digitos: string; userId: string | null; requestId: string },
): Promise<number> {
  let canais: CanalPorQr[];
  try {
    canais = await canaisPorQrDoNumero(admin, input.organizationId, input.digitos);
  } catch (err) {
    logger.error("[meta.coexistencia] canal por QR do mesmo número não conferido", {
      request_id: input.requestId,
      erro: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
  if (canais.length === 0) return 0;

  const waha = getWahaClient();
  let desligados = 0;
  for (const canal of canais) {
    let aparelho: "desligado" | "sem_transporte" | "falhou" = "sem_transporte";
    if (waha && canal.waha_session_name) {
      try {
        await waha.logoutSession(canal.waha_session_name);
        await waha.deleteSession(canal.waha_session_name);
        aparelho = "desligado";
      } catch (err) {
        aparelho = "falhou";
        logger.warn("[meta.coexistencia] canal por QR não saiu do aparelho", {
          request_id: input.requestId,
          channel_session_id: canal.id,
          erro: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const agora = new Date().toISOString();
    const { error } = await admin
      .from("channel_sessions")
      .update({ [ARCHIVED_AT]: agora, status: "STOPPED", last_status_change_at: agora })
      .eq("organization_id", input.organizationId)
      .eq("id", canal.id);
    if (error) {
      logger.error("[meta.coexistencia] canal por QR do mesmo número não arquivado", {
        request_id: input.requestId,
        channel_session_id: canal.id,
        codigo: error.code ?? null,
      });
      continue;
    }
    desligados += 1;

    try {
      await resolverSaudeDaConexaoRemovida(admin, {
        id: canal.id,
        organization_id: input.organizationId,
        status: "STOPPED",
      });
    } catch (err) {
      logger.warn("[meta.coexistencia] avisos do canal por QR não fechados", {
        request_id: input.requestId,
        channel_session_id: canal.id,
        erro: err instanceof Error ? err.message : String(err),
      });
    }
    await sincronizarAvisoDePausa(
      admin,
      { id: canal.id, organization_id: input.organizationId },
      { autor: "coexistencia" },
    );

    const channelSessionId = canal.id;
    void audit({
      action: "channel.coexistencia_qr_desligado",
      actorUserId: input.userId,
      organizationId: input.organizationId,
      resourceType: "channel_session",
      resourceId: channelSessionId,
      requestId: input.requestId,
      metadata: { aparelho, waha_session_name: canal.waha_session_name },
    });
  }
  return desligados;
}
