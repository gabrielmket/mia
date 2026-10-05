/**
 * FORK MIA — LER TUDO O QUE A CONTA PRECISA, e dizer quando não coube.
 *
 * ── O defeito que isto fecha ────────────────────────────────────────────────
 *
 * O PostgREST devolve no máximo `max_rows` linhas por pedido (1000:
 * `supabase/config.toml` e `PGRST_DB_MAX_ROWS` em
 * `infra/supabase-sistema-mia/docker-compose.yml`). Um `.limit(50_000)` devolve
 * 1000 e não avisa: sem erro, sem cabeçalho que alguém leia. Toda leitura nossa
 * que somava, contava ou tirava média no JavaScript em cima de uma lista assim
 * subcontava em silêncio a partir da linha 1001 — receita do mês, saldo da
 * carteira, custo de IA.
 *
 * ── O idioma é o do upstream ────────────────────────────────────────────────
 *
 * O laço é o de `app/api/v1/pipelines/[id]/stages/win-rates/route.ts` (o mais
 * novo dos dele) e o `truncado` é o de `app/api/v1/reports/tags/route.ts`:
 *
 *   · `count` exato só na PRIMEIRA página: é ele que diz o tamanho de verdade;
 *   · o próximo `range` parte do que CHEGOU, não do tamanho pedido: numa
 *     instalação com `max_rows` menor que a página, página curta não é fim;
 *   · o fim é provado pelo `count` ou por uma página VAZIA, nunca por página
 *     curta (`lib/agenda/protecao-followup.ts`);
 *   · acabou o teto de páginas sem prova de fim: `truncado: true`, e quem
 *     chama leva isso até a tela. Número cortado sem aviso é pior que número
 *     nenhum.
 *
 * Ele não tinha o laço num lugar só (cada rota dele escreve o seu). Aqui ele
 * mora num arquivo NOSSO porque nós o usamos em mais de dez leituras, e dez
 * cópias de um laço com três jeitos de errar a parada divergem no primeiro
 * ajuste.
 *
 * ── O que quem chama precisa garantir ───────────────────────────────────────
 *
 * A consulta de cada página tem de vir ORDENADA por uma coluna estável e com um
 * desempate único (`.order("closed_at").order("id")`). Sem `ORDER BY` o lote é
 * o que o plano der, e o `range` seguinte pode repetir ou pular linha.
 *
 * ⚠️ Não lança: devolve `erro`. Dentro da lista de um `Promise.all`, uma chamada
 * que lança na hora vira Unhandled Rejection e derruba a rodada inteira.
 */

/** O `max_rows` do PostgREST. Pedir mais numa página não traz mais nada. */
export const TAMANHO_DA_PAGINA = 1000;

/** O que o supabase-js devolve de uma consulta de lista. */
interface RespostaDaPagina {
  data: readonly unknown[] | null;
  error: { message: string } | null;
  count?: number | null;
}

export interface LeituraPaginada<T> {
  linhas: T[];
  /**
   * O teto de páginas acabou antes de a leitura provar que chegou ao fim. As
   * `linhas` são um RECORTE (o começo da ordem pedida), e a conta feita em cima
   * delas não é o total.
   */
  truncado: boolean;
  /** Quantas linhas o banco disse haver. `null` = ele não disse. */
  total: number | null;
  /** A mensagem do banco, se alguma página falhou. As `linhas` vêm vazias. */
  erro: string | null;
}

export interface OpcoesDaLeitura {
  /** Quantas páginas, no máximo. Acima disso a leitura sai `truncado`. */
  paginasMaximas: number;
  /** Só para teste e para instalação com página menor. O padrão é 1000. */
  tamanhoDaPagina?: number;
}

/**
 * Lê uma consulta inteira, página a página.
 *
 * `pagina(de, ate, pedirContagem)` monta a consulta de UMA página: os mesmos
 * filtros e a mesma ordem em todas, `range(de, ate)` no fim, e
 * `{ count: "exact" }` no `select` quando `pedirContagem` vem `true`.
 */
export async function lerTodasAsPaginas<T>(
  pagina: (de: number, ate: number, pedirContagem: boolean) => PromiseLike<RespostaDaPagina>,
  opcoes: OpcoesDaLeitura,
): Promise<LeituraPaginada<T>> {
  const tamanho = opcoes.tamanhoDaPagina ?? TAMANHO_DA_PAGINA;
  const linhas: T[] = [];
  let total: number | null = null;
  let acabou = false;

  for (let n = 0; n < opcoes.paginasMaximas && !acabou; n++) {
    const de = linhas.length;
    const { data, error, count } = await pagina(de, de + tamanho - 1, n === 0);
    if (error) return { linhas: [], truncado: false, total: null, erro: error.message };

    // `count` nulo NÃO é zero: é o servidor sem dizer quantas há (cabeçalho
    // ausente, proxy). Tratar como zero encerraria a leitura na primeira página.
    if (n === 0) total = typeof count === "number" ? count : null;

    const lote = (data ?? []) as T[];
    linhas.push(...lote);
    acabou = lote.length === 0 || (total !== null && linhas.length >= total);
  }

  return { linhas, truncado: !acabou, total, erro: null };
}
