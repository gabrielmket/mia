/**
 * FORK MIA — um PostgREST de mentira que CORTA em `max_rows`, como o de verdade.
 *
 * O defeito que os testes de `lib/leitura/todas-as-paginas.ts` medem só existe
 * contra um servidor que devolve no máximo 1000 linhas por pedido e não avisa.
 * Um dublê que obedece ao `.limit(50_000)` deixaria a forma antiga passar verde
 * e mediria o dublê, não o código. Este aqui:
 *
 *   · corta TODA resposta em `maxRows`, por maior que seja o `limit`/`range`;
 *   · aplica de verdade os filtros (`eq`, `neq`, `is`, `not … is null`, `in`,
 *     `gte`, `gt`, `lt`, `lte`), a ordem e o `range`;
 *   · devolve o `count` exato só quando o `select` o pede, e `null` senão;
 *   · sem `order`, devolve na ordem de inserção (o que o Postgres costuma fazer
 *     com a ordem física: as linhas mais ANTIGAS primeiro);
 *   · registra cada pedido, para o teste contar as idas ao banco;
 *   · LANÇA em método que não conhece: engolir a cláusula devolveria a linha
 *     que o filtro existia para excluir (a mesma regra de
 *     `tests/helpers/stages-db-double.ts`).
 */

export type Linha = Record<string, unknown>;

export interface Pedido {
  tabela: string;
  /** `[de, ate]` do `range`, ou `null` quando o pedido não paginou. */
  range: [number, number] | null;
  limit: number | null;
  ordem: Array<{ coluna: string; ascendente: boolean }>;
  pediuContagem: boolean;
  devolvidas: number;
}

export interface Resposta {
  data: Linha[] | null;
  error: { message: string } | null;
  count: number | null;
}

/** A cadeia do dublê: todo filtro devolve a própria cadeia, e ela é aguardável. */
export interface Cadeia extends PromiseLike<Resposta> {
  select(colunas?: string, opcoes?: { count?: "exact"; head?: boolean }): Cadeia;
  eq(coluna: string, valor: unknown): Cadeia;
  neq(coluna: string, valor: unknown): Cadeia;
  is(coluna: string, valor: unknown): Cadeia;
  not(coluna: string, operador: string, valor: unknown): Cadeia;
  in(coluna: string, valores: unknown[]): Cadeia;
  gte(coluna: string, valor: unknown): Cadeia;
  gt(coluna: string, valor: unknown): Cadeia;
  lt(coluna: string, valor: unknown): Cadeia;
  lte(coluna: string, valor: unknown): Cadeia;
  order(coluna: string, opcoes?: { ascending?: boolean }): Cadeia;
  range(de: number, ate: number): Cadeia;
  limit(n: number): Cadeia;
  maybeSingle(): Promise<{ data: Linha | null; error: { message: string } | null }>;
  single(): Promise<{ data: Linha | null; error: { message: string } | null }>;
}

export interface PostgrestComTeto {
  /** O cliente, no formato que `createClient()` devolve. */
  cliente: { from: (tabela: string) => Cadeia };
  pedidos: Pedido[];
  /** Quantos pedidos foram feitos a uma tabela. */
  pedidosEm: (tabela: string) => number;
}

/** Datas ISO comparam como instante; o resto, como veio. */
function comparavel(v: unknown): number | string {
  if (typeof v === "number") return v;
  const texto = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}T/.test(texto)) {
    const ms = Date.parse(texto);
    if (!Number.isNaN(ms)) return ms;
  }
  return texto;
}

