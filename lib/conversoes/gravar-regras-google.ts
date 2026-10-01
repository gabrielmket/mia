/**
 * FORK MIA — a GRAVAÇÃO das regras de conversão do Google Ads por etapa (0436),
 * tirada de dentro da ação `salvarRegrasDeConversaoGoogle` para uma função que
 * a tela e o MCP de plataforma chamam (docs/fork/mcp-de-implantacao.md, seção 5).
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
 *    que o livro-razão já usa para aquela etapa, e apagar faria uma religação
 *    futura nascer com outro nome, e reenviar negócios que já foram.
 * 2. Toda etapa LIGADA precisa ser desta organização e estar aberta: ganho é a
 *    compra (outro consumidor) e perda não é conversão.
 * 3. O `event_name` de uma etapa nasce uma vez (`Etapa:<uuid>`) e não muda; a
 *    qualificação migrada da 0402 mantém `QualifiedLead`.
 *
 * ⚠️ O cliente é o de serviço: `organizationId` vem de fonte confiável (a sessão
 * resolvida, ou a organização conferida pelo MCP), nunca do pedido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { eventoDaEtapa, type CanalDeEntrada, type CategoriaDeConversao } from "./regras-google";

export interface RegraGoogleParaGravar {
  stage_id: string;
  enabled: boolean;
  label: string;
  google_action_id: string;
  category: CategoriaDeConversao;
  included_in_conversions: boolean;
  channel: CanalDeEntrada;
}

export type ResultadoDeGravarRegrasGoogle =
  | { ok: true; ligadas: number; desligadas: number }
  | { ok: false; error: "etapa_invalida" | "erro_ao_gravar"; details?: unknown };

export async function gravarRegrasDeConversaoGoogle(
  admin: SupabaseClient,
  quem: { organizationId: string; autorUserId: string },
  regras: readonly RegraGoogleParaGravar[],
): Promise<ResultadoDeGravarRegrasGoogle> {
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
    .from("google_ads_conversion_rules")
    .select("stage_id, event_name, label, google_action_id")
    .eq("organization_id", orgId);
  if (erroLeitura) return { ok: false, error: "erro_ao_gravar" };
  type Existente = {
    stage_id: string;
    event_name: string;
    label: string;
    google_action_id: string;
  };
  const existentePorEtapa = new Map(
    ((existentes ?? []) as Existente[]).map((r) => [r.stage_id, r]),
  );

  // Regra desligada que nunca existiu não vira linha: não há nome a preservar.
  const linhas = regras
    .filter((r) => r.enabled || existentePorEtapa.has(r.stage_id))
    .map((r) => {
      // Desligada com campos vazios preserva o que já estava gravado: as
      // colunas são NOT NULL, e todas as linhas do upsert levam as mesmas.
      const antes = existentePorEtapa.get(r.stage_id);
      return {
        organization_id: orgId,
        stage_id: r.stage_id,
        event_name: antes?.event_name ?? eventoDaEtapa(r.stage_id),
        label: r.label || antes?.label || "Etapa do funil",
        google_action_id: r.google_action_id || antes?.google_action_id || "0",
        category: r.category,
        included_in_conversions: r.included_in_conversions,
        channel: r.channel,
        enabled: r.enabled,
        updated_by: quem.autorUserId,
      };
    });

  if (linhas.length > 0) {
    const { error } = await admin
      .from("google_ads_conversion_rules")
      .upsert(linhas, { onConflict: "organization_id,stage_id" });
    if (error) return { ok: false, error: "erro_ao_gravar", details: error.message };
  }

  // O que sumiu da lista é desligado — nunca apagado (ver o cabeçalho).
  const enviadas = new Set(regras.map((r) => r.stage_id));
  const sumidas = [...existentePorEtapa.keys()].filter((id) => !enviadas.has(id));
  if (sumidas.length > 0) {
    const { error } = await admin
      .from("google_ads_conversion_rules")
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
