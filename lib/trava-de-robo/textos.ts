/**
 * FORK MIA (.108) · As frases da trava de robô que alguém LÊ: a nota na conversa,
 * a linha do tempo do negócio, o aviso da Central e o motivo da perda.
 *
 * A chave é o texto em português e a tradução mora em
 * `lib/i18n/dicionario-mia-trava-de-robo.ts`. Dois jeitos de traduzir, como o
 * resto do produto:
 *
 *   - o que é GRAVADO e mostrado como está (a nota da conversa, o aviso da
 *     Central, o rótulo do motivo no funil) sai no idioma da EMPRESA na hora de
 *     gravar, com os números já preenchidos;
 *   - o que a TELA traduz ao ler (`reason` da linha do tempo, por `t()`) é
 *     gravado em português e sem número, para a chave casar.
 */
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

/** O motivo de perda de sistema, como entra em `crm_pipelines.settings.lost_reasons`. */
export const MOTIVO_DE_PERDA_DA_TRAVA = "Robô ou atendimento automático";

/** A categoria de perda do motivo: do outro lado não havia ninguém. */
export const CATEGORIA_DO_MOTIVO_DA_TRAVA = "Ausência";

export const NOTA_DO_ROBO_COM_NEGOCIO =
  "IA pausada: o outro lado é um robô ({mensagens} mensagens automáticas em {minutos} min). Negócio marcado como perdido e conversa encerrada.";
export const NOTA_DO_ROBO_SEM_NEGOCIO =
  "IA pausada: o outro lado é um robô ({mensagens} mensagens automáticas em {minutos} min). Conversa encerrada; não havia negócio aberto.";
export const NOTA_DO_TETO =
  "IA pausada nesta conversa: a IA respondeu {respostas} vezes em {minutos} min. O negócio e a conversa continuam abertos. Para a IA voltar, use Devolver ao automático.";

/** A linha do tempo (traduzida pela tela ao ler, por isso sem número). */
export const LINHA_DO_TEMPO_DO_ROBO =
  "IA pausada: o outro lado é um robô. Negócio marcado como perdido e conversa encerrada.";
export const LINHA_DO_TEMPO_DO_TETO = "IA pausada nesta conversa: limite de respostas da IA atingido.";
export const PERDA_NA_LINHA_DO_TEMPO = "Perdido: robô ou atendimento automático";

/** O aviso da Central, no teto. */
export const TITULO_DO_AVISO_DO_TETO = "IA pausada nesta conversa: limite de respostas atingido";
export const CORPO_DO_AVISO_DO_TETO =
  "A IA respondeu {respostas} vezes em {minutos} min nesta conversa e foi pausada nela. Confira se do outro lado há uma pessoa; para a IA voltar, use Devolver ao automático.";

/** Quem escreveu a nota da conversa. */
export const AUTOR_DA_NOTA = "Sistema";

/** O motivo curto do silêncio da conversa no teto (`conversations.last_handoff_reason`). */
export const MOTIVO_DO_SILENCIO_DO_TETO = "Teto de respostas da IA";

/** Por que o follow-up foi desmarcado (`cron_jobs` e `followup_enrollments.cancel_reason`). */
export const MOTIVO_DO_CANCELAMENTO_DO_FOLLOWUP = "Trava de robô: o outro lado é um robô.";

/** Traduz e preenche `{chave}`. */
export function frase(texto: string, idioma: Idioma, valores: Record<string, string | number> = {}): string {
  let saida = traduzir(texto, idioma);
  for (const [chave, valor] of Object.entries(valores)) saida = saida.split(`{${chave}}`).join(String(valor));
  return saida;
}
