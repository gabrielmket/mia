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
 *
 * Desde a .95 o preço por E-MAIL segue o MESMO caminho
 * (`lib/planos-mia/preco-por-email.ts`): a leitura do plano é uma só,
 * `precoDoPlanoDaEmpresa`, com a coluna de cada preço.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { moduloLigado } from "@/lib/instalacao/modulos";

export interface PrecoPorMensagem {
  cents: number | null;
  origem: "combinado" | "plano" | null;
}

/** As colunas de preço da linha nossa do plano (`mia_plano_modulos`). */
export type ColunaDePrecoDoPlano = "preco_por_mensagem_cents" | "preco_por_email_cents";

/**
 * O preço que o PLANO da assinatura dá, na coluna pedida. `null` = não há:
 * cobrança desligada, empresa isenta (sem assinatura), plano sem linha nossa ou
 * plano que não diz o preço. Lê o `plano_id` (o atual), nunca o agendado: é o
 * upstream quem decide quando a troca vale, e o preço segue. LANÇA se uma
 * leitura falha: quem chama decide o que a dúvida vale.
 */
export async function precoDoPlanoDaEmpresa(
  admin: SupabaseClient,
  orgId: string,
  coluna: ColunaDePrecoDoPlano,
): Promise<number | null> {
  if (!(await moduloLigado(admin, "cobranca"))) return null;
  const { data: a, error: erroDaAssinatura } = await admin
    .from("cobranca_assinaturas")
    .select("plano_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (erroDaAssinatura)
    throw new Error(`assinatura: leitura falhou (${erroDaAssinatura.code ?? "sem_codigo"})`);
  const planoId = (a as { plano_id?: string } | null)?.plano_id;
  if (!planoId) return null;
  const { data: lado, error: erroDoPlano } = await admin
    .from("mia_plano_modulos")
    .select(coluna)
    .eq("plano_id", planoId)
    .maybeSingle();
  if (erroDoPlano)
    throw new Error(`preço do plano: leitura falhou (${erroDoPlano.code ?? "sem_codigo"})`);
  const v = (lado as Record<string, number | null | undefined> | null)?.[coluna];
  return v === null || v === undefined ? null : Number(v);
}

/**
 * O preço por mensagem do PLANO, para quem não tem preço combinado. `null` = não
 * há (cobrança desligada, isenta, plano sem preço). Nunca lança: na dúvida, o
 * disparo recusa.
 */
export async function precoDoPlano(admin: SupabaseClient, orgId: string): Promise<number | null> {
  try {
    return await precoDoPlanoDaEmpresa(admin, orgId, "preco_por_mensagem_cents");
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
