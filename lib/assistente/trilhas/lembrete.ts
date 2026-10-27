/**
 * FORK MIA (.93) — A TRILHA PAUSADA NO RESUMO DA MANHÃ (decisão 11 do protótipo
 * aprovado em 26/10/2026).
 *
 *   - UMA vez por pausa: o resumo marca `lembrada_em`, e o gatilho da 9090 só
 *     zera a marca quando a pessoa pausa de novo;
 *   - no resumo da manhã do dia SEGUINTE: a pausa é de antes do começo do dia
 *     da empresa, e de no máximo 4 dias atrás (o fim de semana e o feriado
 *     empurram o resumo; uma pausa antiga não é lembrada do nada);
 *   - só para quem tem o resumo ligado: este módulo só é chamado pelo resumo,
 *     que já escolheu quem recebe;
 *   - NUNCA no WhatsApp: o resumo mora no assistente e avisa no sino.
 *
 * Sem IA. O cliente é o de serviço (o cron), como o resto do resumo; o escopo
 * é a própria pessoa (a linha dela).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AcaoDoAssistente } from "../tipos";
import { trilhaPorId } from "./catalogo";
import { configDasTrilhasDaLinha } from "./estado";

/** Até quantos dias atrás uma pausa ainda é lembrada (o dia seguinte, empurrado pelo fim de semana). */
export const DIAS_DO_LEMBRETE = 4;

export interface LembreteDaTrilha {
  texto: string;
  acao: AcaoDoAssistente;
  /** Marca a pausa como lembrada. Chame só depois de o resumo ser gravado. */
  marcar: () => Promise<void>;
}

export async function lembreteDaTrilhaPausada(
  admin: Pick<SupabaseClient, "from">,
  entrada: { organizationId: string; userId: string; inicioDoDia: Date; t: (texto: string) => string },
): Promise<LembreteDaTrilha | null> {
  const { data: configLinha } = await admin
    .from("mia_assistente_trilhas_config")
    .select("me_mostra_como, desligadas, recomendada")
    .eq("organization_id", entrada.organizationId)
    .maybeSingle();
  const config = configDasTrilhasDaLinha(configLinha as Record<string, unknown> | null);
  if (!config.meMostraComo) return null;

  const limite = new Date(entrada.inicioDoDia.getTime() - DIAS_DO_LEMBRETE * 86_400_000);
  const { data, error } = await admin
    .from("mia_assistente_trilhas")
    .select("id, trilha, passo, pausou_em")
    .eq("organization_id", entrada.organizationId)
    .eq("user_id", entrada.userId)
    .eq("situacao", "pausada")
    .is("lembrada_em", null)
    .lt("pausou_em", entrada.inicioDoDia.toISOString())
    .gte("pausou_em", limite.toISOString())
    .order("pausou_em", { ascending: false })
    .limit(5);
  if (error) return null;
  const linha = ((data ?? []) as Array<{ id: string; trilha: string; passo: number }>).find((l) => {
    const t = trilhaPorId(l.trilha);
    return t && !config.desligadas.includes(t.id);
  });
  if (!linha) return null;
  const trilha = trilhaPorId(linha.trilha)!;
  const t = entrada.t;
  const passo = Math.min(Math.max(0, Number(linha.passo) || 0), trilha.passos.length - 1) + 1;

  return {
    texto:
      `${t("Você pausou a trilha")} "${t(trilha.titulo)}" ${t("no passo")} ${passo} ${t("de")} ${trilha.passos.length}. ` +
      t("Quando quiser, eu continuo de onde parou e confiro cada passo no sistema."),
    acao: { tipo: "me_mostra_como", rotulo: "Continuar de onde parei", trilha_id: trilha.id },
    marcar: async () => {
      await admin.from("mia_assistente_trilhas").update({ lembrada_em: new Date().toISOString() }).eq("id", linha.id);
    },
  };
}

/** A retenção das trilhas (9090), chamada pela mesma rodada do resumo. */
export async function expurgarTrilhasVencidas(admin: Pick<SupabaseClient, "rpc">): Promise<number | null> {
  const { data, error } = await admin.rpc("fn_mia_expurgar_trilhas_vencidas", { p_dias: 365, p_limite: 5000 });
  if (error) return null;
  return Number((data as { trilhas?: number } | null)?.trilhas ?? 0);
}
