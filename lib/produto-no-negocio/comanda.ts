/**
 * FORK MIA (.109) · a comanda do ganho com uma linha por item
 * (docs/fork/produto-no-negocio.md).
 *
 * Onde a comanda do ganho está ligada (`settings.comanda_no_ganho`, #1477), ela
 * abria com UMA linha: o valor do negócio e a descrição do funil. Com itens no
 * negócio, ela abre com uma linha por item (nome, quantidade, preço congelado e
 * desconto), que é o que quem cobra precisa conferir.
 *
 * ── O total da comanda continua sendo o valor do negócio ────────────────────
 *
 * A comanda nasceu para cobrar o valor do negócio, e é ele que segue valendo.
 * Quando o valor foi digitado à mão e não bate com a soma, a diferença entra:
 *   valor MAIOR que a soma   uma linha a mais, "Ajuste do valor digitado à mão";
 *   valor MENOR que a soma   desconto a mais nas linhas, da última para a
 *                            primeira, sem nenhuma ficar negativa.
 * `sale_items` não aceita preço negativo (CHECK do upstream), e é por isso que o
 * ajuste para baixo vira desconto e não uma linha.
 */
import { valorDoItem, type ItemDoNegocio } from "./regras";

export interface LinhaDaComanda {
  descricao: string;
  /** `sale_items.quantity` é inteiro: item da proposta com fração vira 1 linha com o valor cheio. */
  quantidade: number;
  precoUnitarioCents: number;
  descontoCents: number;
  totalCents: number;
}

/**
 * As linhas da comanda do ganho. `null` quando o negócio não tem item: quem
 * chama segue com a linha única de sempre.
 */
export function linhasDaComanda(
  itens: readonly ItemDoNegocio[],
  valorDoNegocioCents: number,
  rotuloDoAjuste: string,
): LinhaDaComanda[] | null {
  if (itens.length === 0) return null;
  const linhas: LinhaDaComanda[] = itens.map((it) => {
    const inteira = Number.isInteger(it.quantidade) && it.quantidade > 0;
    const quantidade = inteira ? it.quantidade : 1;
    const preco = inteira ? it.precoUnitarioCents : Math.round(it.quantidade * it.precoUnitarioCents);
    const bruto = quantidade * preco;
    const desconto = Math.min(it.descontoCents, bruto);
    return {
      descricao: it.nome,
      quantidade,
      precoUnitarioCents: preco,
      descontoCents: desconto,
      totalCents: valorDoItem(it),
    };
  });

  const soma = linhas.reduce((a, l) => a + l.totalCents, 0);
  let diferenca = valorDoNegocioCents - soma;
  if (diferenca > 0) {
    linhas.push({
      descricao: rotuloDoAjuste,
      quantidade: 1,
      precoUnitarioCents: diferenca,
      descontoCents: 0,
      totalCents: diferenca,
    });
  } else if (diferenca < 0) {
    for (let i = linhas.length - 1; i >= 0 && diferenca < 0; i--) {
      const l = linhas[i]!;
      const tira = Math.min(l.totalCents, -diferenca);
      l.descontoCents += tira;
      l.totalCents -= tira;
      diferenca += tira;
    }
  }
  return linhas;
}
