/**
 * FORK MIA (MIA-168) · O CONSUMIDOR DE `cadastro.empresa_nasceu`.
 *
 * O gatilho da 9169 (depois do insert em `mia_origem_da_empresa`, origem
 * `cadastro`) emite o evento na org do CLIENTE. Aqui o card do cadastro, no CRM
 * da Time, vai a "Cadastro concluído" e, se a empresa nasceu no teste, a "Em
 * teste" (`lib/planos-mia/lead-do-cadastro.ts`).
 *
 * Roda com a empresa parada (`naOrgParada: "roda"`): a entrada paga nasce
 * suspensa, esperando o primeiro pagamento, e o cadastro dela também conta.
 * O que falta (a fonte, uma etapa, uma leitura) volta como `skipped` e não como
 * `error`: o problema é da configuração da Time, não da empresa do cliente, e
 * no teto o dreno abriria `event_dead` na Central DELA. A rodada horária da
 * jornada cura (`rodadaDoCadastroNaTime`).
 */
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

import { aoNascerAEmpresa } from "./lead-do-cadastro";

const CONSUMER_KEY = "planos_mia.lead_do_cadastro";

async function handle(row: EventRow): Promise<HandlerResult> {
  const r = await aoNascerAEmpresa(createAdminClient(), row.organization_id);
  if (r.status === "ok") return { consumer_key: CONSUMER_KEY, status: "ok", detail: r.momentos.join(",") || "ja_informado" };
  return { consumer_key: CONSUMER_KEY, status: "skipped", detail: `${r.status}:${r.motivo}` };
}

export const leadDoCadastroHandler: EventHandler = {
  key: CONSUMER_KEY,
  naOrgParada: "roda",
  events: ["cadastro.empresa_nasceu"],
  handle,
};
