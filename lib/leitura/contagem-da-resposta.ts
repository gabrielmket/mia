/**
 * FORK MIA — LER A CONTAGEM de um `select(…, { count: "exact", head: true })`.
 *
 * O PostgREST responde a esse pedido com `count` e sem corpo. É a forma de
 * contar no banco, sem trazer linha e sem o teto de 1000 linhas por resposta.
 *
 * ── Os três casos, e por que o terceiro não é zero ──────────────────────────
 *
 *  · `count` veio número: é a resposta.
 *  · `count` não veio, mas vieram as LINHAS: o cliente ignorou a opção e trouxe
 *    tudo. É o que faz o adaptador de Postgres dos invariantes
 *    (`tests/pg-como-supabase.ts`, cujo `select` só recebe as colunas e não tem
 *    teto de linhas). Contar as linhas ali dá o mesmo número. É o mesmo idioma
 *    de `lib/mcp-plataforma/ferramentas/demonstracao.ts`.
 *  · não veio nem um nem outro: `null`. Quem chama decide, e a decisão certa
 *    quase nunca é zero: "não consegui contar" não é "não há nenhum".
 */
export interface RespostaDeContagem {
  count?: number | null;
  data?: unknown;
}

export function contagemDaResposta(resposta: RespostaDeContagem): number | null {
  if (typeof resposta.count === "number") return resposta.count;
  if (Array.isArray(resposta.data)) return resposta.data.length;
  return null;
}
