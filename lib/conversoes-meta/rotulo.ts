/**
 * FORK MIA — o nome que a pessoa reconhece para um envio da Meta no livro-razão
 * (`ad_conversion_dispatches`), para o diagnóstico da Meta, a seção Origem do
 * cartão aberto e o MCP de plataforma.
 *
 * Desde a .72 os eventos de etapa da Meta são os da régua do upstream (0524):
 * a chave no livro é `MetaEtapa:<uuid>` e o RETRATO do que saiu mora em
 * `meta_event_name` (`LeadSubmitted`, `QualifiedLead`…). O rótulo vem da lista do
 * upstream (`rotuloDoEventoDaMeta`), num lugar só.
 *
 * `null` = não é um envio que este módulo sabe nomear (os do Google, por
 * exemplo): quem chama cai no rótulo dele.
 */
import { rotuloDoEventoDaMeta } from "@/lib/conversoes/regras-meta";

export function rotuloDoEnvioDaMeta(eventName: string, metaEventName?: string | null): string | null {
  if (eventName === "Purchase") return "Compra";
  if (eventName.startsWith("MetaEtapa:")) return metaEventName ? rotuloDoEventoDaMeta(metaEventName) : "Etapa do funil";
  return null;
}
