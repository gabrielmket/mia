/**
 * FORK MIA (.90) — O PREÇO POR MENSAGEM DO BROADCAST, com o plano.
 *
 * Antes, o preço era só o combinado com a empresa (`tenant_broadcast_pricing`,
 * gravado pela Time) e, sem ele, o disparo RECUSAVA. No autoatendimento ninguém
 * combina preço à mão: o preço vem do plano (`mia_plano_modulos`,
 * `preco_por_mensagem_cents`). A ordem:
 *   1. o preço combinado com a empresa, quando existe (a Time negociou);
 *   2. senão, o do plano da assinatura, com a cobrança ligada;
 *   3. senão, nenhum — e o disparo continua recusando, como sempre.
 * Com a cobrança desligada, só vale o 1: nada muda para quem já usa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { moduloLigado } from "@/lib/instalacao/modulos";

export interface PrecoPorMensagem {
  cents: number | null;
  origem: "combinado" | "plano" | null;
}

/**
 * O preço do PLANO, para quem não tem preço combinado. `null` = não há (cobrança
 * desligada, isenta, plano sem preço). Nunca lança: na dúvida, o disparo recusa.
 */
export async function precoDoPlano(admin: SupabaseClient, orgId: string): Promise<number | null> {
  try {
    if (!(await moduloLigado(admin, "cobranca"))) return null;
    const { data: a } = await admin
      .from("cobranca_assinaturas")
      .select("plano_id")
      .eq("organization_id", orgId)
      .maybeSingle();
    const planoId = (a as { plano_id?: string } | null)?.plano_id;
    if (!planoId) return null;
    const { data: lado } = await admin
      .from("mia_plano_modulos")
      .select("preco_por_mensagem_cents")
      .eq("plano_id", planoId)
      .maybeSingle();
    const v = (lado as { preco_por_mensagem_cents?: number | null } | null)
      ?.preco_por_mensagem_cents;
    return v === null || v === undefined ? null : Number(v);
  } catch {
    return null;
  }
}

/** O preço que vale para a empresa: o combinado (`combinadoCents`, já lido por quem chama), senão o do plano. */
export async function precoPorMensagemDaEmpresa(
  admin: SupabaseClient,
  orgId: string,
  combinadoCents: number | null,
): Promise<PrecoPorMensagem> {
  if (combinadoCents !== null) return { cents: combinadoCents, origem: "combinado" };
  const doPlano = await precoDoPlano(admin, orgId);
  return doPlano === null ? { cents: null, origem: null } : { cents: doPlano, origem: "plano" };
}
