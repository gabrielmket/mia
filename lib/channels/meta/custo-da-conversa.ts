/**
 * QUANTO CADA CLIENTE GASTOU EM MENSAGEM — a conta, separada da coleta.
 *
 * A Meta manda a CATEGORIA no webhook e o valor em lugar nenhum: ela cobra por
 * tabela, que muda por país e por reajuste dela. Então dinheiro, aqui, é sempre
 * contagem × preço vigente — e o preço mora numa tabela nossa
 * (`platform_precos_meta`).
 *
 * ⚠️ A consequência dessa escolha precisa ficar escrita: um reajuste da Meta
 * muda o valor do PASSADO nos relatórios. É o mal menor: a alternativa seria
 * congelar o preço do dia em cada linha de mensagem, e aí o relatório do mês
 * passado ficaria certo enquanto o do mês inteiro — somando linhas de preços
 * diferentes — deixaria de fechar com a fatura.
 *
 * ⚠️ E a ausência de preço NÃO vira zero. Zero se lê como "de graça", e
 * "categoria sem preço cadastrado" é uma coisa completamente diferente: é uma
 * pergunta para quem opera, não um fato sobre o cliente.
 */

export interface ContagemPorCategoria {
  categoria: string;
  cobradas: number;
}

export interface PrecoDaCategoria {
  categoria: string;
  centavos_brl: number;
}

export interface LinhaDeCusto {
  categoria: string;
  cobradas: number;
  /** `null` = não há preço cadastrado para esta categoria. Nunca 0. */
  centavosUnitarios: number | null;
  /** `null` pelo mesmo motivo. */
  totalCentavos: number | null;
}

export interface CustoDoCliente {
  linhas: LinhaDeCusto[];
  /** Soma só do que TEM preço. */
  totalCentavos: number;
  /** As categorias que ficaram de fora da soma — a tela precisa dizer isso. */
  semPreco: string[];
}

export function calcularCusto(
  contagens: readonly ContagemPorCategoria[],
  precos: readonly PrecoDaCategoria[],
): CustoDoCliente {
  const tabela = new Map(precos.map((p) => [p.categoria, p.centavos_brl]));

  const linhas = contagens
    .map((c) => {
      const unit = tabela.get(c.categoria);
      const centavosUnitarios = unit === undefined ? null : unit;
      return {
        categoria: c.categoria,
        cobradas: c.cobradas,
        centavosUnitarios,
        totalCentavos: centavosUnitarios === null ? null : centavosUnitarios * c.cobradas,
      };
    })
    // Maior gasto primeiro; o que não tem preço vai para o fim, porque é
    // pendência nossa e não informação sobre o cliente.
    .sort((a, b) => (b.totalCentavos ?? -1) - (a.totalCentavos ?? -1));

  return {
    linhas,
    totalCentavos: linhas.reduce((soma, l) => soma + (l.totalCentavos ?? 0), 0),
    semPreco: linhas.filter((l) => l.centavosUnitarios === null).map((l) => l.categoria),
  };
}

/**
 * As categorias que a Meta usa hoje. Serve à tela de preços, para o operador
 * não precisar adivinhar o nome exato — errar a grafia produziria uma linha de
 * preço que nunca casa com mensagem nenhuma, e um custo que fica zero para
 * sempre sem ninguém entender por quê.
 *
 * Não é uma trava: a coleta guarda o que a Meta mandar, inclusive categoria que
 * este código ainda não conhece — e ela aparece na tela como "sem preço", que é
 * exatamente o aviso certo.
 */
export const CATEGORIAS_CONHECIDAS = [
  "marketing",
  "utility",
  "authentication",
  "service",
] as const;
