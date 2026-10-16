/**
 * FORK MIA — a forma COMPARÁVEL do nome de uma empresa: sem caixa, acento,
 * pontuação nem sufixo societário. A régua do agente, da importação e do aviso
 * de nome parecido (`lib/empresas/parecida.ts`). Mora sozinha para as duas
 * pontas a importarem sem se importarem uma à outra.
 */
/** Sufixos societários que não distinguem uma empresa de outra. */
const SUFIXOS = /\b(ltda|me|epp|eireli|sa|s\/a|s\.a|mei|cia|e cia)\b/g;

/**
 * A forma comparável do nome. NÃO é o que se guarda: a empresa fica com o nome
 * como a pessoa escreveu — normalizar o que se mostra faria a ficha exibir
 * "padaria do ze" para quem digitou direito.
 */
export function nomeComparavel(nome: string): string {
  const limpo = nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(SUFIXOS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  /**
   * Letras soltas em sequência viram uma palavra só: `a b c` → `abc`.
   *
   * É o que faz "A.B.C. Materiais" e "ABC Materiais" serem a mesma
   * empresa — e sigla pontuada é comum em razão social brasileira, enquanto o
   * agente ouve a sigla e digita sem ponto. Sem isto, o mesmo cliente vira duas
   * fichas por causa de três pontos.
   */
  return limpo
    .split(" ")
    .reduce<string[]>((tokens, palavra) => {
      const anterior = tokens[tokens.length - 1];
      if (palavra.length === 1 && anterior !== undefined && anterior.length <= 3 && /^[a-z]+$/.test(anterior)) {
        tokens[tokens.length - 1] = anterior + palavra;
        return tokens;
      }
      tokens.push(palavra);
      return tokens;
    }, [])
    .join(" ")
    .trim();
}
