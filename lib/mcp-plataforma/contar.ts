/**
 * FORK MIA — CONTAR NO BANCO, sem trazer linha.
 *
 * O checklist da implantação contava trazendo as linhas com `.limit(5000)` e
 * medindo o tamanho da lista. O PostgREST corta toda resposta em 1000 linhas
 * sem avisar, então um catálogo de 3.000 produtos aparecia como "1.000
 * produtos". Aqui a consulta vem com `{ count: "exact", head: true }`: o banco
 * conta, nenhuma linha trafega, e não há teto de linhas para cortar.
 *
 * ⚠️ Contagem que falha LANÇA, e contagem que não veio também: zero no lugar
 * de "não consegui contar" faria o checklist dizer "catálogo vazio" para um
 * cliente que tem catálogo.
 */
type Contagem = PromiseLike<{ count: number | null; error: { message: string } | null }>;

/**
 * `consulta` é a cadeia já filtrada, com `select("id", { count: "exact", head: true })`.
 * `oQue` entra na mensagem de erro ("não consegui contar os produtos: …").
 */
export async function contarNoBanco(consulta: Contagem, oQue: string): Promise<number> {
  const { count, error } = await consulta;
  if (error) throw new Error(`não consegui contar ${oQue}: ${error.message}`);
  // `count` nulo não é zero: é o servidor sem dizer quantas há.
  if (typeof count !== "number") throw new Error(`não consegui contar ${oQue}: o banco não devolveu a contagem`);
  return count;
}
