/**
 * FORK MIA — a GRAVAÇÃO das regras de conversão da Meta por etapa (0524 do
 * upstream), tirada de dentro da ação `salvarRegrasDeConversaoMeta` para uma
 * função que a tela e o MCP de plataforma chamam. É o par de
 * `gravar-regras-google.ts`, pelo mesmo motivo (docs/fork/mcp-de-implantacao.md,
 * seção 5, e docs/fork/conversoes-da-meta.md).
 *
 * O miolo é o que o upstream escreveu, sem mudança de regra: a ação ficou com a
 * sessão, o papel, o segundo fator, a auditoria e a revalidação da tela; aqui
 * ficou o que não depende de quem pede. Se o upstream mexer no miolo, o conflito
 * aparece na fusão da ação, e a mudança dele entra aqui.
 *
 * ── As três regras que ele carrega ──────────────────────────────────────────
 *
 * 1. Quem chama manda a lista INTEIRA das etapas, cada uma ligada ou não. Regra
 *    que some da lista é DESLIGADA, nunca apagada: a linha guarda o `event_name`
 *    que o livro-razão já usa para aquela etapa.
 * 2. Toda etapa LIGADA precisa ser desta organização e estar aberta: ganho é a
 *    compra (outro consumidor) e perda não é conversão.
 * 3. O `event_name` de uma etapa nasce uma vez (`MetaEtapa:<uuid>`) e não muda.
 *
 * ⚠️ O cliente é o de serviço: `organizationId` vem de fonte confiável (a sessão
 * resolvida, ou a organização conferida pelo MCP), nunca do pedido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { eventoDaEtapaMeta, type EventoDaMeta } from "./regras-meta";

export interface RegraMetaParaGravar {
  stage_id: string;
  enabled: boolean;
  meta_event: EventoDaMeta;
}

export type ResultadoDeGravarRegrasMeta =
  | { ok: true; ligadas: number; desligadas: number }
  | { ok: false; error: "etapa_invalida" | "erro_ao_gravar"; details?: unknown };

export async function gravarRegrasDeConversaoMeta(
  admin: SupabaseClient,
  quem: { organizationId: string; autorUserId: string },
  regras: readonly RegraMetaParaGravar[],
): Promise<ResultadoDeGravarRegrasMeta> {
  const orgId = quem.organizationId;

  // Toda etapa ligada precisa ser DESTA organização e estar aberta: ganho é a
  // compra (outro consumidor) e perda não é conversão.
  const ligadas = regras.filter((r) => r.enabled).map((r) => r.stage_id);
  if (ligadas.length > 0) {
    const { data: etapas, error } = await admin
      .from("crm_stages")
      .select("id")
      .eq("organization_id", orgId)
      .eq("is_won", false)
      .eq("is_lost", false)
      .in("id", ligadas);
    if (error) return { ok: false, error: "erro_ao_gravar" };
    const validas = new Set(((etapas ?? []) as Array<{ id: string }>).map((e) => e.id));
    if (ligadas.some((id) => !validas.has(id))) return { ok: false, error: "etapa_invalida" };
  }

  const { data: existentes, error: erroLeitura } = await admin
    .from("meta_ads_conversion_rules")
    .select("stage_id, event_name")
    .eq("organization_id", orgId);
  if (erroLeitura) return { ok: false, error: "erro_ao_gravar" };
  const existentePorEtapa = new Map(
    ((existentes ?? []) as Array<{ stage_id: string; event_name: string }>).map((r) => [
      r.stage_id,
      r,
    ]),
  );

  // Regra desligada que nunca existiu não vira linha: não há nome a preservar.
  const linhas = regras
    .filter((r) => r.enabled || existentePorEtapa.has(r.stage_id))
    .map((r) => ({
      organization_id: orgId,
      stage_id: r.stage_id,
      event_name: existentePorEtapa.get(r.stage_id)?.event_name ?? eventoDaEtapaMeta(r.stage_id),
      meta_event: r.meta_event,
      enabled: r.enabled,
      updated_by: quem.autorUserId,
    }));

  if (linhas.length > 0) {
    const { error } = await admin
      .from("meta_ads_conversion_rules")
      .upsert(linhas, { onConflict: "organization_id,stage_id" });
    if (error) return { ok: false, error: "erro_ao_gravar", details: error.message };
  }

  // O que sumiu da lista é desligado — nunca apagado (ver o cabeçalho).
  const enviadas = new Set(regras.map((r) => r.stage_id));
  const sumidas = [...existentePorEtapa.keys()].filter((id) => !enviadas.has(id));
  if (sumidas.length > 0) {
    const { error } = await admin
      .from("meta_ads_conversion_rules")
      .update({ enabled: false, updated_by: quem.autorUserId })
      .eq("organization_id", orgId)
      .in("stage_id", sumidas);
    if (error) return { ok: false, error: "erro_ao_gravar", details: error.message };
  }

  return {
    ok: true,
    ligadas: ligadas.length,
    desligadas: regras.length - ligadas.length + sumidas.length,
  };
}
