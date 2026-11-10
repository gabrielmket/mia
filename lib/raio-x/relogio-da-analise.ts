/**
 * FORK MIA (.106) · O RELÓGIO DA ANÁLISE DO RAIO-X: quanto cada chamada para
 * fora pode levar, e quando ela pode começar.
 *
 * ─── O defeito que isto conserta ────────────────────────────────────────────
 *
 * A rota do cron dá a cada chamada 45 s (`PRAZO_DA_CHAMADA_MS`, o mesmo da
 * importação do histórico do upstream): `prazo = Date.now() + 45 s`. A .101 só
 * chamava o modelo de IA com 45 s INTEIROS pela frente (`temTempo(amb,
 * 45_000)`). Como as leituras do banco antes dela já gastam alguns
 * milissegundos, a classificação devolvia "parou" antes de chamar o modelo em
 * TODA rodada: sem erro, sem custo, para sempre. Os testes davam 10 minutos de
 * prazo com o relógio parado, e o portão nunca fechava neles.
 *
 * ─── A regra agora ──────────────────────────────────────────────────────────
 *
 * Uma chamada que pode levar até `teto` só começa se termina antes do
 * `prazo + FOLGA_DEPOIS_DO_PRAZO_MS`. O agendador corta o curl no `-m` (60 s)
 * do job (`docker/scheduler/entrypoint.sh`): passado o prazo de 45 s sobram
 * 15 s, e 10 s deles podem ser da chamada; os outros 5 s ficam para gravar no
 * banco. `tests/unit/raio-x-analise-anda.test.ts` confere a conta com o `-m`
 * de verdade, e que a chamada do modelo cabe com o relógio andando.
 *
 * O prazo e a margem do upstream (`lib/channels/historico/prazo.ts`) ficam
 * como estão: o raio-X tem os próprios tetos, aqui.
 */

/** Passado o prazo da chamada do cron, quanto uma chamada já começada ainda pode levar. */
export const FOLGA_DEPOIS_DO_PRAZO_MS = 10_000;

/** O download de UM áudio do leitor (ou do storage da conta), no total. Menor que o do upstream (15 s). */
export const TETO_DO_DOWNLOAD_DO_RAIO_X_MS = 10_000;

/** A transcrição de UM áudio. O transcritor do upstream não tem teto; o nosso corta aqui. */
export const TETO_DA_TRANSCRICAO_MS = 30_000;

/** A chamada do modelo que classifica um lote de conversas. */
export const TETO_DA_CLASSIFICACAO_MS = 40_000;

/** Quantos áudios vão juntos, em paralelo. */
export const AUDIOS_EM_PARALELO = 4;

/** Downloads que falham em sequência até desistir dos áudios que faltam no período. */
export const FALHAS_DE_DOWNLOAD_PARA_DESISTIR = 10;

/** Quanto a fase de áudios pode durar, contada de `analise.audios_desde`. */
export const TETO_DA_FASE_DE_AUDIOS_MS = 30 * 60_000;

/** Rodadas que lançam no MESMO item até ele ser deixado de lado. */
export const FALHAS_SEGUIDAS_PARA_PULAR = 3;

/** Cabe começar agora uma chamada que pode levar até `tetoMs`? */
export function cabeAChamada(prazo: number, agora: number, tetoMs: number): boolean {
  return agora + tetoMs <= prazo + FOLGA_DEPOIS_DO_PRAZO_MS;
}

/** A promessa, ou o erro `sem_resposta` depois de `ms`. O timer não segura o processo. */
export async function comTeto<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const corte = new Promise<never>((_, recusar) => {
    timer = setTimeout(() => recusar(new Error("sem_resposta")), ms);
    timer.unref?.();
  });
  // A que perdeu a corrida não pode virar rejeição sem dono.
  promessa.catch(() => undefined);
  try {
    return await Promise.race([promessa, corte]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
