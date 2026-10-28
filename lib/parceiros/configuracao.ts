/**
 * FORK MIA (.97) · A CONFIGURAÇÃO DA COMISSÃO DOS PARCEIROS: a alíquota do
 * Simples (um campo só, para todo o sistema) e os dias do calendário do repasse
 * (fecha no dia 1, nota até o dia 5, Pix até o dia 10). Da INSTALAÇÃO: mora em
 * `platform_config` (`MIA_COMISSAO_DOS_PARCEIROS`, texto JSON, não é segredo),
 * editada em Admin › Cobrança › Conexão com a verificação em duas etapas.
 *
 * Mudar a alíquota vale para os pagamentos seguintes: cada comissão grava a
 * alíquota do dia em que nasceu (`mia_comissoes.aliquota_pct`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { CONFIGURACAO_PADRAO, configuracaoDaComissaoSchema, type ConfiguracaoDaComissao } from "./regras";

export const CHAVE_DA_COMISSAO = "MIA_COMISSAO_DOS_PARCEIROS";

/** A configuração gravada, ou a padrão (sem alíquota). Nunca lança. */
export async function lerConfiguracaoDaComissao(admin: SupabaseClient): Promise<ConfiguracaoDaComissao> {
  try {
    const { data, error } = await admin.from("platform_config").select("valor").eq("chave", CHAVE_DA_COMISSAO).maybeSingle();
    if (error || !data || typeof (data as { valor?: unknown }).valor !== "string") return CONFIGURACAO_PADRAO;
    const lido = configuracaoDaComissaoSchema.safeParse(JSON.parse((data as { valor: string }).valor));
    return lido.success ? lido.data : CONFIGURACAO_PADRAO;
  } catch {
    return CONFIGURACAO_PADRAO;
  }
}

/** Grava (quem chama já conferiu o dono da instalação e o MFA). */
export async function gravarConfiguracaoDaComissao(
  admin: SupabaseClient,
  entrada: unknown,
  ator: string,
): Promise<{ ok: true; config: ConfiguracaoDaComissao } | { ok: false; motivo: "invalida" | "ordem_dos_dias" | "falha_no_banco" }> {
  const lido = configuracaoDaComissaoSchema.safeParse(entrada);
  if (!lido.success) {
    const ordem = lido.error.issues.some((i) => i.message === "ordem_dos_dias");
    return { ok: false, motivo: ordem ? "ordem_dos_dias" : "invalida" };
  }
  const { error } = await admin.from("platform_config").upsert(
    { chave: CHAVE_DA_COMISSAO, valor: JSON.stringify(lido.data), eh_segredo: false, semeado_do_env: false, updated_by: ator },
    { onConflict: "chave" },
  );
  if (error) return { ok: false, motivo: "falha_no_banco" };
  return { ok: true, config: lido.data };
}
