/**
 * FORK MIA (.96) · PARA ONDE VAI A EMPRESA PARADA.
 *
 * A empresa que nasceu num plano de ENTRADA PAGA (0 dia de teste) fica suspensa
 * pelo gatilho do upstream (0679) até o primeiro pagamento, com o tipo
 * `cobranca` e `cobranca_assinaturas.pagamento_inicial_pendente = true`. Ela não
 * deve nada: o destino dela é o passo "Pagamento" do início
 * (`/onboarding/pagamento`), nunca a tela "Conta suspensa" (protótipo
 * "Pagamento no início", 27/10/2026). Todo outro caso de empresa parada
 * (atraso de quem já pagou, suspensão administrativa, redigida) continua indo
 * para `/account-suspended`, como no upstream.
 *
 * Os pontos de ligação, cada um com `FORK MIA (.96)`: `resolveActiveOrg`
 * (lib/auth/server.ts), o layout de `/app`, o layout do início e o hub
 * `/account-suspended`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

export const CAMINHO_DO_PASSO_DO_PAGAMENTO = "/onboarding/pagamento";
export const CAMINHO_DA_SUSPENSAO = "/account-suspended";

/**
 * O motivo que o gatilho da entrada paga do upstream (0679) grava na suspensão.
 * O bloqueio no fim do teste (9122) grava o MESMO: daí em diante é a entrada paga.
 */
export const MOTIVO_DA_ENTRADA_PAGA = "Aguardando o primeiro pagamento";

/**
 * A empresa está parada SÓ porque espera o primeiro pagamento da entrada paga:
 * suspensão do tipo cobrança E a assinatura com o primeiro pagamento pendente.
 * Leitura que falha devolve `false` (o caminho do upstream, a tela de suspensão).
 */
export async function vaiAoPassoDoPagamento(
  orgId: string,
  suspendedKind: string | null | undefined,
  admin?: SupabaseClient,
): Promise<boolean> {
  if (suspendedKind !== "cobranca") return false;
  try {
    const { data, error } = await (admin ?? createAdminClient())
      .from("cobranca_assinaturas")
      .select("pagamento_inicial_pendente")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error) return false;
    return (data as { pagamento_inicial_pendente?: boolean } | null)?.pagamento_inicial_pendente === true;
  } catch {
    return false;
  }
}

/** O destino da empresa parada: o passo do pagamento (entrada paga) ou a tela de suspensão. */
export async function destinoDaEmpresaParada(
  org: { orgId: string; suspended_kind?: string | null },
  admin?: SupabaseClient,
): Promise<string> {
  return (await vaiAoPassoDoPagamento(org.orgId, org.suspended_kind ?? null, admin))
    ? CAMINHO_DO_PASSO_DO_PAGAMENTO
    : CAMINHO_DA_SUSPENSAO;
}