function comparar(a: unknown, b: unknown): number {
  const x = comparavel(a);
  const y = comparavel(b);
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

export function postgrestComTeto(
  tabelas: Record<string, Linha[]>,
  opcoes: { maxRows?: number; semContagem?: boolean; falhaEm?: (pedido: number, tabela: string) => string | null } = {},
): PostgrestComTeto {
  const maxRows = opcoes.maxRows ?? 1000;
  const pedidos: Pedido[] = [];
  /**
   * O resultado filtrado e ordenado, por tabela + filtros + ordem. As páginas de
   * uma mesma leitura repetem a consulta inteira e só mudam o `range`; refazer
   * filtro e ordem de dezenas de milhares de linhas a cada ida custava o tempo
   * do teste. As tabelas não mudam depois de criadas (o dublê só lê).
   */
  const memoria = new Map<string, Linha[]>();

  function consulta(tabela: string) {
    const filtros: Array<(l: Linha) => boolean> = [];
    /** O que identifica a consulta, sem o `range`: a chave da `memoria`. */
    const assinatura: string[] = [];
    const filtrar = (nome: string, coluna: string, valor: unknown, f: (l: Linha) => boolean) => {
      assinatura.push(`${nome}:${coluna}:${JSON.stringify(valor)}`);
      filtros.push(f);
      return q;
    };
    const ordem: Pedido["ordem"] = [];
    let range: [number, number] | null = null;
    let limit: number | null = null;
    let pediuContagem = false;
    let soContagem = false;

    function executar(): Resposta {
      const falha = opcoes.falhaEm?.(pedidos.length + 1, tabela) ?? null;
      if (falha) {
        pedidos.push({ tabela, range, limit, ordem, pediuContagem, devolvidas: 0 });
        return { data: null, error: { message: falha }, count: null };
      }
      const chaveDaMemoria = [
        tabela,
        ...assinatura,
        ...ordem.map((o) => `ordem:${o.coluna}:${o.ascendente}`),
      ].join("|");
      let linhas = memoria.get(chaveDaMemoria) ?? null;
      const veioDaMemoria = linhas !== null;
      linhas ??= (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
      if (!veioDaMemoria && ordem.length > 0) {
        // As chaves saem UMA vez por linha: com dezenas de milhares de linhas
        // e um pedido por página, ler a data dentro do comparador custaria caro.
        const comChave = linhas.map((linha) => ({
          linha,
          chave: ordem.map((o) => comparavel(linha[o.coluna])),
        }));
        comChave.sort((a, b) => {
          for (let i = 0; i < ordem.length; i++) {
            const x = a.chave[i]!;
            const y = b.chave[i]!;
            if (x === y) continue;
            const c = x < y ? -1 : 1;
            return ordem[i]!.ascendente ? c : -c;
          }
          return 0;
        });
        linhas = comChave.map((c) => c.linha);
      }
      memoria.set(chaveDaMemoria, linhas);
      const total = linhas.length;
      const de = range ? range[0] : 0;
      const pedidas = range ? range[1] - range[0] + 1 : (limit ?? Number.POSITIVE_INFINITY);
      // O corte do SERVIDOR: vale por cima de qualquer `limit` ou `range`.
      const fatia = soContagem ? [] : linhas.slice(de, de + Math.min(pedidas, maxRows));
      pedidos.push({ tabela, range, limit, ordem, pediuContagem, devolvidas: fatia.length });
      return {
        data: soContagem ? null : fatia,
        error: null,
        count: pediuContagem && !opcoes.semContagem ? total : null,
      };
    }

    const q: Record<string, unknown> = {
      select: (_colunas?: string, o?: { count?: string; head?: boolean }) => {
        pediuContagem = o?.count === "exact";
        soContagem = o?.head === true;
        return q;
      },
      eq: (c: string, v: unknown) => filtrar("eq", c, v, (l) => l[c] === v),
      neq: (c: string, v: unknown) => filtrar("neq", c, v, (l) => l[c] !== v),
      is: (c: string, v: unknown) => filtrar("is", c, v, (l) => (l[c] ?? null) === v),
      not: (c: string, op: string, v: unknown) => {
        if (op !== "is" || v !== null) {
          throw new Error(`dublê: .not("${c}", "${op}", …) só é suportado como "is null"`);
        }
        return filtrar("not-is-null", c, null, (l) => (l[c] ?? null) !== null);
      },
      in: (c: string, vs: unknown[]) => filtrar("in", c, vs, (l) => vs.includes(l[c])),
      gte: (c: string, v: unknown) => filtrar("gte", c, v, (l) => l[c] != null && comparar(l[c], v) >= 0),
      gt: (c: string, v: unknown) => filtrar("gt", c, v, (l) => l[c] != null && comparar(l[c], v) > 0),
      lt: (c: string, v: unknown) => filtrar("lt", c, v, (l) => l[c] != null && comparar(l[c], v) < 0),
      lte: (c: string, v: unknown) => filtrar("lte", c, v, (l) => l[c] != null && comparar(l[c], v) <= 0),
      order: (coluna: string, o?: { ascending?: boolean }) => (
        ordem.push({ coluna, ascendente: o?.ascending !== false }), q
      ),
      range: (de: number, ate: number) => ((range = [de, ate]), q),
      limit: (n: number) => ((limit = n), q),
      maybeSingle: async () => {
        const r = executar();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      single: async () => {
        const r = executar();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      then: (resolver: (r: unknown) => unknown, rejeitar?: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => executar())
          .then(resolver, rejeitar),
    };

    return new Proxy(q, {
      get(alvo, nome) {
        if (typeof nome === "symbol" || nome in alvo) return alvo[nome as string];
        throw new Error(`dublê: método .${String(nome)}() não suportado em "${tabela}"`);
      },
    }) as unknown as Cadeia;
  }

  return {
    cliente: { from: (tabela: string) => consulta(tabela) },
    pedidos,
    pedidosEm: (tabela: string) => pedidos.filter((p) => p.tabela === tabela).length,
  };
}
