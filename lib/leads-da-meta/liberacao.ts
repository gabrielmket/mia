/**
 * FORK MIA — esta empresa pode usar a importação dos leads da Meta?
 *
 * Com o módulo desligado (`LEADS_DA_META_E_MODULO_VENDAVEL = false`) a resposta é
 * sempre sim, sem consultar o banco. Ligado, é a liberação viva em
 * `organization_modules` — e leitura que falha RECUSA, como em `moduloLiberado`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { moduloLiberado } from "@/lib/modulos/liberacao";

import { LEADS_DA_META_E_MODULO_VENDAVEL, MODULO_DOS_LEADS_DA_META } from "./modulo";

export async function leadsDaMetaLiberados(
  db: SupabaseClient,
  organizationId: string,
  exigeModulo: boolean = LEADS_DA_META_E_MODULO_VENDAVEL,
): Promise<boolean> {
  if (!exigeModulo) return true;
  return moduloLiberado(db, organizationId, MODULO_DOS_LEADS_DA_META);
}
