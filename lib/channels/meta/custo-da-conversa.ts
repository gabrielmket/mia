/**
 * QUANTO CADA CLIENTE GASTOU EM MENSAGEM — a conta, separada da coleta.
 *
 * A Meta manda a CATEGORIA no webhook e o valor em lugar nenhum: ela cobra por
 * tabela, que muda por país e por reajuste dela. Então dinheiro, aqui, é sempre
 * contagem × preço — e o preço mora numa tabela nossa (`platform_precos_meta`,
 * o atual).
 *
 * FORK MIA (MIA-99, migration 9165): o preço tem VIGÊNCIA. Cada mensagem custa
 * o preço que valia no instante dela (`mia_precos_meta_vigencias`, mantida por
 * um gatilho em `platform_precos_meta`), e não o de hoje: até aqui, um reajuste
 * mudava o custo de um mês já fechado. Conta pela vigência é
 * `calcularCustoPorVigencia`; `calcularCusto` (um preço por categoria) continua
 * para quem só tem a tabela atual.
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
  /**
   * `null` = não há preço cadastrado para esta categoria. Nunca 0.
   *
   * Na conta pela vigência (MIA-99), é o preço da mensagem MAIS RECENTE do
   * período que tinha preço: num mês em que o preço mudou há mais de um, e a
   * quebra está em `precos`.
   */
  centavosUnitarios: number | null;
  /** `null` pelo mesmo motivo. Na conta pela vigência, a soma do que tem preço. */
  totalCentavos: number | null;
  /**
   * FORK MIA (MIA-99): as mensagens da categoria por preço vigente, do mais
   * antigo para o mais novo. Só na conta pela vigência. `centavosUnitarios:
   * null` = mensagens de um instante sem preço vigente.
   */
  precos?: PrecoAplicado[];
}

/** FORK MIA (MIA-99): quantas mensagens de uma categoria custaram um mesmo preço. */
export interface PrecoAplicado {
  centavosUnitarios: number | null;
  cobradas: number;
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

// ── A conta pela vigência (FORK MIA, MIA-99) ─────────────────────────────────

/** Uma linha de `mia_precos_meta_vigencias` (migration 9165). */
export interface VigenciaDoPreco {
  categoria: string;
  centavos_brl: number;
  /**
   * O início, inclusive. `-infinity` = desde sempre (o primeiro preço da
   * categoria). Vem como texto do PostgREST e como `Date` ou número do `pg`.
   */
  vigente_desde: string | Date | number;
  /** O fim, exclusive. `null` = é o preço atual. */
  vigente_ate: string | Date | number | null;
}

/** Uma mensagem cobrada pela Meta: a categoria e o instante dela. */
export interface MensagemCobrada {
  categoria: string;
  /** Texto do PostgREST, `Date` do `pg`. */
  created_at: string | Date;
}

/**
 * O instante, em milissegundos, de uma ponta de vigência. `-infinity` e
 * `infinity` são as do Postgres; o que não se lê como data é recusado em vez de
 * virar NaN, que faria a mensagem cair em vigência nenhuma sem aviso.
 */
export function instanteDe(valor: string | Date | number): number {
  if (typeof valor === "number") return valor;
  if (valor instanceof Date) return valor.getTime();
  if (valor === "-infinity") return Number.NEGATIVE_INFINITY;
  if (valor === "infinity") return Number.POSITIVE_INFINITY;
  const ms = Date.parse(valor);
  if (Number.isNaN(ms)) throw new Error(`vigência com data ilegível: ${valor}`);
  return ms;
}

interface FaixaDePreco {
  desde: number;
  ate: number;
  centavos: number;
}

function faixasPorCategoria(vigencias: readonly VigenciaDoPreco[]): Map<string, FaixaDePreco[]> {
  const porCategoria = new Map<string, FaixaDePreco[]>();
  for (const v of vigencias) {
    const faixa = {
      desde: instanteDe(v.vigente_desde),
      ate: v.vigente_ate === null ? Number.POSITIVE_INFINITY : instanteDe(v.vigente_ate),
      centavos: v.centavos_brl,
    };
    const lista = porCategoria.get(v.categoria) ?? [];
    lista.push(faixa);
    porCategoria.set(v.categoria, lista);
  }
  return porCategoria;
}

/**
 * O custo pelas mensagens, cada uma ao preço que valia NO INSTANTE dela
 * (`vigente_desde <= created_at < vigente_ate`). É o que mantém o mês fechado
 * igual depois de um reajuste: as mensagens de outubro custam o preço de
 * outubro, mesmo que o de hoje seja outro.
 *
 * Mesmo formato de `calcularCusto`, uma linha por categoria, com a quebra por
 * preço em `precos`. A mensagem de um instante sem preço vigente (categoria que
 * nunca teve preço, ou que foi apagada) fica fora da soma e põe a categoria em
 * `semPreco`, como antes: nunca zero.
 */
export function calcularCustoPorVigencia(
  mensagens: readonly MensagemCobrada[],
  vigencias: readonly VigenciaDoPreco[],
): CustoDoCliente {
  const faixas = faixasPorCategoria(vigencias);

  interface Acumulado {
    cobradas: number;
    /** Por preço (`null` = sem preço): quantas e o instante da mais recente. */
    porPreco: Map<number | null, { cobradas: number; desde: number; maisRecente: number }>;
  }
  const porCategoria = new Map<string, Acumulado>();

  for (const m of mensagens) {
    const ms = instanteDe(m.created_at);
    const faixa = (faixas.get(m.categoria) ?? []).find((f) => f.desde <= ms && ms < f.ate);
    const preco = faixa ? faixa.centavos : null;
    const acc = porCategoria.get(m.categoria) ?? { cobradas: 0, porPreco: new Map() };
    acc.cobradas += 1;
    const doPreco = acc.porPreco.get(preco) ?? {
      cobradas: 0,
      desde: faixa ? faixa.desde : Number.POSITIVE_INFINITY,
      maisRecente: Number.NEGATIVE_INFINITY,
    };
    doPreco.cobradas += 1;
    doPreco.maisRecente = Math.max(doPreco.maisRecente, ms);
    acc.porPreco.set(preco, doPreco);
    porCategoria.set(m.categoria, acc);
  }

  const linhas: LinhaDeCusto[] = [...porCategoria.entries()]
    .map(([categoria, acc]) => {
      const precos: PrecoAplicado[] = [...acc.porPreco.entries()]
        .sort((a, b) => a[1].desde - b[1].desde)
        .map(([centavos, p]) => ({
          centavosUnitarios: centavos,
          cobradas: p.cobradas,
          totalCentavos: centavos === null ? null : centavos * p.cobradas,
        }));
      const comPreco = [...acc.porPreco.entries()].filter(([centavos]) => centavos !== null);
      const maisRecente = comPreco.sort((a, b) => b[1].maisRecente - a[1].maisRecente)[0];
      return {
        categoria,
        cobradas: acc.cobradas,
        centavosUnitarios: maisRecente ? maisRecente[0] : null,
        totalCentavos:
          comPreco.length === 0
            ? null
            : precos.reduce((soma, p) => soma + (p.totalCentavos ?? 0), 0),
        precos,
      };
    })
    .sort((a, b) => (b.totalCentavos ?? -1) - (a.totalCentavos ?? -1));

  return {
    linhas,
    totalCentavos: linhas.reduce((soma, l) => soma + (l.totalCentavos ?? 0), 0),
    semPreco: linhas
      .filter((l) => (l.precos ?? []).some((p) => p.centavosUnitarios === null))
      .map((l) => l.categoria),
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
