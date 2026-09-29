/**
 * FORK MIA — por que a lista de grupos de um número não veio.
 *
 * `ChannelAdapter.listGroups` LANÇA na falha, com o erro do transporte. Quem
 * está fora de `lib/channels/` não pode ler esse erro (ele nomeia o transporte,
 * e a catraca `lint:channels` recusa a feature que pergunta quem é o canal), e
 * por isso a classificação mora aqui, do lado de dentro da fronteira.
 *
 * Existe por um defeito medido: em produção (29/09/2026) o seletor de grupo de
 * cada empresa, no painel do número de avisos, ficou travado com a frase "não
 * consegui perguntar ao WhatsApp". Sem o porquê, quem opera não sabe se
 * reconecta o número, troca a chave do servidor ou só espera.
 *
 * Devolve um CÓDIGO, não uma frase: a frase é da tela, que a traduz. O erro cru
 * nunca sai daqui — o do teto de tempo carrega o endereço interno do transporte.
 */
export const MOTIVOS_DA_FALHA_DE_GRUPOS = [
  /** O transporte não respondeu dentro do teto. Esperar e recarregar. */
  "sem_resposta",
  /** A instalação não tem o serviço de WhatsApp configurado. */
  "sem_transporte",
  /** A chave do servidor foi recusada. Ler o QR de novo NÃO resolve. */
  "chave_recusada",
  /** A sessão não existe mais no transporte. Reconectar pelo QR. */
  "sessao_inexistente",
  /** A sessão existe mas não está conectada. Reconectar e recarregar. */
  "desconectado",
  /** O transporte recusou com outro código. */
  "recusado",
  /** Nenhum dos acima. */
  "desconhecido",
] as const;

export type MotivoDaFalhaDeGrupos = (typeof MOTIVOS_DA_FALHA_DE_GRUPOS)[number];

export function motivoDaFalhaAoListarGrupos(err: unknown): MotivoDaFalhaDeGrupos {
  const erro = err instanceof Error ? err.message : String(err ?? "");
  if (erro.startsWith("waha_timeout")) return "sem_resposta";
  if (erro === "waha_not_configured") return "sem_transporte";
  const status = /^waha_groups_(\d{3})$/.exec(erro)?.[1];
  if (status === "401" || status === "403") return "chave_recusada";
  if (status === "404") return "sessao_inexistente";
  if (status === "422") return "desconectado";
  if (status) return "recusado";
  return "desconhecido";
}
