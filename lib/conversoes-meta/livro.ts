/**
 * FORK MIA — o livro-razão, do jeito que o consumidor da Meta o lê.
 *
 * A ESCRITA é a do upstream (`registraEnvio`, `lib/conversoes/registro-de-envio.ts`):
 * uma linha por negócio e evento, `sent` nunca rebaixado. A LEITURA daqui traz
 * uma coluna a mais que a dele, o MOTIVO, porque a Meta precisa separar duas
 * linhas que não foram enviadas:
 *
 *   · a que guarda o RETRATO de um evento de verdade (o negócio passou nas
 *     travas e só faltou a conexão, ou a Meta recusou): o reenvio e a volta à
 *     etapa usam esse retrato, com a data e o valor do primeiro envio;
 *   · a que registra uma DECISÃO ("anterior à regra", "formulário desligado"):
 *     não é pendência, e um movimento novo que passe nas travas é evento novo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { registraEnvio, type StatusDeEnvio } from "@/lib/conversoes/registro-de-envio";
import type { NomeDoEvento } from "@/lib/plataformas-de-anuncio/types";

import { MOTIVOS_QUE_NAO_SAO_EVENTO } from "./situacao";

export interface RegistroDaMeta {
  status: string;
  platform: string;
  reason: string | null;
  value_cents: number | null;
  currency: string | null;
  event_occurred_at: string | null;
  remote_request_id: string | null;
}

/** Leitura falha fechada: erro de banco nunca autoriza um segundo envio. */
export async function lerRegistroDaMeta(
  admin: SupabaseClient,
  organizationId: string,
  leadId: string,
  evento: string,
): Promise<RegistroDaMeta | null> {
  const { data, error } = await admin
    .from("ad_conversion_dispatches")
    .select("status, platform, reason, value_cents, currency, event_occurred_at, remote_request_id")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .eq("event_name", evento)
    .maybeSingle();
  if (error) throw new Error("Não foi possível consultar o registro de conversão.");
  return (data as RegistroDaMeta | null) ?? null;
}

/** A linha guarda o retrato de um evento de verdade (e não uma decisão das travas)? */
export function temRetrato(registro: RegistroDaMeta | null): registro is RegistroDaMeta & { event_occurred_at: string } {
  return Boolean(
    registro?.event_occurred_at &&
      registro.status !== "sent" &&
      !(registro.reason !== null && MOTIVOS_QUE_NAO_SAO_EVENTO.includes(registro.reason)),
  );
}

export interface LinhaParaRegistrar {
  organizationId: string;
  leadId: string;
  /** `Meta:<evento>` para etapa, `Purchase` para a venda do lead de formulário. */
  evento: string;
  status: StatusDeEnvio;
  motivo: string | null;
  detalhe?: string | null;
  valorCentavos: number | null;
  moeda: string | null;
  /** Quando o evento aconteceu. Só os eventos de etapa guardam (é o retrato). */
  ocorridoEm?: string;
}

/** Grava o desfecho pela escrita do upstream. Falha propaga: o consumidor reagenda. */
export async function registrarNoLivro(admin: SupabaseClient, linha: LinhaParaRegistrar): Promise<void> {
  await registraEnvio(admin, {
    organizationId: linha.organizationId,
    leadId: linha.leadId,
    plataforma: "meta_ads",
    // O tipo do upstream só enumera os eventos dele; `Meta:<evento>` é texto na
    // coluna, como `Etapa:<uuid>` também é.
    evento: linha.evento as NomeDoEvento,
    status: linha.status,
    motivo: linha.motivo,
    eventoId: `${linha.leadId}:${linha.evento}`,
    valorCentavos: linha.valorCentavos,
    moeda: linha.moeda,
    detalhe: linha.detalhe ?? null,
    ...(linha.ocorridoEm ? { ocorridoEm: linha.ocorridoEm } : {}),
  });
}
