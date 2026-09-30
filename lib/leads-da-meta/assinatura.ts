/**
 * FORK MIA (.62) — A PÁGINA ASSINADA NO APP, para a Meta avisar na hora.
 *
 * Sem a assinatura (`{pagina}/subscribed_apps` com o campo `leadgen`) a Meta não
 * manda o aviso `leadgen` ao webhook do app, e o lead só entra pela leitura a
 * cada 5 minutos. Quem assina:
 *
 *   · a rota que LIGA o formulário (`PUT /api/v1/leads-da-meta/formularios`),
 *     na hora, com o resultado na resposta para a tela dizer o motivo;
 *   · a RODADA, para o formulário que nunca tentou (ligado antes da .62), para
 *     a recusa depois de algumas horas (o token pode ter ganho a permissão) e,
 *     uma vez por dia, para conferir que a assinatura continua lá.
 *
 * O resultado fica no formulário (`tempo_real`, `tempo_real_motivo`,
 * `tempo_real_detalhe`, `tempo_real_em`, migration 9005). A assinatura é da
 * PÁGINA, então todos os formulários daquela Página recebem o mesmo resultado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { assinarLeadsDaPagina } from "@/lib/plataformas-de-anuncio/meta/leads";

export type EstadoDoTempoReal = "assinado" | "recusado";

/** A recusa é revista depois disto: o token pode ter ganho a permissão. */
export const REVER_RECUSA_MS = 6 * 60 * 60 * 1000;
/** A assinatura aceita é conferida de novo uma vez por dia (a Página pode ter saído do app). */
export const REVER_ASSINATURA_MS = 24 * 60 * 60 * 1000;

export interface ColunasDoTempoReal {
  tempo_real: EstadoDoTempoReal;
  tempo_real_motivo: string | null;
  tempo_real_detalhe: string | null;
  tempo_real_em: string;
}

/** Hora de (re)conferir a assinatura deste formulário? Pura. */
export function precisaConferirTempoReal(
  linha: { tempo_real?: string | null; tempo_real_em?: string | null },
  agora: Date,
): boolean {
  if (!linha.tempo_real || !linha.tempo_real_em) return true;
  const idade = agora.getTime() - new Date(linha.tempo_real_em).getTime();
  if (Number.isNaN(idade)) return true;
  return idade >= (linha.tempo_real === "assinado" ? REVER_ASSINATURA_MS : REVER_RECUSA_MS);
}

/** Assina a Página e devolve as colunas a gravar. Nunca lança: recusa vira motivo. */
export async function ligarTempoReal(
  tokenDaPagina: string,
  pageId: string,
  agora: Date,
): Promise<ColunasDoTempoReal> {
  const r = await assinarLeadsDaPagina(tokenDaPagina, pageId).catch((erro: unknown) => ({
    ok: false as const,
    falha: "transitorio" as const,
    detalhe: erro instanceof Error ? erro.message : "falha desconhecida",
  }));
  if (r.ok) {
    return {
      tempo_real: "assinado",
      tempo_real_motivo: null,
      tempo_real_detalhe: null,
      tempo_real_em: agora.toISOString(),
    };
  }
  return {
    tempo_real: "recusado",
    tempo_real_motivo: r.falha,
    tempo_real_detalhe: r.detalhe.slice(0, 300),
    tempo_real_em: agora.toISOString(),
  };
}

/** Grava o resultado em TODOS os formulários da empresa naquela Página. */
export async function gravarTempoReal(
  admin: SupabaseClient,
  organizationId: string,
  pageId: string,
  colunas: ColunasDoTempoReal,
): Promise<void> {
  const { error } = await admin
    .from("mia_leads_da_meta_formularios")
    .update(colunas)
    .eq("organization_id", organizationId)
    .eq("page_id", pageId);
  if (error) {
    logger.warn("[leads-da-meta] resultado do tempo real não gravado", {
      organization_id: organizationId,
      detalhe: error.message.slice(0, 200),
    });
  }
}
