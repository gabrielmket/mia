/**
 * FORK MIA (MIA-169) — o consumidor das CONVERSÕES DO SITE
 * (docs/fork/conversoes-da-meta.md, seção "Conversões do site").
 *
 * O par nosso de `etapa-meta.handler.ts` e `qualificacao.handler.ts`: quando um
 * negócio entra numa etapa com regras do site ligadas (`mia_regras_de_conversao_do_site`,
 * 9170), cada regra manda o seu evento pelo MESMO `processarConversao`, que
 * delega a `./site.ts`. Uma etapa pode ter várias regras (a "Assinante" leva
 * Subscribe, Purchase e a ação do Google): cada uma tem a sua chave no livro-razão.
 *
 * As travas são as dos dois consumidores do upstream, na mesma ordem:
 *  - o que já foi enviado não sai de novo (sair e voltar à etapa não duplica);
 *  - movimento anterior à regra não envia (`configured_at`: ligar uma regra não
 *    despeja o histórico do funil);
 *  - a etapa precisa ser desta organização e estar aberta.
 *
 * O REENVIO (`ad_conversion.retry_requested`) não passa por aqui: as chaves são
 * `MetaEtapa:<id da regra>` e `Etapa:<id da regra>`, e os consumidores do
 * upstream já as pegam, leem o retrato e chamam `processarConversao`, que
 * devolve a decisão a `./site.ts`. Escutar aqui também mandaria duas vezes.
 */
import { z } from "zod";

import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

import { processarConversao } from "./envio.handler";
import { lerRegistro } from "./registro-de-envio";
import { chaveDaRegraDoSite, lerRegrasDoSiteDaEtapa } from "./site";

const KEY = "conversoes.etapa_site";
const ignorar = (detail: string): HandlerResult => ({ consumer_key: KEY, status: "skipped", detail });

/** Junta o desfecho de cada regra: uma que pede nova tentativa reagenda o evento inteiro. */
function juntar(resultados: HandlerResult[]): HandlerResult {
  const detalhe = resultados.map((r) => r.detail ?? r.status).join("; ");
  const reagendar = resultados.filter((r) => r.status === "retry" && r.retry_at);
  if (reagendar.length > 0) {
    const retry_at = reagendar.map((r) => r.retry_at!).sort()[0];
    return { consumer_key: KEY, status: "retry", retry_at, detail: detalhe };
  }
  if (resultados.some((r) => r.status === "ok")) return { consumer_key: KEY, status: "ok", detail: detalhe };
  return { consumer_key: KEY, status: "skipped", detail: detalhe };
}

async function handle(row: EventRow): Promise<HandlerResult> {
  if (!row.entity_id) return ignorar("sem_entidade");
  if (row.event_type !== "lead.stage_changed") return ignorar("outro_evento");
  const etapaId = z.uuid().safeParse(row.payload.to_stage_id);
  if (!etapaId.success || !row.created_at || !Number.isFinite(Date.parse(row.created_at)))
    return ignorar("sem_etapa_ou_data");

  const admin = createAdminClient();
  try {
    const regras = await lerRegrasDoSiteDaEtapa(admin, row.organization_id, etapaId.data);
    if (regras.length === 0) return ignorar("etapa_sem_regra_do_site");

    const { data: etapa, error: erroEtapa } = await admin
      .from("crm_stages")
      .select("id")
      .eq("organization_id", row.organization_id)
      .eq("id", etapaId.data)
      .eq("is_won", false)
      .eq("is_lost", false)
      .maybeSingle();
    if (erroEtapa) throw erroEtapa;
    if (!etapa) return ignorar("etapa_invalida");

    const resultados: HandlerResult[] = [];
    for (const regra of regras) {
      const evento = chaveDaRegraDoSite(regra);
      const registro = await lerRegistro(admin, row.organization_id, row.entity_id, evento);
      if (registro?.status === "sent") {
        resultados.push(ignorar(`${evento}: ja_enviada`));
        continue;
      }
      // Com retrato, o retrato vale (é a nova tentativa do mesmo movimento).
      const ocorridoEm = registro?.event_occurred_at ?? row.created_at;
      if (!registro?.event_occurred_at && Date.parse(row.created_at) < Date.parse(regra.configuredAt)) {
        resultados.push(ignorar(`${evento}: anterior_a_configuracao`));
        continue;
      }
      const r = await processarConversao(row, {
        ocorridoEm,
        evento,
        ...(regra.plataforma === "meta_ads"
          ? { eventoMeta: regra.eventoMeta ?? undefined }
          : { googleActionId: regra.googleAcaoId ?? undefined }),
      });
      resultados.push({ ...r, detail: `${evento}: ${r.detail ?? r.status}` });
    }
    return juntar(resultados);
  } catch {
    return {
      consumer_key: KEY,
      status: "retry",
      retry_at: new Date(Date.now() + 300_000).toISOString(),
      detail: "Não foi possível processar a conversão do site. Nova tentativa agendada.",
    };
  }
}

export const conversaoDeEtapaDoSiteHandler: EventHandler = {
  key: KEY,
  naOrgParada: "pula",
  events: ["lead.stage_changed"],
  handle,
};
