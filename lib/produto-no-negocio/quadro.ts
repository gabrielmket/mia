/**
 * FORK MIA (.109) · a linha do item no cartão do quadro (tela 1 do protótipo).
 *
 * Uma leitura por quadro (não uma por cartão), dentro de `comSinaisDoCartao`.
 * Nunca lança: se a leitura falhar, devolve `null` e o cartão fica sem a linha,
 * como era antes; o quadro não cai por causa dela.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { linhaDoCartao, type LinhaDoCartao } from "./regras";
import { lerItensDosNegocios } from "./servidor";

export async function itensDoQuadro(
  db: SupabaseClient,
  org: string,
  leadIds: readonly string[],
): Promise<Map<string, LinhaDoCartao> | null> {
  try {
    const itens = await lerItensDosNegocios(db, org, leadIds);
    const linhas = new Map<string, LinhaDoCartao>();
    for (const [leadId, lista] of itens) {
      const linha = linhaDoCartao(lista);
      if (linha) linhas.set(leadId, linha);
    }
    return linhas;
  } catch (err) {
    logger.warn("cartao_itens_falhou", {
      organization_id: org,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
