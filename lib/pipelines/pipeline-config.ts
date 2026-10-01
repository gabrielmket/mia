/**
 * FORK MIA — a gravação da CONFIGURAÇÃO do funil (vocabulário, campos, motivos de
 * perda e de ganho, reabertura), fora da Server Action.
 *
 * A mescla morava em `app/actions/settings/updatePipelineConfig.ts`: ler
 * `vocabulary` e `settings` do funil, sobrepor só as chaves que vieram e
 * regravar. O MCP de plataforma grava as mesmas chaves ao montar o funil de um
 * cliente; com a mescla num lugar só, uma chave nova da tela passa a valer para
 * os dois caminhos sem ninguém lembrar de copiar.
 *
 * O `patch` chega já validado por `pipelineConfigPatchSchema`
 * (`lib/schemas/settings.ts`), o mesmo da tela.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PipelineConfigPatch } from "@/lib/schemas/settings";

export type ResultadoDaConfiguracaoDoFunil =
  | { ok: true; mudou: boolean }
  | { ok: false; error: "not_found" | "forbidden_tenant" | (string & {}) };

/** Texto canônico (chaves ordenadas) para comparar dois jsonb sem depender da ordem. */
function estavel(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(estavel).join(",")}]`;
  if (valor !== null && typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${estavel(v)}`).join(",")}}`;
  }
  return JSON.stringify(valor ?? null);
}

/**
 * Mescla e grava. `organizationId` é a organização de quem chama, resolvida de
 * fonte confiável: funil de outra organização responde `forbidden_tenant`, como
 * a action sempre respondeu.
 */
export async function gravarConfiguracaoDoFunil(
  supabase: SupabaseClient,
  args: { organizationId: string; pipelineId: string; patch: PipelineConfigPatch },
): Promise<ResultadoDaConfiguracaoDoFunil> {
  const { organizationId, pipelineId, patch } = args;

  const { data: row, error: readErr } = await supabase
    .from("crm_pipelines")
    .select("vocabulary, settings, organization_id")
    .eq("id", pipelineId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!row) return { ok: false, error: "not_found" };
  if (row.organization_id !== organizationId) return { ok: false, error: "forbidden_tenant" };

  const vocabularioAtual = (row.vocabulary as Record<string, unknown> | null) ?? {};
  const nextVocabulary = patch.vocabulary
    ? { ...vocabularioAtual, ...patch.vocabulary }
    : vocabularioAtual;

  const currentSettings = (row.settings as Record<string, unknown> | null) ?? {};
  const nextSettings: Record<string, unknown> = { ...currentSettings };
  if (patch.fields !== undefined) nextSettings.fields = patch.fields;
  if (patch.lost_reasons !== undefined) nextSettings.lost_reasons = patch.lost_reasons;
  if (patch.won_reasons !== undefined) nextSettings.won_reasons = patch.won_reasons;
  if (patch.won_reason_required !== undefined) {
    nextSettings.won_reason_required = patch.won_reason_required;
  }
  if (patch.reabertura !== undefined) nextSettings.reabertura = patch.reabertura;
  if (patch.reabertura_campos !== undefined) {
    nextSettings.reabertura_campos = patch.reabertura_campos;
  }
  // Ver `lib/crm/metas/progresso.ts`: ausente = vencer aqui é receita.
  if (patch.vitoria_e_receita !== undefined) {
    nextSettings.vitoria_e_receita = patch.vitoria_e_receita;
  }

  // Para quem repete a mesma gravação (a implantação roda mais de uma vez):
  // `mudou` diz se o que foi pedido já era o que estava gravado.
  const mudou =
    estavel(nextVocabulary) !== estavel(vocabularioAtual) ||
    estavel(nextSettings) !== estavel(currentSettings);

  const { error } = await supabase
    .from("crm_pipelines")
    .update({ vocabulary: nextVocabulary, settings: nextSettings })
    .eq("id", pipelineId)
    // Redundante com a conferência acima quando o client é o da sessão (a RLS já
    // recorta); obrigatório quando é o `service_role` do MCP de plataforma.
    .eq("organization_id", organizationId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, mudou };
}
