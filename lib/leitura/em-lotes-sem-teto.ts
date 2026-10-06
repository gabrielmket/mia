/**
 * FORK MIA — LER POR LISTA DE IDS, em lotes, sem perder o que passa de 1000.
 *
 * ── A borda que isto fecha ──────────────────────────────────────────────────
 *
 * `buscaEmLotes` (do upstream, `lib/supabase/em-lotes.ts`) quebra a lista de
 * ids em lotes de 100 para o `.in()` caber na URL. Ele resolve o tamanho do
 * PEDIDO, e não o da RESPOSTA: quando a tabela tem VÁRIAS linhas por id, um
 * lote de 100 ids pode devolver mais de 1000 linhas, e aí o PostgREST corta em
 * 1000 sem avisar, lote por lote.
 *
 * É possível, e não é raro: 100 negócios com 15 documentos cada são 1.500
 * obrigações num lote só (medido em `em-lotes-sem-teto.test.ts`). O quadro
 * deixava de avisar o que estava vencido nos negócios que ficavam depois da
 * milésima linha, e a soma de compras de quem compra sempre saía menor.
 *
 * Onde a tabela tem UMA linha por id (contatos por `id`, conversas por `id`), o
 * lote devolve no máximo 100 linhas e o `buscaEmLotes` dele continua certo: só
 * as leituras de "várias por id" passam por aqui.
 *
 * ── Como ──────────────────────────────────────────────────────────────────
 *
 * Os mesmos lotes de 100 ids, em paralelo, e cada lote lido até o fim pelo laço
 * de `todas-as-paginas.ts`: contagem exata na primeira página (um lote que cabe
 * numa página custa a MESMA ida de antes), `range` a partir do que chegou, e
 * `id` como desempate da ordem.
 *
 * Quem chama passa a consulta do lote SEM `range` e sem aguardar, repassando a
 * `contagem` ao `select`:
 *
 *     buscaEmLotesSemTeto<Linha>(ids, (lote, contagem) =>
 *       db.from("tabela").select(COLUNAS, contagem).eq("organization_id", org).in("coluna", lote),
 *     )
 *
 * ⚠️ Não lança: devolve `error`, como o `buscaEmLotes`. E diz `truncado` se
 * algum lote passou do teto de páginas (20 mil linhas para 100 ids).
 */
import { IDS_POR_LOTE } from "@/lib/supabase/em-lotes";

import { lerTodasAsPaginas } from "./todas-as-paginas";

/** Quantas páginas de 1000 UM lote de 100 ids pode ter antes de sair `truncado`. */
const PAGINAS_POR_LOTE = 20;

/** O que vai no segundo argumento do `select` da primeira página de cada lote. */
export type ContagemDoLote = { count: "exact" } | undefined;

interface RespostaDoLote {
  data: readonly unknown[] | null;
  error: { message: string } | null;
  count?: number | null;
}

/** A cadeia do supabase-js antes do `range`: ordena e pagina. */
interface CadeiaDoLote {
  order(coluna: string, opcoes?: { ascending?: boolean }): { range(de: number, ate: number): PromiseLike<RespostaDoLote> };
}

export async function buscaEmLotesSemTeto<T>(
  ids: readonly string[],
  /** A consulta de UM lote, com os filtros e o `.in()`, sem `range`. */
  consulta: (lote: string[], contagem: ContagemDoLote) => unknown,
  opcoes: { desempate?: string } = {},
): Promise<{ data: T[]; error: { message: string } | null; truncado: boolean }> {
  if (ids.length === 0) return { data: [], error: null, truncado: false };
  const desempate = opcoes.desempate ?? "id";

  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_POR_LOTE) lotes.push(ids.slice(i, i + IDS_POR_LOTE));

  const lidos = await Promise.all(
    lotes.map((lote) =>
      lerTodasAsPaginas<T>(
        (de, ate, pedirContagem) =>
          (consulta(lote, pedirContagem ? { count: "exact" } : undefined) as CadeiaDoLote)
            // Desempate único DEPOIS da ordem que quem chama já pediu: paginar
            // por `range` só é correto sobre uma ordem que não empata.
            .order(desempate, { ascending: true })
            .range(de, ate),
        { paginasMaximas: PAGINAS_POR_LOTE },
      ),
    ),
  );

  const data: T[] = [];
  let truncado = false;
  for (const lido of lidos) {
    if (lido.erro) return { data: [], error: { message: lido.erro }, truncado: false };
    data.push(...lido.linhas);
    truncado ||= lido.truncado;
  }
  return { data, error: null, truncado };
}
