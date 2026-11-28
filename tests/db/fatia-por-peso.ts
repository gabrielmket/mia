/**
 * A divisão dos arquivos de tests/invariants entre as fatias do `invariants-majors`
 * (ci.yml), por PESO medido em vez de pelo hash do caminho (MIA-346).
 *
 * ## Por que existe
 *
 * O `--shard=N/M` padrão do vitest ordena os arquivos pelo sha1 do caminho e corta
 * em M pedaços com o mesmo NÚMERO de arquivos. Aqui isso desequilibra: 6 dos ~780
 * arquivos somam 24% do tempo (o mais pesado leva ~165 s, a mediana ~1 s), e onde
 * eles caem decide qual fatia é o caminho crítico. Medido em 28/11/2026 (5 rodadas
 * verdes do ci.yml, tabela na MIA-346): a fatia 1 levava 18 a 25 min de vitest e as
 * outras 12 a 18. A simulação do corte do vitest sobre os tempos medidos reproduz o
 * log (20,2 · 14,1 · 12,5 min contra 20,2 · 14,2 · 12,5) e mostra que uma 4ª fatia
 * pelo hash ainda deixaria uma com ~17 min; por peso, as quatro ficam em ~13.
 *
 * ## Como divide
 *
 * Maior peso primeiro (empate: caminho), cada arquivo vai para a fatia mais leve
 * até ali (empate: a de menor número). É determinístico: toda fatia de todas as
 * majors recebe a MESMA lista (mesmo checkout) e calcula a MESMA divisão, então as
 * fatias são disjuntas e somam todos os arquivos — quem guarda é
 * tests/unit/fatia-por-peso.test.ts.
 *
 * O peso vem de `peso-dos-invariantes.json` (segundos medidos, só os arquivos de
 * 5 s ou mais). Arquivo fora da tabela (novo, ou leve) pesa `PESO_PADRAO`. Tabela
 * velha só piora o EQUILÍBRIO, nunca a cobertura: todo arquivo cai em alguma fatia.
 * Para refazer a tabela: scripts/peso-dos-invariantes.mjs.
 */

/** Segundos de um arquivo leve (média medida dos arquivos abaixo de 5 s: 1,2 s). */
export const PESO_PADRAO = 1.2;

/**
 * O que todo arquivo paga além dos próprios testes: o banco novo copiado do molde
 * (tests/db/banco-limpo-por-arquivo.ts) e o import. Medido no rodapé do vitest:
 * `setup 85s, import 53s` em 259 arquivos ≈ 0,5 s; arredondado para 0,6.
 */
export const CUSTO_FIXO_POR_ARQUIVO = 0.6;

export type Pesos = Readonly<Record<string, number>>;

export function pesoDoArquivo(caminho: string, pesos: Pesos): number {
  const medido = pesos[caminho];
  return (typeof medido === "number" && medido > 0 ? medido : PESO_PADRAO) + CUSTO_FIXO_POR_ARQUIVO;
}

/**
 * Os arquivos da fatia `indice` (1 a `total`). `caminhos` são relativos à raiz do
 * repositório, com `/` (ex.: `tests/invariants/x.test.ts`).
 */
export function fatiaPorPeso(
  caminhos: readonly string[],
  indice: number,
  total: number,
  pesos: Pesos,
): string[] {
  if (!Number.isInteger(total) || total < 1) throw new Error(`total de fatias inválido: ${total}`);
  if (!Number.isInteger(indice) || indice < 1 || indice > total) {
    throw new Error(`fatia ${indice} fora de 1..${total}`);
  }
  const unicos = [...new Set(caminhos)];
  const ordem = unicos
    .map((caminho) => ({ caminho, peso: pesoDoArquivo(caminho, pesos) }))
    .sort((a, b) => b.peso - a.peso || (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0));
  const carga = new Array<number>(total).fill(0);
  const fatia: string[] = [];
  for (const { caminho, peso } of ordem) {
    let destino = 0;
    for (let i = 1; i < total; i++) if ((carga[i] ?? 0) < (carga[destino] ?? 0)) destino = i;
    carga[destino] = (carga[destino] ?? 0) + peso;
    if (destino === indice - 1) fatia.push(caminho);
  }
  return fatia;
}

/**
 * O embaralhamento do vitest (`shuffle` de @vitest/utils/helpers, 4.1), copiado
 * para a MESMA semente dar a MESMA ordem que dava com o sequenciador dele: quem
 * repete uma rodada com `--sequence.seed=<semente do log>` reproduz a ordem.
 */
export function embaralhar<T>(lista: T[], semente: number): T[] {
  let s = semente;
  let n = lista.length;
  while (n) {
    const x = Math.sin(s) * 1e4;
    const i = Math.floor((x - Math.floor(x)) * n--);
    const anterior = lista[n] as T;
    lista[n] = lista[i] as T;
    lista[i] = anterior;
    ++s;
  }
  return lista;
}
