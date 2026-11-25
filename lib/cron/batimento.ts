/**
 * FORK MIA (MIA-154) — O BATIMENTO DE UM CRON: ELE PASSOU, E QUANDO?
 *
 * ─── O buraco que isto fecha ─────────────────────────────────────────────────
 *
 * O vigia dos números (`app/api/v1/cron/channel-health`) roda a cada 5 min e,
 * numa rodada estável (todo número `WORKING`, contador zero), não escreve NADA:
 * é de propósito, para a rodada comum não pagar uma escrita por sessão. O efeito
 * colateral é que ninguém (a ronda, o trem, o n8n) consegue saber se ele passou.
 * Em 23/11 a ronda leu `last_health_check_at`, que é da tela de Conexões, e
 * concluiu que a checagem tinha parado desde 19/11 (MIA-152). Não tinha.
 *
 * ─── O desenho ───────────────────────────────────────────────────────────────
 *
 * Uma linha por rota em `public.mia_batimentos_de_cron` (migration 9168),
 * regravada por `upsert` no fim da rodada: uma escrita a cada batida, que
 * sobrevive a reinício do Redis e do app. É o padrão do bloco `backup` da
 * `/api/v1/health` (FORK MIA .62): carimbo no banco, julgado com prazo, exposto
 * como `em_dia`.
 *
 * O `resumo` carrega SÓ contagens (sessões, verificadas, desfechos). Nunca id
 * de empresa, nome de número ou telefone: a `/health` é pública, e o resumo é
 * o tipo de campo que alguém um dia resolve publicar.
 *
 * ─── O batimento nunca derruba a rota ────────────────────────────────────────
 *
 * Falhou a escrita (tabela que ainda não existe porque o baseline não passou,
 * rede, permissão), vira `logger.warn` e a rodada responde o que responderia.
 * O vigia é o que importa; o batimento é o recibo dele.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

/** A tabela do batimento (migration 9168). */
export const TABELA_DO_BATIMENTO = "mia_batimentos_de_cron";

/** A rota do vigia dos números, como ela aparece na linha do batimento. */
export const ROTA_DO_VIGIA_DOS_CANAIS = "channel-health";

/**
 * A régua de `em_dia` do vigia: 15 min, três batidas do agendamento de 5 min
 * (`docker/scheduler/entrypoint.sh`). Uma batida perdida (deploy, app
 * reiniciando) não é alarme; três seguidas é.
 */
export const MINUTOS_PARA_EM_DIA_DO_VIGIA = 15;

/** Só contagens. Nada que identifique empresa, número ou pessoa. */
export type ResumoDoBatimento = Record<string, number | string | boolean>;

/**
 * Grava (ou regrava) o batimento da rota. Nunca lança: qualquer falha vira
 * `logger.warn` com a rota e o motivo, e a rota segue.
 */
export async function registrarBatimento(
  admin: Pick<SupabaseClient, "from">,
  rota: string,
  resumo: ResumoDoBatimento,
  agora: Date = new Date(),
): Promise<void> {
  try {
    // O nome vai LITERAL (e não `TABELA_DO_BATIMENTO`): a cerca
    // `on-conflict-aponta-para-constraint-real` só confere o alvo do
    // `onConflict` contra o banco quando lê a tabela no `.from("...")` acima.
    const { error } = await admin
      .from("mia_batimentos_de_cron")
      .upsert({ rota, ultima_rodada_em: agora.toISOString(), resumo }, { onConflict: "rota" });
    if (error) {
      logger.warn("[batimento] não gravou", { rota, detail: error.message });
    }
  } catch (err) {
    logger.warn("[batimento] não gravou", {
      rota,
      detail: err instanceof Error ? err.message : "erro",
    });
  }
}

/** Por que não se sabe. */
export type MotivoDoBatimentoDesconhecido = "sem_tabela" | "falha_de_leitura" | "nao_configurado";

/** A leitura, do jeito que chegou: o carimbo (ou `null` = nunca bateu), ou por que ela não veio. */
export type LeituraDoBatimento = { ultima_rodada_em: string | null } | { falha: MotivoDoBatimentoDesconhecido };

/**
 * O bloco `vigia_dos_canais` da `/api/v1/health`.
 *
 * - `em_dia: true`: bateu há menos de 15 min.
 * - `em_dia: false`: bateu há mais, ou nunca bateu (`ultima_rodada_em: null`).
 * - `em_dia: null`: não se sabe (sem a tabela, leitura falhou). Desconhecido
 *   não é "em dia", como no bloco `backup`: um monitor trata `em_dia !== true`
 *   como problema.
 */
export type EstadoDoVigiaDosCanais =
  | { ultima_rodada_em: string | null; em_dia: boolean }
  | { ultima_rodada_em: null; em_dia: null; motivo: MotivoDoBatimentoDesconhecido };

function instante(texto: string | null): number | null {
  if (!texto) return null;
  const t = new Date(texto).getTime();
  return Number.isFinite(t) ? t : null;
}

/** A leitura julgada contra o relógio. Pura: o relógio vem de fora. */
export function avaliarVigiaDosCanais(leitura: LeituraDoBatimento, agora: Date): EstadoDoVigiaDosCanais {
  if ("falha" in leitura) return { ultima_rodada_em: null, em_dia: null, motivo: leitura.falha };
  if (leitura.ultima_rodada_em === null) return { ultima_rodada_em: null, em_dia: false };

  const bateu = instante(leitura.ultima_rodada_em);
  if (bateu === null) return { ultima_rodada_em: null, em_dia: null, motivo: "falha_de_leitura" };

  const minutos = (agora.getTime() - bateu) / 60_000;
  return {
    ultima_rodada_em: new Date(bateu).toISOString(),
    em_dia: minutos < MINUTOS_PARA_EM_DIA_DO_VIGIA,
  };
}
