/**
 * ALARGAR A JANELA REPROGRAMA O TURNO QUE ESTAVA ESPERANDO POR ELA.
 *
 * ## O defeito, medido em produção (Academia Body Fit, 18/09/2026)
 *
 * `inbound-turn.ts` adia o turno quando a janela anti-ban está fechada e congela
 * `run_after` na abertura CALCULADA NAQUELE INSTANTE. Nada revisita jobs
 * pendentes quando os knobs mudam: o worker reavalia a janela, mas só depois do
 * `run_after` — tarde demais.
 *
 * Na evidência: job `d2504332…`, `inbound_turn`, `pending`, `run_after` 07:00
 * local, com `channel_knobs` já em 0h–23h. O operador tinha alargado a janela
 * para destravar um teste, e nada aconteceu.
 *
 * É o pior dos defeitos daquela auditoria porque é exatamente o caminho que uma
 * pessoa percorre para se salvar: ela mexe na configuração certa, o sistema não
 * responde, e ela conclui que a configuração não funciona. O produto fica sem
 * saída pela tela.
 *
 * ## Por que reprogramar para AGORA e não para a nova abertura
 *
 * Calcular a nova abertura aqui seria repetir, num segundo lugar, a regra que
 * `janelaDeEnvioAberta`/`proximaAberturaDaJanela` já implementam — e duas réguas
 * divergem na primeira mudança. Trazer para agora devolve a decisão a quem é
 * dono dela: o turno roda, reavalia a janela com os knobs NOVOS e ou responde ou
 * se adia sozinho para a abertura correta.
 *
 * Isso não é caro. O gate da janela roda ANTES de resolver agente e ANTES de
 * qualquer chamada ao modelo: um turno que volta para uma janela ainda fechada
 * custa um claim e um update, não um centavo de IA.
 *
 * ## Por que SÓ `janela_anti_ban`
 *
 * Os outros motivos de adiamento dependem de outra condição — `horario_do_agente`
 * da versão publicada do agente, `canal_fora` de a sessão do canal voltar. Trazê-los
 * junto os faria voltar cedo demais, para serem adiados de novo no mesmo segundo.
 * O motivo vem da COLUNA `deferred_reason` (migration 0251), nunca de comparar o
 * texto de `last_error`: filtrar por frase quebra calado no dia em que alguém
 * melhorar a frase.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChannelKnobsRow } from "@/lib/ai/pacing-knobs";

/**
 * Os campos cuja mudança pode destravar um turno parado. `throttle_ms` e
 * `jitter_max_ms` ficam de fora de propósito: eles mudam o ESPAÇAMENTO entre
 * envios, não a permissão de enviar — e um turno adiado pela janela não está
 * esperando por eles.
 */
const CAMPOS_QUE_MEXEM_NA_JANELA = [
  "window_start_hour",
  "window_end_hour",
  "allow_sunday",
  "timezone",
] as const satisfies ReadonlyArray<keyof ChannelKnobsRow>;

/** O PUT mexeu em algo que pode reabrir a janela deste canal? */
export function mexeuNaJanela(campos: Record<string, unknown>): boolean {
  return CAMPOS_QUE_MEXEM_NA_JANELA.some((c) => c in campos);
}

/**
 * Traz para agora os `inbound_turn` pendentes deste canal que estavam adiados
 * pela janela anti-ban.
 *
 * Devolve quantos reprogramou, ou **`null` quando não foi possível saber** — e a
 * diferença é deliberada. Devolver `0` numa falha de consulta diria "não havia
 * nenhum turno esperando", que é uma afirmação sobre o mundo que ninguém mediu;
 * é a mesma armadilha que fez `channel_knobs.updated_at` custar uma hora. Quem
 * chama mostra "não sei", nunca "nenhum".
 */
export async function reprogramarTurnosAdiadosPelaJanela(input: {
  organizationId: string;
  channelSessionId: string;
}): Promise<number | null> {
  const admin = createAdminClient();
  const agora = new Date().toISOString();

  try {
    // `service_role` passa por cima da RLS: o filtro de `organization_id` é
    // MANUAL e vem do authz da rota, nunca do body (regra dura de multi-tenancy).
    const { data, error } = await admin
      .from("job_queue")
      .update({ run_after: agora, deferred_reason: null })
      .eq("organization_id", input.organizationId)
      .eq("kind", "inbound_turn")
      .eq("status", "pending")
      .eq("deferred_reason", "janela_anti_ban")
      // Só o que ainda está no futuro. Um job já vencido não precisa de empurrão,
      // e reescrever seu `run_after` só o faria perder a vez na ordem do claim.
      .gt("run_after", agora)
      .eq("payload->>channel_session_id", input.channelSessionId)
      .select("id");

    if (error) return null;
    return data?.length ?? 0;
  } catch {
    // O SALVAR DOS KNOBS JÁ ACONTECEU quando chegamos aqui, e ele é o que o
    // operador pediu. Derrubar a resposta inteira porque não deu para mexer na
    // fila devolveria "falha ao salvar" para uma configuração que ESTÁ salva — e
    // mandaria a pessoa tentar de novo contra um estado que já mudou.
    //
    // Devolve `null` ("não sei"), nunca `0` ("não havia nenhum"). É a mesma
    // distinção do `error` acima, e é a lição de `channel_knobs.updated_at`:
    // afirmar sobre o mundo o que não se mediu foi o que custou a hora daquela
    // investigação.
    return null;
  }
}
