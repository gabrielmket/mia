/**
 * FORK MIA (.108) · A etiqueta que a trava de robô põe no contato, e a pergunta
 * "este contato está travado como robô?" (pura).
 *
 * Mora num arquivo próprio, sem dependência, para o nascimento do negócio
 * (`lib/leads/nascimento-do-lead.ts`, caminho quente da ingestão) poder perguntar
 * sem carregar o resto da trava.
 */

/** A etiqueta, já como `normalizarTags` a deixa (minúsculas). */
export const ETIQUETA_DE_ROBO = "robô";

/**
 * O contato está com a trava de robô de pé? A etiqueta "robô" E a IA calada pelo
 * `force_human`, as duas coisas que a trava grava.
 *
 * As duas, e não só a etiqueta: a etiqueta fica como histórico quando alguém
 * devolve a conversa para a IA ("Devolver ao automático" solta o `force_human`),
 * e a partir daí o contato volta a ser tratado como qualquer outro.
 */
export function contatoTravadoComoRobo(contato: { tags?: unknown; force_human?: unknown } | null | undefined): boolean {
  if (!contato || contato.force_human !== true) return false;
  const tags = Array.isArray(contato.tags) ? contato.tags : [];
  return tags.some((t) => typeof t === "string" && t.trim().toLowerCase() === ETIQUETA_DE_ROBO);
}
